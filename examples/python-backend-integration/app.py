"""Minimal Flask/FastAPI example — Nimiq Faucet Python SDK."""

import os
from nimiq_faucet import FaucetClient, ClaimOptions, HostContext, FaucetError

FAUCET_URL = os.environ.get("FAUCET_URL", "http://localhost:8080")
API_KEY = os.environ.get("FAUCET_API_KEY")
HMAC_SECRET = os.environ.get("FAUCET_HMAC_SECRET")

client = FaucetClient(FAUCET_URL, api_key=API_KEY, hmac_secret=HMAC_SECRET)


def handle_claim(address: str, user_id: str | None = None) -> dict:
    """Process a faucet claim on behalf of a user.

    In production, call this from your Flask/FastAPI route handler after
    authenticating the user. The host context (user ID, KYC level, etc.)
    feeds into the faucet's abuse scoring — signed contexts receive a
    trust bonus.
    """
    options = ClaimOptions()

    if user_id and HMAC_SECRET:
        ctx = HostContext(uid=user_id, kyc_level="email")
        # Sign the context so the faucet trusts it without whole-request HMAC
        options.host_context = FaucetClient.sign_host_context(
            ctx, API_KEY or "default", HMAC_SECRET
        )

    try:
        response = client.claim(address, options)
        confirmed = client.wait_for_confirmation(response.id, timeout_s=30)
        return {
            "id": confirmed.id,
            "status": confirmed.status,
            "tx_id": confirmed.tx_id,
        }
    except FaucetError as e:
        return {"error": e.message, "status": e.status}


if __name__ == "__main__":
    # Quick test: claim to a testnet address
    result = handle_claim("NQ02 STQX XESU 2E4S N9X7 GEXD 0VGL Y8PT BQ05")
    print(result)
