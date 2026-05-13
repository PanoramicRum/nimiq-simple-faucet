"""Faucet API error."""

from __future__ import annotations


class FaucetError(Exception):
    """Raised for non-2xx server responses.

    Mirrors the server's uniform ``ErrorResponse`` envelope
    (``{error, code?, message?}``). ``status`` is the HTTP status code;
    ``message`` is the human-readable detail; ``code`` is the stable
    ``SCREAMING_SNAKE_CASE`` identifier for programmatic branching.
    """

    def __init__(self, status: int, message: str, code: str = ""):
        self.status = status
        self.message = message
        self.code = code
        super().__init__(f"faucet error: {status} {message}" + (f" ({code})" if code else ""))
