## What and why

## How it was checked

- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm test`
- [ ] `npm run check:hosts`
- [ ] Changed how the server talks to Leclerc Drive: tried live with my own logged-in session, a
      few requests only

## Checklist

- [ ] No new dependency (or it was discussed in an issue first)
- [ ] No tool that validates the cart, picks a slot, places an order or pays
- [ ] Nothing reads, stores or logs a password, cookie or 2FA code
- [ ] No host outside the allowlist (`fdN-courses`/`fdN-secure`, `www` and
      `api-recherchemagasins` under `leclercdrive.fr`, `127.0.0.1`); no telemetry
- [ ] No cookie, account detail, address, order, loyalty card or capture in code, tests, docs or
      screenshots; a fix comes with its unit test
- [ ] `CHANGELOG.md` has a line under `## [Unreleased]` if users will notice the change
