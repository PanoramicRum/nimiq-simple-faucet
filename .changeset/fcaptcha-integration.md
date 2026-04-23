---
"@nimiq-faucet/sdk": minor
---

Add FCaptcha as a self-hosted CAPTCHA provider.

`FaucetConfig.captcha` now accepts `provider: 'fcaptcha'` and an optional
`serverUrl` field pointing at the operator's FCaptcha service. The claim
UI renders the upstream FCaptcha widget (`<serverUrl>/fcaptcha.js`) when
this provider is selected.

Server-side the new `@faucet/abuse-fcaptcha` driver is a thin wrapper
around FCaptcha's `/api/token/verify`; all detection logic lives upstream
at [github.com/WebDecoy/FCaptcha](https://github.com/WebDecoy/FCaptcha).
Operators enable it by setting `FAUCET_FCAPTCHA_URL`,
`FAUCET_FCAPTCHA_SITE_KEY`, and `FAUCET_FCAPTCHA_SECRET`, optionally using
the `deploy/compose/fcaptcha.yml` overlay to run FCaptcha as a sidecar.

Turnstile, hCaptcha, and FCaptcha remain mutually exclusive — pick one
per deployment.
