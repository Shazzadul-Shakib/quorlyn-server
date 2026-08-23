# ADR-0011: The answer key never enters a student-facing response

- **Status:** Accepted
- **Date:** 2026-08-23

## Context

*"Teacher can see the quizzes correct answers"* — and students, by
implication, cannot. But teachers and students read the same quiz through the
same models: `Question` and `QuestionOption`, where `isCorrect` sits on the
option row ([ADR-0010](0010-quiz-authoring-model.md)).

The failure mode is well known and quiet: a response DTO that carries the
option list is written once for the teacher's preview, reused for the exam
screen, and now every student can read the answer key out of the network tab
without any part of the code looking wrong. Nothing throws, nothing logs, and
the leaderboard just becomes meaningless.

The same discipline already exists in this codebase for exactly this class
of problem —
`passwordHash` and `tokenHash` never reach a response — but those are enforced
by hand-written mappers, and one forgotten field is all it takes.

## Decision

Make the leak structurally impossible rather than remembered:

1. **Two response DTOs, never one with a flag.** `ExamQuestionDto` (student)
   has `id`, `prompt`, `type`, `points`, and `options: { id, text }[]`.
   `AnswerKeyQuestionDto` (teacher) additionally has
   `options: { id, text, isCorrect }[]`. There is no
   `includeAnswers?: boolean` parameter on a shared mapper — a boolean
   argument is a runtime decision, and runtime decisions are how this leaks.
2. **The repository doesn't fetch what the caller may not see.**
   `QuestionRepository.findForExam(quizId)` uses an explicit Prisma `select`
   that omits `isCorrect` entirely; `findWithAnswerKey(quizId)` is a separate
   method. The student path never has the answer key in memory, so it cannot
   be logged, serialized by accident, or picked up by a future `...spread`.
3. **Grading reads the key directly in the service, never through a DTO.**
   `AttemptsService` compares submitted option ids against
   `findWithAnswerKey` results inside the submission transaction
   ([ADR-0014](0014-attempt-lifecycle-and-timing.md)) and stores the outcome
   on `AttemptAnswer`.
4. **Routes are separated too.** `GET /attempts/:id/questions` (student, exam
   view) and `GET /quizzes/:id/answer-key` (teacher, requires
   `Permission.VIEW_RESULTS`) are different endpoints with different guards,
   not one endpoint that branches on the caller's role.
5. **Students never receive per-question correctness**, only their score and
   their own submitted answers. Revealing the key after the window closes is
   a plausible future feature; it is not in the requirements, and adding a
   `revealAnswersAt` field now would create a second path to the key that
   nobody is testing.

## Alternatives considered

- **One DTO plus a serialization group / `@Exclude()` on `isCorrect`** —
  `class-transformer` can strip the field by role. Rejected because the field
  is still fetched, still in memory, and the protection depends on the
  interceptor being wired for that specific route; a `res.json(question)`
  anywhere bypasses it. Structural absence beats conditional removal.
- **Store the answer key in a separate table (`QuestionAnswerKey`)** — the
  strongest version of the same idea: the option row physically cannot carry
  the flag. Rejected as a worse fit for authoring and grading (every read of
  a question for editing becomes a join) for a marginal gain over an explicit
  `select`. Reconsider if the key ever needs its own audit trail.
- **Trust the role check on the shared endpoint** — one route, one DTO, a
  role branch. Rejected: it is the exact shape of the bug this ADR exists to
  prevent.

## Consequences

- Two repository methods and two DTOs per question read is more surface than
  one of each. That duplication is the point, and it should not be
  "refactored away" later — a reviewer seeing the near-identical mappers
  should read this ADR before merging them.
- Shuffled option order (ADR-0010) matters here too: the exam view must not
  return options in the authoring order if authoring order correlates with
  the correct answer. Options are shuffled per attempt with the same seed as
  questions.
- A teacher who is also a student in another organization
  ([ADR-0006](0006-membership-as-the-unit-of-tenancy.md)) hits the answer-key
  endpoint with a valid teacher token for *their* org — the endpoint is
  org-scoped like everything else, so the cross-org case is handled by the
  standard tenancy filter, not by a special rule.
- The convention check in `.claude/hooks/post-edit-checks.mjs` already flags
  DTOs that mention `passwordHash`/`tokenHash`; `isCorrect` on a DTO whose
  name does not say "answer key" belongs in that same check when this lands.
