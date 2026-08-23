---
name: query-review
description: Review or optimize database access — N+1 queries, missing or redundant indexes, over-fetching, unbounded list queries, transaction scope, and select/include shape. Use when adding a repository query, when a query feels slow, or when auditing data access before shipping.
---

# Query review

Run this over the queries a change touches — not the whole codebase — unless
the user asked for a full audit. Everything lives in
[src/common/repositories/](../../../src/common/repositories/); if you find a
query outside that directory, that's finding #1 (ADR-0005).

## The checklist

**1. Round trips.** Count the queries one request issues. Two sequential
`await`s that don't depend on each other should be `Promise.all`. A query
inside a `for`/`map` over rows is an N+1 — replace it with a single `findMany`
using `where: { id: { in: ids } }`, or an `include`/`select` on the parent
query. `InvitesService.previewByToken` and `createInvite` each do a
find-then-find; that's fine at two, but the pattern is the one to watch as
lists grow.

**2. Fetch shape.** Prisma returns every scalar column by default. If the
caller uses three fields of a wide row, `select` them. Two specific traps
here: rows carrying `passwordHash` or `tokenHash` shouldn't be pulled into
memory or logged when the caller only needs an id and a role, and
`include: { user: true }` (as in `findByTokenHashWithUser`) is right only
because the caller genuinely needs the whole user to mint a token pair.

**3. Index coverage.** For every `where`, `orderBy`, and `@unique` lookup, name
the index that serves it:

| Query | Index |
| --- | --- |
| `user.findUnique({ email })` | `User.email @unique` |
| `invite.findFirst({ email, organizationId, status })` | `Invite @@index([organizationId])` / `@@index([email])` |
| `refreshToken.findUnique({ tokenHash })` | `RefreshToken.tokenHash @unique` |
| `organization.findUnique({ joinCode })` | `Organization.joinCode @unique` |

A composite index serves any *prefix* of its columns, so
`@@index([organizationId, role])` already covers `organizationId` alone —
adding the single-column index too is dead weight on every write. Conversely,
a `where` on a column with no index and no unique constraint is a sequential
scan; either add the index in a [/schema-change](../schema-change/SKILL.md) or
state explicitly why the table stays small enough not to care.

**4. Unbounded reads.** `findMany` with no `take` is a latent outage. Today
`findManyByOrg` and `findAll` are unbounded because the row counts are small;
any new list endpoint — or any of these once a tenant gets big — needs
pagination (`take`/`skip` or cursor) plumbed through the DTO. Flag it when you
see it rather than silently adding a limit that changes the API contract.

**5. Filter in the query, not in memory.** `findMany(...).filter(...)` and
"fetch then compare `organizationId`" are both correctness bugs in a
multi-tenant app, not just slowness — the row already left the database. Push
`organizationId` into the `where`.

**6. Counting and existence.** Use `count` for a count and
`findFirst({ select: { id: true } })` for an existence check; never
`findMany().length`.

**7. Transaction scope.** A transaction holds a connection and locks rows for
its whole body — keep network calls (mail, HTTP) and password hashing *outside*
it. `InvitesService.acceptInvite` hashes the password before opening the
transaction and sends nothing inside it; match that. Single-model atomicity
belongs inside the repository (`RefreshTokenRepository.rotate`); cross-model
uses `PrismaTransactionRunner`.

**8. Retry loops.** `OrganizationsService.create` retries on a join-code
collision up to `MAX_JOIN_CODE_ATTEMPTS`. Any retry must be bounded, must only
catch the specific error it can recover from, and must not wrap a
transaction that already committed side effects.

**9. Write amplification.** `updateMany` with a narrow `where` beats fetching
ids then updating each (`revokeAllForUser` does this right). Check that a
frequently-written table isn't carrying indexes nothing reads.

## Measuring before claiming

Don't assert a query is slow without evidence. To see the SQL Prisma emits,
temporarily enable logging in
[prisma.service.ts](../../../src/common/prisma/prisma.service.ts)
(`new PrismaClient({ log: ['query'] })`) and exercise the route, or run
`EXPLAIN ANALYZE` against the database directly. Remove any temporary
instrumentation before finishing.

## Reporting

Report findings ordered by impact, each with: the file and method, what the
query does now, the concrete failure mode (at what scale it bites), and the
fix. Separate "fixed now" from "worth doing when N grows" — don't rewrite a
query that is fine at current cardinality just because a pattern looks
suboptimal in the abstract. If a fix needs an index, hand it off to
[/schema-change](../schema-change/SKILL.md) rather than editing
`schema.prisma` without a migration.
