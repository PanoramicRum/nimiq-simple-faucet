package faucet

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"sort"
	"strings"
)

// canonicalString assembles the string the server HMAC-signs:
//
//	"POST\n<path>\n<timestamp>\n<nonce>\n<body>"
//
// Must match apps/server/src/hmac.ts#canonicalString exactly.
func canonicalString(method, path, timestamp, nonce, body string) string {
	return strings.Join([]string{strings.ToUpper(method), path, timestamp, nonce, body}, "\n")
}

// signHMAC returns the lower-case hex HMAC-SHA256 of `data` using `secret`.
func signHMAC(secret, data string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(data))
	return hex.EncodeToString(mac.Sum(nil))
}

// randomNonce returns a 16-byte random nonce as lowercase hex. Falls back to
// an empty string on entropy failure; callers should treat empty as a signal
// to retry (extraordinarily unlikely on any supported platform).
func randomNonce() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return ""
	}
	return hex.EncodeToString(buf)
}

// canonicalHostContextFields lists the fields included in the
// hostContext signature, in the exact order the server expects. Must
// match `CANONICAL_FIELDS` in packages/core/src/hostContext.ts.
var canonicalHostContextFields = [...]string{
	"uid",
	"cookieHash",
	"sessionHash",
	"accountAgeDays",
	"emailDomainHash",
	"kycLevel",
	"tags",
	"verifiedIdentities",
}

// canonicalizeHostContext serialises the trust-claim fields of a HostContext
// in the same shape the server canonicalizes for HMAC signing — a JSON
// array of [key, value] pairs in CANONICAL_FIELDS order, with array
// values lexicographically sorted. Mirrors
// packages/core/src/hostContext.ts#canonicalizeHostContext.
//
// Note: HostContext currently has no VerifiedIdentities field on the
// Go struct (the server schema does); when that field is added, plumb
// it through here too.
func canonicalizeHostContext(ctx *HostContext) (string, error) {
	if ctx == nil {
		return "[]", nil
	}
	type entry struct {
		key   string
		value interface{}
	}
	values := map[string]interface{}{}
	if ctx.UID != nil {
		values["uid"] = *ctx.UID
	}
	if ctx.CookieHash != nil {
		values["cookieHash"] = *ctx.CookieHash
	}
	if ctx.SessionHash != nil {
		values["sessionHash"] = *ctx.SessionHash
	}
	if ctx.AccountAgeDays != nil {
		values["accountAgeDays"] = *ctx.AccountAgeDays
	}
	if ctx.EmailDomainHash != nil {
		values["emailDomainHash"] = *ctx.EmailDomainHash
	}
	if ctx.KYCLevel != nil {
		values["kycLevel"] = *ctx.KYCLevel
	}
	if len(ctx.Tags) > 0 {
		// Sort a copy so we don't mutate the caller's slice.
		sorted := append([]string(nil), ctx.Tags...)
		sort.Strings(sorted)
		values["tags"] = sorted
	}
	// verifiedIdentities not yet on the Go HostContext struct; leave a
	// hook here so the canonical order matches the server when it is.
	entries := make([][2]interface{}, 0, len(canonicalHostContextFields))
	for _, k := range canonicalHostContextFields {
		v, ok := values[k]
		if !ok {
			continue
		}
		entries = append(entries, [2]interface{}{k, v})
	}
	out, err := json.Marshal(entries)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// SignHostContext signs a HostContext with an integrator HMAC secret and
// returns a copy whose Signature is set to "<integratorID>:<base64-hmac>".
// The signature uses HMAC-SHA256 over the canonical JSON the server
// reconstructs; mirrors `FaucetClient.signHostContext` in the TS SDK
// (packages/sdk-ts/src/index.ts).
//
// Run this on your BACKEND — never expose hmacSecret to the browser.
// Pass the signed context through to the browser SDK's Claim() call
// (closes audit Improvement #104).
func SignHostContext(ctx HostContext, integratorID, hmacSecret string) (HostContext, error) {
	canonical, err := canonicalizeHostContext(&ctx)
	if err != nil {
		return HostContext{}, err
	}
	mac := hmac.New(sha256.New, []byte(hmacSecret))
	mac.Write([]byte(canonical))
	sig := integratorID + ":" + base64.StdEncoding.EncodeToString(mac.Sum(nil))
	out := ctx
	out.Signature = &sig
	return out, nil
}
