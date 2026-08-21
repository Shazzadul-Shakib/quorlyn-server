# ADR-0001: Opaque, hashed, rotating refresh tokens with reuse detection

- **Status:** Accepted
- **Date:** 2026-07-30

## Context

Access tokens need to be short-lived so a compromised token or a stale role
(e.g. a deactivated user) doesn't stay valid for long. But short-lived access
tokens alone mean the client has to re-authenticate with a password every
15 minutes, which is unusable. A refresh mechanism is needed that's
long-lived but doesn't reintroduce the same exposure window the short access
token was meant to avoid.

The naive version — a long-lived JWT or static token stored in the DB and
reused for every refresh — has a specific failure mode: if that single token
is ever exfiltrated (XSS, log leakage, a compromised device), it's valid
until it expires, and the server has no way to tell the legitimate client's
traffic apart from the attacker's.

## Decision

Refresh tokens are opaque random strings (`generateOpaqueToken`,
[src/common/utils/token.util.ts](../../src/common/utils/token.util.ts)), not
JWTs — they carry no claims, so nothing leaks if decoded, and they can't be
validated without a database lookup, which is the point.

Only `sha256(token)` is ever persisted (`RefreshToken.tokenHash`), so a
database read (backup leak, misconfigured replica, etc.) doesn't hand out
usable tokens.

Every call to `POST /auth/refresh` **rotates**: the presented token is marked
`revokedAt` + `replacedBy`, and a new token is issued
(`TokenService.rotateRefreshToken`,
[src/common/token/token.service.ts](../../src/common/token/token.service.ts)).
The old token is now single-use and dead.

If a token that's already been rotated (`revokedAt` is set) is presented
again, that's a signal someone has a copy of a token the legitimate client
already moved past — the server responds by revoking *every* refresh token
for that user (`revokeAllUserTokens`), not just the one presented.

## Alternatives considered

- **Long-lived static refresh token, no rotation** — simplest to implement,
  but a leaked token stays valid for its full TTL (30 days here) with no way
  to distinguish attacker traffic from legitimate traffic. Rejected.
- **JWT refresh tokens (self-contained, no DB lookup)** — would remove the DB
  round-trip on refresh, but makes revocation impossible without a denylist,
  which reintroduces the DB lookup anyway and adds a second token format to
  reason about. Rejected in favor of one consistent opaque-token model for
  both invites and refresh tokens.
- **Sliding-window single token (update expiry in place, no rotation)** —
  cheaper (one row update, no new row per refresh) but provides no reuse
  signal at all if the token is stolen. Rejected.

## Consequences

- Every refresh is a DB write, not just a read — acceptable at this scale,
  would need revisiting under high-frequency refresh traffic.
- `RefreshToken` rows accumulate (one per rotation); there's no cleanup job
  for expired/revoked rows yet — worth a scheduled prune if this goes to
  production traffic.
- Reuse detection is coarse: it revokes *all* sessions on any reuse, not just
  the suspicious one. Simpler and safer to reason about than per-session
  tracking, at the cost of logging out a user's other legitimate devices on a
  false positive (e.g. a client retrying a refresh after a dropped response).
