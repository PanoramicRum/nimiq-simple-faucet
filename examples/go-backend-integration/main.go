// Minimal Go backend that proxies faucet claims.
// Exposes GET /healthz, GET /config, and POST /claim on :8081.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	faucet "github.com/nimiq/simple-faucet-go"
)

func main() {
	url := os.Getenv("FAUCET_URL")
	if url == "" {
		url = "http://localhost:8080"
	}

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
		json.NewEncoder(w).Encode(cfg)
	})

	mux.HandleFunc("POST /claim", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Address string `json:"address"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Address == "" {
			http.Error(w, `{"error":"address is required"}`, http.StatusBadRequest)
			return
		}

		uid := "go-backend-example"
		resp, err := client.SolveAndClaim(r.Context(), body.Address, faucet.ClaimOptions{
			HostContext: &faucet.HostContext{UID: &uid},
		})
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadGateway)
			json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
		defer cancel()

		confirmed, err := client.WaitForConfirmation(ctx, resp.ID, 60*time.Second)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusGatewayTimeout)
			json.NewEncoder(w).Encode(map[string]string{
				"error":   err.Error(),
				"claimId": resp.ID,
				"status":  resp.Status,
			})
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(confirmed)
	})

	addr := ":8081"
	log.Printf("go-backend-integration listening on %s (faucet: %s)", addr, url)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatal(err)
	}
}
