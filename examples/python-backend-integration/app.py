"""Nimiq Faucet Python backend integration — full abuse-layer demo.

Demonstrates HMAC-signed hostContext + automatic hashcash via
`solve_and_claim()`. Drop into any Flask/FastAPI/Django route handler;
the abuse-layer plumbing is identical regardless of the framework.
"""

import logging
import os

from nimiq_faucet import (
    ClaimOptions,
    FaucetClient,
    FaucetError,
    HostContext,
)

FAUCET_URL = os.environ.get("FAUCET_URL", "http://localhost:8080")
INTEGRATOR_ID = os.environ.get("FAUCET_INTEGRATOR_ID", "python-backend-example")
# HMAC secret is OPTIONAL — without it the example sends an unsigned uid
# (still useful for traffic shaping, but the asserted fields don't carry
# weight in the faucet's abuse score). Set it in production.
HMAC_SECRET = os.environ.get("FAUCET_HMAC_SECRET")
# Optional: integrator API key for whole-request HMAC (S2S auth, not
# hostContext signing). Independent of FAUCET_HMAC_SECRET below.
API_KEY = os.environ.get("FAUCET_API_KEY")

client = FaucetClient(FAUCET_URL, api_key=API_KEY, hmac_secret=HMAC_SECRET if API_KEY else None)

logger = logging.getLogger(__name__)


def handle_claim(
    address: str,
    *,
    user_id: str | None = None,
    kyc_level: str | None = None,
    account_age_days: int | None = None,
    tags: list[str] | None = None,
) -> dict:
    """Process a faucet claim on behalf of a user.

    In production, call this from your route handler AFTER authenticating
    the user. The host-context fields below are values you VOUCH for to
    the faucet — your auth system has already verified them. Signing the
    context with FAUCET_HMAC_SECRET binds them to your integrator
    identity so the faucet can treat them as load-bearing.
    """
    options = ClaimOptions()

    # Build a hostContext from your authenticated user's state. Only
    # fill in fields you can actually attest to — empty fields don't
    # earn trust bonuses.
    ctx = HostContext(
        uid=user_id or INTEGRATOR_ID,
        kyc_level=kyc_level,
        account_age_days=account_age_days,
        tags=tags,
    )

    # Sign hostContext if a secret is configured. Without it the faucet
    # IGNORES the asserted fields (the claim still works — it just falls
    # back to default abuse scoring on the unsigned-context path).
    if HMAC_SECRET:
        options.host_context = FaucetClient.sign_host_context(
            ctx, INTEGRATOR_ID, HMAC_SECRET,
        )
    else:
        options.host_context = ctx

    try:
        # solve_and_claim handles the hashcash round-trip when the
        # server requires it; on servers without hashcash configured
        # this falls through to a plain claim().
        attempts = 0

        def on_progress(n: int) -> None:
            nonlocal attempts
            attempts = n

        response = client.solve_and_claim(address, options, on_progress=on_progress)
        if attempts:
            logger.info("hashcash solved in %d attempts", attempts)
        confirmed = client.wait_for_confirmation(response.id, timeout_s=60)
        return {
            "id": confirmed.id,
            "status": confirmed.status,
            "tx_id": confirmed.tx_id,
            "signed_hostcontext": HMAC_SECRET is not None,
        }
    except FaucetError as e:
        return {"error": e.message, "status": e.status}


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    # Quick test: claim to a testnet address. In a real backend this
    # would come from the authenticated user's request body.
    result = handle_claim(
        "NQ02 STQX XESU 2E4S N9X7 GEXD 0VGL Y8PT BQ05",
        user_id="alice",
        kyc_level="email",
        account_age_days=180,
        tags=["beta-tester"],
    )
    print(result)
