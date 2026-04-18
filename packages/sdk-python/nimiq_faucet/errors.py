"""Faucet API error."""

from __future__ import annotations


class FaucetError(Exception):
    """Raised for non-2xx server responses."""

    def __init__(self, status: int, message: str, code: str = "", decision: str = ""):
        self.status = status
        self.message = message
        self.code = code
        self.decision = decision
        super().__init__(f"faucet error: {status} {message}" + (f" ({code})" if code else ""))
