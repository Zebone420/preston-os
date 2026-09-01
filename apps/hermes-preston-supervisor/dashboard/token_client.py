"""Preston Supervisor - durable OAuth token client. SERVER SIDE ONLY.

Resolves the bearer that preston_client presents to Preston Control's
seven read routes. The 'hermes' surface is a dedicated confidential
OAuth client of the platform auth server; its access tokens are
short-lived (~1h), so durability comes from a refresh-token store
with rotation capture (the proven os-runtime resolver pattern,
ported to stdlib Python):

  - the store file holds the CURRENT refresh token plus a cached
    access token and its expiry; the auth server rotates the refresh
    token on every use, so the rotated value is persisted atomically
    (same-directory exclusive temp file + os.replace) BEFORE the new
    access token is handed to a caller;
  - a cached access token inside the reuse margin of its expiry is
    treated as expired; a still-fresh one is returned without any
    network round trip;
  - every failure is CLOSED: missing env, missing/unseeded/malformed
    store, refresh refusal, missing rotation -> a static error tag,
    never a fallback credential, never any token text in a message;
  - client authentication at the token endpoint is HTTP Basic
    (client_secret_basic), matching the confidential client config;
  - no static long-lived bearer path exists in this module at all.

The ONE-TIME seeding of the store (authorization-code + PKCE consent
completed by the owner in a browser) lives in tools/link_bootstrap.py
outside this runtime tree; this module never runs an authorization
flow and never prompts anyone.
"""

import base64
import json
import os
import threading
import urllib.error
import urllib.parse
import urllib.request

ENV_TOKEN_URL = "HERMES_PRESTON_OAUTH_TOKEN_URL"
ENV_CLIENT_ID = "HERMES_PRESTON_OAUTH_CLIENT_ID"
ENV_CLIENT_SECRET = "HERMES_PRESTON_OAUTH_CLIENT_SECRET"
ENV_STORE = "HERMES_PRESTON_TOKEN_STORE"

TIMEOUT_SECONDS = 15
MAX_RESPONSE_BYTES = 64 * 1024
# An access token this close to expiry is treated as already expired.
REUSE_MARGIN_SECONDS = 120

_LOCK = threading.Lock()


class TokenError(Exception):
    """Carries ONLY a static tag; never token or endpoint text."""

    def __init__(self, tag):
        super().__init__(tag)
        self.tag = tag


def read_oauth_config(env=None):
    env = os.environ if env is None else env
    token_url = str(env.get(ENV_TOKEN_URL, "") or "").strip()
    client_id = str(env.get(ENV_CLIENT_ID, "") or "").strip()
    client_secret = str(env.get(ENV_CLIENT_SECRET, "") or "").strip()
    store_path = str(env.get(ENV_STORE, "") or "").strip()
    ok_url = token_url.startswith("https://")
    return {
        "token_url": token_url if ok_url else "",
        "client_id": client_id,
        "client_secret": client_secret,
        "store_path": store_path,
        "configured": bool(
            ok_url and client_id and client_secret and store_path
        ),
    }


def _parse_store(raw):
    """Store payload -> dict, or None when malformed. Shape:
    {"v": 1, "refresh_token": str,
     "access_token": str?, "access_expires_at": epoch-seconds?}"""
    try:
        payload = json.loads(raw.decode("utf-8"))
    except Exception:
        return None
    if not isinstance(payload, dict) or payload.get("v") != 1:
        return None
    refresh = payload.get("refresh_token")
    if not isinstance(refresh, str) or not refresh.strip():
        return None
    return payload


def store_state(env=None):
    """Secret-free store descriptor for the link banner:
    'unconfigured' | 'unseeded' | 'ready' | 'error'."""
    cfg = read_oauth_config(env)
    if not cfg["configured"]:
        return "unconfigured"
    try:
        with open(cfg["store_path"], "rb") as handle:
            raw = handle.read(MAX_RESPONSE_BYTES)
    except FileNotFoundError:
        return "unseeded"
    except OSError:
        return "error"
    return "ready" if _parse_store(raw) else "error"


def _atomic_write(store_path, payload):
    """Exclusive same-directory temp + fsync + os.replace. Restrictive
    mode on creation; best effort on platforms that ignore it."""
    tmp = store_path + ".tmp." + str(os.getpid())
    data = json.dumps(payload).encode("utf-8")
    fd = os.open(tmp, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        os.write(fd, data)
        os.fsync(fd)
    finally:
        os.close(fd)
    try:
        os.replace(tmp, store_path)
    except OSError:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise


def write_store(store_path, refresh_token, access_token=None,
                access_expires_at=None):
    """Shared with tools/link_bootstrap.py so the seeded store and the
    rotated store are byte-identical in shape."""
    payload = {"v": 1, "refresh_token": refresh_token}
    if access_token and access_expires_at:
        payload["access_token"] = access_token
        payload["access_expires_at"] = access_expires_at
    _atomic_write(store_path, payload)


def _refresh(cfg, refresh_token, opener):
    """refresh_token grant with client_secret_basic. Returns
    (access_token, rotated_refresh_or_None, expires_at_or_None)."""
    body = urllib.parse.urlencode({
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
    }).encode("ascii")
    basic = base64.b64encode(
        (cfg["client_id"] + ":" + cfg["client_secret"]).encode("utf-8")
    ).decode("ascii")
    request = urllib.request.Request(
        cfg["token_url"],
        data=body,
        method="POST",
        headers={
            "Authorization": "Basic " + basic,
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
        },
    )
    open_fn = opener if opener is not None else urllib.request.urlopen
    try:
        with open_fn(request, timeout=TIMEOUT_SECONDS) as response:
            raw = response.read(MAX_RESPONSE_BYTES)
    except urllib.error.HTTPError:
        # Revoked / rotated-away / bad client auth. Tag only.
        raise TokenError("token_refresh_refused")
    except Exception:
        raise TokenError("token_endpoint_unreachable")
    try:
        payload = json.loads(raw.decode("utf-8"))
    except Exception:
        raise TokenError("token_refresh_refused")
    access = str(payload.get("access_token") or "").strip()
    if not access:
        raise TokenError("token_refresh_refused")
    rotated = str(payload.get("refresh_token") or "").strip() or None
    expires_at = payload.get("expires_at")
    if not isinstance(expires_at, (int, float)):
        expires_in = payload.get("expires_in")
        expires_at = (
            _now() + float(expires_in)
            if isinstance(expires_in, (int, float)) else None
        )
    return access, rotated, expires_at


def _now():
    import time

    return time.time()


def resolve_access_token(env=None, opener=None, now=None,
                         force_refresh=False):
    """Return a bearer for the Preston read surface, refreshing and
    persisting rotation when needed. Raises TokenError (static tag)
    on ANY failure - there is no fallback of any kind."""
    with _LOCK:
        cfg = read_oauth_config(env)
        if not cfg["configured"]:
            raise TokenError("link_oauth_unconfigured")
        try:
            with open(cfg["store_path"], "rb") as handle:
                raw = handle.read(MAX_RESPONSE_BYTES)
        except FileNotFoundError:
            raise TokenError("token_store_missing")
        except OSError:
            raise TokenError("token_store_unreadable")
        payload = _parse_store(raw)
        if payload is None:
            raise TokenError("token_store_malformed")

        current_time = _now() if now is None else now
        cached = str(payload.get("access_token") or "").strip()
        expires_at = payload.get("access_expires_at")
        if (
            not force_refresh
            and cached
            and isinstance(expires_at, (int, float))
            and expires_at - current_time > REUSE_MARGIN_SECONDS
        ):
            return cached

        access, rotated, new_expires_at = _refresh(
            cfg, payload["refresh_token"], opener
        )
        if not rotated:
            # Without the rotated refresh token the NEXT run would
            # present a consumed one and kill the session family.
            raise TokenError("token_rotation_missing")
        write_store(cfg["store_path"], rotated, access, new_expires_at)
        return access
