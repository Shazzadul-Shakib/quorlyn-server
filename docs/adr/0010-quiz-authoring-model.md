# ADR-0010: Quiz authoring model, and immutability once a quiz is live

- **Status:** Accepted
- **Date:** 2026-08-23

## Context

A teacher needs full CRUD over quizzes. The hard part isn't the CRUD — it's
what "update" means once students have started answering. If a question's
text, options, or point value changes while attempts exist, two students who
sat "the same quiz" sat different exams, and the leaderboard
([ADR-0018](0018-scoring-and-leaderboards.md)) is comparing scores that were
never comparable.

The question shape also has to be decided before anything is stored. The
requirements describe timed exams with a leaderboard and automatic
submission, which means grading has to be automatic — a free-text answer
awaiting a human marker has no score to rank at the moment the timer stops.

## Decision

Three models, an explicit lifecycle, and a hard freeze at publication.

```prisma
enum QuizStatus   { DRAFT PUBLISHED CLOSED ARCHIVED }
enum QuestionType { SINGLE_CHOICE MULTI_CHOICE TRUE_FALSE }

model Quiz {
  id             String     @id @default(cuid())
  organizationId String
  createdById    String     // User id of the authoring teacher
  title          String
  description    String?
  status         QuizStatus @default(DRAFT)
  durationSeconds Int                       // per-attempt timer, see ADR-0012
  totalPoints    Int        @default(0)     // denormalized sum of question points
  shuffleQuestions Boolean  @default(true)
  publishedAt    DateTime?
  createdAt      DateTime   @default(now())
  updatedAt      DateTime   @updatedAt

  questions Question[]
  attempts  Attempt[]
  links     QuizLink[]

  @@index([organizationId, status])
  @@index([createdById])
}

model Question {
  id       String       @id @default(cuid())
  quizId   String
  type     QuestionType
  prompt   String
  points   Int          @default(1)
  position Int
  options  QuestionOption[]

  @@unique([quizId, position])
  @@index([quizId])
}

model QuestionOption {
  id         String  @id @default(cuid())
  questionId String
  text       String
  isCorrect  Boolean          // never leaves the server for a student — ADR-0011
  position   Int

  @@unique([questionId, position])
  @@index([questionId])
}
```

**Lifecycle.** `DRAFT → PUBLISHED → CLOSED → ARCHIVED`, one direction only.

- `DRAFT` — freely editable, invisible to students, no links resolve, no
  attempts possible.
- `PUBLISHED` — questions, options, `points`, `durationSeconds` and the
  attempt policy are **immutable**. `title`, `description`, the availability
  window and link management stay editable, because none of them changes what
  was asked or how it was scored.
- `CLOSED` — no new attempts; in-flight attempts are finalized
  ([ADR-0015](0015-auto-submission-and-cause.md)); results and leaderboards
  stay readable.
- `ARCHIVED` — hidden from the default dashboard lists, still readable by id.

**Publishing validates once, so the runtime never has to.** A quiz cannot be
published unless every question has at least two options, exactly one correct
option for `SINGLE_CHOICE`/`TRUE_FALSE`, at least one for `MULTI_CHOICE`, and
`totalPoints > 0`. The attempt path can then assume a well-formed quiz.

**Editing a published quiz means duplicating it.** `POST /quizzes/:id/duplicate`
deep-copies the quiz into a new `DRAFT`, leaving the original and its results
untouched. There is no in-place unpublish.

## Alternatives considered

- **Versioned quizzes (`QuizVersion` rows, attempts pinned to a version)** —
  the fully general answer: edit whenever you like, old attempts keep
  pointing at what they actually saw. Rejected as the first move because it
  doubles the model (every question and option hangs off a version), and
  because teachers overwhelmingly want *"fix a typo"* or *"make a new
  variant"* — the first is a `title`/`description` edit, which stays allowed;
  the second is a duplicate. If per-version comparison ever becomes a real
  requirement, duplication has already produced separate quiz rows to
  compare.
- **Allow edits and invalidate affected attempts** — keeps one quiz row.
  Rejected: it destroys student work as a side effect of a teacher's typo,
  and "invalidate" has no good answer for an attempt that is in progress at
  that moment.
- **Snapshot the question set into each attempt** (copy prompts and options
  into the attempt row at start) — makes each attempt self-describing.
  Rejected as storage-expensive and redundant given immutability: with a
  frozen quiz, the attempt's foreign key already resolves to exactly what the
  student saw. Worth reconsidering only alongside versioning.
- **Free-text / manually graded questions in the first cut** — rejected
  deliberately, see Consequences.

## Consequences

- **Only auto-gradable question types exist.** That is what makes an
  immediate score, an immediate leaderboard, and auto-submission on
  disconnect coherent. Adding `SHORT_ANSWER` later is not just a new enum
  value: it needs a grading state on the attempt (`PENDING_REVIEW`), a
  leaderboard that can exclude ungraded attempts, and a teacher marking
  queue. That is a separate ADR, not an increment.
- `totalPoints` is denormalized on `Quiz` and must be recomputed on every
  question write while the quiz is `DRAFT`. It is safe precisely because it
  freezes at publication.
- `shuffleQuestions` is applied per attempt at serve time, from a seed derived
  from the attempt id, so a reconnecting student sees the same order they
  left. Shuffling is not stored per question.
- Deleting a `PUBLISHED` quiz is not offered; `ARCHIVED` is the disposal
  route. Attempt rows reference questions, and a delete would take real
  student results with it.
