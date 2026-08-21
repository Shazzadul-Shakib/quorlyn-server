# ADR-0002: Single-schema multi-tenancy via nullable `organizationId`

- **Status:** Accepted
- **Date:** 2026-07-30

## Context

The system needs three kinds of user: a platform-wide superadmin with no
tenant, and org-scoped teachers/students who must never see another
organization's data. This needs to be decided before the schema is written,
since it shapes every table that follows.

## Decision

One `User` table, one `Role` enum (`SUPERADMIN`/`TEACHER`/`STUDENT`), and a
nullable `organizationId` foreign key
([prisma/schema.prisma](../../prisma/schema.prisma)):

- `SUPERADMIN` rows have `organizationId: null`.
- `TEACHER`/`STUDENT` rows always have `organizationId` set.

Tenant isolation is enforced in application code, not the database:
services that return a specific resource check the caller's
`organizationId` against the resource's before returning it (e.g.
`OrganizationsService.findById`,
[src/module/organizations/organizations.service.ts](../../src/module/organizations/organizations.service.ts)),
and `SUPERADMIN` is explicitly exempted from that check. List endpoints that
should be tenant-scoped filter by `organizationId` in the Prisma query
itself rather than filtering in memory.

`organizationId` is indexed (`@@index([organizationId])`,
`@@index([organizationId, role])`) since it's the dominant filter on every
tenant-scoped query.

## Alternatives considered

- **Schema-per-tenant / database-per-tenant** — the strongest isolation
  guarantee, but massive operational overhead (migrations run N times,
  connection pooling per tenant) for a platform where tenants are
  classrooms/schools, not enterprises needing that level of guarantee.
  Rejected as over-engineering for this scale.
- **Postgres row-level security (RLS)** — pushes isolation into the database
  itself, which is more robust against an application-layer bug leaking
  cross-tenant data. Rejected for now to keep the authorization logic
  visible and testable in one place (services/guards) rather than split
  across app code and RLS policies — worth revisiting if this were headed to
  production with untrusted tenants.
- **Separate `Superadmin` table instead of a role on `User`** — would avoid
  a nullable FK, but duplicates auth/session logic (login, refresh tokens,
  `me`) for a single row type. Rejected; the nullable FK is a smaller
  compromise than a parallel auth path.

## Consequences

- Every new query against a tenant-scoped model must remember to filter by
  `organizationId` — there's no database-level backstop if a service forgets.
  This is the main risk this design accepts.
- Adding a genuinely tenant-less concept later (e.g. platform-wide settings)
  fits naturally, since `SUPERADMIN` already models "no tenant" as a first-
  class state rather than a special case bolted on.
