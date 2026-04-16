# Integrator HMAC signing

When your backend calls the faucet on behalf of your users, HMAC-sign the
request. Signed requests are trusted more by the abuse-prevention pipeline
(the `hostContext` is weighted higher and `hostContextVerified: true` is
set in the decision trace).

This doc shows the exact canonical form, required headers, and working
backend examples in Node, Go, and raw `curl`.

---

## The wire contract

Every signed request sends four custom headers alongside the usual
content-type:

```
x-faucet-api-key:   <public integrator api key>
x-faucet-timestamp: <unix millis, server enforces ±5 min skew>
x-faucet-nonce:     <fresh per-request, any string, 32+ chars recommended>
x-faucet-signature: <lowercase hex of HMAC-SHA256, see below>
```

The signature is:

```
HMAC_SHA256(
  secret   = <your integrator secret>,
  message  = METHOD + "\n" + PATH + "\n" + TIMESTAMP + "\n" + NONCE + "\n" + BODY,
)
```

- `METHOD` is uppercased (`POST`, `GET`, …)
- `PATH` is the request path including query string (e.g. `/v1/claim`)
- `TIMESTAMP` and `NONCE` are the **same strings** sent in the headers
- `BODY` is the raw request body bytes, unparsed. For JSON requests, this is
  the exact string you're about to send — do **not** reformat it.

The server implementation lives in [apps/server/src/hmac.ts](../apps/server/src/hmac.ts).

---

## Provisioning integrator credentials

1. Start the faucet with an admin password set.
2. Open `http://<your-faucet>/admin/integrators`.
3. Click **Create**, name the integrator, hit save.
4. **Copy the shown API key and secret immediately** — the secret is only
   displayed once. Store it in your backend's secret manager.

Alternatively, seed via env var on startup:

```
FAUCET_INTEGRATOR_KEYS=myapp:ak_xxx:sk_yyy
```

(format: `<id>:<apiKey>:<secret>`, comma-separated for multiple).

---

## Example: Node.js / TypeScript

```ts
import { createHmac } from 'node:crypto';
import { randomBytes } from 'node:crypto';

const FAUCET_URL    = process.env.FAUCET_URL!;       // https://faucet.example.com
const FAUCET_KEY    = process.env.FAUCET_API_KEY!;   // ak_xxx
const FAUCET_SECRET = process.env.FAUCET_HMAC_SECRET!; // sk_yyy

function signedFetch(path: string, bodyObj: unknown) {
  const body      = JSON.stringify(bodyObj);
  const timestamp = String(Date.now());
  const nonce     = randomBytes(16).toString('hex');
  const canonical = ['POST', path, timestamp, nonce, body].join('\n');
  const signature = createHmac('sha256', FAUCET_SECRET)
    .update(canonical)
    .digest('hex');

  return fetch(FAUCET_URL + path, {
    method: 'POST',
    headers: {
      'content-type':       'application/json',
      'x-faucet-api-key':   FAUCET_KEY,
      'x-faucet-timestamp': timestamp,
      'x-faucet-nonce':     nonce,
      'x-faucet-signature': signature,
    },
    body,
  });
}

// Claim on behalf of a known, signed-in user:
const res = await signedFetch('/v1/claim', {
  address: userNimiqAddress,
  hostContext: {
    uid:            hashedUserId,   // your stable per-user identifier
    accountAgeDays: 42,
    kycLevel:       'email',
    tags:           ['mobile'],
  },
});
const { id, status, txId } = await res.json();
```

---

## Example: Go

```go
package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"time"
)

func signedPost(path string, bodyObj any) (*http.Response, error) {
	body, _ := json.Marshal(bodyObj)
	ts := strconv.FormatInt(time.Now().UnixMilli(), 10)
	nonceBytes := make([]byte, 16)
	_, _ = rand.Read(nonceBytes)
	nonce := hex.EncodeToString(nonceBytes)

	canonical := "POST\n" + path + "\n" + ts + "\n" + nonce + "\n" + string(body)
	mac := hmac.New(sha256.New, []byte(os.Getenv("FAUCET_HMAC_SECRET")))
	mac.Write([]byte(canonical))
	sig := hex.EncodeToString(mac.Sum(nil))

	req, _ := http.NewRequest("POST", os.Getenv("FAUCET_URL")+path, bytes.NewReader(body))
	req.Header.Set("content-type", "application/json")
	req.Header.Set("x-faucet-api-key", os.Getenv("FAUCET_API_KEY"))
	req.Header.Set("x-faucet-timestamp", ts)
	req.Header.Set("x-faucet-nonce", nonce)
	req.Header.Set("x-faucet-signature", sig)
	return http.DefaultClient.Do(req)
}

func main() {
	resp, err := signedPost("/v1/claim", map[string]any{
		"address": "NQ12 …",
		"hostContext": map[string]any{
			"uid":            "hashed-user-id",
			"accountAgeDays": 42,
			"kycLevel":       "email",
		},
	})
	if err != nil {
		panic(err)
	}
	fmt.Println(resp.Status)
}
```

The [`@nimiq-faucet/sdk-go`](https://github.com/PanoramicRum/nimiq-simple-faucet/tree/main/packages/sdk-go) package does all of this automatically when you pass `APIKey` and `HMACSecret` to `faucet.New`:

```go
client := faucet.New(faucet.Config{
  URL:        "https://faucet.example.com",
  APIKey:     os.Getenv("FAUCET_API_KEY"),
  HMACSecret: os.Getenv("FAUCET_HMAC_SECRET"),
})
resp, _ := client.Claim(ctx, addr, faucet.ClaimOptions{
  HostContext: &faucet.HostContext{UID: &uidHash},
})
```

---

## Example: curl (for testing)

```bash
#!/usr/bin/env bash
set -e

FAUCET_URL="http://localhost:8080"
API_KEY="ak_xxx"
SECRET="sk_yyy"

BODY='{"address":"NQ12 ...","hostContext":{"uid":"test-user"}}'
TS=$(($(date +%s)*1000))
NONCE=$(openssl rand -hex 16)

SIG=$(printf "POST\n/v1/claim\n%s\n%s\n%s" "$TS" "$NONCE" "$BODY" \
  | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $2}')

curl -sS "$FAUCET_URL/v1/claim" \
  -H "content-type: application/json" \
  -H "x-faucet-api-key: $API_KEY" \
  -H "x-faucet-timestamp: $TS" \
  -H "x-faucet-nonce: $NONCE" \
  -H "x-faucet-signature: $SIG" \
  -d "$BODY"
```

---

## Gotchas

- **Body byte-exactness**: sign the exact bytes you send. If your HTTP
  client re-serializes JSON (e.g. reordering keys), the signature will
  break. Compute the body string once, sign it, then send it verbatim.
- **Timestamps must be millis, not seconds**: the server's 5-minute skew
  check fails silently if you pass seconds — it just looks "very old".
- **Nonces must be unique per integrator**: nonces are stored for 5 min
  and reuse is rejected. Random hex is the safest path.
- **Path includes the query string**: `POST /v1/claim?debug=1` has path
  `/v1/claim?debug=1`, not just `/v1/claim`.
- **Signature is hex, not base64**: `HMAC-SHA256(...)` → hex digest,
  lowercase, no prefix.

## What gets trusted

When the signature verifies:

- `ClaimRequest.hostContextVerified = true` is set.
- Abuse layers can weight `hostContext.uid`, `accountAgeDays`, `kycLevel`
  more heavily (e.g. the fingerprint layer trusts the `uid` as stable).
- The full claim response still runs through every abuse check — signing
  only grants trust, not bypass.

Signing the whole request is how the faucet currently establishes
integrator identity. A field-level signing scheme for just `hostContext`
(using `canonicalizeHostContext` from `@faucet/core`) is on the roadmap;
see [ROADMAP.md](../ROADMAP.md).
