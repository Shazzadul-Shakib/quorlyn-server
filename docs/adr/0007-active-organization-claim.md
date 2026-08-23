# ADR-0007: The active organization is a claim in the access token

- **Status:** Accepted
- **Date:** 2026-08-23

## Context

Once a user can belong to several organizations ([ADR-0006](0006-membership-as-the-unit-of-tenancy.md)),
every org-scoped request needs to answer "which organization is this call
about?" — and the answer must be authenticated, because it decides which
tenant's data the caller reaches.

Today the answer is baked into the JWT as `organizationId`
([jwt-payload.interface.ts](../../src/common/token/jwt-payload.interface.ts))
and the guards trust it, because there was only ever one possible value per
user. With many memberships, "trust the token" and "let the client say"
stop being the same thing.

Login is also no longer unambiguous: at the moment credentials are checked,
the server doesn't know which organization the user means, and the user may
not have decided yet.

## Decision

Keep the organization in the access token, and make selecting it an explicit,
authenticated step.

```ts
interface JwtPayload {
  sub: string;                  // user id
  platformRole: PlatformRole;   // SUPERADMIN | MEMBER
  deviceId: string;             // see ADR-0017
  org: {                        // null until an organization is selected
    id: string;
    role: OrgRole;
    isOrgOwner: boolean;
    permissions: Permission[];  // see ADR-0008
  } | null;
}
```

- **Login returns the membership list.** `POST /auth/login` responds with the
  token pair plus `memberships: [{ organizationId, name, role }]`. If there
  is exactly one active membership the server pre-selects it and the token
  carries `org`; with zero or several, `org` is `null`.
- **`POST /auth/organizations/:id/select`** validates that the caller has an
  `ACTIVE` membership for that organization and returns a **new access
  token** carrying the `org` claim. The refresh token is untouched — it is
  scoped to a user and a device, not to an organization.
- **An org-less access token is nearly powerless.** It can call `/auth/me`,
  list memberships, select an organization, and log out. Every org-scoped
  route requires an `org` claim; a new `OrgContextGuard` runs after
  `JwtAuthGuard` and rejects a missing claim with `403`.
- **`RolesGuard` reads `org.role`,** not the old `user.role`; `@Roles(...)`
  becomes `@OrgRoles(OrgRole.TEACHER)`. `SUPERADMIN` is checked against
  `platformRole` and bypasses the org guard where a route allows it.
- **Refreshing preserves the selected organization.** `POST /auth/refresh`
  re-reads the membership before re-signing, so a membership revoked or
  suspended mid-session stops working at the next refresh rather than
  outliving it.

## Alternatives considered

- **An `X-Organization-Id` header, validated against `Membership` on every
  request** — the organization becomes a request parameter rather than a
  session property, so switching costs nothing and a revoked membership takes
  effect instantly. Rejected as the default because it puts a database read
  in front of every request, which is exactly what
  [ADR-0001](0001-refresh-token-rotation.md) chose a stateless access token
  to avoid; it also makes "acting in the wrong org" a client bug rather than
  a structural impossibility. Worth revisiting if instant revocation ever
  outranks per-request latency.
- **One refresh-token family per organization** — the org would be pinned for
  the whole session with no re-selection step. Rejected: sessions are
  device-bound ([ADR-0017](0017-single-active-device.md)), so per-org refresh
  families multiply sessions per device and make "one active device" much
  harder to define, for no gain over re-signing an access token.
- **Derive the organization from the resource being accessed** (e.g. read the
  quiz, take its `organizationId`, check membership) — no claim needed at
  all. Rejected: it can't answer list endpoints ("my quizzes" in *which*
  org?), and it makes the tenancy check implicit at every call site, which is
  the failure mode ADR-0002 explicitly avoids.

## Consequences

- Permissions and org role are cached in the token for its lifetime
  (`JWT_ACCESS_TTL`, 15m). A demotion or a suspension takes effect at the
  next refresh, at most 15 minutes later — the same trade-off ADR-0001
  already accepted for `role`, now with a larger blast radius since
  permissions are finer-grained. Anything that must apply immediately
  (suspending a user mid-exam) revokes refresh tokens *and* finalizes the
  attempt, rather than relying on the access token expiring.
- The client gains a real concept of "current organization" and a switcher.
  A stale tab acting in a different org than the user is looking at is a real
  bug class; the org id is therefore echoed in every org-scoped response so
  the client can detect the mismatch.
- `TokenService.issueTokenPair` no longer takes a `User` — it takes a user
  plus an optional resolved membership, and `signAccessToken` gains an
  org-less form.
