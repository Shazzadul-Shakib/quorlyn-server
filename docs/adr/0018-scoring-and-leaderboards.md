# ADR-0018: One row per student on the leaderboard, computed on read in SQL

- **Status:** Accepted
- **Date:** 2026-08-23

## Context

*"Teacher can see the quizzes leaderboard"* — and with `maxAttempts > 1`
([ADR-0012](0012-availability-window-and-attempt-policy.md)) a student may
have several finished attempts at the same quiz. A leaderboard that lists
attempts lists the same person three times; a leaderboard that lists students
has to pick which attempt represents them, and rank by it.

"Pick one row per group, ordered within the group" is precisely what SQL's
`DISTINCT ON` and window functions do, and precisely what Prisma's query API
does not express. So the decision is not only *what* the ranking means but
*where* it is computed — and doing it in application code means loading every
attempt for a quiz into memory to sort it, which is the shape of a query that
works in a demo and fails in a school.

## Decision

**The representative attempt per student is chosen by the quiz's
`scoringPolicy`** (`BEST` | `FIRST` | `LATEST`), and only `SUBMITTED`
attempts are eligible — including auto-submitted ones, whatever their cause
([ADR-0015](0015-auto-submission-and-cause.md)). An attempt that ended in a
disconnect still counts; that is what makes the cause worth recording rather
than worth hiding.

**Ranking is `score DESC, durationMs ASC, submittedAt ASC`.** Time is the tie
-breaker because two students with full marks are not equal in an exam
context, and the earlier submission wins a remaining tie so the order is
total and stable. Ranks are dense (`1, 2, 2, 4` style via `RANK()`), so tied
students visibly share a position.

**The query lives in `AttemptRepository.leaderboard(quizId, …)` as typed
`$queryRaw`.** This is an explicit, bounded exception to
[ADR-0005](0005-repository-pattern-for-data-access.md)'s spirit — a
repository may drop to SQL when the query API cannot express the query — and
it is *not* a licence for services to do the same. The service still calls
`leaderboard(...)` and receives typed rows; it never sees SQL, a `where`, or
a raw string.

```sql
-- shape, not final text: one row per student, then ranked
WITH representative AS (
  SELECT DISTINCT ON (a."userId")
         a."userId", a.id, a.score,
         EXTRACT(EPOCH FROM (a."submittedAt" - a."startedAt")) * 1000 AS duration_ms,
         a."submittedAt"
  FROM "Attempt" a
  WHERE a."quizId" = $1 AND a.status = 'SUBMITTED'
  ORDER BY a."userId",
           CASE $2 WHEN 'BEST' THEN a.score END DESC NULLS LAST,
           CASE $2 WHEN 'FIRST' THEN a."submittedAt" END ASC,
           CASE $2 WHEN 'LATEST' THEN a."submittedAt" END DESC
)
SELECT RANK() OVER (ORDER BY score DESC, duration_ms ASC, "submittedAt" ASC) AS rank, …
FROM representative
ORDER BY rank
LIMIT $3 OFFSET $4;
```

`@@index([quizId, status])` on `Attempt` serves the filter; the sort is over
one quiz's finished attempts, which is bounded by class size, not by platform
size.

**Every leaderboard read is paginated and tenant-scoped**, and it runs
`finalizeIfDue` over any still-open attempts for that quiz first (ADR-0015) so
the board never shows a student as missing because a job hasn't run.

**Students see the same board, differently.** A student's view returns the top
N plus their own row and rank — never the full list — so a leaderboard cannot
be used to enumerate an organization's students. Whether students see it at
all is a per-quiz flag (`leaderboardVisibleToStudents`, default `false`); the
requirement asks only for the teacher's view.

## Alternatives considered

- **A materialized `LeaderboardEntry` table, updated at submission** — reads
  become a plain indexed select. Rejected as premature: it introduces a
  second source of truth that can drift (a corrected score, a deleted
  attempt, a changed `scoringPolicy` all need repair logic), for a read that
  is already an indexed scan of one class's attempts. Revisit when a single
  quiz has tens of thousands of attempts, or when the board is polled live
  during exams.
- **Compute in TypeScript from `findMany`** — no raw SQL, stays entirely
  within ADR-0005. Rejected: it transfers every attempt row for the quiz to
  the app on every view, and the grouping logic would be re-implemented for
  each dashboard that needs it.
- **Rank by score only, ignoring time** — simpler and arguably fairer.
  Rejected: with auto-graded multiple choice, ties are the norm rather than
  the exception, and a board where half the class shares rank 1 tells the
  teacher nothing.
- **Include `IN_PROGRESS` attempts as provisional rows** — a live board
  during the exam. Rejected: it leaks how others are doing while they are
  still working, and a provisional score computed from partial answers is
  exactly the answer-key signal [ADR-0011](0011-answer-key-exposure-boundary.md)
  keeps away from students.

## Consequences

- Raw SQL means the schema and the query are coupled by hand: a renamed
  column breaks at runtime, not at compile time. The query is confined to one
  repository method for that reason, and it is the first thing that needs a
  test when the attempt schema changes.
- `durationMs` is derived rather than stored, so an attempt finalized long
  after its deadline (a sweeper backlog) would show an inflated duration.
  Finalization therefore records `submittedAt` as the moment the attempt
  *ended* — `deadlineAt` for a timeout, the last heartbeat for a disconnect —
  not the moment the row was written.
- Changing `scoringPolicy` on a published quiz silently reorders history.
  ADR-0010 freezes it at publication for this reason; that freeze is
  load-bearing here, not incidental.
- The same representative-attempt logic is what the dashboards need
  ([ADR-0019](0019-dashboard-read-models.md)), so it belongs in one reusable
  CTE rather than being written twice with subtly different tie-breaks.
