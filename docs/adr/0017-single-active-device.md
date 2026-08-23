# ADR-0017: One active device per account, released by email verification

- **Status:** Accepted
- **Date:** 2026-08-23

## Context

*"One student can have only one device access; if already logged in on any
device, they should see 'log out from that device' and log in via email
verification."*

The point is exam integrity: two simultaneous sessions means one screen for
the questions and another for a helper, or an account shared between two
people sitting the same exam.

[ADR-0001](0001-refresh-token-rotation.md) deliberately built the opposite:
refresh tokens are per-session precisely so a user can hold several — laptop,
phone, tablet — and revoke one without disturbing the others. `RefreshToken`
already stores `userAgent` and `ipAddress`, but neither identifies a device:
both change with a browser update or a move between wifi and mobile data, and
both are trivially spoofed.

Two decisions are therefore needed: what counts as "a device", and what
happens when a second one appears.

## Decision

**A device is a client-generated opaque id, stored hashed, bound to the
refresh-token family.**

```prisma
model Device {
  id           String    @id @default(cuid())
  userId       String
  deviceIdHash String                          // sha256 of a client-generated uuid
  label        String?                         // "Chrome on Windows", for the UI
  lastSeenAt   DateTime  @default(now())
  revokedAt    DateTime?
  createdAt    DateTime  @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, deviceIdHash])
  @@index([userId])
}

model RefreshToken {
  // ...existing fields
  deviceId String?      // FK to Device — the family is device-scoped
}

model EmailChallenge {
  id          String    @id @default(cuid())
  userId      String
  purpose     ChallengePurpose      // DEVICE_CHANGE (extensible)
  codeHash    String                // sha256 of a 6-digit code
  expiresAt   DateTime              // 10 minutes
  attempts    Int       @default(0) // wrong-code counter, max 5
  consumedAt  DateTime?
  createdAt   DateTime  @default(now())

  @@index([userId, purpose])
}
```

The client generates a UUID on first run and stores it (`localStorage`, or
the app's own storage), sending it as `X-Device-Id` on auth calls. It is
**not** a security control — a determined user can clear it — it is a stable
identifier so that legitimate re-logins on the same machine are not treated
as device changes.

**Login has a third outcome.** Beyond success and bad credentials:

```mermaid
sequenceDiagram
    participant B as New device
    participant API
    participant Mail
    B->>API: POST /auth/login (email, password, X-Device-Id)
    API-->>B: 409 DEVICE_CONFLICT { activeDevice: { label, lastSeenAt } }
    B->>API: POST /auth/device-change/request
    API->>Mail: 6-digit code (10 min, single use)
    B->>API: POST /auth/device-change/verify (code, X-Device-Id)
    API->>API: revoke all refresh tokens; revoke old Device; bind new one
    API-->>B: token pair for the new device
```

- The `409` names the existing device (label and last-seen time) and nothing
  else — no ip address, no token, nothing that helps an attacker who guessed
  a password. It is returned only after credentials verify, so it is not an
  account-existence oracle.
- Verification revokes **every** refresh token for the user, not just the
  other device's, so exactly one family survives: the one issued at the end
  of the flow. The old device's next refresh fails and it is logged out —
  which is the "log out from that device" the requirement asks for.
- Code requests are rate-limited per user and per ip, expire in 10 minutes,
  are single-use, and lock out after 5 wrong attempts. Codes are stored as
  `sha256`, like every other secret here.

**The policy is a per-user flag, not a role check.**
`User.singleDeviceEnforced Boolean @default(true)`, set from how the account
was created: student self-enrolment and student invites leave it `true`,
teacher invites set it `false`. It cannot be a role check because login
happens *before* an organization is selected
([ADR-0007](0007-active-organization-claim.md)) — at that moment a user with
memberships in three organizations has no single role to consult, and one of
them may be `STUDENT`.

**A device change during an in-flight attempt is allowed and recorded.**
Blocking it would strand a student whose laptop died; the new device resumes
the attempt ([ADR-0014](0014-attempt-lifecycle-and-timing.md)) and a
`DEVICE_CHANGED` proctor event goes on the timeline for the teacher to judge
([ADR-0016](0016-focus-enforcement-is-client-side.md)).

## Alternatives considered

- **Silently revoke the old session on a new login** — the common "you've
  been logged out elsewhere" pattern, no email round-trip. Rejected: it makes
  account sharing *convenient* (log in, take the exam, the other party logs
  back in afterwards) and gives the legitimate owner no signal that someone
  else has their password. The email step is what makes the takeover visible
  and costly.
- **Device fingerprinting (user agent + ip + screen metrics)** — nothing for
  the client to store. Rejected: unreliable in both directions. It flags the
  same student after a browser update and fails to distinguish two identical
  lab machines, so it would generate constant false lockouts on exactly the
  hardware schools use.
- **Bind the session to the device with no override at all** — strongest
  integrity. Rejected: a lost or broken phone would permanently lock a
  student out, needing staff intervention for a routine event.
- **Enforce single-device only while an attempt is in progress** — narrower,
  and it targets exactly the integrity risk. A genuinely reasonable
  alternative, rejected because the requirement is written about accounts,
  not attempts, and because the pre-exam moment (sharing credentials the
  night before) is when sharing actually happens.

## Consequences

- **This narrows ADR-0001 rather than replacing it.** Rotation, hashing,
  and reuse detection are unchanged; what changes is how many families may be
  live at once for an enforced user. ADR-0001 stays `Accepted`.
- Clearing browser storage generates a new device id and therefore a device
  change — an email round-trip for what the user experiences as "logging in
  again". Incognito windows do it every time. This is the main usability cost
  and it is why teachers are exempt by default.
- "Already logged in" means *a live refresh-token family exists*, so a student
  who closes the tab without logging out is still holding the slot until the
  token expires (`REFRESH_TOKEN_TTL_DAYS`, default 30). A shorter TTL for
  enforced users, or an idle timeout, is worth revisiting once there is real
  usage data.
- The mailer gains a second template and becomes load-bearing: invite mail is
  best-effort ([invites.service.ts](../../src/module/invites/invites.service.ts)
  logs and continues), but a device-change code that never arrives is a
  locked-out student. This flow must surface SMTP failure to the caller
  rather than swallowing it.
- `TokenService` now needs the device on every issue and rotate, so
  `RefreshTokenMeta` grows a `deviceId` and the rotation path must carry it
  forward to the successor token.
