# CLAUDE.md — Quorlyn backend

Multi-tenant SaaS API: **NestJS 11 + Prisma + PostgreSQL**, pnpm workspace.
Organizations own teachers and students; a platform-wide `SUPERADMIN` sits
outside any org. Auth is short-lived JWT access tokens + opaque, hashed,
rotating refresh tokens.

Binding context, in priority order:

1. [docs/adr/](docs/adr/) — accepted decisions. **ADR-0005** (repository
   pattern) and **ADR-0002** (tenancy) constrain nearly every change.
2. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — request lifecycle, tenancy,
   token/session model, data model.
3. [docs/README.md](docs/README.md) — which doc a change belongs in, and what
   deliberately does *not* get documented.

## Commands

Always `pnpm` — never `npm` or `yarn`.

| Command | When |
| --- | --- |
| `pnpm dev` | run with hot reload (port from `PORT`, default 5000) |
| `pnpm typecheck` | fast typecheck — run this after every code change |
| `pnpm lint` | ESLint with `--fix` |
| `pnpm build` | full `nest build` |
| `pnpm test` / `pnpm test:e2e` | Jest unit (`src/**/*.spec.ts`) / e2e |
| `pnpm prisma:generate` | regenerate the Prisma client after a schema edit |
| `pnpm prisma:migrate` | create + apply a dev migration (**ask before running**) |
| `pnpm db:seed` | seed the superadmin |

Never run `prisma migrate reset`, `prisma db push`, or anything that drops
data without explicit approval. Never read or write [.env](.env) values into
chat, commits, or docs — [.env.example](.env.example) is the only env file
that gets edited.

## The loop — follow this for every unit of work

**1. Orient.** Find the existing pattern before inventing one. Every layer
already has at least one worked example (invites is the most complete
vertical slice: controller → service → repositories → transaction → mailer →
Swagger). Read the neighbouring feature, not just the file you're editing.

**2. Plan.** State which layers the change touches — route / DTO / service /
repository / schema / migration / docs — and which ADR it lives under. If the
change contradicts an accepted ADR, stop and say so; don't silently work
around it.

**3. Implement, outside-in.** Route + DTOs → service (business rules,
tenancy checks, error mapping) → repository method → schema/migration if the
data model actually needs it. Skip layers you don't need, but never skip the
repository: services do not talk to Prisma.

**4. Verify.** Typecheck, then lint. Run the relevant tests if any exist for
the touched area. Re-read the diff for the non-negotiables below before
calling it done. If you couldn't verify something (no DB, no test coverage),
say that explicitly rather than implying it passed.

**5. Document.** Decide, out loud, which of these the change needs — the
answer is often "none", and that's a valid answer to state:
   - **ADR** — a decision with a real alternative, or a non-obvious
     constraint you discovered while debugging → `/write-adr`.
   - **ARCHITECTURE.md** — a flow changed shape (new guard, new module, new
     relationship, a diagram no longer matches).
   - **README.md** — only the pitch, stack, setup, or a new bullet under
     *Notable problems solved*.
   - Swagger is not optional documentation — it ships with the route (below).

**6. Report.** Close with: what changed (by layer), what problem it solved,
what you verified and how, what you deliberately did not do, and any
follow-up the user should decide on.

### Skills that carry the detailed procedure

| Skill | Use for |
| --- | --- |
| `/api-endpoint` | adding or changing an HTTP route (DTOs, guards, Swagger, service, repo) |
| `/schema-change` | Prisma model/field/enum/index changes and migrations |
| `/query-review` | N+1s, missing indexes, over-fetching, unbounded lists, transaction scope |
| `/write-adr` | recording a decision or a solved non-obvious problem |
| `/verify` | the pre-handoff gate: typecheck, lint, layering, Swagger, docs, secrets |

## Non-negotiables

These are the rules a reviewer will actually check. Violating one is a bug,
not a style preference.

**Layering (ADR-0005).** Services never import `PrismaService`, never build
`where`/`data`/`include` objects, and never import
`Prisma.PrismaClientKnownRequestError` or reference error code `P2002`. One
repository per model in [src/common/repositories/](src/common/repositories/),
methods named for the *operation* (`findPendingByEmailAndOrg`), not the query
(`findFirst`). The single allowed Prisma leak into a service is a
`Prisma.TransactionClient` handle threaded through repository calls.

**Transactions.** Single-model atomicity lives *inside* the repository (see
`RefreshTokenRepository.rotate`). Cross-model atomicity uses
`PrismaTransactionRunner.run(async (tx) => …)` and passes `tx` as the
trailing argument to each repository call. Every repository write method
takes `tx: Prisma.TransactionClient = this.prisma` so the same method works
inside or outside a transaction.

**Database errors.** Repositories translate via `toUniqueConstraintError` and
throw `UniqueConstraintViolationError`
([errors.ts](src/common/repositories/errors.ts)); services catch it and check
`error.violates('email')`, then throw the HTTP exception.

**Tenancy (ADR-0002).** Every org-scoped read and write is filtered by
`organizationId` *in the query itself* — never fetch-then-check. Services
that return a resource by id compare `currentUser.organizationId` and allow
`SUPERADMIN` through explicitly (see `OrganizationsService.findById`).
`currentUser.organizationId!` is only safe on routes that are `@Roles(...)`-
restricted to org-scoped roles.

**Never leak a Prisma model to the client.** Controllers return response DTO
classes, built by a `to<Thing>Response` mapper in the feature's `dto/` folder.
`passwordHash`, `tokenHash`, and raw tokens never appear in a response — the
one exception is a freshly issued refresh token, returned once and stored
only as `sha256`.

**Input DTOs are the security boundary.** `class-validator` on every field;
the global `ValidationPipe` runs `whitelist + forbidNonWhitelisted +
transform`, so an unvalidated field is a rejected field. Where a Prisma enum
would let a client escalate, declare a narrowed input enum instead — see
`InvitableRole` in
[create-invite.dto.ts](src/module/invites/dto/create-invite.dto.ts), which
makes `SUPERADMIN` structurally unrequestable.

**Swagger ships with the route.** `@ApiTags` on the controller;
`@ApiOperation({ summary })` on every handler; `@ApiResponse({ status, type })`
for anything with a body; `@ApiBearerAuth('access-token')` on every non-
`@Public()` route; `@ApiProperty()` on every DTO field. A route whose shape
isn't visible at `/docs` is unfinished.

**Auth surface.** Global guard order is `ThrottlerGuard → JwtAuthGuard →
RolesGuard`. Opt out of auth with `@Public()`, into role checks with
`@Roles(...)`, and read the caller with `@CurrentUser()`. Any new public
endpoint that creates an account, sends mail, or accepts a secret gets a
tighter `@Throttle({ default: { limit: 5, ttl: 60_000 } })`.

**Secrets & config.** New env var → add it to `envSchema` in
[env.validation.ts](src/common/config/env.validation.ts) *and* to
[.env.example](.env.example) with a placeholder. Read config via
`ConfigService<EnvConfig, true>.get('KEY', { infer: true })`, never
`process.env`. Passwords use `hashPassword`; anything token-shaped uses
`generateOpaqueToken` + `hashToken`.

**Failure of a side effect must not fail the request.** Mail sending is
best-effort: wrap it in `try/catch` and `this.logger.warn(...)`, as
`InvitesService.createInvite` does.

## Exam platform rules (ADR-0006 … 0020)

The exam side is built. These rules are load-bearing; the decision log is
indexed at [docs/adr/README.md](docs/adr/README.md) and the client contract at
[docs/FRONTEND.md](docs/FRONTEND.md).

- **Tenancy is `Membership`, not `User`** (ADR-0006). `User` has no
  `organizationId` and no org role. Org scoping filters on
  `Membership.organizationId` / `Attempt.organizationId`; the active org
  arrives as a token claim selected via `/auth/organizations/:id/select`
  (ADR-0007). `SUPERADMIN` is `User.platformRole`.
- **The answer key never enters a student path** (ADR-0011).
  `QuestionRepository.findManyForExam` omits `isCorrect` via `select`;
  `findManyWithAnswerKey` is separate, with separate DTOs and routes. Never
  merge those mappers, never add an `includeAnswers` flag.
- **The server owns the exam clock** (ADR-0014). `deadlineAt` is computed at
  start; no endpoint accepts elapsed time, a client deadline, or a client
  event timestamp. Everything that asks the time injects `Clock`.
- **Finalization is a conditional update** inside the grading transaction
  (ADR-0015), reached both lazily (`finalizeIfDue` on read paths) and by the
  sweeper. Every finalization sets `submissionCause`, including `MANUAL`.
- **Published quizzes are immutable** (ADR-0010); `duplicate` is the way to
  edit one. Only title, description, window, leaderboard visibility and
  violation limit stay editable.
- **Focus lockdown is not enforceable server-side** (ADR-0016). Record
  violations, act on the count, and never describe it as a device lock in an
  API field, a doc, or UI copy.
- **Question content is validated, never rewritten** (ADR-0020) — UTF-8
  Bangla/English with `$…$` LaTeX. Reject unbalanced delimiters, HTML and
  non-maths commands; do not sanitize a formula into something the teacher
  did not write. Count characters, never bytes.
- **A new question type is a new grader class** registered in `ExamModule`
  (OCP) — never a new branch in a `switch`.
- **Raw SQL is allowed in a repository, never in a service** (ADR-0018) — the
  leaderboard's window function is the one exception to ADR-0005's query API.

## Layout

```
src/
  common/          cross-cutting: config, decorators, guards, mailer,
                   prisma, repositories, token, utils, shared DTOs
  module/<feature>/  <feature>.controller.ts | .service.ts | .module.ts
                     dto/  request DTOs, response DTOs, to<Thing>Response utils
prisma/            schema.prisma, migrations/, seed.ts
docs/              README.md (doc policy), ARCHITECTURE.md, adr/
```

`PrismaModule`, `RepositoriesModule`, and `MailerModule` are `@Global()` — a
feature module does not import them to inject a repository or the mailer.
`TokenModule` is not global; import it where `TokenService` is needed.

## Style

Match the surrounding code. Comments explain *why* a non-obvious thing is
that way (see the comment above `RefreshTokenRepository.rotate`); they never
narrate what the next line does. Constants like `INVITE_TTL_MS` go at module
top, not inline. Import order in practice: node/nest → `@prisma/client` →
common → feature-local. Use `import type` for type-only imports. Prettier and
ESLint settle everything else — run them rather than hand-formatting.
