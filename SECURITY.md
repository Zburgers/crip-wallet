# Security Policy

## Supported scope

Crip Wallet has no released or production-supported version. The local MVP is
experimental and limited to disposable fake value on Anvil chain `31337`.

## Report a vulnerability

Do not open a public issue. Use GitHub private vulnerability reporting for
`Zburgers/crip-wallet`. Include affected commit, reproduction, impact, and any
evidence with secrets removed. If private reporting is unavailable, contact the
repository owner through a private verified channel before sharing details.

Do not test with real funds, production credentials, third-party wallets, or
public networks. Do not retain or transmit discovered secrets.

## Response expectations

Reports will be acknowledged when maintainers are available; no response SLA is
currently promised. Security-critical findings block release and merge until
resolved and verified. See `docs/SECURITY.md` for engineering gates and the
threat model.

## Security claims

The local signer is not production-grade custody. Control-plane policy is not
cryptographic enforcement. Simulation does not guarantee execution. Open source
does not mean audited.
