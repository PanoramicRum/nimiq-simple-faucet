"""Tests for the Nimiq Faucet Python SDK."""

import json
import unittest
from unittest.mock import patch, MagicMock

from nimiq_faucet import (
    FaucetClient,
    FaucetError,
    HostContext,
    solve_hashcash,
    canonicalize_host_context,
    sign_host_context,
)


class TestHashcash(unittest.TestCase):
    def test_solve_produces_valid_nonce(self):
        challenge = "test-challenge-abc"
        difficulty = 8  # low difficulty for fast test
        nonce = solve_hashcash(challenge, difficulty)
        import hashlib
        digest = hashlib.sha256(f"{challenge}:{nonce}".encode()).digest()
        # Check leading zero bits
        bits = 0
        for byte in digest:
            if byte == 0:
                bits += 8
                continue
            mask = 0x80
            while mask > 0:
                if byte & mask:
                    break
                bits += 1
                mask >>= 1
            break
        self.assertGreaterEqual(bits, difficulty)


class TestHostContext(unittest.TestCase):
    def test_canonicalize_excludes_signature(self):
        ctx = HostContext(uid="user-1", signature="should-be-excluded")
        canonical = canonicalize_host_context(ctx)
        parsed = json.loads(canonical)
        keys = [entry[0] for entry in parsed]
        self.assertIn("uid", keys)
        self.assertNotIn("signature", keys)

    def test_canonicalize_includes_verified_identities(self):
        ctx = HostContext(uid="user-1", verified_identities=["google", "apple"])
        canonical = canonicalize_host_context(ctx)
        parsed = json.loads(canonical)
        keys = [entry[0] for entry in parsed]
        self.assertIn("verifiedIdentities", keys)

    def test_sign_host_context_produces_valid_signature(self):
        ctx = HostContext(uid="user-1")
        signed = sign_host_context(ctx, "demo-integrator", "secret-key-123")
        self.assertIsNotNone(signed.signature)
        self.assertTrue(signed.signature.startswith("demo-integrator:"))
        # Signature should be base64
        import base64
        b64_part = signed.signature.split(":")[1]
        base64.b64decode(b64_part)  # Should not raise


class TestFaucetError(unittest.TestCase):
    def test_error_message_format(self):
        err = FaucetError(403, "denied", code="RATE_LIMIT")
        self.assertIn("403", str(err))
        self.assertIn("denied", str(err))
        self.assertIn("RATE_LIMIT", str(err))


class TestHostContextToDict(unittest.TestCase):
    def test_omits_none_fields(self):
        ctx = HostContext(uid="u1")
        d = ctx.to_dict()
        self.assertEqual(d, {"uid": "u1"})

    def test_includes_all_set_fields(self):
        ctx = HostContext(uid="u1", kyc_level="email", tags=["vip"])
        d = ctx.to_dict()
        self.assertEqual(d["uid"], "u1")
        self.assertEqual(d["kycLevel"], "email")
        self.assertEqual(d["tags"], ["vip"])


if __name__ == "__main__":
    unittest.main()
