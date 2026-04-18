"""Data types mirroring the server's API contract."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class HostContext:
    uid: str | None = None
    cookie_hash: str | None = None
    session_hash: str | None = None
    account_age_days: int | None = None
    email_domain_hash: str | None = None
    kyc_level: str | None = None  # none | email | phone | id
    tags: list[str] | None = None
    verified_identities: list[str] | None = None
    signature: str | None = None

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {}
        if self.uid is not None:
            d["uid"] = self.uid
        if self.cookie_hash is not None:
            d["cookieHash"] = self.cookie_hash
        if self.session_hash is not None:
            d["sessionHash"] = self.session_hash
        if self.account_age_days is not None:
            d["accountAgeDays"] = self.account_age_days
        if self.email_domain_hash is not None:
            d["emailDomainHash"] = self.email_domain_hash
        if self.kyc_level is not None:
            d["kycLevel"] = self.kyc_level
        if self.tags is not None:
            d["tags"] = self.tags
        if self.verified_identities is not None:
            d["verifiedIdentities"] = self.verified_identities
        if self.signature is not None:
            d["signature"] = self.signature
        return d


@dataclass
class FingerprintBundle:
    visitor_id: str | None = None
    confidence: float | None = None
    components: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {}
        if self.visitor_id is not None:
            d["visitorId"] = self.visitor_id
        if self.confidence is not None:
            d["confidence"] = self.confidence
        if self.components is not None:
            d["components"] = self.components
        return d


@dataclass
class ClaimOptions:
    host_context: HostContext | None = None
    fingerprint: FingerprintBundle | None = None
    captcha_token: str | None = None
    hashcash_solution: str | None = None
    idempotency_key: str | None = None


@dataclass
class ClaimResponse:
    id: str = ""
    status: str = ""  # broadcast | confirmed | rejected | challenged | timeout | expired
    tx_id: str | None = None
    decision: str | None = None  # allow | challenge | review | deny
    reason: str | None = None
    idempotent: bool | None = None

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> ClaimResponse:
        return cls(
            id=d.get("id", ""),
            status=d.get("status", ""),
            tx_id=d.get("txId"),
            decision=d.get("decision"),
            reason=d.get("reason"),
            idempotent=d.get("idempotent"),
        )


@dataclass
class HashcashChallenge:
    challenge: str = ""
    difficulty: int = 0
    expires_at: int = 0

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> HashcashChallenge:
        return cls(
            challenge=d.get("challenge", ""),
            difficulty=d.get("difficulty", 0),
            expires_at=d.get("expiresAt", 0),
        )


@dataclass
class CaptchaConfig:
    provider: str = ""
    site_key: str = ""


@dataclass
class HashcashConfig:
    difficulty: int = 0
    ttl_ms: int = 0


@dataclass
class FaucetConfig:
    network: str = ""
    claim_amount_luna: str = ""
    abuse_layers: dict[str, bool] = field(default_factory=dict)
    captcha: CaptchaConfig | None = None
    hashcash: HashcashConfig | None = None

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> FaucetConfig:
        captcha = None
        if d.get("captcha"):
            captcha = CaptchaConfig(
                provider=d["captcha"].get("provider", ""),
                site_key=d["captcha"].get("siteKey", ""),
            )
        hashcash = None
        if d.get("hashcash"):
            hashcash = HashcashConfig(
                difficulty=d["hashcash"].get("difficulty", 0),
                ttl_ms=d["hashcash"].get("ttlMs", 0),
            )
        return cls(
            network=d.get("network", ""),
            claim_amount_luna=d.get("claimAmountLuna", ""),
            abuse_layers=d.get("abuseLayers", {}),
            captcha=captcha,
            hashcash=hashcash,
        )
