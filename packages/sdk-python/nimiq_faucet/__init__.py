"""Nimiq Faucet Python SDK — pure-stdlib client for the Nimiq Simple Faucet."""

from .client import FaucetClient
from .errors import FaucetError
from .hashcash import solve_hashcash
from .hmac_auth import sign_host_context, canonicalize_host_context
from .types import (
    ClaimOptions,
    ClaimResponse,
    FaucetConfig,
    FingerprintBundle,
    HashcashChallenge,
    HostContext,
)

__all__ = [
    "FaucetClient",
    "FaucetError",
    "solve_hashcash",
    "sign_host_context",
    "canonicalize_host_context",
    "ClaimOptions",
    "ClaimResponse",
    "FaucetConfig",
    "FingerprintBundle",
    "HashcashChallenge",
    "HostContext",
]

__version__ = "2.2.0"
