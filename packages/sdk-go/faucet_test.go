package faucet

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestSolveHashcashLowDifficulty(t *testing.T) {
	nonce := SolveHashcash("hello", 4)
	if nonce == "" {
		t.Fatal("expected non-empty nonce")
	}
	sum := sha256.Sum256([]byte("hello:" + nonce))
	if leadingZeroBits(sum[:]) < 4 {
		t.Fatalf("nonce %q does not satisfy difficulty 4", nonce)
	}
}

func TestLeadingZeroBits(t *testing.T) {
	cases := []struct {
		in   []byte
		want int
	}{
		{[]byte{0xff}, 0},
		{[]byte{0x7f}, 1},
		{[]byte{0x00, 0x80}, 8},
		{[]byte{0x00, 0x00, 0x10}, 19},
	}
	for _, tc := range cases {
		if got := leadingZeroBits(tc.in); got != tc.want {
			t.Errorf("leadingZeroBits(%x) = %d, want %d", tc.in, got, tc.want)
		}
	}
}

func TestCanonicalStringMatchesServer(t *testing.T) {
	got := canonicalString("post", "/v1/claim", "1700000000000", "abc", `{"address":"x"}`)
	want := "POST\n/v1/claim\n1700000000000\nabc\n{\"address\":\"x\"}"
	if got != want {
		t.Fatalf("canonical string mismatch:\n got=%q\nwant=%q", got, want)
	}
}

func TestSignHMACDeterministic(t *testing.T) {
	a := signHMAC("secret", "data")
	b := signHMAC("secret", "data")
	if a != b || len(a) != 64 {
		t.Fatalf("expected stable 64-char hex, got %q / %q", a, b)
	}
}

func TestConfigRoundtrip(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/config" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(FaucetConfig{
			Network:         "test",
			ClaimAmountLuna: "100000",
			AbuseLayers:     map[string]bool{"hashcash": true},
			Hashcash:        &HashcashConfig{Difficulty: 16, TTLMs: 60000},
		})
	}))
	defer srv.Close()
	c := New(Config{URL: srv.URL})
	cfg, err := c.Config(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Network != "test" || cfg.Hashcash == nil || cfg.Hashcash.Difficulty != 16 {
		t.Fatalf("bad config: %+v", cfg)
	}
}

func TestClaimHappyPath(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/claim" || r.Method != http.MethodPost {
			t.Fatalf("unexpected %s %s", r.Method, r.URL.Path)
		}
		body, _ := io.ReadAll(r.Body)
		if !strings.Contains(string(body), `"address":"NQ00..."`) {
			t.Fatalf("missing address in body: %s", body)
		}
		_ = json.NewEncoder(w).Encode(ClaimResponse{ID: "abc", Status: "broadcast", TxID: "tx1"})
	}))
	defer srv.Close()
	c := New(Config{URL: srv.URL})
	resp, err := c.Claim(context.Background(), "NQ00...", ClaimOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if resp.ID != "abc" || resp.TxID != "tx1" {
		t.Fatalf("unexpected response: %+v", resp)
	}
}

func TestClaimHMACSignedHeaders(t *testing.T) {
	const apiKey = "key-1"
	const secret = "shhh"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		gotKey := r.Header.Get("x-faucet-api-key")
		ts := r.Header.Get("x-faucet-timestamp")
		nonce := r.Header.Get("x-faucet-nonce")
		sig := r.Header.Get("x-faucet-signature")
		if gotKey != apiKey || ts == "" || nonce == "" || sig == "" {
			t.Fatalf("missing hmac headers: key=%q ts=%q nonce=%q sig=%q", gotKey, ts, nonce, sig)
		}
		if _, err := strconv.ParseInt(ts, 10, 64); err != nil {
			t.Fatalf("timestamp not integer: %q", ts)
		}
		expected := signHMAC(secret, canonicalString(r.Method, r.URL.Path, ts, nonce, string(body)))
		if expected != sig {
			t.Fatalf("signature mismatch:\n got=%s\nwant=%s", sig, expected)
		}
		_ = json.NewEncoder(w).Encode(ClaimResponse{ID: "signed", Status: "broadcast"})
	}))
	defer srv.Close()
	c := New(Config{URL: srv.URL, APIKey: apiKey, HMACSecret: secret})
	resp, err := c.Claim(context.Background(), "NQ00...", ClaimOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if resp.ID != "signed" {
		t.Fatalf("bad id: %q", resp.ID)
	}
}

func TestErrorBodyDecoded(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(403)
		_, _ = w.Write([]byte(`{"error":"denied","decision":"deny","code":"abuse"}`))
	}))
	defer srv.Close()
	c := New(Config{URL: srv.URL})
	_, err := c.Claim(context.Background(), "x", ClaimOptions{})
	if err == nil {
		t.Fatal("expected error")
	}
	fe, ok := err.(*FaucetError)
	if !ok {
		t.Fatalf("expected *FaucetError, got %T", err)
	}
	if fe.Status != 403 || fe.Decision != "deny" || fe.Code != "abuse" || fe.Message != "denied" {
		t.Fatalf("bad error fields: %+v", fe)
	}
}

func TestRequestChallengeAndSolve(t *testing.T) {
	// Difficulty 4 so the brute-force finishes quickly.
	const challenge = "test-challenge-string"
	const difficulty = 4
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/challenge":
			_ = json.NewEncoder(w).Encode(HashcashChallenge{
				Challenge:  challenge,
				Difficulty: difficulty,
				ExpiresAt:  time.Now().Add(time.Minute).UnixMilli(),
			})
		case "/v1/claim":
			body, _ := io.ReadAll(r.Body)
			if !strings.Contains(string(body), `"hashcashSolution":"`+challenge+`#`) {
				t.Fatalf("solution missing/mangled: %s", body)
			}
			_ = json.NewEncoder(w).Encode(ClaimResponse{ID: "solved", Status: "broadcast"})
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	c := New(Config{URL: srv.URL})
	resp, err := c.SolveAndClaim(context.Background(), "NQ00...", ClaimOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if resp.ID != "solved" {
		t.Fatalf("bad id: %q", resp.ID)
	}
}

// Cross-SDK fixture: the canonical bytes + signature here are generated
// from packages/core/dist/index.js#canonicalizeHostContext (the
// server's source-of-truth implementation) and replayed by every SDK to
// prove byte-for-byte parity (closes audit Improvement #104).
//
// If you change CANONICAL_FIELDS or canonicalizeHostContext in the
// core package, regenerate the fixture by running the snippet at the
// top of packages/sdk-go/hmac.go's docstring and update every SDK's
// copy of these constants — then rerun the cross-SDK tests.
const fixtureCanonical = `[["uid","user-42"],["cookieHash","a1b2c3"],["accountAgeDays",365],["kycLevel","phone"],["tags",["a-tag","m-tag","z-tag"]]]`
const fixtureSignature = "acme-corp:2ro3gqXVYo9YQf4biq3VQZP9nS2M9LItJESSuXfqxow="

func TestSignHostContextMatchesServerFixture(t *testing.T) {
	uid := "user-42"
	cookieHash := "a1b2c3"
	var ageDays float64 = 365
	kyc := "phone"
	ctx := HostContext{
		UID:            &uid,
		CookieHash:     &cookieHash,
		AccountAgeDays: &ageDays,
		KYCLevel:       &kyc,
		// Tags supplied UNSORTED on purpose — the canonicalizer must sort.
		Tags: []string{"z-tag", "a-tag", "m-tag"},
	}
	canonical, err := canonicalizeHostContext(&ctx)
	if err != nil {
		t.Fatalf("canonicalize failed: %v", err)
	}
	if canonical != fixtureCanonical {
		t.Fatalf("canonical mismatch:\n got=%s\nwant=%s", canonical, fixtureCanonical)
	}
	signed, err := SignHostContext(ctx, "acme-corp", "super-secret-hmac-key-for-testing")
	if err != nil {
		t.Fatalf("sign failed: %v", err)
	}
	if signed.Signature == nil || *signed.Signature != fixtureSignature {
		got := "<nil>"
		if signed.Signature != nil {
			got = *signed.Signature
		}
		t.Fatalf("signature mismatch:\n got=%s\nwant=%s", got, fixtureSignature)
	}
}

func TestSignHostContextDoesNotMutateInput(t *testing.T) {
	uid := "user-42"
	ctx := HostContext{UID: &uid, Tags: []string{"b", "a"}}
	originalTags := append([]string(nil), ctx.Tags...)
	_, err := SignHostContext(ctx, "id", "secret")
	if err != nil {
		t.Fatal(err)
	}
	for i, v := range originalTags {
		if ctx.Tags[i] != v {
			t.Fatalf("input mutated: tags[%d] = %q, want %q", i, ctx.Tags[i], v)
		}
	}
	if ctx.Signature != nil {
		t.Fatalf("input mutated: ctx.Signature became %v", *ctx.Signature)
	}
}

func TestWaitForConfirmationTimesOut(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(ClaimResponse{ID: "x", Status: "broadcast"})
	}))
	defer srv.Close()
	c := New(Config{URL: srv.URL})
	_, err := c.WaitForConfirmation(context.Background(), "x", 50*time.Millisecond)
	fe, ok := err.(*FaucetError)
	if !ok || fe.Status != 408 {
		t.Fatalf("expected 408 FaucetError, got %v", err)
	}
}
