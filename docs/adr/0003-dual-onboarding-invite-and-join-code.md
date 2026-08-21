# ADR-0003: Two onboarding paths sharing one token primitive

- **Status:** Accepted
- **Date:** 2026-07-30

## Context

Two very different onboarding needs exist in the same system: a teacher
being added to an organization is a deliberate, admin-controlled action
(specific email, specific role, should be revocable before it's used) — but
requiring a teacher to individually invite every student in a class doesn't
scale and adds friction to what should be self-serve signup.

## Decision

Two separate flows, deliberately not unified into one "invite" concept:

1. **Invite** ([src/module/invites/invites.service.ts](../../src/module/invites/invites.service.ts)) —
   targeted at one email, created by a `TEACHER`, 7-day expiry, explicit
   state machine (`PENDING → ACCEPTED | EXPIRED | REVOKED`) so a mis-sent
   invite can be revoked before it's used.
2. **Join code** ([src/module/students/students.service.ts](../../src/module/students/students.service.ts)) —
   one public, per-organization code
   (`generateJoinCode`, [src/common/utils/join-code.util.ts](../../src/common/utils/join-code.util.ts)),
   any email can self-register against it, no per-user token issued or
   tracked.

Both still route through the same primitive underneath: opaque tokens
generated with `generateOpaqueToken` and stored only as
`sha256(token)` (`hashToken`) — the invite token is that pattern applied to a
single-use, single-recipient case; the join code is a human-readable,
long-lived variant of the same "don't store the secret raw" principle,
generated from a 32-character alphabet with visually ambiguous characters
(`0/O`, `1/I/L`) removed so it can be read aloud or copied without error.

Organization creation also always creates an owner invite in the same
transaction as the org row (`OrganizationsService.create`), rather than
requiring a second manual step to get the first teacher into a newly created
org.

## Alternatives considered

- **One generic "invite" model for both teachers and students** — would
  mean generating and emailing a unique invite per student, which doesn't
  match how classrooms actually onboard (a teacher announces one code to a
  whole class). Rejected as a mismatch with the real workflow.
- **Join code as a JWT instead of a random code** — would avoid the DB
  lookup on join, but the code needs to be short and human-typeable (spoken
  in class, written on a whiteboard); a JWT can't satisfy that. Rejected.
- **No expiry on invites** — simpler, but an unrevoked invite to a
  wrong/former email would stay exploitable indefinitely. Rejected in favor
  of a 7-day TTL plus explicit revocation.

## Consequences

- Join codes are a standing credential, not single-use — anyone with the
  code can join as a student until the org rotates it (rotation isn't
  implemented yet). Acceptable for the target use case (a semi-public
  classroom code), but would need a rotate/regenerate endpoint before this
  could support a more adversarial audience.
- Two code paths for "create a user from a credential" (`InvitesService.acceptInvite`
  and `StudentsService.join`) duplicate the password-hash + token-issue
  shape. Kept separate rather than merged because their validation rules
  (expiry/status vs. code lookup) genuinely differ — revisit if a third
  onboarding path appears and the duplication grows.
