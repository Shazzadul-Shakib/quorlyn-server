---
name: api-endpoint
description: Add or change an HTTP endpoint in this NestJS API — route, request/response DTOs, guards and roles, throttling, service logic, repository method, and Swagger. Use whenever the work involves a controller, a new route or a change to an existing one, request validation, or the shape of an API response.
---

# Adding or changing an endpoint

Work outside-in and stop at the shallowest layer that does the job. The
invites vertical slice is the reference implementation — read
[invites.controller.ts](../../../src/module/invites/invites.controller.ts),
[invites.service.ts](../../../src/module/invites/invites.service.ts), and
[invite.repository.ts](../../../src/common/repositories/invite.repository.ts)
before writing anything new.

## 1. Decide the contract first

Answer these before touching code, and state the answers:

- **Path and verb**, and which feature module owns it. A new noun means a new
  module under `src/module/<feature>/` (controller + service + module +
  `dto/`), registered in [app.module.ts](../../../src/app.module.ts).
- **Who can call it.** Public (`@Public()`), any authenticated user (no
  decorator), or role-restricted (`@Roles(Role.TEACHER)`). Default to the
  narrowest that satisfies the requirement.
- **Tenancy.** Which organization's data does it touch, and where does the
  `organizationId` come from — `@CurrentUser()` for org-scoped roles, a path
  param plus an explicit ownership check for superadmin-reachable routes.
- **Status code.** Nest returns 201 for `@Post`, 200 otherwise. A mutation
  with no body returns `@HttpCode(HttpStatus.NO_CONTENT)` and `Promise<void>`.

## 2. Request DTO — `dto/<action>.dto.ts`

- One `class-validator` decorator per field; optional fields get
  `@IsOptional()`. The global pipe rejects unknown fields, so anything not
  declared is refused for you.
- `@ApiProperty()` on every field, with `example` for anything a reader would
  otherwise have to guess, and `enum:` for enums.
- If a Prisma enum would let a client request something it shouldn't, declare
  a narrowed enum in the DTO file and document why in a comment — mirror
  `InvitableRole`.
- Normalize in the service, not the DTO (see `dto.joinCode.trim().toUpperCase()`
  in `StudentsService.join`).

## 3. Response DTO — `dto/<thing>-response.dto.ts` + `dto/<thing>-response.util.ts`

Never return a Prisma model. Declare a response class with `@ApiProperty()`
on each field, and a pure mapper `to<Thing>Response(model): <Thing>ResponseDto`
next to it. Reuse the shared ones where they fit:
[auth-tokens-response.dto.ts](../../../src/common/dto/auth-tokens-response.dto.ts),
[token-pair-response.dto.ts](../../../src/common/dto/token-pair-response.dto.ts),
[user-summary.dto.ts](../../../src/common/dto/user-summary.dto.ts). Check that
no hash, secret, or internal id sneaks into the mapper.

## 4. Controller handler

Thin — it wires decorators to one service call and nothing else. No business
logic, no error handling, no data shaping.

```ts
@Post()
@Roles(Role.TEACHER)
@ApiBearerAuth('access-token')
@ApiOperation({ summary: 'Invite a teacher or student into your organization' })
@ApiResponse({ status: 201, type: InviteResponseDto })
create(
  @Body() dto: CreateInviteDto,
  @CurrentUser() currentUser: AuthenticatedUser,
): Promise<InviteResponseDto> {
  return this.invitesService.createInvite(dto, currentUser.organizationId!, currentUser.sub);
}
```

Swagger checklist for the handler: `@ApiTags` on the class,
`@ApiOperation` here, `@ApiResponse` with the real DTO type (`[Dto]` for
lists), `@ApiBearerAuth('access-token')` unless `@Public()`. Add
`@ApiResponse` entries for the error cases a client must handle (409 on
conflict, 410 on an expired token) when they're part of the contract.

Public routes that create accounts, send mail, or consume a secret also get
`@Throttle({ default: { limit: 5, ttl: 60_000 } })`.

## 5. Service method

This is where the rules live: existence and conflict checks, state-machine
guards, tenancy comparison, error translation, side effects.

- Throw Nest HTTP exceptions with a message a client can show:
  `ConflictException`, `NotFoundException`, `ForbiddenException`,
  `GoneException` for a valid-but-dead token, `UnauthorizedException` for
  credentials.
- Catch `UniqueConstraintViolationError` and map `error.violates('field')` to
  the right HTTP exception — never let a raw Prisma error escape.
- Cross-model writes go inside `this.transactionRunner.run(async (tx) => …)`,
  passing `tx` to each repository call.
- Best-effort side effects (mail) are wrapped in `try/catch` with
  `this.logger.warn(...)`; they never fail the request.
- Return the response DTO via the mapper.

## 6. Repository method

If the query doesn't exist yet, add it to the model's repository rather than
querying in the service. Name it for the operation, scope it by
`organizationId` when org-scoped, add `tx: Prisma.TransactionClient = this.prisma`
as a trailing parameter on writes, and declare an exported `Create<X>Input`
interface for creates. Wrap creates/updates that can violate a unique index
in the `toUniqueConstraintError` translation. Then re-read
[/query-review](../query-review/SKILL.md)'s checklist for the new query.

## 7. Wire and verify

- New module → add it to `imports` in `app.module.ts`. Needs `TokenService`?
  Import `TokenModule` in the feature module (it is not global).
- `pnpm typecheck` then `pnpm lint`.
- Confirm the route appears correctly at `/docs` (run `pnpm dev` and check, or
  at minimum re-read the decorators against the checklist above).
- Then run [/verify](../verify/SKILL.md).

## 8. Document

A new endpoint on its own is not ARCHITECTURE.md material — the code says it.
Update [ARCHITECTURE.md](../../../docs/ARCHITECTURE.md) only if the request
lifecycle, the auth surface, or a flow diagram changed. If you chose between
two real designs (or discovered a constraint that forced one), write it up
with [/write-adr](../write-adr/SKILL.md).
