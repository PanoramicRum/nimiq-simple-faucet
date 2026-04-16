---
"@nimiq-faucet/sdk": major
"@nimiq-faucet/react": major
"@nimiq-faucet/vue": major
"@nimiq-faucet/capacitor": major
"@nimiq-faucet/react-native": major
---

Initial 1.0.0 release.

First public release of the Nimiq Simple Faucet SDK surface. See
[CHANGELOG.md](../CHANGELOG.md) for the full catalogue of what ships
with 1.0.0 (server, admin dashboard, all 9 abuse layers, MCP server,
Helm chart, frozen OpenAPI spec, end-to-end testnet-verified).

All five published SDKs (`@nimiq-faucet/sdk`, `@nimiq-faucet/react`,
`@nimiq-faucet/vue`, `@nimiq-faucet/capacitor`, `@nimiq-faucet/react-native`)
expose the same stable surface:

```ts
new FaucetClient({ url }).claim(address, { hostContext })
```
