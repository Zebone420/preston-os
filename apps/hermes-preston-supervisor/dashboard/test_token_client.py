"""token_client tests (stdlib unittest). Pins: fail-closed config and
store handling, cached-access reuse inside expiry, refresh via
client_secret_basic, rotation captured atomically, no token text in
any error, and the absence of any static-bearer path."""

import base64
import io
import json
import os
import tempfile
import unittest
import urllib.error
import urllib.parse

import token_client as tc

CLIENT_ID = "33333333-4444-4555-8666-777777777777"
SECRET = "test-client-secret-value"
TOKEN_URL = "https://auth.example.test/auth/v1/oauth/token"


def env_with_store(store_path):
    return {
        tc.ENV_TOKEN_URL: TOKEN_URL,
        tc.ENV_CLIENT_ID: CLIENT_ID,
        tc.ENV_CLIENT_SECRET: SECRET,
        tc.ENV_STORE: store_path,
    }


class FakeResponse(io.BytesIO):
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def refresh_opener(captured, payload, status=200):
    def opener(request, timeout=None):
        captured.append(request)
        if status >= 400:
            raise urllib.error.HTTPError(
                request.full_url, status, "refused", {}, io.BytesIO(b"{}")
            )
        return FakeResponse(json.dumps(payload).encode("utf-8"))

    return opener


class StoreCase(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.store = os.path.join(self.dir.name, "hermes-link.json")
        self.env = env_with_store(self.store)

    def tearDown(self):
        self.dir.cleanup()

    def seed(self, refresh="seed-refresh", access=None, expires_at=None):
        tc.write_store(self.store, refresh, access, expires_at)


class ConfigTests(StoreCase):
    def test_unconfigured_fails_closed(self):
        for missing in (
            tc.ENV_TOKEN_URL,
            tc.ENV_CLIENT_ID,
            tc.ENV_CLIENT_SECRET,
            tc.ENV_STORE,
        ):
            env = dict(self.env)
            env.pop(missing)
            with self.assertRaises(tc.TokenError) as ctx:
                tc.resolve_access_token(env=env)
            self.assertEqual(ctx.exception.tag, "link_oauth_unconfigured")

    def test_plain_http_token_url_refused(self):
        env = dict(self.env)
        env[tc.ENV_TOKEN_URL] = "http://auth.example.test/oauth/token"
        with self.assertRaises(tc.TokenError) as ctx:
            tc.resolve_access_token(env=env)
        self.assertEqual(ctx.exception.tag, "link_oauth_unconfigured")

    def test_no_static_bearer_env_exists(self):
        names = [n for n in dir(tc) if n.startswith("ENV_")]
        values = [getattr(tc, n) for n in names]
        self.assertEqual(
            sorted(values),
            sorted([
                "HERMES_PRESTON_OAUTH_TOKEN_URL",
                "HERMES_PRESTON_OAUTH_CLIENT_ID",
                "HERMES_PRESTON_OAUTH_CLIENT_SECRET",
                "HERMES_PRESTON_TOKEN_STORE",
            ]),
        )


class StoreStateTests(StoreCase):
    def test_states(self):
        self.assertEqual(tc.store_state({}), "unconfigured")
        self.assertEqual(tc.store_state(self.env), "unseeded")
        with open(self.store, "w", encoding="utf-8") as handle:
            handle.write("not json")
        self.assertEqual(tc.store_state(self.env), "error")
        self.seed()
        self.assertEqual(tc.store_state(self.env), "ready")

    def test_state_never_contains_token_material(self):
        self.seed(refresh="super-sensitive-refresh")
        self.assertNotIn(
            "super-sensitive-refresh", json.dumps(tc.store_state(self.env))
        )


class ResolveTests(StoreCase):
    def test_missing_store_fails_closed(self):
        with self.assertRaises(tc.TokenError) as ctx:
            tc.resolve_access_token(env=self.env)
        self.assertEqual(ctx.exception.tag, "token_store_missing")

    def test_malformed_store_fails_closed_not_refreshed(self):
        with open(self.store, "w", encoding="utf-8") as handle:
            handle.write('{"v": 9}')
        captured = []
        with self.assertRaises(tc.TokenError) as ctx:
            tc.resolve_access_token(
                env=self.env, opener=refresh_opener(captured, {})
            )
        self.assertEqual(ctx.exception.tag, "token_store_malformed")
        self.assertEqual(captured, [])

    def test_fresh_cached_access_reused_without_network(self):
        self.seed(access="cached-access", expires_at=1000_000)
        captured = []
        token = tc.resolve_access_token(
            env=self.env,
            opener=refresh_opener(captured, {}),
            now=1000_000 - 600,
        )
        self.assertEqual(token, "cached-access")
        self.assertEqual(captured, [])

    def test_near_expiry_triggers_refresh_and_rotation_persist(self):
        self.seed(
            refresh="old-refresh", access="stale", expires_at=1000_000
        )
        captured = []
        payload = {
            "access_token": "new-access",
            "refresh_token": "new-refresh",
            "expires_in": 3600,
        }
        token = tc.resolve_access_token(
            env=self.env,
            opener=refresh_opener(captured, payload),
            now=1000_000 - 30,
        )
        self.assertEqual(token, "new-access")
        self.assertEqual(len(captured), 1)
        request = captured[0]
        self.assertEqual(request.get_method(), "POST")
        self.assertEqual(request.full_url, TOKEN_URL)
        expected = base64.b64encode(
            (CLIENT_ID + ":" + SECRET).encode("utf-8")
        ).decode("ascii")
        self.assertEqual(
            request.get_header("Authorization"), "Basic " + expected
        )
        form = urllib.parse.parse_qs(request.data.decode("ascii"))
        self.assertEqual(form["grant_type"], ["refresh_token"])
        self.assertEqual(form["refresh_token"], ["old-refresh"])
        with open(self.store, "rb") as handle:
            stored = json.loads(handle.read())
        self.assertEqual(stored["refresh_token"], "new-refresh")
        self.assertEqual(stored["access_token"], "new-access")
        self.assertNotIn("old-refresh", json.dumps(stored))

    def test_force_refresh_bypasses_fresh_cache(self):
        self.seed(
            refresh="old-refresh", access="cached", expires_at=2000_000
        )
        captured = []
        payload = {
            "access_token": "forced-access",
            "refresh_token": "next-refresh",
            "expires_in": 3600,
        }
        token = tc.resolve_access_token(
            env=self.env,
            opener=refresh_opener(captured, payload),
            now=1000,
            force_refresh=True,
        )
        self.assertEqual(token, "forced-access")
        self.assertEqual(len(captured), 1)

    def test_missing_rotation_fails_closed_store_intact(self):
        self.seed(refresh="only-refresh")
        payload = {"access_token": "acc"}  # no rotated refresh token
        with self.assertRaises(tc.TokenError) as ctx:
            tc.resolve_access_token(
                env=self.env, opener=refresh_opener([], payload)
            )
        self.assertEqual(ctx.exception.tag, "token_rotation_missing")
        with open(self.store, "rb") as handle:
            stored = json.loads(handle.read())
        self.assertEqual(stored["refresh_token"], "only-refresh")

    def test_refresh_refused_maps_to_static_tag(self):
        self.seed()
        with self.assertRaises(tc.TokenError) as ctx:
            tc.resolve_access_token(
                env=self.env, opener=refresh_opener([], {}, status=400)
            )
        self.assertEqual(ctx.exception.tag, "token_refresh_refused")

    def test_endpoint_unreachable_maps_to_static_tag(self):
        self.seed()

        def opener(request, timeout=None):
            raise OSError("secret-host-detail refused")

        with self.assertRaises(tc.TokenError) as ctx:
            tc.resolve_access_token(env=self.env, opener=opener)
        self.assertEqual(ctx.exception.tag, "token_endpoint_unreachable")

    def test_errors_never_carry_token_or_secret_text(self):
        self.seed(refresh="refresh-value-x")
        for status in (400, 401):
            try:
                tc.resolve_access_token(
                    env=self.env,
                    opener=refresh_opener([], {}, status=status),
                )
            except tc.TokenError as exc:
                text = str(exc)
                self.assertNotIn("refresh-value-x", text)
                self.assertNotIn(SECRET, text)
                self.assertNotIn(TOKEN_URL, text)


if __name__ == "__main__":
    unittest.main()
