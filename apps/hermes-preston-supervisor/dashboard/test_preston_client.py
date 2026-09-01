"""Preston Supervisor backend client tests (stdlib unittest; no
FastAPI needed). Pins: fail-closed configuration, the op allowlist,
path/query validation, GET-only requests, token confidentiality,
static error tags (never exception text), and the single bounded
forced-refresh retry on 401."""

import io
import json
import unittest
import urllib.error

import preston_client as pc
import token_client as tc

GOAL = "11111111-2222-4333-8444-555555555555"
ART = "art-" + "a" * 32
ENV_OK = {
    pc.ENV_URL: "https://preston-os-staging.vercel.app",
    tc.ENV_TOKEN_URL: "https://auth.example.test/auth/v1/oauth/token",
    tc.ENV_CLIENT_ID: "33333333-4444-4555-8666-777777777777",
    tc.ENV_CLIENT_SECRET: "test-client-secret-value",
    tc.ENV_STORE: "unused-by-these-tests.json",
}


def fixed_token(force=False):
    return "test-bearer-value"


class FakeResponse(io.BytesIO):
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def opener_capture(captured, payload=None, status=200):
    def opener(request, timeout=None):
        captured.append(request)
        body = json.dumps(payload if payload is not None else {"ok": True})
        response = FakeResponse(body.encode("utf-8"))
        response.status = status
        return response

    return opener


class ConfigTests(unittest.TestCase):
    def test_unconfigured_fails_closed(self):
        out = pc.fetch_op("status", env={})
        self.assertEqual(out["linked"], False)
        self.assertEqual(out["error"], "preston_link_not_configured")

    def test_oauth_without_url_fails_closed(self):
        env = dict(ENV_OK)
        env.pop(pc.ENV_URL)
        out = pc.fetch_op("status", env=env)
        self.assertEqual(out["error"], "preston_link_not_configured")

    def test_url_without_oauth_fails_closed(self):
        out = pc.fetch_op("status", env={pc.ENV_URL: ENV_OK[pc.ENV_URL]})
        self.assertEqual(out["error"], "preston_link_not_configured")

    def test_plain_http_remote_url_refused(self):
        env = dict(ENV_OK)
        env[pc.ENV_URL] = "http://example.com"
        out = pc.fetch_op("status", env=env)
        self.assertEqual(out["error"], "preston_link_not_configured")

    def test_link_state_never_carries_credentials(self):
        state = pc.link_state(ENV_OK)
        self.assertEqual(state["configured"], True)
        self.assertEqual(state["store"], "unseeded")
        text = json.dumps(state)
        self.assertNotIn("test-client-secret-value", text)
        self.assertNotIn("test-bearer-value", text)


class AllowlistTests(unittest.TestCase):
    def test_unknown_op_refused(self):
        out = pc.fetch_op(
            "submit_goal", env=ENV_OK, token_resolver=fixed_token
        )
        self.assertEqual(out["ok"], False)
        self.assertEqual(out["error"], "op_not_allowed")

    def test_every_allowed_path_is_a_control_read(self):
        for path in pc.ALLOWED_OPS.values():
            self.assertTrue(path.startswith("/api/control/"))
        joined = " ".join(pc.ALLOWED_OPS.values())
        for banned in ("decision", "cancel", "follow-up"):
            self.assertNotIn(banned, joined)
        self.assertEqual(len(pc.ALLOWED_OPS), 7)

    def test_goal_id_must_be_uuid(self):
        out = pc.fetch_op(
            "goal", {"goal_id": "../../etc"}, env=ENV_OK,
            token_resolver=fixed_token,
        )
        self.assertEqual(out["error"], "goal_id_invalid")

    def test_artifact_id_shape_enforced(self):
        out = pc.fetch_op(
            "artifact", {"artifact_id": "art-xyz"}, env=ENV_OK,
            token_resolver=fixed_token,
        )
        self.assertEqual(out["error"], "artifact_id_invalid")

    def test_malformed_cursor_refused_locally(self):
        out = pc.fetch_op(
            "events", None, {"cursor": "bad cursor!!"}, env=ENV_OK,
            token_resolver=fixed_token,
        )
        self.assertEqual(out["error"], "cursor_invalid")


class RequestShapeTests(unittest.TestCase):
    def test_get_only_with_bearer_and_no_token_in_result(self):
        captured = []
        out = pc.fetch_op(
            "goal",
            {"goal_id": GOAL},
            env=ENV_OK,
            opener=opener_capture(captured, {"found": True}),
            token_resolver=fixed_token,
        )
        self.assertEqual(len(captured), 1)
        request = captured[0]
        self.assertEqual(request.get_method(), "GET")
        self.assertEqual(
            request.full_url,
            "https://preston-os-staging.vercel.app/api/control/goals/"
            + GOAL,
        )
        self.assertEqual(
            request.get_header("Authorization"),
            "Bearer test-bearer-value",
        )
        self.assertEqual(out["ok"], True)
        self.assertEqual(out["data"], {"found": True})
        self.assertNotIn("test-bearer-value", json.dumps(out))

    def test_events_query_is_bounded_and_allowlisted(self):
        captured = []
        pc.fetch_op(
            "events",
            None,
            {"cursor": "v1:123:sup:job:x", "limit": "99999",
             "evil": "1"},
            env=ENV_OK,
            opener=opener_capture(captured),
            token_resolver=fixed_token,
        )
        url = captured[0].full_url
        self.assertIn("cursor=", url)
        self.assertIn("limit=100", url)
        self.assertNotIn("evil", url)

    def test_result_passes_platform_body_verbatim(self):
        payload = {"ok": False, "error": "cursor_invalid"}
        out = pc.fetch_op(
            "events", env=ENV_OK, opener=opener_capture([], payload),
            token_resolver=fixed_token,
        )
        self.assertEqual(out["ok"], True)  # transport worked
        self.assertEqual(out["data"], payload)  # platform verdict intact


class TokenPathTests(unittest.TestCase):
    def test_token_error_tag_passes_through_fail_closed(self):
        def resolver(force=False):
            raise tc.TokenError("token_store_missing")

        out = pc.fetch_op(
            "status", env=ENV_OK, opener=opener_capture([]),
            token_resolver=resolver,
        )
        self.assertEqual(out["linked"], True)
        self.assertEqual(out["ok"], False)
        self.assertEqual(out["error"], "token_store_missing")

    def test_401_forces_exactly_one_refresh_then_fails_closed(self):
        resolver_calls = []

        def resolver(force=False):
            resolver_calls.append(force)
            return "always-stale"

        def opener(request, timeout=None):
            raise urllib.error.HTTPError(
                request.full_url, 401, "unauthorized", {}, io.BytesIO(b"")
            )

        out = pc.fetch_op(
            "status", env=ENV_OK, opener=opener, token_resolver=resolver
        )
        self.assertEqual(resolver_calls, [False, True])
        self.assertEqual(out["error"], "preston_auth_failed")
        self.assertEqual(out["status"], 401)

    def test_401_recovers_after_forced_refresh(self):
        attempts = []

        def resolver(force=False):
            return "fresh" if force else "stale"

        def opener(request, timeout=None):
            attempts.append(request.get_header("Authorization"))
            if len(attempts) == 1:
                raise urllib.error.HTTPError(
                    request.full_url, 401, "unauthorized", {},
                    io.BytesIO(b""),
                )
            return FakeResponse(b'{"ok": true}')

        out = pc.fetch_op(
            "status", env=ENV_OK, opener=opener, token_resolver=resolver
        )
        self.assertEqual(attempts, ["Bearer stale", "Bearer fresh"])
        self.assertEqual(out["ok"], True)


class FailureTests(unittest.TestCase):
    def test_auth_failure_maps_to_static_tag(self):
        def opener(request, timeout=None):
            raise urllib.error.HTTPError(
                request.full_url, 403, "forbidden", {}, io.BytesIO(b"")
            )

        out = pc.fetch_op(
            "status", env=ENV_OK, opener=opener,
            token_resolver=fixed_token,
        )
        self.assertEqual(out["error"], "preston_auth_failed")
        self.assertEqual(out["status"], 403)

    def test_network_failure_never_leaks_exception_text(self):
        def opener(request, timeout=None):
            raise OSError("secret-host-detail 10.0.0.1 refused")

        out = pc.fetch_op(
            "status", env=ENV_OK, opener=opener,
            token_resolver=fixed_token,
        )
        self.assertEqual(out["error"], "preston_unreachable")
        self.assertNotIn("10.0.0.1", json.dumps(out))

    def test_non_json_response_tagged(self):
        def opener(request, timeout=None):
            response = FakeResponse(b"<html>login</html>")
            response.status = 200
            return response

        out = pc.fetch_op(
            "status", env=ENV_OK, opener=opener,
            token_resolver=fixed_token,
        )
        self.assertEqual(out["error"], "response_not_json")


if __name__ == "__main__":
    unittest.main()
