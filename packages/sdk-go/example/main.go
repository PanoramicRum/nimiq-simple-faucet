// Minimal example pointing at a locally-running faucet.
package main

import (
	"context"
	"fmt"
	"log"
	"time"

	faucet "github.com/nimiq/simple-faucet-go"
)

func main() {
	client := faucet.New(faucet.Config{URL: "http://localhost:3000"})
	ctx := context.Background()

	cfg, err := client.Config(ctx)
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	fmt.Printf("network=%s amount=%s\n", cfg.Network, cfg.ClaimAmountLuna)

	resp, err := client.Claim(ctx, "NQ00 0000 0000 0000 0000 0000 0000 0000 0000", faucet.ClaimOptions{})
	if err != nil {
		log.Fatalf("claim: %v", err)
	}
	fmt.Printf("claim id=%s status=%s tx=%s\n", resp.ID, resp.Status, resp.TxID)

	final, err := client.WaitForConfirmation(ctx, resp.ID, 60*time.Second)
	if err != nil {
		log.Fatalf("wait: %v", err)
	}
	fmt.Printf("final status=%s tx=%s\n", final.Status, final.TxID)
}
