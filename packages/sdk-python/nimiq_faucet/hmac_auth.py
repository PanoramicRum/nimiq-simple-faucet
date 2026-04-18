"""HMAC authentication for server-to-server integrator requests."""

from __future__ import annotations

import hashlib
import hmac as _hmac
import json
import time
import secrets
from typing import Any

from .types import HostContext

_CANONICAL_FIELDS = (
    "uid",
    "cookieHash",
    "sessionHash",
    "accountAgeDays",
    "emailDomainHash",
    "kycLevel",
    "tags",
    "verifiedIdentities",
)


def sign_request(
    method: str,
    path: str,
    body: str,
    api_key: str,
    hmac_secret: str,
) -> dict[str, str]:
    """Build the HMAC auth headers for a whole-request signature.

    Returns a dict of headers to merge into the request.
    """
    ts = str(int(time.time()))
    nonce = secrets.token_hex(16)
    body_hash = hashlib.sha256(body.encode()).hexdigest()
    canonical = f"{method}\n{path}\n{ts}\n{nonce}\n{body_hash}"
    sig = _hmac.new(hmac_secret.encode(), canonical.encode(), hashlib.sha256).hexdigest()
    return {
        "x-faucet-api-key": api_key,
        "x-faucet-timestamp": ts,
        "x-faucet-nonce": nonce,
        "x-faucet-signature": sig,
    }


def canonicalize_host_context(ctx: HostContext) -> str:
    """Produce the canonical JSON string for a host context (excludes signature)."""
    d = ctx.to_dict()
    entries: list[tuple[str, Any]] = []
    for key in _CANONICAL_FIELDS:
        value = d.get(key)
        if value is None:
            continue
        if isinstance(value, list):
            value = sorted(value)
        entries.append((key, value))
    return json.dumps(entries)


def sign_host_context(
    host_context: HostContext,
    integrator_id: str,
    hmac_secret: str,
) -> HostContext:
    """Sign a host context with a per-field HMAC.

    Returns a new HostContext with ``signature`` set to
    ``{integrator_id}:{base64_hmac}``.

    Run this on your **backend** — never expose hmac_secret to the browser.
    """
    import base64

    canonical = canonicalize_host_context(host_context)
    sig = _hmac.new(hmac_secret.encode(), canonical.encode(), hashlib.sha256).digest()
    b64 = base64.b64encode(sig).decode()
    return HostContext(
        uid=host_context.uid,
        cookie_hash=host_context.cookie_hash,
        session_hash=host_context.session_hash,
        account_age_days=host_context.account_age_days,
        email_domain_hash=host_context.email_domain_hash,
        kyc_level=host_context.kyc_level,
        tags=host_context.tags,
        verified_identities=host_context.verified_identities,
        signature=f"{integrator_id}:{b64}",
    )
