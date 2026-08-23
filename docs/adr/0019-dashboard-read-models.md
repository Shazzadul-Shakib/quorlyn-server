# ADR-0019: Dashboards aggregate on read, with the cost made explicit

- **Status:** Accepted
- **Date:** 2026-08-23

## Context

Four dashboards are asked for, and they are all the same shape of question
asked from different angles:

- **Teacher, all quizzes** — *"overview of his quizzes together"*.
- **Teacher, one quiz** — *"and individually"*: participation, score
  distribution, which questions the class got wrong.
- **Organization** — teachers, quizzes and links, student progress,
  leaderboards, *"their overall overview"*.
- **Student** — *"see their progress in dashboard"*, across every
  organization they belong to ([ADR-0006](0006-membership-as-the-unit-of-tenancy.md)).

Every number on them is an aggregate over `Attempt` and `AttemptAnswer`, and
the tempting move is to keep running counters on `Quiz` and `Membership`
updated at submission time. That is also the move that produces a dashboard
which is confidently wrong six months later, because a counter has no way to
be recomputed from first principles once it has drifted.

## Decision

**Aggregate on read.** Every dashboard figure is a `groupBy`/aggregate query
against the attempt tables at request time. No summary tables, no counters
maintained on write, no cache in the first cut.

Concretely, one repository method per panel — not one god query:

| Panel | Query | Index it relies on |
| --- | --- | --- |
| Teacher, all quizzes | `groupBy(quizId)` over the teacher's quizzes: attempts, distinct students, avg score | `Attempt @@index([quizId, status])` |
| Quiz participation | count of distinct students with a `SUBMITTED` attempt vs. link uses | same |
| Score distribution | `groupBy` over bucketed `score` for one quiz | same |
| Per-question difficulty | `groupBy(questionId)` over `AttemptAnswer.isCorrect` for one quiz | `AttemptAnswer @@index([questionId, isCorrect])` |
| Org overview | counts by `Membership.role`, quizzes by status, attempts in a period | `Membership @@index([organizationId, role])`, `Attempt @@index([organizationId, submittedAt])` |
| Student progress | the student's representative attempts, grouped by organization | `Attempt @@index([userId, quizId])` |

Four rules keep this honest as data grows:

1. **Every dashboard query is scoped to one organization and one time
   window.** There is no "all time, all tenants" query; the org filter comes
   from the token claim ([ADR-0007](0007-active-organization-claim.md)), and
   the period defaults to the last 90 days with an explicit range parameter.
2. **The representative-attempt rule is shared with the leaderboard**
   ([ADR-0018](0018-scoring-and-leaderboards.md)) — one CTE, used by both, so
   a student's "score" never means two different things on two screens.
3. **No panel returns an unbounded list.** Lists inside a dashboard (recent
   attempts, top students, active links) are capped and paginated; the
   dashboard endpoint returns aggregates plus those capped lists, never a
   full table for the client to reduce.
4. **The trigger for change is measured, not guessed.** When a dashboard
   endpoint's p95 exceeds ~300ms on real data, the next step is a
   materialized view or a `QuizStats` summary table refreshed by the existing
   sweeper (ADR-0015) — not an ad-hoc cache added under pressure. Writing
   that trigger down now is the point of this ADR.

Each dashboard is a single endpoint returning a composed response
(`GET /dashboard/teacher`, `/dashboard/quizzes/:id`, `/dashboard/organization`,
`/dashboard/student`) rather than eight client round-trips, because the panels
share filters and a single service call can run their queries concurrently.

## Alternatives considered

- **Counters on `Quiz`/`Membership` maintained at submission** — O(1) reads.
  Rejected: drift is undetectable and unrepairable without the source data
  anyway, corrections and deletions each need bespoke decrement logic, and
  the read they optimize is not on any hot path. The denormalization that
  *is* accepted (`Attempt.organizationId`, `Attempt.maxScore`) is different
  in kind: those are immutable copies, not running totals.
- **Materialized views refreshed on a schedule** — a genuinely good fit, and
  the most likely next step. Rejected as the *first* step because it fixes a
  performance problem that has not been measured yet, at the cost of stale
  numbers during an exam, which is exactly when a teacher watches the screen.
- **A separate analytics store (ClickHouse, a read replica, an ETL)** —
  rejected outright at this size; it is infrastructure and a second copy of
  the truth for a few hundred rows per class.
- **Letting the client compute panels from a raw attempts feed** — rejected:
  it ships every student's result to every teacher's browser and puts the
  representative-attempt rule in the frontend, where it will diverge from the
  leaderboard's.

## Consequences

- Per-question difficulty is the query that will hurt first: it aggregates
  `AttemptAnswer` rows, the largest table in the system
  (students × questions). Its index is not optional, and it is the natural
  first candidate for the summary table described above.
- Dashboard responses are composed of several concurrent queries, so a slow
  panel slows the whole endpoint. Each panel method must be independently
  timed in logs, or the eventual optimization work starts by guessing.
- Numbers move while an exam is running, because `finalizeIfDue` settles
  attempts as they are read (ADR-0015). That is correct and needs saying in
  the UI: "participation: 18/24" during a live exam is a snapshot, not a
  final figure.
- Students see their own progress across organizations, which is the one
  cross-tenant read in the product. It is safe only because it is scoped to
  `userId = caller` and returns nothing about other students; any future
  "compare with your cohort" feature re-opens that question and needs its own
  decision.
