# ADR-0008: Org role plus explicit permission grants on the membership

- **Status:** Accepted
- **Date:** 2026-08-23

## Context

The organization dashboard has to *"maintain teachers and permissions"*. Two
roles and one boolean (`OrgRole` + `isOrgOwner`) can't express what the
dashboard implies: an owner who wants a teacher to run quizzes but not invite
colleagues, or an assistant who may read results but not author quizzes.

The obvious escape — adding a role per combination (`TEACHER_READONLY`,
`TEACHER_ADMIN`, …) — multiplies enum values every time a new capability
appears, and each new value has to be handled everywhere `OrgRole` is
switched on.

At the same time the system is small: four or five distinct capabilities, one
organization deep, no cross-org delegation. A full role/permission/assignment
schema would be more machinery than there are rules to express.

## Decision

Keep `OrgRole` as the coarse identity (what kind of participant you are) and
attach a set of explicit permissions to the membership for the fine-grained
authority.

```prisma
enum Permission {
  MANAGE_MEMBERS      // invite, suspend, change permissions
  MANAGE_QUIZZES      // create, edit, publish, close quizzes
  VIEW_RESULTS        // attempts, leaderboards, per-question stats
  MANAGE_ORGANIZATION // rename, rotate join code, manage links
}

model Membership {
  // ...see ADR-0006
  role        OrgRole
  isOrgOwner  Boolean      @default(false)
  permissions Permission[] @default([])
}
```

Resolution rules, in order:

1. `platformRole = SUPERADMIN` → everything, no membership required.
2. `isOrgOwner = true` → every permission in the organization, implicitly.
   Owners are not stored with an explicit permission list, so a new
   `Permission` value doesn't need backfilling.
3. Otherwise → exactly the permissions on the membership row.
4. `OrgRole.STUDENT` memberships hold no permissions and are not grantable
   any; the dashboard never offers them.

Enforcement is a `@RequirePermissions(Permission.MANAGE_QUIZZES)` decorator
plus a `PermissionsGuard` running after `OrgContextGuard`, reading
`org.permissions` and `org.isOrgOwner` from the token claim
([ADR-0007](0007-active-organization-claim.md)) — no database read, same
shape as the existing [RolesGuard](../../src/common/guards/roles.guard.ts).

A teacher invited without an explicit permission set is created with
`[MANAGE_QUIZZES, VIEW_RESULTS]` — enough to do the job the invite was for,
and nothing that touches other people's access.

## Alternatives considered

- **More `OrgRole` values instead of permissions** — no new concepts, and the
  existing guard handles it unchanged. Rejected because the capabilities are
  independent of each other: expressing every useful combination takes
  2^n roles, and "teacher who can invite" is a *permission* the owner grants,
  not a different kind of person.
- **A `Role` table with a `RolePermission` join, assignable per organization**
  — the textbook RBAC schema, and the right answer if organizations ever
  define their own roles. Rejected as premature: it turns one array column
  into three tables and a management UI to answer a question no user has
  asked yet ("we want our own role called Head of Year"). The migration from
  a `Permission[]` column to that schema is mechanical if it becomes real.
- **Per-resource ACLs (this teacher may see *this* quiz)** — rejected outright
  for now: nothing in the requirements is per-resource, and it would make
  every list query an authorization join.

## Consequences

- Permissions travel in the access token, so a revoked permission stays live
  until the next refresh — bounded by `JWT_ACCESS_TTL`, and the same
  staleness trade-off already accepted in ADR-0001 and ADR-0007. Removing
  someone's access *now* means suspending the membership and revoking their
  refresh tokens, not editing permissions.
- Adding a `Permission` value is a schema migration (Postgres enum) plus a
  decision about which existing memberships get it. Owners get it for free by
  rule 2; everyone else defaults to not having it, which is the safe
  direction.
- Two guards now sit between `JwtAuthGuard` and the handler
  (`OrgContextGuard`, `PermissionsGuard`). The global guard order becomes
  `Throttler → JwtAuth → OrgContext → OrgRoles → Permissions`, and
  [docs/ARCHITECTURE.md](../ARCHITECTURE.md) has to be updated when this
  lands — the request-lifecycle diagram there is the load-bearing
  documentation for it.
- The last owner of an organization must not be able to remove their own
  `isOrgOwner` flag or suspend themselves; that check belongs in the service,
  and it is the kind of rule that is easy to forget and expensive to
  discover.
