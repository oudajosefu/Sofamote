# Security Policy

## Supported versions

Only the latest published Sofamote release is supported for security fixes.

## Reporting a vulnerability

Please report vulnerabilities through GitHub private vulnerability reporting for this repository. Do not open a public issue for security-sensitive reports.

Helpful details include:

- Sofamote version or commit
- Operating system and browser
- Whether the issue affects pairing, token handling, WebSocket auth, LAN exposure, static assets, installers, startup behavior, or OS-level input automation
- Reproduction steps or a proof of concept

The maintainer will triage reports as time allows and will coordinate fixes publicly after the issue can be disclosed safely.

## Security model notes

Sofamote is intended for trusted local networks. The phone client connects to a laptop server over LAN, and WebSocket upgrades require the pairing token from the QR URL. Anyone who can see the QR code can pair, so treat it like a local secret.

