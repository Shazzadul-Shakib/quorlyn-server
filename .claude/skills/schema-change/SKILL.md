---
name: schema-change
description: Change the Prisma data model — add or alter a model, field, enum, relation, or index — and produce the matching migration, repository methods, and docs. Use whenever schema.prisma, prisma/migrations, the seed script, or the shape of persisted data is involved.
---

# Changing the data model

The schema is the source of truth for *what* is stored;
[ARCHITECTURE.md](../../../docs/ARCHITECTURE.md) carries the *why* for
relationships that aren't self-evident. Read
[schema.prisma](../../../prisma/schema.prisma) in full before editing — it is
short, and the existing conventions matter more than the change you're making.

## 1. Check the change is actually needed

A new field is a permanent commitment on a table with production data. Before
adding one, confirm the value can't be derived from what's already stored, and
that it isn't a computed view that belongs in a response DTO.

## 2. Conventions to match

- `id String @id @default(cuid())`, never autoincrement.
- `createdAt DateTime @default(now())` on every model; `updatedAt DateTime @updatedAt`
  on anything mutable (`RefreshToken` and `Invite` intentionally omit it —
  they are append-plus-status-transition, not edited).
- Enums (`Role`, `InviteStatus`) live at the top of the file. A status field
  gets an explicit `@default(...)`.
- Secrets are stored hashed and the column says so: `tokenHash String @unique`,
  `passwordHash String`. Never add a column that holds a raw token or password.
- Tenancy: an org-scoped model carries `organizationId String` plus the
  relation, and `@@index([organizationId])`. `User.organizationId` is
  deliberately nullable — that nullability *is* the superadmin (ADR-0002);
  don't "fix" it.
- Cascade only where the child is meaningless without the parent
  (`RefreshToken` → `User`). Invites and users deliberately do **not** cascade
  from `Organization` — deleting an org with members should fail loudly.

## 3. Index every access path you just created

For each new query the change enables, ask what the `where` clause looks like
and whether an index covers it. Prefix rules apply: `@@index([organizationId, role])`
already serves a lookup on `organizationId` alone, so don't add a redundant
single-column index. Add `@unique` for anything looked up by a secret or a
natural key (`tokenHash`, `joinCode`, `email`). See
[/query-review](../query-review/SKILL.md) for the fuller checklist.

## 4. Migration

```bash
pnpm prisma:migrate    # ask the user before running — it hits their database
```

Name the migration for the change (`add_assignment_model`, not `update`).
Then:

- **Read the generated SQL** in `prisma/migrations/<timestamp>_<name>/migration.sql`
  before moving on. Look for anything destructive: `DROP COLUMN`, `DROP TABLE`,
  a type narrowing, or a `NOT NULL` added to a populated table.
- A required column on an existing table needs either a `@default(...)` or a
  three-step migration (add nullable → backfill → enforce). Say which you
  chose and why.
- Never edit an already-applied migration, and never `prisma migrate reset` or
  `prisma db push` on a database with data. A mistake gets a *new* migration.
- `pnpm prisma:generate` runs as part of migrate, but run it explicitly if you
  edited the schema without migrating yet — otherwise the generated types the
  repositories rely on are stale.

## 5. Propagate through the layers

1. **Repository** — new queries the change enables become named methods on the
   model's repository ([src/common/repositories/](../../../src/common/repositories/)).
   A new model means a new repository class registered in
   [repositories.module.ts](../../../src/common/repositories/repositories.module.ts)
   (both `providers` and `exports`).
2. **Create input interface** — `export interface Create<X>Input { … }` in the
   repository file, so services never build Prisma `data` objects.
3. **Response DTOs** — a new column is *not* automatically part of the API.
   Add it to the response DTO and its `to<Thing>Response` mapper deliberately,
   and never expose a hash column.
4. **Seed** — [prisma/seed.ts](../../../prisma/seed.ts) must still run; update
   it if a required field appeared.

## 6. Verify

- `pnpm prisma:generate` → `pnpm typecheck` →
  `pnpm lint`. A schema change that compiles everywhere on the first try is
  worth a second look: it may mean nothing actually reads the new field.
- Run [/verify](../verify/SKILL.md).

## 7. Document

- Update the `erDiagram` in [ARCHITECTURE.md](../../../docs/ARCHITECTURE.md)
  whenever a model or relationship is added, removed, or re-pointed — a
  diagram that no longer matches reality is worse than no diagram.
- Add prose there only for a relationship whose *why* isn't obvious from the
  schema file itself.
- A structural decision (nullable FK for tenancy, denormalizing for a query,
  choosing not to cascade) is ADR material → [/write-adr](../write-adr/SKILL.md).
