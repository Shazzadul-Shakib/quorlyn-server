# ADR-0013: Shareable quiz links are revocable tokens, and taking one enrols the student

- **Status:** Accepted
- **Date:** 2026-08-23

## Context

*"Teacher and organization can share the quiz link to the student"*, and
*"student simply login and start exam"*. The student on the other end of that
link may not be a member of the organization yet — they may not have an
account at all.

Two existing mechanisms almost cover it and each falls short. The
organization join code ([ADR-0003](0003-dual-onboarding-invite-and-join-code.md))
gets a student into the organization but says nothing about which quiz.
Invites are per-email and single-use, which is the opposite of a link a
teacher pastes into a class group.

Handing out a bare `/quizzes/{id}` URL is the obvious shortcut, and it is
wrong for a specific reason: a quiz id is permanent and unrevocable. Once it
leaks, the only remedy is closing the quiz for everyone.

## Decision

A quiz is shared through a **`QuizLink`** — an opaque token, hashed at rest,
issued per share and revocable on its own.

```prisma
model QuizLink {
  id         String    @id @default(cuid())
  quizId     String
  tokenHash  String    @unique     // sha256, same primitive as invites
  label      String?               // "Section B", for the teacher's own use
  expiresAt  DateTime?
  maxUses    Int?                  // null = unlimited within the quiz window
  usedCount  Int       @default(0)
  revokedAt  DateTime?
  createdById String
  createdAt  DateTime  @default(now())

  quiz Quiz @relation(fields: [quizId], references: [id], onDelete: Cascade)

  @@index([quizId])
}
```

The flow, deliberately mirroring the invite preview/accept split that already
exists:

1. **`GET /quiz-links/:token` — public.** Returns quiz title, organization
   name, duration, and window. No questions, no ids that grant access. This
   is what the student sees before logging in, and it is the only public
   surface.
2. **The student authenticates** — existing login, or self-registration with
   the same email/password flow students already use.
3. **`POST /quiz-links/:token/start` — authenticated.** In one transaction:
   resolve the link (not revoked, not expired, uses remaining), ensure an
   `ACTIVE` `STUDENT` membership for the link's organization — creating it if
   absent ([ADR-0006](0006-membership-as-the-unit-of-tenancy.md)) — increment
   `usedCount`, then create or resume the attempt
   ([ADR-0014](0014-attempt-lifecycle-and-timing.md)).

Self-enrolment through a link is what makes *"student can attend exam in
multiple organization"* work in practice: the student never applies to join a
school, they follow a link and become a student of that organization as a
side effect of sitting its exam.

`usedCount` counts **distinct students who started**, not requests — a
student who reloads or resumes does not consume the allowance twice. A link
that has already enrolled a student always lets that student back in, even
after `maxUses` is reached; otherwise a reconnecting student is locked out of
an exam they are in the middle of.

Existing members are unaffected by link limits: a `TEACHER` opening the link
gets a preview, not an attempt.

## Alternatives considered

- **Share the quiz id directly, guarded by organization membership** — no new
  model, and access control is the membership check that exists anyway.
  Rejected: it cannot be revoked without closing the quiz, it offers no way
  to distinguish "the link I gave section A" from "the link that ended up on
  a forum", and it forces every student to be enrolled by some other means
  first, which the requirements do not provide.
- **Reuse `Invite` with a nullable `quizId`** — one token model instead of
  two. Rejected: invites are addressed to one email and consumed once by
  design (ADR-0003), and relaxing that to serve links would weaken the
  property that makes invites auditable.
- **Require the organization join code before a quiz link works** — two-step
  onboarding, tighter control over who becomes a member. Rejected as
  friction that the requirement explicitly writes against (*"student simply
  login and start exam"*); a teacher who wants that control revokes the link
  and invites individually instead.
- **Signed, stateless links (JWT in the URL)** — no table, no lookup.
  Rejected: unrevocable by construction, which is the entire problem being
  solved.

## Consequences

- Anyone holding the link can become a student of that organization. That is
  the intended behaviour, and it means link hygiene is a real operational
  concern: `expiresAt`, `maxUses`, and one-click revoke exist so a leaked
  link is a contained incident rather than an open door. The organization
  dashboard lists links with their use counts for exactly this reason.
- A student's membership can now be created by a flow that never touched an
  invite or a join code. Anything that assumes "a member was invited" —
  audit views, member lists — must handle a `joinedAt` with no inviter.
- `usedCount` is incremented inside the start transaction, so two
  simultaneous first-time starts on a `maxUses = 1` link cannot both succeed;
  the increment is a conditional update, not a read-then-write.
- Link tokens are secrets and get the same treatment as every other token
  here: generated with `generateOpaqueToken`, stored as `sha256`, returned to
  the teacher exactly once at creation, and never logged.

## Amendment (2026-08-30)

Three changes on top of the original decision, driven by real confusion over
having several simultaneous links for one quiz with no clear "the" link:

- **One active link per quiz at a time.** "Active" — now formalized as
  `acceptingAttempts` (below) — governs this: `POST /quiz-links` 409s if an
  active one already exists; a teacher removes (or outlasts the expiry of)
  the current one before minting another.
- **`revokedAt` is gone; revoking is now a hard delete.** The soft-revoke
  update is replaced by `QuizLinkRepository.remove()` (`DELETE`), safe even
  against a link with attempts already against it — `Attempt.quizLinkId` is
  `onDelete: SetNull`, so those attempts just lose the back-reference, they
  don't cascade away. The lazy check at start time (`startFromLink`) no
  longer distinguishes "revoked" from "never existed" — a deleted link 404s
  like any other unknown token, rather than 410-ing with a specific message.
- **A quiz auto-closes once its own `closesAt` passes** (`PUBLISHED` →
  `CLOSED`, finalizing in-flight attempts exactly like a manual close). This
  runs on a 30-second `@Cron` sweep (`QuizClosingSweeperService`), mirroring
  the existing attempt-finalization sweeper and ADR-0015's reasoning: the
  *correctness* guarantee is still the lazy check at use-time
  (`QuizPolicyService.resolveStartWindow`), not this sweep — it only keeps
  `Quiz.status` (and anything that lists/filters on it, including a link's
  own `acceptingAttempts`) from sitting stale on `PUBLISHED` past the
  deadline the teacher actually set.

  **This was link-`expiresAt`-driven at first, and that was wrong** — caught
  because in practice every existing link had `expiresAt: null` (teachers
  configure the deadline once, on the quiz, not again per link), so the
  original sweeper never fired against real data. It was also wrong in
  principle: an existing org member can start an attempt directly via `POST
  /quizzes/{id}/attempts`, with no link involved at all, so a link expiring
  is not evidence the exam itself is over. `closesAt` is the one field that
  actually means that.

  `QuizLink.acceptingAttempts` (`QuizLinksService#acceptingAttempts`, private
  helper shared by `create`'s one-active-link check, `list`, and `preview`)
  is the single definition of "would a new attempt actually start through
  this link right now" — it folds in the *quiz's* `status`/`opensAt`/
  `closesAt` together with the link's own `expiresAt`/`maxUses`, precisely so
  a link with no expiry of its own still correctly reads as dead once the
  quiz itself closes.
