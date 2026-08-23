# ADR-0009: Batch invitations issue one token per recipient

- **Status:** Accepted
- **Date:** 2026-08-23

## Context

Organizations onboard teachers in groups — *"multiple email can receive
invitation link"*. The existing flow
([ADR-0003](0003-dual-onboarding-invite-and-join-code.md),
[invites.service.ts](../../src/module/invites/invites.service.ts)) creates one
`Invite` row with one hashed token for one email address, then emails it.

Naively extending it means either looping the endpoint from the client (N
requests, N failure points, no batch feedback) or accepting a list and
failing the whole request when one address is already a member — which is the
common case when re-inviting a group.

There is also a tempting shortcut: issue *one* link and send it to everyone.

## Decision

`POST /invites/batch` accepts up to 100 addresses and creates **one `Invite`
row with its own opaque token per address**, reusing the existing token
primitive and the single-invite acceptance path unchanged.

```jsonc
// request
{ "emails": ["a@x.edu", "b@x.edu"], "role": "TEACHER", "permissions": ["MANAGE_QUIZZES"] }

// 201 response — per-recipient outcome, never a bare 4xx for the batch
{
  "created": 1,
  "skipped": 1,
  "results": [
    { "email": "a@x.edu", "status": "INVITED",         "inviteId": "ckq…" },
    { "email": "b@x.edu", "status": "ALREADY_INVITED", "inviteId": "ckp…" }
  ]
}
```

- Per-address outcomes: `INVITED`, `ALREADY_MEMBER`, `ALREADY_INVITED`,
  `INVALID_EMAIL`. Validation of the list shape (size, syntax, duplicates
  within the request) still rejects the whole request with `400` — that's a
  malformed call, not a per-recipient outcome.
- **Rows are created in one transaction; emails are sent after it commits**,
  each in its own `try/catch` with a warning log, matching the best-effort
  mail rule already used for single invites. One dead mailbox does not roll
  back the other 99 invitations.
- Each address keeps its own token, expiry, and `PENDING → ACCEPTED |
  EXPIRED | REVOKED` lifecycle, so a single recipient can be revoked or
  re-sent without touching the others.
- The batch endpoint requires `Permission.MANAGE_MEMBERS`
  ([ADR-0008](0008-organization-permissions.md)) and is throttled below the
  global default, because it is the one authenticated endpoint that can send
  100 emails in one call.

## Alternatives considered

- **One shared invite link with N uses** — one row, one token, one email
  template, and the organization can paste it into a group chat. Rejected on
  two counts: the invite is no longer attributable (the `Invite.email` that
  the acceptance flow relies on to create the right membership disappears),
  and it cannot be revoked per person. It is also a feature that already
  exists under a different name — the organization join code (ADR-0003) is
  exactly "a shareable, multi-use, self-serve entry point", scoped to
  students by design.
- **Fail the whole batch on the first conflict** — simplest semantics and a
  clean `409`. Rejected because re-inviting a mostly-onboarded group is the
  normal case, and an all-or-nothing rule makes the caller diff the lists by
  hand before every call.
- **Accept the list and process it in a background queue** — protects the
  request from mail latency. Rejected for now: there is no queue
  infrastructure in this project, and mail is already fire-and-forget after
  the transaction commits, so the request returns without waiting on SMTP
  anyway.

## Consequences

- 100 rows and 100 emails per call is a real abuse surface if
  `MANAGE_MEMBERS` is ever granted too freely. The cap, the throttle, and the
  permission are all load-bearing, not decoration.
- The response is a 201 that includes failures, which is unusual enough to be
  worth documenting explicitly in Swagger — a client that only checks the
  status code will silently miss `ALREADY_MEMBER`.
- `InviteRepository` gains a `createMany`-shaped method and a
  `findPendingByEmailsAndOrg(emails[])` lookup so the conflict check is one
  query for the batch rather than one per address.
- The single-invite endpoint stays. It is the batch endpoint with one
  element, but it is also the one used by the organization-creation flow, and
  collapsing them would couple that flow to the batch response shape.
