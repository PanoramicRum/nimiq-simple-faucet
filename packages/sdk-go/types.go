package faucet

import "fmt"

// HostContext mirrors the TS `HostContext`. All fields are optional; unset
// pointer fields are omitted from the JSON body.
type HostContext struct {
	UID             *string  `json:"uid,omitempty"`
	CookieHash      *string  `json:"cookieHash,omitempty"`
	SessionHash     *string  `json:"sessionHash,omitempty"`
	AccountAgeDays  *float64 `json:"accountAgeDays,omitempty"`
	EmailDomainHash *string  `json:"emailDomainHash,omitempty"`
	KYCLevel        *string  `json:"kycLevel,omitempty"` // none | email | phone | id
	Tags            []string `json:"tags,omitempty"`
	Signature       *string  `json:"signature,omitempty"`
}

// FingerprintBundle mirrors the TS `FingerprintBundle`.
type FingerprintBundle struct {
	VisitorID  *string                `json:"visitorId,omitempty"`
	Confidence *float64               `json:"confidence,omitempty"`
	Components map[string]interface{} `json:"components,omitempty"`
}

// ClaimOptions mirrors the TS `ClaimOptions`.
type ClaimOptions struct {
	HostContext      *HostContext       `json:"hostContext,omitempty"`
	Fingerprint      *FingerprintBundle `json:"fingerprint,omitempty"`
	CaptchaToken     *string            `json:"captchaToken,omitempty"`
	HashcashSolution *string            `json:"hashcashSolution,omitempty"`
}

// ClaimResponse mirrors the TS `ClaimResponse`.
type ClaimResponse struct {
	ID       string `json:"id"`
	Status   string `json:"status"` // queued | broadcast | confirmed | rejected | challenged
	TxID     string `json:"txId,omitempty"`
	Decision string `json:"decision,omitempty"` // allow | challenge | review | deny
	Reason   string `json:"reason,omitempty"`
}

// HashcashChallenge mirrors the TS `HashcashChallenge`.
type HashcashChallenge struct {
	Challenge  string `json:"challenge"`
	Difficulty int    `json:"difficulty"`
	ExpiresAt  int64  `json:"expiresAt"`
}

// FaucetConfig mirrors the TS `FaucetConfig`.
type FaucetConfig struct {
	Network         string          `json:"network"` // main | test
	ClaimAmountLuna string          `json:"claimAmountLuna"`
	AbuseLayers     map[string]bool `json:"abuseLayers"`
	Captcha         *CaptchaConfig  `json:"captcha,omitempty"`
	Hashcash        *HashcashConfig `json:"hashcash,omitempty"`
}

// CaptchaConfig is the server-published captcha provider info.
type CaptchaConfig struct {
	Provider string `json:"provider"` // turnstile | hcaptcha
	SiteKey  string `json:"siteKey"`
}

// HashcashConfig is the server-published hashcash policy.
type HashcashConfig struct {
	Difficulty int `json:"difficulty"`
	TTLMs      int `json:"ttlMs"`
}

// FaucetError is returned for non-2xx server responses. It implements `error`.
type FaucetError struct {
	Status   int
	Message  string
	Code     string
	Decision string
}

// Error implements the standard error interface.
func (e *FaucetError) Error() string {
	if e.Code != "" {
		return fmt.Sprintf("faucet error: %d %s (%s)", e.Status, e.Message, e.Code)
	}
	return fmt.Sprintf("faucet error: %d %s", e.Status, e.Message)
}
