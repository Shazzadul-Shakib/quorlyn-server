# ADR-0016: The server cannot lock a device — it records violations and acts on them

- **Status:** Accepted
- **Date:** 2026-08-23

## Context

*"Once timer start student can not shut down or change tab of his device."*

Taken literally, this is not implementable — and saying so plainly here is
more useful than quietly building something weaker and calling it done. A
backend receives HTTP requests; it has no view of the operating system, no
control over the window manager, and no way to prevent a laptop lid from
closing. Even a web frontend cannot enforce it: the Fullscreen API can be
exited with Escape, `beforeunload` prompts can be dismissed, `visibilitychange`
fires *after* the tab is already hidden, and a browser with devtools open can
have any of it removed. A second device sitting next to the first defeats all
of it regardless.

What *is* implementable is detection, recording, and consequence — which is
how real proctoring works before you reach hardware lockdown.

## Decision

Split the requirement into a client obligation and a server guarantee, and be
explicit about which is which.

**The client attempts the lock** (best effort, not trusted): request
fullscreen on start, listen for `visibilitychange`, `blur`, `fullscreenchange`,
`beforeunload`, `copy`, `paste`, and report each occurrence.

**The server records what it is told and enforces the consequences:**

```prisma
enum ProctorEventType {
  TAB_HIDDEN
  WINDOW_BLUR
  FULLSCREEN_EXIT
  COPY
  PASTE
  RECONNECT
  DEVICE_CHANGED
}

model ProctorEvent {
  id         String           @id @default(cuid())
  attemptId  String
  type       ProctorEventType
  occurredAt DateTime         @default(now())   // server time, not client time
  metadata   Json?

  attempt Attempt @relation(fields: [attemptId], references: [id], onDelete: Cascade)

  @@index([attemptId, type])
}

model Quiz {
  // ...
  maxFocusViolations Int? @default(3)   // null = record only, never auto-submit
}
```

- `POST /attempts/:id/events` accepts a batch of reported events for an
  `IN_PROGRESS` attempt. It is throttled and the payload is capped; a client
  spamming events cannot inflate the table.
- Events are stamped with **server** time. A client-supplied `occurredAt`
  would be as forgeable as the timer, and for the same reason it is ignored
  (kept in `metadata` for diagnostics only).
- When counted violations (`TAB_HIDDEN` + `FULLSCREEN_EXIT`) exceed
  `maxFocusViolations`, the attempt is finalized with
  `SubmissionCause.PROCTOR_VIOLATION`
  ([ADR-0015](0015-auto-submission-and-cause.md)). `WINDOW_BLUR` and clipboard
  events are recorded but do not count toward the limit — blur fires for
  notifications and IME popups, and false auto-submissions are worse than
  missed ones.
- The teacher sees a per-attempt event timeline next to the score. **Events
  never alter the score**; they are evidence for a human, not a grading input.
- Absence of events proves nothing and is never treated as proof of good
  conduct.

## Alternatives considered

- **Claim server-side enforcement** (block requests from a "hidden" tab, kill
  the attempt on a missed poll) — rejected because the server's only signal
  is the client's own report, so this is the same client-trusting design with
  a misleading name attached. The heartbeat gap in ADR-0015 already covers
  genuine absence.
- **Treat every blur as an immediate auto-submit** — the strictest reading of
  the requirement. Rejected: a system notification, a screen-reader window,
  or an OS update toast would end a student's exam. The violation *count*
  exists precisely so the strict reading is available (`maxFocusViolations:
  1`) without being the default.
- **Native/kiosk lockdown client or a proctoring vendor** — the only way to
  actually deliver the literal requirement. Out of scope for this backend,
  and deliberately not blocked by anything here: a lockdown client would
  report to the same `/events` endpoint with the same event types, and the
  consequence logic would not change.
- **Webcam or screen-recording proctoring** — a different product with
  different consent, storage, and privacy obligations. Not considered.

## Consequences

- **The product claim must match reality.** The organization dashboard should
  say "focus violations recorded: 3", never "device was locked". Overstating
  this to a school is a trust problem, not a technical one.
- Proctor events are the highest-cardinality table in the system and the one
  with the least analytic value per row. They are capped per attempt, and a
  retention policy (drop events for attempts older than N months) should be
  decided before the first large deployment.
- A student on a genuinely flaky connection will accumulate `RECONNECT`
  events that look like violations to a suspicious reader. Keeping reconnects
  out of the violation count — and visibly separate in the timeline — is what
  keeps the feature fair.
- Because the events are self-reported, they can only ever *raise* suspicion,
  never settle it. Any disciplinary process built on this data needs a human
  in the loop, and the API should never expose a "cheated: true" field that
  invites automation of that judgement.
