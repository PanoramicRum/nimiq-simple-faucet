# Go

The Go SDK is server-side only. It handles integrator HMAC signing and is the
recommended way to mint `hostContext.signature` for any frontend SDK.

## Install

```bash
go get github.com/PanoramicRum/nimiq-simple-faucet/packages/sdk-go
```

## Add a claim endpoint

```go
package main

import (
	"context"
	"encoding/json"
	"net/http"
	"os"

	faucet "github.com/PanoramicRum/nimiq-simple-faucet/packages/sdk-go"
)

func main() {
	client := faucet.New(faucet.Config{
		URL:        os.Getenv("FAUCET_URL"),
		APIKey:     os.Getenv("FAUCET_API_KEY"),
		HMACSecret: os.Getenv("FAUCET_HMAC_SECRET"),
	})

	http.HandleFunc("/claim", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Address string `json:"address"`
			UID     string `json:"uidHash"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		id, err := client.Claim(r.Context(), body.Address, faucet.HostContext{
			UID:      body.UID,
			KycLevel: faucet.KycEmail,
		})
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		json.NewEncoder(w).Encode(map[string]string{"claimId": id})
	})

	_ = http.ListenAndServe(":3000", nil)
}
```

`client.Claim` canonicalizes `HostContext`, signs it with `HMACSecret`, and
sends the request with `Authorization: Bearer <APIKey>`.

## Signing only

If the browser or mobile app will call the faucet directly, use
`client.SignContext` to produce a signature to forward:

```go
sig, err := client.SignContext(ctx, faucet.HostContext{UID: uidHash})
if err != nil {
	return ctx, err
}
// Pass sig through to the browser; include it on the next claim.
```

## Live snippet URL

| Version | URL | Notes |
| --- | --- | --- |
| `latest` | `/snippets/go` | TODO: generated at release (M9). |
