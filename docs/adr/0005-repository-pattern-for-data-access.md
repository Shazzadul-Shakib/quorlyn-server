# ADR-0005: Repository layer between services and Prisma

- **Status:** Accepted
- **Date:** 2026-08-21

## Context

Every service (`AuthService`, `TokenService`, `InvitesService`,
`OrganizationsService`, `StudentsService`) injected `PrismaService` directly
and built its own `where`/`data`/`include` objects inline. This worked, but
meant the query shape for a given model (e.g. what counts as "the pending
invite for this email in this org") was duplicated wherever a service needed
it, and every service carried a dependency on Prisma's full query-builder
API surface rather than on the specific operations it actually needed.

It also meant database-specific error handling leaked into services as
copy-pasted logic: `OrganizationsService` and `StudentsService` each had
their own near-identical `isXCollision(error)` function that inspected
`Prisma.PrismaClientKnownRequestError`, its `.code === 'P2002'`, and
`error.meta?.target` to detect a unique-constraint violation.

Two flows — `OrganizationsService.create` (org + owner invite) and
`InvitesService.acceptInvite` (user create + invite status update) —
genuinely need atomicity across two models, which is the main complication
in separating "the query" from "the service": Prisma's interactive
transactions require the *same* transaction client (`Prisma.TransactionClient`)
threaded through every query in the transaction, so introducing a repository
per model raises the question of who owns the transaction boundary.

## Decision

- One repository per model — `UserRepository`, `OrganizationRepository`,
  `InviteRepository`, `RefreshTokenRepository`
  ([src/common/repositories/](../../src/common/repositories/)) — each
  exposing methods named for the operation, not the query
  (`findPendingByEmailAndOrg`, not `findFirst`). Services no longer import
  `PrismaService` or construct Prisma query objects at all.
- Unique-constraint detection is centralized once, in
  [src/common/repositories/errors.ts](../../src/common/repositories/errors.ts):
  `toUniqueConstraintError` inspects the Prisma error and returns a plain
  `UniqueConstraintViolationError` (carrying the violated `target` columns),
  or `null`. Repositories throw it; services check
  `error.violates('email')` / `error.violates('joinCode')` — no service
  imports `Prisma.PrismaClientKnownRequestError` or knows about `P2002`.
- **Single-model transactions stay inside the repository.** `RefreshTokenRepository.rotate`
  wraps its update+create in `$transaction([...])` internally — `TokenService`
  never sees a transaction at all.
- **Cross-model transactions are demarcated by a `PrismaTransactionRunner`**
  ([src/common/prisma/transaction-runner.ts](../../src/common/prisma/transaction-runner.ts)),
  a single-method wrapper around `prisma.$transaction`. Services that need
  atomicity across repositories (`OrganizationsService.create`,
  `InvitesService.acceptInvite`) inject it and pass a callback; each
  repository method accepts an optional trailing `tx` client
  (`Prisma.TransactionClient`, default = the repository's own `PrismaService`)
  so the same call signature works inside or outside a transaction. This is
  the one place a service still touches a Prisma-defined type — the
  transaction handle — but it never builds a query with it; it only threads
  it through repository calls it would be making anyway.
- Both `PrismaModule` and the new `RepositoriesModule` are `@Global()`,
  matching the existing convention (`PrismaService` was already global) —
  feature modules don't need to import either to inject a repository.

## Alternatives considered

- **Ambient transaction via `AsyncLocalStorage`** — would let repository
  methods pick up an in-flight transaction implicitly, so services wouldn't
  need to pass `tx` at all. Rejected as more magic than a four-model,
  two-cross-model-transaction codebase justifies; the explicit `tx` parameter
  is more code but traceable by reading the call site.
- **A generic `BaseRepository<T>` with CRUD methods** — would reduce
  boilerplate across the four repositories. Rejected because the actual
  query shapes barely overlap (`findPendingByEmailAndOrg`,
  `findByTokenHashWithUser`, `rotate` have no generic equivalent), so a base
  class would only cover `findById`-shaped methods while every interesting
  method still needs to be hand-written — not enough shared surface to
  justify the abstraction and its type gymnastics.
- **Full Unit-of-Work object passed through the service layer** — a richer
  abstraction than a bare `tx` parameter, tracking multiple repository calls
  as one unit explicitly. Rejected as more structure than two call sites need;
  `PrismaTransactionRunner.run()` plus optional `tx` params covers both
  existing transactions without the extra type.
- **Keep Prisma calls in services, just extract the duplicated
  collision-detection helpers into a shared util** — the smaller, cheaper
  fix. Rejected because it only solves the error-handling duplication, not
  the actual goal (services building query shapes directly, coupling every
  service to Prisma's query API and making the query shape hard to find /
  reuse across services that touch the same model).

## Consequences

- A new query need means a new repository method, not an inline
  `prisma.model.findX(...)` in the service — slightly more ceremony for a
  one-off query, but every existing query for a model is now discoverable in
  one file instead of scattered across services.
- The `tx` parameter is a visible, if narrow, Prisma leak into the two
  services that orchestrate cross-model transactions
  (`OrganizationsService`, `InvitesService`). Swapping Prisma for another
  ORM would still require touching those two call sites, not just the
  repositories — an acceptable, explicitly-scoped exception to "services
  never import Prisma types."
- Repositories return Prisma's generated model types (`User`, `Organization`,
  ...) directly rather than separate domain entities — there's no
  domain/persistence mapping layer. That's a deliberate scope limit: this
  app has no logic that needs a domain model shaped differently from its
  table, so a mapping layer would be pure ceremony. Worth revisiting only if
  a model's in-memory shape ever needs to diverge from its persisted shape.
