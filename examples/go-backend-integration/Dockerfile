## syntax=docker/dockerfile:1.7
# Go backend integration example.
# Build context must be the repo root.

FROM golang:1.22-alpine AS build
WORKDIR /app
COPY packages/sdk-go packages/sdk-go
COPY examples/go-backend-integration examples/go-backend-integration
WORKDIR /app/examples/go-backend-integration
RUN go build -o /go-faucet-backend .

FROM alpine:3.19 AS runtime
RUN apk add --no-cache ca-certificates
COPY --from=build /go-faucet-backend /usr/local/bin/go-faucet-backend
EXPOSE 8081
HEALTHCHECK --interval=10s --timeout=2s CMD wget -qO- http://127.0.0.1:8081/healthz || exit 1
CMD ["go-faucet-backend"]
