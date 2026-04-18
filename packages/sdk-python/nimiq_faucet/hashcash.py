"""Hashcash solver — pure stdlib SHA-256 brute-force."""

from __future__ import annotations

import hashlib
import random
import string
from typing import Callable


def _leading_zero_bits(digest: bytes) -> int:
    bits = 0
    for byte in digest:
        if byte == 0:
            bits += 8
            continue
        mask = 0x80
        while mask > 0:
            if byte & mask:
                return bits
            bits += 1
            mask >>= 1
        break
    return bits


def solve_hashcash(
    challenge: str,
    difficulty: int,
    on_progress: Callable[[int], None] | None = None,
) -> str:
    """Brute-force a nonce such that SHA-256(challenge:nonce) has at least
    ``difficulty`` leading zero bits.

    ``on_progress`` is called every ~2048 attempts if provided.
    """
    attempts = 0
    while True:
        nonce = f"{attempts:x}.{''.join(random.choices(string.ascii_lowercase + string.digits, k=8))}"
        digest = hashlib.sha256(f"{challenge}:{nonce}".encode()).digest()
        if _leading_zero_bits(digest) >= difficulty:
            return nonce
        attempts += 1
        if on_progress and attempts % 2048 == 0:
            on_progress(attempts)
