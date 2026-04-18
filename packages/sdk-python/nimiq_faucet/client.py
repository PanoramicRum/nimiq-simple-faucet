"""Nimiq Faucet Python SDK client."""

from __future__ import annotations

import json
import time
import urllib.request
import urllib.error
from typing import Any

from .types import (
    ClaimOptions,
    ClaimResponse,
    FaucetConfig,
    HashcashChallenge,
    HostContext,
)
from .errors import FaucetError
from .hmac_auth import sign_request, sign_host_context
from .hashcash import solve_hashcash


class FaucetClient:
    """Pure-stdlib HTTP client for the Nimiq Simple Faucet REST API.

    Usage::

        client = FaucetClient("https://faucet.example.com")
        response = client.claim("NQ02 ...")
        confirmed = client.wait_for_confirmation(response.id)
    """

    def __init__(
        self,
        url: str,
        *,
        api_key: str | None = None,
        hmac_secret: str | None = None,
    ):
        self.base_url = url.rstrip("/")
        self._api_key = api_key
        self._hmac_secret = hmac_secret

    # -- Public API ----------------------------------------------------------

    def config(self) -> FaucetConfig:
        """GET /v1/config — public faucet configuration."""
        data = self._get("/v1/config")
        return FaucetConfig.from_dict(data)

    def claim(self, address: str, options: ClaimOptions | None = None) -> ClaimResponse:
        """POST /v1/claim — submit a faucet claim."""
        opts = options or ClaimOptions()
        body: dict[str, Any] = {"address": address}
        if opts.captcha_token:
            body["captchaToken"] = opts.captcha_token
        if opts.hashcash_solution:
            body["hashcashSolution"] = opts.hashcash_solution
        if opts.idempotency_key:
            body["idempotencyKey"] = opts.idempotency_key
        if opts.fingerprint:
            body["fingerprint"] = opts.fingerprint.to_dict()
        if opts.host_context:
            body["hostContext"] = opts.host_context.to_dict()
        data = self._post("/v1/claim", body)
        return ClaimResponse.from_dict(data)

    def status(self, claim_id: str) -> ClaimResponse:
        """GET /v1/claim/:id — poll claim status."""
        data = self._get(f"/v1/claim/{claim_id}")
        return ClaimResponse.from_dict(data)

    def request_challenge(self, uid: str | None = None) -> HashcashChallenge:
        """POST /v1/challenge — mint a hashcash challenge."""
        body: dict[str, Any] = {}
        if uid:
            body["uid"] = uid
        data = self._post("/v1/challenge", body)
        return HashcashChallenge.from_dict(data)

    def wait_for_confirmation(
        self,
        claim_id: str,
        timeout_s: float = 60.0,
        poll_interval_s: float = 2.0,
    ) -> ClaimResponse:
        """Poll status until the claim reaches a terminal state."""
        deadline = time.monotonic() + timeout_s
        while time.monotonic() < deadline:
            resp = self.status(claim_id)
            if resp.status in ("confirmed", "rejected", "expired"):
                return resp
            time.sleep(poll_interval_s)
        raise FaucetError(0, f"Claim {claim_id} not confirmed within {timeout_s}s", "CONFIRM_TIMEOUT")

    def solve_and_claim(
        self,
        address: str,
        options: ClaimOptions | None = None,
        on_progress: Any = None,
    ) -> ClaimResponse:
        """Request a hashcash challenge, solve it, then claim."""
        challenge = self.request_challenge()
        nonce = solve_hashcash(challenge.challenge, challenge.difficulty, on_progress)
        opts = options or ClaimOptions()
        opts.hashcash_solution = nonce
        return self.claim(address, opts)

    @staticmethod
    def sign_host_context(
        host_context: HostContext,
        integrator_id: str,
        hmac_secret: str,
    ) -> HostContext:
        """Sign a host context with a per-field HMAC (backend-only)."""
        return sign_host_context(host_context, integrator_id, hmac_secret)

    # -- Internal HTTP -------------------------------------------------------

    def _get(self, path: str) -> dict[str, Any]:
        url = f"{self.base_url}{path}"
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        return self._do(req)

    def _post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        url = f"{self.base_url}{path}"
        data = json.dumps(body).encode()
        headers: dict[str, str] = {
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        if self._api_key and self._hmac_secret:
            headers.update(sign_request("POST", path, json.dumps(body), self._api_key, self._hmac_secret))
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")
        return self._do(req)

    def _do(self, req: urllib.request.Request) -> dict[str, Any]:
        try:
            with urllib.request.urlopen(req) as resp:
                body = json.loads(resp.read().decode())
                return body
        except urllib.error.HTTPError as e:
            try:
                err_body = json.loads(e.read().decode())
            except Exception:
                err_body = {}
            raise FaucetError(
                status=e.code,
                message=err_body.get("error") or err_body.get("message") or str(e),
                code=err_body.get("code", ""),
                decision=err_body.get("decision", ""),
            ) from e
