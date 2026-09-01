"""Preston Supervisor - Preston Control read client. READ ONLY.

This module is the ONLY doorway between the Hermes dashboard plugin
and Preston Control. It speaks the supported authenticated HTTP
surface (/api/control/*) and exposes EXACTLY the seven supported read
operations. Everything else is refused by the op allowlist.

Security posture (pinned by test/security-boundary.test.ts and
test_preston_client.py):
  - GET only; no write/consequential Preston operation is reachable.
  - Fail closed: missing configuration means 'link not configured',
    never a guess, never a fallback credential.
  - The bearer is resolved SERVER SIDE per request by token_client
    (dedicated 'hermes' OAuth client, refresh-token store, rotation
    captured); there is NO static long-lived bearer path. No token
    is ever echoed into any response, log, or error, and none ever
    reaches the browser.
  - No direct database access, no shell, no process spawning of any
    kind. Standard library HTTP only.
  - Signed artifact URLs pass through to the caller and are never
    cached or persisted here.

Machine-to-machine auth: Preston Control accepts three per-surface
OAuth clients ('mcp', 'gpt', 'hermes'); the 'hermes' client is valid
for the seven read routes ONLY, so even this process's own bearer
carries no write authority (auth.ts + http.ts READ_SURFACES).
"""

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request

import token_client

ENV_URL = "HERMES_PRESTON_CONTROL_URL"

TIMEOUT_SECONDS = 15
MAX_RESPONSE_BYTES = 512 * 1024

UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
ARTIFACT_ID_RE = re.compile(r"^art-[0-9a-f]{32}$")
CURSOR_RE = re.compile(r"^[A-Za-z0-9:._-]{1,240}$")

# The COMPLETE reachable Preston surface. Adding an entry here is a
# governance change; the boundary tests pin this map to reads only.
ALLOWED_OPS = {
    "status": "/api/control/status",
    "goal": "/api/control/goals/{goal_id}",
    "job": "/api/control/jobs/{job_id}",
    "approvals": "/api/control/approvals",
    "events": "/api/control/events",
    "evidence": "/api/control/evidence",
    "artifact": "/api/control/artifacts/{artifact_id}",
}

PATH_PARAM_RES = {
    "goal_id": UUID_RE,
    "job_id": UUID_RE,
    "artifact_id": ARTIFACT_ID_RE,
}

# Query parameters accepted per op (everything else is dropped).
ALLOWED_QUERY = {
    "events": ("cursor", "limit"),
    "evidence": ("goal_id", "job_id"),
}


def read_config(env=None):
    env = os.environ if env is None else env
    url = str(env.get(ENV_URL, "") or "").strip().rstrip("/")
    ok_url = url.startswith("https://") or url.startswith(
        "http://127.0.0.1"
    ) or url.startswith("http://localhost")
    oauth = token_client.read_oauth_config(env)
    return {
        "url": url if ok_url else "",
        "configured": bool(ok_url and url and oauth["configured"]),
    }


def link_state(env=None):
    """Secret-free link descriptor for the UI. Never includes any
    token or any part of one."""
    cfg = read_config(env)
    host = ""
    if cfg["url"]:
        try:
            host = urllib.parse.urlsplit(cfg["url"]).netloc
        except ValueError:
            host = ""
    return {
        "configured": cfg["configured"],
        "host": host,
        "store": token_client.store_state(env),
    }


def build_url(base, op, path_params, query):
    if op not in ALLOWED_OPS:
        raise ValueError("op_not_allowed")
    path = ALLOWED_OPS[op]
    for name, pattern in PATH_PARAM_RES.items():
        marker = "{" + name + "}"
        if marker in path:
            value = str((path_params or {}).get(name, "") or "")
            if not pattern.match(value):
                raise ValueError(name + "_invalid")
            path = path.replace(marker, urllib.parse.quote(value, safe=""))
    pairs = []
    for key in ALLOWED_QUERY.get(op, ()):
        value = (query or {}).get(key)
        if value is None or value == "":
            continue
        value = str(value)
        if key == "cursor" and not CURSOR_RE.match(value):
            # A malformed cursor is still FORWARDED shape-checked?
            # No: refuse locally with the same tag the platform uses,
            # so garbage can never become a request.
            raise ValueError("cursor_invalid")
        if key == "limit":
            if not value.isdigit():
                continue
            value = str(max(1, min(100, int(value))))
        if key in ("goal_id", "job_id") and not UUID_RE.match(value):
            raise ValueError(key + "_invalid")
        pairs.append((key, value))
    qs = urllib.parse.urlencode(pairs)
    return base + path + ("?" + qs if qs else "")


def fetch_op(op, path_params=None, query=None, env=None, opener=None,
             token_resolver=None):
    """Perform one allowed Preston Control read. Returns a JSON-safe
    dict; never raises to the route layer; never leaks any token."""
    cfg = read_config(env)
    if not cfg["configured"]:
        return {
            "linked": False,
            "ok": False,
            "error": "preston_link_not_configured",
        }
    try:
        url = build_url(cfg["url"], op, path_params, query)
    except ValueError as exc:
        # exc carries only our own static tags (see build_url).
        return {"linked": True, "ok": False, "error": str(exc)}

    def default_resolver(force=False):
        return token_client.resolve_access_token(
            env=env, force_refresh=force
        )

    resolver = (
        token_resolver if token_resolver is not None else default_resolver
    )
    open_fn = opener if opener is not None else urllib.request.urlopen
    forced = False
    while True:
        try:
            token = resolver(force=forced)
        except token_client.TokenError as exc:
            # Static tag from token_client; fail closed, no fallback.
            return {"linked": True, "ok": False, "error": exc.tag}
        request = urllib.request.Request(
            url,
            method="GET",
            headers={
                "Authorization": "Bearer " + token,
                "Accept": "application/json",
            },
        )
        try:
            with open_fn(request, timeout=TIMEOUT_SECONDS) as response:
                raw = response.read(MAX_RESPONSE_BYTES + 1)
                status = getattr(response, "status", 200)
            break
        except urllib.error.HTTPError as exc:
            status = exc.code
            if status == 401 and not forced:
                # One forced refresh covers an access token revoked or
                # rotated away inside its reuse window; a second 401
                # fails closed below - never more than one retry.
                forced = True
                continue
            try:
                raw = exc.read(MAX_RESPONSE_BYTES + 1)
            except Exception:
                raw = b""
            if status in (401, 403):
                return {
                    "linked": True,
                    "ok": False,
                    "error": "preston_auth_failed",
                    "status": status,
                }
            if status == 503:
                return {
                    "linked": True,
                    "ok": False,
                    "error": "preston_control_disabled",
                    "status": status,
                }
            break
        except Exception:
            # Network/timeout class. Static tag only - exception text
            # can embed the URL, which is config, not for the browser.
            return {
                "linked": True,
                "ok": False,
                "error": "preston_unreachable",
            }

    if len(raw) > MAX_RESPONSE_BYTES:
        return {"linked": True, "ok": False, "error": "response_too_large"}
    try:
        body = json.loads(raw.decode("utf-8"))
    except Exception:
        return {
            "linked": True,
            "ok": False,
            "error": "response_not_json",
            "status": status,
        }
    # Pass the platform's own projected, secret-screened result through
    # verbatim; the tag wrapper tells the UI the link worked.
    return {"linked": True, "ok": True, "status": status, "data": body}
