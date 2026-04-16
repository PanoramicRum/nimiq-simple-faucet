# simple-faucet-go

Go client for the Nimiq Simple Faucet. Zero external dependencies; standard library only.

## Install

```
go get github.com/nimiq/simple-faucet-go
```

Requires Go 1.22+.

## Usage

```go
import (
    "context"
    "time"

    faucet "github.com/nimiq/simple-faucet-go"
)

client := faucet.New(faucet.Config{URL: "https://faucet.example.com"})
resp, err := client.Claim(context.Background(), "NQ00...", faucet.ClaimOptions{})
if err != nil { return err }

final, err := client.WaitForConfirmation(context.Background(), resp.ID, 60*time.Second)
```

### Server-to-server with HMAC

```go
client := faucet.New(faucet.Config{
    URL: "https://faucet.example.com",
    APIKey: "ak_...",
    HMACSecret: "sk_...",
})
```

### Hashcash

```go
resp, err := client.SolveAndClaim(ctx, addr, faucet.ClaimOptions{})
```

Mirrors the surface of `@nimiq-faucet/sdk`: `Claim`, `Status`, `WaitForConfirmation`, `Config`, `RequestChallenge`, `SolveAndClaim`. See `example/main.go`.
