// Package faucet is a thin client for the Nimiq Simple Faucet.
//
// It mirrors the surface of the TypeScript SDK in @nimiq-faucet/sdk:
// Claim, Status, WaitForConfirmation, Config, RequestChallenge, SolveAndClaim,
// plus a package-level SolveHashcash helper.
package faucet

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Config configures a Client.
type Config struct {
	// URL is the faucet base URL (e.g. "https://faucet.example.com"). Required.
	URL string
	// APIKey is the integrator API key. Required only for server-to-server
	// HMAC-signed calls.
	APIKey string
	// HMACSecret is the integrator HMAC secret. Required only for server-to-
	// server HMAC-signed calls.
	HMACSecret string
	// HTTPClient is optional; defaults to &http.Client{Timeout: 30 * time.Second}.
	HTTPClient *http.Client
}

// Client is a faucet HTTP client. Safe for concurrent use.
type Client struct {
	baseURL    string
	apiKey     string
	hmacSecret string
	http       *http.Client
}

// New constructs a Client from Config.
func New(cfg Config) *Client {
	httpc := cfg.HTTPClient
	if httpc == nil {
		httpc = &http.Client{Timeout: 30 * time.Second}
	}
	return &Client{
		baseURL:    strings.TrimRight(cfg.URL, "/"),
		apiKey:     cfg.APIKey,
		hmacSecret: cfg.HMACSecret,
		http:       httpc,
	}
}

// Config fetches the public faucet config (GET /v1/config).
func (c *Client) Config(ctx context.Context) (*FaucetConfig, error) {
	var out FaucetConfig
	if err := c.get(ctx, "/v1/config", &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// claimBody mirrors the request body on the server's /v1/claim route.
type claimBody struct {
	Address          string             `json:"address"`
	CaptchaToken     *string            `json:"captchaToken,omitempty"`
	HashcashSolution *string            `json:"hashcashSolution,omitempty"`
	Fingerprint      *FingerprintBundle `json:"fingerprint,omitempty"`
	HostContext      *HostContext       `json:"hostContext,omitempty"`
}

// Claim submits a claim for `address` (POST /v1/claim).
func (c *Client) Claim(ctx context.Context, address string, opts ClaimOptions) (*ClaimResponse, error) {
	body := claimBody{
		Address:          address,
		CaptchaToken:     opts.CaptchaToken,
		HashcashSolution: opts.HashcashSolution,
		Fingerprint:      opts.Fingerprint,
		HostContext:      opts.HostContext,
	}
	var out ClaimResponse
	if err := c.post(ctx, "/v1/claim", body, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// Status fetches the state of a previously-submitted claim (GET /v1/claim/:id).
func (c *Client) Status(ctx context.Context, id string) (*ClaimResponse, error) {
	var out ClaimResponse
	if err := c.get(ctx, "/v1/claim/"+id, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// RequestChallenge requests a signed hashcash challenge (POST /v1/challenge).
// Returns a FaucetError with Status 404 if hashcash is not enabled.
func (c *Client) RequestChallenge(ctx context.Context, uid string) (*HashcashChallenge, error) {
	body := map[string]string{}
	if uid != "" {
		body["uid"] = uid
	}
	var out HashcashChallenge
	if err := c.post(ctx, "/v1/challenge", body, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// SolveAndClaim requests a challenge, brute-forces a solution, and submits it
// with the claim. `opts.HostContext.UID`, if set, is used as the challenge uid.
func (c *Client) SolveAndClaim(ctx context.Context, address string, opts ClaimOptions) (*ClaimResponse, error) {
	uid := ""
	if opts.HostContext != nil && opts.HostContext.UID != nil {
		uid = *opts.HostContext.UID
	}
	chall, err := c.RequestChallenge(ctx, uid)
	if err != nil {
		return nil, err
	}
	nonce := SolveHashcash(chall.Challenge, chall.Difficulty)
	solution := chall.Challenge + "#" + nonce
	opts.HashcashSolution = &solution
	return c.Claim(ctx, address, opts)
}

// WaitForConfirmation polls Status until the claim is "confirmed" or
// "rejected", or until `timeout` elapses. Returns a FaucetError with
// Status 408 on timeout.
func (c *Client) WaitForConfirmation(ctx context.Context, id string, timeout time.Duration) (*ClaimResponse, error) {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		resp, err := c.Status(ctx, id)
		if err != nil {
			return nil, err
		}
		if resp.Status == "confirmed" || resp.Status == "rejected" {
			return resp, nil
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}
	return nil, &FaucetError{Status: 408, Message: fmt.Sprintf("claim %s not confirmed in %s", id, timeout)}
}

// SolveHashcash brute-forces a nonce whose SHA-256(challenge + ":" + nonce)
// has at least `difficulty` leading zero bits. Mirrors solveHashcash in
// the TS SDK.
func SolveHashcash(challenge string, difficulty int) string {
	r := rand.New(rand.NewSource(time.Now().UnixNano()))
	var attempts uint64
	for {
		nonce := strconv.FormatUint(attempts, 36) + "." + strconv.FormatUint(r.Uint64(), 36)
		sum := sha256.Sum256([]byte(challenge + ":" + nonce))
		if leadingZeroBits(sum[:]) >= difficulty {
			return nonce
		}
		attempts++
	}
}

func leadingZeroBits(buf []byte) int {
	bits := 0
	for _, b := range buf {
		if b == 0 {
			bits += 8
			continue
		}
		for mask := byte(0x80); mask > 0; mask >>= 1 {
			if b&mask != 0 {
				return bits
			}
			bits++
		}
		return bits
	}
	return bits
}

// --- internal transport --------------------------------------------------

func (c *Client) get(ctx context.Context, path string, out interface{}) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return err
	}
	return c.do(req, out)
}

func (c *Client) post(ctx context.Context, path string, body interface{}, out interface{}) error {
	bodyBytes, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(bodyBytes))
	if err != nil {
		return err
	}
	req.Header.Set("content-type", "application/json")
	if c.apiKey != "" && c.hmacSecret != "" {
		ts := strconv.FormatInt(time.Now().UnixMilli(), 10)
		nonce := randomNonce()
		sig := signHMAC(c.hmacSecret, canonicalString("POST", path, ts, nonce, string(bodyBytes)))
		req.Header.Set("x-faucet-api-key", c.apiKey)
		req.Header.Set("x-faucet-timestamp", ts)
		req.Header.Set("x-faucet-nonce", nonce)
		req.Header.Set("x-faucet-signature", sig)
	}
	return c.do(req, out)
}

func (c *Client) do(req *http.Request, out interface{}) error {
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	if resp.StatusCode >= 400 {
		fe := &FaucetError{Status: resp.StatusCode, Message: fmt.Sprintf("HTTP %d", resp.StatusCode)}
		var errBody struct {
			Error    string `json:"error"`
			Code     string `json:"code"`
			Decision string `json:"decision"`
		}
		if len(body) > 0 {
			if jerr := json.Unmarshal(body, &errBody); jerr == nil {
				if errBody.Error != "" {
					fe.Message = errBody.Error
				}
				fe.Code = errBody.Code
				fe.Decision = errBody.Decision
			}
		}
		return fe
	}
	if out == nil || len(body) == 0 {
		return nil
	}
	return json.Unmarshal(body, out)
}

