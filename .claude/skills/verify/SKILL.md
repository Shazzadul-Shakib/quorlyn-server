---
name: verify
description: Pre-handoff gate for this repo — typecheck, lint, layering and tenancy rules, Swagger completeness, response-leak check, migration sanity, docs and secrets. Run before reporting any code change as done, or when asked to double-check work.
---

# Verify before handing off

Run the checks that apply to what actually changed. Report each as pass, fail,
or not-applicable — never imply a check ran when it didn't.

## Automated

```bash
pnpm typecheck    # typecheck (fast)
pnpm lint                                        # eslint --fix
pnpm test                                        # only if specs cover the touched area
```

If the schema changed, `pnpm prisma:generate` must come first or the
typecheck is checking stale generated types.

## By hand — read the diff against these

**Layering (ADR-0005).** No `PrismaService` import, `prisma.<model>.` call,
`P2002`, or `PrismaClientKnownRequestError` anywhere under `src/module/`:

```bash
grep -rnE "PrismaService|prisma\.[a-z]+\.|P2002|PrismaClientKnownRequestError" src/module/ || echo "clean"
```

The only legitimate hit is a `Prisma.TransactionClient` type used to thread
`tx` through repository calls.

**Tenancy (ADR-0002).** Every org-scoped query filters by `organizationId` in
the `where`. Every by-id fetch that a non-superadmin can reach compares
`currentUser.organizationId` — or is scoped by it in the query. No
fetch-then-check. `currentUser.organizationId!` appears only on routes
restricted to org-scoped roles.

**Response leaks.** No `passwordHash`, `tokenHash`, or raw Prisma model
reaches a controller return type. Every response goes through a
`to<Thing>Response` mapper:

```bash
grep -rn "passwordHash\|tokenHash" src/module/ --include="*.controller.ts" --include="*response*" || echo "clean"
```

**Swagger.** For each changed controller: `@ApiTags` on the class,
`@ApiOperation` on every handler, `@ApiResponse` with a real DTO type wherever
there's a body, `@ApiBearerAuth('access-token')` on every route that isn't
`@Public()`, `@ApiProperty()` on every field of every DTO the route touches.

**Guards and limits.** New public route → is `@Public()` deliberate, and does
it need the tighter `@Throttle({ default: { limit: 5, ttl: 60_000 } })`? New
privileged route → is `@Roles(...)` the narrowest set that works?

**Validation.** Every request DTO field carries a `class-validator` decorator.
No Prisma enum is accepted directly where it would let a client escalate to
`SUPERADMIN`.

**Migrations.** `git status` shows the migration alongside the schema edit —
never a schema change without one. Read the generated SQL for `DROP`,
narrowing type changes, or `NOT NULL` on a populated table. No previously
applied migration was edited.

**Config and secrets.** New env var is in *both* `envSchema`
([env.validation.ts](../../../src/common/config/env.validation.ts)) and
[.env.example](../../../.env.example) with a placeholder. No `process.env`
outside that file. No real secret, token, or `.env` value in the diff, in a
doc, or in a log line:

```bash
git diff --cached -- . ':(exclude).env' | grep -nE "(secret|password|token).*=.*['\"][A-Za-z0-9/+_-]{16,}" || echo "clean"
```

**Docs.** Decide and state which applies — often "none":
ARCHITECTURE.md (a flow or diagram changed shape) · ADR (a real decision or a
non-obvious constraint → [/write-adr](../write-adr/SKILL.md)) · README (pitch,
stack, setup, or one new *Notable problems solved* bullet). Docs land in the
same change as the code, never "later".

## Report

Close with a short block:

- **Changed** — by layer (route / DTO / service / repository / schema / docs).
- **Solved** — the problem, in one line.
- **Verified** — which commands ran and their result; which checks were manual.
- **Not done** — anything skipped, and why. Unverifiable things (no DB access,
  no test coverage for this path) go here, said plainly.
- **Decide** — anything that needs the user's call.
