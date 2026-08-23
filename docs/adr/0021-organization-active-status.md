# ADR-0021: Organization-level access switch, separate from Membership.status

- **Status:** Accepted
- **Date:** 2026-08-23

## Context

`Membership.status` (ADR-0006) already lets an org owner suspend one member.
There was no way for the platform superadmin to suspend an entire
organization at once — for example, a customer whose subscription lapsed.
Doing that by hand (suspending every membership row) is not atomic, does not
cover memberships created afterward, and gives no single place to reverse
the decision.

## Decision

Add `Organization.isActive: Boolean @default(true)`, controlled only via
`PATCH /organizations/:id/status` (`@PlatformRoles(SUPERADMIN)`,
`SetOrganizationStatusDto { isActive }`).

Enforcement sits in `OrgClaimService.resolveOrThrow` — the single place that
turns "this user, that organization" into a token claim (ADR-0007) — rather
than in a new per-request guard:

- `resolveOrThrow` fetches the organization first and throws
  `ForbiddenException` if `!organization.isActive`, **before** branching on
  `platformRole`. This blocks the superadmin's own synthesized claim too:
  selecting into a suspended org is refused the same as any other member, so
  the switch can't be bypassed by the actor who set it. Restoring access
  doesn't need the claim path at all — `setActive` operates on the
  organization id directly.
- `resolveDefault` (auto-select at login) additionally filters out
  memberships whose `organization.isActive` is false.
- `resolveOrNull` (used on refresh) already degrades any throw to a null
  claim, so a token inside a newly-suspended org stops carrying it within
  one access-token lifetime — identical in shape to how a suspended
  Membership already degrades (see the comment on `AuthService.refresh`).

`MembershipSummaryDto.organizationIsActive` surfaces the flag on `GET
/auth/me` so a client can show *why* selecting an organization is refused,
without waiting for the 403.

## Alternatives considered

- **A guard/interceptor checking `isActive` on every org-scoped request** —
  rejected: `CurrentOrg`/`RequireOrg` already trust the token claim
  everywhere (ADR-0007's whole premise), and re-checking the database on
  every request duplicates work the claim-resolution step already does once
  per access-token lifetime. Consistent with how Membership suspension is
  enforced.
- **Let the superadmin bypass the suspension** (so they can act inside a
  suspended org to investigate or fix something) — rejected for this pass:
  the request was specifically that a suspended org can perform *no*
  operation. A superadmin bypass is a straightforward follow-up
  (`platformRole === SUPERADMIN` short-circuit before the `isActive` check)
  if a support workflow needs it later.

## Consequences

Suspending an org is a single, atomic, reversible toggle, and every existing
enforcement path (login auto-select, explicit select, refresh) goes through
one function. The cost: the superadmin also loses the ability to select into
a suspended organization through the normal auth flow, so any future
"inspect a suspended org" admin feature needs its own read path that doesn't
go through `resolveOrThrow` (e.g. `GET /organizations/:id`, which already
works for any org regardless of `isActive`).
