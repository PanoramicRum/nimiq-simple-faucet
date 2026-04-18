# Python backend integration example

Minimal example showing how to use the `nimiq-faucet` Python SDK from a backend service.

## Run locally

```bash
pip install nimiq-faucet
FAUCET_URL=http://localhost:8080 python app.py
```

## With Docker

```bash
docker build -t python-faucet-example .
docker run --rm -e FAUCET_URL=http://host.docker.internal:8080 python-faucet-example
```
