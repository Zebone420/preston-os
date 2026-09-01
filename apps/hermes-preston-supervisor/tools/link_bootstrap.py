"""Preston link bootstrap - OWNER-RUN, ONE TIME per environment.

Seeds the Preston Supervisor refresh-token store by walking the
authorization-code + PKCE flow against the platform auth server for
the dedicated 'hermes' confidential OAuth client (client_secret_basic
at the token endpoint). RFC 8252 loopback redirect: a one-shot HTTP
listener on 127.0.0.1 receives the code; nothing is ever exposed
beyond loopback and the listener exits as soon as one callback lands.

What this script does NOT do:
  - it never prints, logs, or stores any token or secret in output;
  - it never talks to Preston Control at all;
  - it never runs as a service; the durable runtime path is
    dashboard/token_client.py (refresh + rotation capture only).

Required environment (names only; values are owner-held):
  HERMES_PRESTON_OAUTH_TOKEN_URL   https auth-server OAuth token URL
                                   (must end in /oauth/token)
  HERMES_PRESTON_OAUTH_CLIENT_ID   the hermes staging client id
  HERMES_PRESTON_TOKEN_STORE       path the store file is written to
  HERMES_PRESTON_OAUTH_CLIENT_SECRET  optional; prompted via getpass
                                      (hidden) when unset
  HERMES_PRESTON_BOOTSTRAP_PORT    optional loopback port (9127)

Run:  python tools/link_bootstrap.py
Then open the printed URL in the owner browser session, sign in as
the owner, and approve the consent screen. On success the script
prints only the store path.
"""

import base64
import getpass
import hashlib
import json
import os
import pathlib
import secrets
import sys
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

_DASHBOARD = str(
    pathlib.Path(__file__).resolve().parent.parent / "dashboard"
)
if _DASHBOARD not in sys.path:
    sys.path.insert(0, _DASHBOARD)

import token_client  # noqa: E402

TIMEOUT_SECONDS = 30
WAIT_SECONDS = 300


def b64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


class _Callback(BaseHTTPRequestHandler):
    result = None
    expected_state = ""

    def do_GET(self):  # noqa: N802 (stdlib handler contract)
        parsed = urllib.parse.urlsplit(self.path)
        if parsed.path != "/callback":
            self.send_response(404)
            self.end_headers()
            return
        query = urllib.parse.parse_qs(parsed.query)
        state = (query.get("state") or [""])[0]
        code = (query.get("code") or [""])[0]
        upstream_error = (query.get("error") or [""])[0]
        if state != _Callback.expected_state:
            _Callback.result = ("error", "state_mismatch")
        elif upstream_error:
            _Callback.result = ("error", "authorization_refused")
        elif not code:
            _Callback.result = ("error", "no_code")
        else:
            _Callback.result = ("code", code)
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.end_headers()
        self.wfile.write(
            b"Preston link bootstrap: you may close this tab.\n"
        )

    def log_message(self, *args):  # silence default request logging
        pass


def main():
    token_url = os.environ.get(
        token_client.ENV_TOKEN_URL, ""
    ).strip()
    client_id = os.environ.get(
        token_client.ENV_CLIENT_ID, ""
    ).strip()
    store_path = os.environ.get(token_client.ENV_STORE, "").strip()
    if (
        not token_url.startswith("https://")
        or not token_url.endswith("/oauth/token")
        or not client_id
        or not store_path
    ):
        print(
            "bootstrap: set "
            + token_client.ENV_TOKEN_URL
            + " (https, ending /oauth/token), "
            + token_client.ENV_CLIENT_ID
            + " and "
            + token_client.ENV_STORE
        )
        return 78
    if os.path.exists(store_path):
        print("bootstrap: store already exists; refusing to overwrite")
        print("bootstrap: remove it first ONLY if reseeding on purpose")
        return 78
    client_secret = os.environ.get(
        token_client.ENV_CLIENT_SECRET, ""
    ).strip()
    if not client_secret:
        client_secret = getpass.getpass(
            "hermes staging client secret (hidden): "
        ).strip()
    if not client_secret:
        print("bootstrap: no client secret provided")
        return 78

    port = int(os.environ.get("HERMES_PRESTON_BOOTSTRAP_PORT", "9127"))
    redirect_uri = "http://127.0.0.1:" + str(port) + "/callback"
    authorize_url = token_url[: -len("/token")] + "/authorize"
    verifier = b64url(secrets.token_bytes(32))
    challenge = b64url(hashlib.sha256(verifier.encode("ascii")).digest())
    state = b64url(secrets.token_bytes(24))
    _Callback.expected_state = state
    _Callback.result = None

    query = urllib.parse.urlencode({
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "scope": "email",
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    })
    print("bootstrap: open this URL in the OWNER browser session:")
    print()
    print("  " + authorize_url + "?" + query)
    print()
    print(
        "bootstrap: waiting up to "
        + str(WAIT_SECONDS)
        + "s on "
        + redirect_uri
    )

    server = HTTPServer(("127.0.0.1", port), _Callback)
    server.timeout = WAIT_SECONDS
    try:
        server.handle_request()
    finally:
        server.server_close()
    if _Callback.result is None:
        print("bootstrap: timed out waiting for the callback")
        return 75
    kind, value = _Callback.result
    if kind != "code":
        print("bootstrap: failed (" + value + ")")
        return 70

    body = urllib.parse.urlencode({
        "grant_type": "authorization_code",
        "code": value,
        "redirect_uri": redirect_uri,
        "code_verifier": verifier,
    }).encode("ascii")
    basic = base64.b64encode(
        (client_id + ":" + client_secret).encode("utf-8")
    ).decode("ascii")
    request = urllib.request.Request(
        token_url,
        data=body,
        method="POST",
        headers={
            "Authorization": "Basic " + basic,
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(
            request, timeout=TIMEOUT_SECONDS
        ) as response:
            payload = json.loads(response.read(64 * 1024))
    except urllib.error.HTTPError as exc:
        print("bootstrap: token exchange refused (HTTP "
              + str(exc.code) + ")")
        return 70
    except Exception:
        print("bootstrap: token endpoint unreachable")
        return 70

    access = str(payload.get("access_token") or "").strip()
    refresh = str(payload.get("refresh_token") or "").strip()
    if not access or not refresh:
        print("bootstrap: response lacked access or refresh token")
        return 70
    expires_at = payload.get("expires_at")
    if not isinstance(expires_at, (int, float)):
        expires_in = payload.get("expires_in")
        expires_at = (
            token_client._now() + float(expires_in)
            if isinstance(expires_in, (int, float)) else None
        )
    token_client.write_store(store_path, refresh, access, expires_at)
    print("bootstrap: store seeded at " + store_path)
    print("bootstrap: done; tokens were NOT printed anywhere")
    return 0


if __name__ == "__main__":
    sys.exit(main())
