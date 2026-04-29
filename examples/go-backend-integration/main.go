// Minimal Go backend that proxies faucet claims with full abuse-layer
// integration: hashcash via SolveAndClaim and HMAC-signed hostContext.
//
// Exposes GET /healthz, GET /config, and POST /claim on :8081.
//
// In production, the integrator's user-state fields (uid, accountAgeDays,
// kycLevel, tags) are signed with FAUCET_HMAC_SECRET so the faucet can
// trust them in its abuse pipeline. Without a signature the asserted
// fields are ignored.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	faucet "github.com/PanoramicRum/nimiq-simple-faucet/packages/sdk-go"
)

func main() {
	url := envOr("FAUCET_URL", "http://localhost:8080")
	integratorID := envOr("FAUCET_INTEGRATOR_ID", "go-backend-example")
	// HMAC secret is OPTIONAL — without it the example sends an unsigned
	// uid (still useful, but the asserted fields don't carry weight in
	// the faucet's abuse score). Set it in production.
	hmacSecret := os.Getenv("FAUCET_HMAC_SECRET")

	client := faucet.New(faucet.Config{URL: url})
	mux := http.NewServeMux()

	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		fmt.Fprintln(w, "ok")
	})

	mux.HandleFunc("GET /config", func(w http.ResponseWriter, r *http.Request) {
		cfg, err := client.Config(r.Context())
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(cfg)
	})

	mux.HandleFunc("POST /claim", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Address string `json:"address"`
			UserID  string `json:"userId"`
			KYC     string `json:"kyc"` // "none" | "email" | "phone" | "id"
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Address == "" {
			http.Error(w, `{"error":"address is required"}`, http.StatusBadRequest)
			return
		}

		// Build a host context. In a real integrator's backend, these
		// fields come from your authenticated user record — they are
		// values you VOUCH for to the faucet. The HMAC binds them to
		// you so the faucet can apply the asserted-trust bonus.
		uid := userIDOr(body.UserID, integratorID)
		hc := faucet.HostContext{UID: &uid}
		if body.KYC != "" {
			hc.KYCLevel = &body.KYC
		}
		// Sign hostContext if a secret is configured. Production
		// deployments should require this; the demo allows unsigned for
		// quick start (the faucet still accepts the claim, but the
		// hostContext fields aren't load-bearing without a signature).
		if hmacSecret != "" {
			signed, err := faucet.SignHostContext(hc, integratorID, hmacSecret)
			if err != nil {
				http.Error(w, fmt.Sprintf(`{"error":"sign hostContext: %s"}`, err.Error()), http.StatusInternalServerError)
				return
			}
			hc = signed
		}

		// SolveAndClaim handles the hashcash round-trip if the server
		// requires it (Config().Hashcash != nil). On servers without
		// hashcash configured this falls through to a plain Claim.
		resp, err := client.SolveAndClaim(r.Context(), body.Address, faucet.ClaimOptions{
			HostContext: &hc,
		})
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadGateway)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
		defer cancel()

		confirmed, err := client.WaitForConfirmation(ctx, resp.ID, 60*time.Second)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusGatewayTimeout)
			_ = json.NewEncoder(w).Encode(map[string]string{
				"error":   err.Error(),
				"claimId": resp.ID,
				"status":  resp.Status,
			})
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(confirmed)
	})

	addr := ":8081"
	log.Printf("go-backend-integration listening on %s (faucet: %s, signed-hostContext: %t)", addr, url, hmacSecret != "")
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatal(err)
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func userIDOr(userID, fallback string) string {
	if userID != "" {
		return userID
	}
	return fallback
}
