# ADR-0012: Availability window, attempt limit, and scoring policy are three separate fields

- **Status:** Accepted
- **Date:** 2026-08-23

## Context

The requirement — *"quiz will have an expiration time because same student
can attend exam multiple time"* — folds three different clocks and rules into
one phrase:

- how long **one sitting** lasts once the student presses start,
- how long the **quiz itself** accepts new sittings,
- and what happens when the **same student sits it more than once**.

Collapsing them into a single "expires at" produces immediate contradictions:
a student who starts one minute before expiry either gets a one-minute exam
or is allowed to run 30 minutes past the deadline, and a retake either
overwrites the first result or silently creates two rows that both claim to
be the student's score.

## Decision

Model them as three independent fields, and derive every runtime decision
from them rather than from a single timestamp.

```prisma
enum ScoringPolicy { BEST FIRST LATEST }

model Quiz {
  // ...see ADR-0010
  durationSeconds Int             // one sitting, in seconds
  opensAt         DateTime?       // null = open as soon as PUBLISHED
  closesAt        DateTime?       // null = open until status becomes CLOSED
  maxAttempts     Int           @default(1)
  scoringPolicy   ScoringPolicy @default(BEST)
  lateStartCutoff Boolean       @default(true)
}
```

**Starting an attempt** requires all of: quiz `PUBLISHED`, `now >= opensAt`,
`now < closesAt`, and the student's counted attempts `< maxAttempts`.

**The deadline of a sitting is computed once, on the server, at start:**

```
deadlineAt = min(startedAt + durationSeconds, closesAt ?? +∞)
```

and stored on the attempt ([ADR-0014](0014-attempt-lifecycle-and-timing.md)).
The window can therefore truncate a sitting, which is the honest reading of a
close time — a quiz that closes at 17:00 does not accept answers at 17:20.
When `lateStartCutoff` is true, a start that would yield less than the full
duration is refused outright rather than handing the student a short exam;
turning it off allows the truncated sitting.

**`maxAttempts` counts attempts that were started**, not attempts that were
finished. An attempt abandoned after one question consumed one of the
allowance; otherwise "start, peek at the questions, close the tab" is an
unlimited preview. Attempts finalized as `DISCONNECTED`
([ADR-0015](0015-auto-submission-and-cause.md)) count too — a dropped
connection cannot become a way to reroll.

**`scoringPolicy` decides which single attempt represents the student** in
the leaderboard, the dashboards, and their own progress view. All attempts
remain individually visible to the teacher and to the student; the policy
selects the *representative* one, it does not delete the others.

## Alternatives considered

- **One `expiresAt` field, duration inferred from it** — the literal reading
  of the requirement, and the smallest schema. Rejected: it can't express
  "a 30-minute exam available all week", which is the normal shape of the
  feature, and it makes the last minutes of a window behave differently from
  every other minute.
- **`maxAttempts` counted on submitted attempts only** — friendlier to a
  student whose browser crashed. Rejected because it is indistinguishable
  from deliberate abandonment, and the disconnect case already has a real
  answer: a disconnected attempt is *resumable* until its own deadline
  (ADR-0014), so the student gets their time back without getting a fresh
  attempt.
- **A separate `QuizSchedule` model for per-cohort windows** — different
  windows for different groups of students. Rejected as unrequested; nothing
  in the requirements distinguishes cohorts, and the join code /
  link model ([ADR-0013](0013-quiz-links-and-self-enrolment.md)) has no
  concept of one.
- **Letting the client send elapsed time or a client-computed deadline** —
  rejected on sight; the timer is the thing being cheated.

## Consequences

- Four fields must be validated together at publish time: a `closesAt` before
  `opensAt`, or a window shorter than `durationSeconds` with
  `lateStartCutoff` on, is a quiz nobody can ever sit. The publish validation
  in ADR-0010 is where that check belongs.
- `maxAttempts > 1` makes the leaderboard's "one row per student" rule
  non-trivial, and it is where `scoringPolicy` earns its place — see
  [ADR-0018](0018-scoring-and-leaderboards.md) for the query.
- `opensAt`/`closesAt` are timestamps with no timezone concept beyond UTC.
  Teachers pick times in their own zone; converting at the edge is a client
  responsibility, and every API response returns UTC. Getting this wrong is
  the single most likely support ticket, so the API never accepts a naive
  local time.
- Changing the window on a `PUBLISHED` quiz stays allowed (ADR-0010), which
  means an in-flight attempt's stored `deadlineAt` can now disagree with a
  newly shortened `closesAt`. The finalizer resolves this by re-applying the
  `min(...)` rule at finalization, so a shortened window still cuts the
  sitting.
