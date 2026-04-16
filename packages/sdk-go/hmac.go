package faucet

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
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
