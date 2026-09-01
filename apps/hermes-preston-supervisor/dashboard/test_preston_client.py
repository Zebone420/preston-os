"""Preston Supervisor backend client tests (stdlib unittest; no
FastAPI needed). Pins: fail-closed configuration, the op allowlist,
path/query validation, GET-only requests, token confidentiality, and
static error tags (never exception text)."""

import io
import json
import unittest
import urllib.error

import preston_client as pc

GOAL = "11111111-2222-4333-8444-555555555555"
ART = "art-" + "a" * 32
ENV_OK = {
    pc.ENV_URL: "https://preston-os-staging.vercel.app",
    pc.ENV_TOKEN: "test-bearer-value",
}


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

    def test_token_without_url_fails_closed(self):
        out = pc.fetch_op("status", env={pc.ENV_TOKEN: "x"})
        self.assertEqual(out["error"], "preston_link_not_configured")

    def test_plain_http_remote_url_refused(self):
        env = {pc.ENV_URL: "http://example.com", pc.ENV_TOKEN: "x"}
        out = pc.fetch_op("status", env=env)
        self.assertEqual(out["error"], "preston_link_not_configured")

    def test_link_state_never_carries_the_token(self):
        state = pc.link_state(ENV_OK)
        self.assertEqual(state["configured"], True)
        self.assertNotIn("test-bearer-value", json.dumps(state))


class AllowlistTests(unittest.TestCase):
    def test_unknown_op_refused(self):
        out = pc.fetch_op("submit_goal", env=ENV_OK)
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
        out = pc.fetch_op("goal", {"goal_id": "../../etc"}, env=ENV_OK)
        self.assertEqual(out["error"], "goal_id_invalid")

    def test_artifact_id_shape_enforced(self):
        out = pc.fetch_op("artifact", {"artifact_id": "art-xyz"}, env=ENV_OK)
        self.assertEqual(out["error"], "artifact_id_invalid")

    def test_malformed_cursor_refused_locally(self):
        out = pc.fetch_op(
            "events", None, {"cursor": "bad cursor!!"}, env=ENV_OK
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
        )
        url = captured[0].full_url
        self.assertIn("cursor=", url)
        self.assertIn("limit=100", url)
        self.assertNotIn("evil", url)

    def test_result_passes_platform_body_verbatim(self):
        payload = {"ok": False, "error": "cursor_invalid"}
        out = pc.fetch_op(
            "events", env=ENV_OK, opener=opener_capture([], payload)
        )
        self.assertEqual(out["ok"], True)  # transport worked
        self.assertEqual(out["data"], payload)  # platform verdict intact


class FailureTests(unittest.TestCase):
    def test_auth_failure_maps_to_static_tag(self):
        def opener(request, timeout=None):
            raise urllib.error.HTTPError(
                request.full_url, 401, "unauthorized", {}, io.BytesIO(b"")
            )

        out = pc.fetch_op("status", env=ENV_OK, opener=opener)
        self.assertEqual(out["error"], "preston_auth_failed")
        self.assertEqual(out["status"], 401)

    def test_network_failure_never_leaks_exception_text(self):
        def opener(request, timeout=None):
            raise OSError("secret-host-detail 10.0.0.1 refused")

        out = pc.fetch_op("status", env=ENV_OK, opener=opener)
        self.assertEqual(out["error"], "preston_unreachable")
        self.assertNotIn("10.0.0.1", json.dumps(out))

    def test_non_json_response_tagged(self):
        def opener(request, timeout=None):
            response = FakeResponse(b"<html>login</html>")
            response.status = 200
            return response

        out = pc.fetch_op("status", env=ENV_OK, opener=opener)
        self.assertEqual(out["error"], "response_not_json")


if __name__ == "__main__":
    unittest.main()
