# Frontend build guide

Everything a client needs to build against this API: the auth model, the full
endpoint contract, how to render mixed Bangla/English + LaTeX content, and the
exam runner — which is the part with real rules rather than just screens.

This document is the contract. Where it disagrees with a hunch about "how
these things usually work", it wins; where it disagrees with the running
Swagger at `/docs`, Swagger wins and this file is stale — say so.

- **Base URL:** `http://localhost:5000` in development (`PORT`, default 5000).
- **Interactive reference:** `GET /docs` (Swagger UI).
- **All timestamps are ISO-8601 UTC.** Never send a naive local time; convert
  at the edge, render in the user's zone.
- **Decisions behind the design:** [docs/adr/README.md](adr/README.md). Read
  [ADR-0016](adr/0016-focus-enforcement-is-client-side.md) before building the
  exam runner — the client is responsible for the half the server cannot do.

---

## 1. What you are building

Four surfaces, one codebase:

| Surface | Audience | Entry |
| --- | --- | --- |
| **Platform admin** | Superadmin | Create organizations, invite their first owner |
| **Organization dashboard** | Org owner / teachers with `MANAGE_MEMBERS` | Members, permissions, invites, join code, org-wide stats |
| **Teacher workspace** | Teachers with `MANAGE_QUIZZES` | Author quizzes with maths, publish, share links, read results and leaderboards |
| **Student** | Students | Join an org, sit timed exams, see progress across organizations |

The **exam runner** is a distinct mode inside the student surface: full-screen,
no navigation chrome, its own heartbeat and autosave loops. Treat it as its own
route tree with its own layout.

---

## 2. Auth model

Three facts travel with every request, and they are not the same fact:

1. **Who you are** — the access token (`Authorization: Bearer <accessToken>`).
2. **Which organization you are acting in** — a claim *inside* that token,
   chosen explicitly ([ADR-0007](adr/0007-active-organization-claim.md)).
3. **Which device you are on** — the `X-Device-Id` header
   ([ADR-0017](adr/0017-single-active-device.md)).

### Device id

Generate a UUID on first run, persist it, and send it on **every** request:

```ts
function deviceId(): string {
  let id = localStorage.getItem('quorlyn.deviceId');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('quorlyn.deviceId', id);
  }
  return id;
}
// axios/fetch interceptor
headers['X-Device-Id'] = deviceId();
```

Student accounts are device-locked. Clearing site data or using a private
window produces a new device id and therefore triggers the email verification
flow below — tell the user that before they clear anything.

### Login

`POST /auth/login` → `{ email, password }`

```jsonc
// 200
{
  "accessToken": "eyJ…",
  "refreshToken": "9f2c…",          // opaque, not a JWT
  "accessTokenExpiresIn": 900,       // seconds
  "user": { "id": "…", "email": "…", "platformRole": "MEMBER", "singleDeviceEnforced": true },
  "memberships": [
    { "organizationId": "…", "organizationName": "Dhaka Model School",
      "role": "TEACHER", "isOrgOwner": true, "status": "ACTIVE",
      "permissions": ["MANAGE_QUIZZES", "VIEW_RESULTS"] }
  ],
  "org": { "id": "…", "role": "TEACHER", "isOrgOwner": true, "permissions": [...] } // or null
}
```

- `org !== null` → the user had exactly one active membership and it was
  pre-selected. Go straight to the dashboard.
- `org === null` **and** `memberships.length > 1` → show an organization
  picker.
- `org === null` **and** `memberships.length === 0` → the account exists but
  belongs to nothing yet. Offer "join with a code" or "open your invite link".

### The device conflict (409)

```jsonc
// 409 — credentials were correct
{ "statusCode": 409, "code": "DEVICE_CONFLICT",
  "message": "This account is already signed in on another device…",
  "activeDevice": { "label": "Chrome on Windows", "lastSeenAt": "2026-08-23T09:12:00.000Z" } }
```

Do not treat this as a login failure. Show: *"You're signed in on
{label}, last active {relative time}. Sign out there and continue here?"* then:

1. `POST /auth/device-change/request` → `{ email, password }` → **202**.
   A six-digit code is emailed. It expires in 10 minutes, is single-use, and
   locks out after 5 wrong attempts.
2. `POST /auth/device-change/verify` → `{ email, password, code }` → **200**
   with a normal login payload. Every other session is now signed out.

Rate limits: 3 requests/min and 5 codes/hour per account.

### Selecting an organization

`POST /auth/organizations/{organizationId}/select` → **200**

```jsonc
{ "accessToken": "eyJ…", "accessTokenExpiresIn": 900,
  "org": { "id": "…", "role": "STUDENT", "isOrgOwner": false, "permissions": [] } }
```

Replace **only** the access token — the refresh token is unchanged, because it
is scoped to a user and a device, not an organization. Store the selected
`organizationId` so refreshes can preserve it.

Calling an org-scoped route without a selection returns:

```jsonc
{ "statusCode": 403, "message": "Select an organization first: POST /auth/organizations/{id}/select" }
```

Handle that globally by bouncing to the org picker rather than showing a raw
error.

### Refresh

`POST /auth/refresh` → `{ refreshToken, organizationId? }` → new
`{ accessToken, refreshToken, accessTokenExpiresIn }`.

- Always send the currently selected `organizationId`, or the new token comes
  back org-less and every org-scoped call starts failing.
- **Rotation is strict**: the old refresh token dies the moment it is used.
  Serialise refreshes behind a single in-flight promise — two parallel
  refreshes will make the second look like token *reuse*, and the server
  revokes every session when it sees that.
- Refresh proactively at ~80% of `accessTokenExpiresIn`, and on any 401.
- If the membership was suspended, the refresh still succeeds but returns a
  token whose `org` is null. Re-select; if that 403s, the user has genuinely
  lost access — send them to the picker with a message.

### Storage

| Value | Where | Why |
| --- | --- | --- |
| `accessToken` | memory (or `sessionStorage`) | short-lived, replaced often |
| `refreshToken` | `localStorage` if you must persist login | it is the long-lived secret — never log it |
| `deviceId` | `localStorage` | must be stable |
| `organizationId` | `localStorage` | restores the last workspace |

Never put a token in a URL, and never log a token or an invite/link token.

### Other auth routes

- `GET /auth/me` → `{ user, memberships, org }`. Call on boot to restore state.
- `POST /auth/logout` → `{ refreshToken }` → 204.
- `POST /auth/logout-all` → 204, kills every session for the user.

---

## 3. Error contract

| Status | Meaning | What the UI should do |
| --- | --- | --- |
| 400 | Validation failed | Field errors; `message` may be an array of strings |
| 401 | Bad or expired credentials/token | Refresh once, then send to login |
| 403 | Wrong role, missing permission, no org selected, no attempts left | Explain; do not retry |
| 404 | Not found, or not yours (tenancy) | "Not found" — never imply it exists elsewhere |
| 409 | Conflict: device, duplicate, frozen field, wrong state | Show the specific message |
| 410 | Gone: expired invite/link, time is up, attempt closed | Terminal — navigate away |
| 429 | Throttled | Back off; show remaining time if you track it |

Nest's default error body is `{ statusCode, message, error }`, where `message`
is a string or an array of strings. `DEVICE_CONFLICT` additionally carries
`code` and `activeDevice`.

---

## 4. Content: Bangla, English, and mathematics

Question prompts and options are **UTF-8 text with inline LaTeX**
([ADR-0020](adr/0020-question-content-storage.md)):

```
একটি বস্তুর ভরবেগ $p = mv$ হলে গতিশক্তি কত?
বিক্রিয়াটি সম্পন্ন করো: $\ce{2H2 + O2 -> 2H2O}$
```

`$…$` is inline maths, `$$…$$` is display maths, `\$` is a literal dollar
sign, and everything outside the delimiters is plain text. Each question
carries `contentFormat: "PLAIN" | "LATEX_MIXED"`.

### Authoring — MathLive

Use a [MathLive](https://mathlive.io/mathfield/) `<math-field>` for the maths
segments and read `mathfield.getValue('latex')`. The editor is inserted into a
plain text field: the teacher writes prose, and each formula is inserted
wrapped in `$…$`.

```ts
import 'mathlive';
const field = document.querySelector('math-field')!;
const latex = field.getValue('latex');          // e.g. "\\frac{1}{2}mv^2"
insertAtCursor(promptInput, `$${latex}$`);
```

Enable the mhchem extension so `\ce{…}` works for chemistry. Physics units are
plain `\mathrm{}`.

### Rendering — KaTeX (or MathLive's static render)

```ts
import katex from 'katex';
import 'katex/dist/katex.min.css';
import 'katex/dist/contrib/mhchem';   // \ce{}

const MATH = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g;

export function renderContent(value: string, format: ContentFormat): Node[] {
  if (format === 'PLAIN') return [document.createTextNode(value)];

  return value.split(MATH).map((segment) => {
    const display = segment.startsWith('$$');
    const inline = !display && segment.startsWith('$');
    if (!display && !inline) {
      return document.createTextNode(segment.replaceAll('\\$', '$'));
    }
    const span = document.createElement('span');
    katex.render(segment.slice(display ? 2 : 1, display ? -2 : -1), span, {
      displayMode: display,
      throwOnError: false,
      strict: 'ignore',
      trust: false,          // ← non-negotiable: disables \href and friends
    });
    return span;
  });
}
```

**Rules, not suggestions:**

- `trust: false` and `throwOnError: false`. Never `innerHTML` raw content, and
  never enable `\html…` commands. The server validates content and rejects
  HTML and dangerous macros, but the renderer is the actual boundary.
- Render the *same* way in the authoring preview and the exam, or a teacher
  will publish something that looks different to students.
- Wrap long formulae in a horizontally scrollable container; do not let them
  widen the page.

### Bangla typography

- Load a Bangla-capable font (Noto Sans Bengali, Hind Siliguri) and set a
  font stack that falls through to it: Latin glyphs from your UI font, Bengali
  from the Bangla font.
- Bengali needs more line height than Latin — `line-height: 1.75` on question
  text, not `1.4`.
- Never truncate question text by character count; Bengali conjuncts break
  badly. Clamp by line instead.
- `Quiz.language` (`EN` | `BN` | `MIXED`) is a hint for font/`lang` attribute
  selection. It never restricts what the content may contain: a Bangla physics
  question legitimately holds English variable names.

---

## 5. The exam runner

The part with real rules. Read this section fully before writing it.

### What the server guarantees, and what it does not

**The server owns the clock** ([ADR-0014](adr/0014-attempt-lifecycle-and-timing.md)).
`deadlineAt` is computed server-side when the attempt starts and is never
negotiated. Your countdown is a *rendering* of `deadlineAt - serverTime`; it
carries no authority, and a wrong client clock changes nothing.

**The server cannot lock the device**
([ADR-0016](adr/0016-focus-enforcement-is-client-side.md)). Fullscreen,
tab-switch detection and unload warnings are yours, they are best-effort, and
they are evadable. Your job is to make leaving *hard and visible*, and to
report what happens. Never label this "device locked" in UI copy — it is
"focus violations recorded".

### Lifecycle

```
POST /quizzes/{quizId}/attempts        → start or resume (idempotent)
   or POST /attempts/from-link/{token} → start via a shared link (enrols the student)
GET  /attempts/{id}                    → questions + saved answers
PUT  /attempts/{id}/answers/{questionId}   → autosave, on every change
POST /attempts/{id}/heartbeat          → every 15s
POST /attempts/{id}/events             → focus/proctor events, batched
POST /attempts/{id}/submit             → finish
```

Starting is **idempotent**: if an attempt is already in progress you get that
same attempt back, with its original deadline. Always call start on entry
rather than tracking "have I started" yourself.

### Attempt payload

```jsonc
{
  "id": "ckq…", "quizId": "ckp…", "quizTitle": "পদার্থবিজ্ঞান — অধ্যায় ৩",
  "attemptNumber": 1, "status": "IN_PROGRESS",
  "startedAt": "2026-08-23T10:00:00.000Z",
  "deadlineAt": "2026-08-23T10:30:00.000Z",
  "serverTime": "2026-08-23T10:00:00.120Z",   // ← anchor your countdown to this
  "remainingMs": 1799880,
  "submittedAt": null, "submissionCause": null,
  "score": null, "maxScore": 40,
  "focusViolations": 0, "maxFocusViolations": 3
}
```

### The countdown

Compute an offset once, then run locally off `performance.now()`:

```ts
const skewMs = Date.parse(attempt.serverTime) - Date.now();
const deadline = Date.parse(attempt.deadlineAt);
const remaining = () => deadline - (Date.now() + skewMs);
```

Re-anchor `skewMs` on every heartbeat response. Do **not** count down by
decrementing a number in `setInterval` — background tabs throttle timers and
the clock will drift.

### Heartbeat loop — every 15 seconds

```jsonc
// POST /attempts/{id}/heartbeat → 200
{ "status": "IN_PROGRESS", "serverTime": "…", "deadlineAt": "…",
  "remainingMs": 1740000, "submissionCause": null }
```

- Also fire a heartbeat on `visibilitychange → visible` and on `focus`.
  Browsers throttle timers in background tabs, and a student who merely
  switched tabs must not be scored as disconnected.
- **90 seconds of silence counts as a disconnect** and the attempt is
  auto-submitted as `DISCONNECTED`. That is six missed beats — enough to ride
  out a lift or a wifi handover.
- If a heartbeat returns `status: "SUBMITTED"`, the attempt is over: stop every
  loop, exit fullscreen, and show the result screen with `submissionCause`.
- On network failure, keep retrying with backoff and show a visible
  "reconnecting…" banner with the remaining grace time. Do not silently
  swallow it — the student needs to know their exam is at risk.

### Autosave

`PUT /attempts/{id}/answers/{questionId}` with
`{ "selectedOptionIds": ["opt1"] }` → **204**.

- Send on every change; debounce ~400 ms per question. An empty array records
  a deliberate skip.
- Queue while offline and flush on reconnect, oldest first.
- **410 means time is up or the attempt is closed.** Stop everything and show
  the result screen — do not retry.
- There is no bulk submit payload. By the time the student presses submit, the
  server already has every answer; that is what makes a disconnect survivable.

### Question order

`GET /attempts/{id}` returns questions already shuffled for this attempt (when
the quiz enables it), deterministically from the attempt id. Render them in
the order given, and never re-sort — a reconnecting student must see the same
order. Option order is shuffled the same way.

```jsonc
{
  "attempt": { … },
  "questions": [
    { "id": "q1", "type": "SINGLE_CHOICE", "prompt": "…$p = mv$…",
      "contentFormat": "LATEX_MIXED", "points": 2,
      "options": [ { "id": "o1", "text": "…" }, { "id": "o2", "text": "…" } ] }
  ],
  "answers": [ { "questionId": "q1", "selectedOptionIds": ["o2"] } ]
}
```

Note what is **not** there: no `isCorrect`, anywhere, ever. Students never
receive the answer key, not even after submitting
([ADR-0011](adr/0011-answer-key-exposure-boundary.md)). If you find yourself
writing code that hides a correctness flag, you are on the wrong endpoint.

`type` drives the input: `SINGLE_CHOICE` and `TRUE_FALSE` are radios (send one
id), `MULTI_CHOICE` is checkboxes (send the full set). Multi-choice is graded
all-or-nothing — say so in the UI so students know partial guesses do not pay.

### Focus enforcement

On start: request fullscreen from the user's click (browsers refuse otherwise),
and register:

| Browser event | Report as | Counts toward auto-submit |
| --- | --- | --- |
| `visibilitychange` → hidden | `TAB_HIDDEN` | ✅ |
| `fullscreenchange` → exited | `FULLSCREEN_EXIT` | ✅ |
| `blur` on window | `WINDOW_BLUR` | ❌ (too noisy) |
| `copy` / `paste` | `COPY` / `PASTE` | ❌ |
| reconnected after a gap | `RECONNECT` | ❌ |

```jsonc
// POST /attempts/{id}/events
{ "events": [ { "type": "TAB_HIDDEN", "clientTime": "2026-08-23T10:04:11.000Z" } ] }
```

The response is the current attempt — read `focusViolations` and
`maxFocusViolations` from it. Warn on every counted violation
(*"Leaving the exam screen has been recorded — 2 of 3"*), and when
`status` comes back `SUBMITTED` with `PROCTOR_VIOLATION`, the exam is over.

Batch events (flush every few seconds or on 10 queued); the endpoint accepts
up to 50 per call and is throttled to 60/min. `clientTime` is diagnostic only —
the server stamps its own time.

Also add a `beforeunload` warning while an attempt is in progress. It is
dismissible; add it anyway, because most accidental exits are accidents.

### Submitting

`POST /attempts/{id}/submit` → the attempt with `score`, `maxScore` and
`submissionCause`. Then: clear the loops, exit fullscreen, drop the unload
handler, and show a result screen keyed on cause:

| `submissionCause` | Copy |
| --- | --- |
| `MANUAL` | "Submitted. Score X/Y." |
| `TIMER_EXPIRED` | "Time is up — your answers were submitted automatically." |
| `DISCONNECTED` | "Your connection dropped, so the exam was submitted automatically." |
| `PROCTOR_VIOLATION` | "The exam ended because the exam screen was left too many times." |
| `QUIZ_CLOSED` | "Your teacher closed this quiz; your answers were submitted." |
| `ADMIN_CLOSED` | "This attempt was closed by staff." |

Show the score, never per-question correctness.

### Reconnection rules

| Situation | What happens | UI |
| --- | --- | --- |
| Back within 90s | Nothing was finalized | Resume silently; send `RECONNECT` |
| Back after 90s, before deadline | Attempt was auto-submitted as `DISCONNECTED` | Result screen — it cannot be reopened |
| Back on a different device | Allowed; recorded as `DEVICE_CHANGED` | Resume; the timer did not stop |
| Attempts remaining | Start offers a fresh attempt with a fresh clock | Show "Attempt 2 of 3" |

An attempt that has been finalized is never reopened. That is deliberate:
otherwise pulling the network cable buys thinking time.

---

## 6. Endpoint reference

`✱` = requires an organization selected. Permissions are on the caller's
membership; org owners and the superadmin satisfy any permission.

### Organizations

| Method | Path | Gate |
| --- | --- | --- |
| POST | `/organizations` `{ name, ownerEmail }` | superadmin |
| GET | `/organizations?page&limit` | superadmin |
| GET | `/organizations/current` ✱ | any member |
| PATCH | `/organizations/current` `{ name }` ✱ | `MANAGE_ORGANIZATION` |
| POST | `/organizations/current/rotate-join-code` ✱ | `MANAGE_ORGANIZATION` |
| GET | `/organizations/{id}` | superadmin, or a member of it |

Rotating the join code invalidates the old one — confirm before doing it.

### Members and invites

| Method | Path | Gate |
| --- | --- | --- |
| GET | `/members?role&page&limit` ✱ | `MANAGE_MEMBERS` |
| GET | `/members/{id}` ✱ | `MANAGE_MEMBERS` |
| PATCH | `/members/{id}` `{ permissions?, isOrgOwner?, status? }` ✱ | `MANAGE_MEMBERS` |
| POST | `/invites` `{ email, role, isOrgOwner?, permissions? }` ✱ | `MANAGE_MEMBERS` |
| POST | `/invites/batch` `{ emails[], role, … }` ✱ | `MANAGE_MEMBERS` |
| GET | `/invites?status&page&limit` ✱ | `MANAGE_MEMBERS` |
| DELETE | `/invites/{id}` ✱ | `MANAGE_MEMBERS` |
| GET | `/invites/token/{token}` | public |
| POST | `/invites/accept` `{ token, password }` | public |
| POST | `/students/join` `{ joinCode, email, password }` | public |

`POST /invites/batch` **always returns 201**, with per-recipient outcomes:

```jsonc
{ "created": 1, "skipped": 1,
  "results": [ { "email": "a@x.edu", "status": "INVITED", "inviteId": "…" },
               { "email": "b@x.edu", "status": "ALREADY_INVITED", "inviteId": "…" } ] }
```

Render that table — a client that only checks the status code will silently
tell the user 100 invitations went out when 40 did.

`GET /invites/token/{token}` returns `accountExists`. When true, ask for the
person's **existing** password (accepting adds a membership to that account);
when false, ask them to choose a new one.

Permissions available: `MANAGE_MEMBERS`, `MANAGE_QUIZZES`, `VIEW_RESULTS`,
`MANAGE_ORGANIZATION`. Students hold none and cannot be granted any. The last
active owner cannot be demoted or suspended (409).

### Quizzes ✱ — `MANAGE_QUIZZES` unless noted

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/quizzes` | Creates a `DRAFT` |
| GET | `/quizzes?status&mine&page&limit` | `{ items, total }` |
| GET | `/quizzes/{id}` | |
| PATCH | `/quizzes/{id}` | Published quizzes accept only `title`, `description`, `opensAt`, `closesAt`, `leaderboardVisibleToStudents`, `maxFocusViolations` — anything else is 409 |
| DELETE | `/quizzes/{id}` | Drafts only |
| POST | `/quizzes/{id}/publish` | Validates the whole quiz; questions freeze |
| POST | `/quizzes/{id}/close` | Finalizes attempts in flight |
| POST | `/quizzes/{id}/archive` | |
| POST | `/quizzes/{id}/duplicate` | The way to "edit" a published quiz |
| GET | `/quizzes/{id}/questions` | Authoring view, with the answer key |
| POST | `/quizzes/{id}/questions` | Drafts only |
| PATCH | `/quizzes/{id}/questions/{questionId}` | Drafts only; sending `options` replaces the whole set |
| DELETE | `/quizzes/{id}/questions/{questionId}` | Drafts only |
| PUT | `/quizzes/{id}/questions/order` `{ questionIds[] }` | Must list every question exactly once |
| GET | `/quizzes/{id}/answer-key` | `VIEW_RESULTS` |
| POST | `/quizzes/{id}/links` | Token returned **once** |
| GET | `/quizzes/{id}/links` | |
| DELETE | `/quizzes/{id}/links/{linkId}` | Revoke |
| GET | `/quizzes/{id}/leaderboard?page&limit` | Any member; students only if `leaderboardVisibleToStudents` |

Quiz timing fields, which are three different things
([ADR-0012](adr/0012-availability-window-and-attempt-policy.md)):

- `durationSeconds` — how long **one sitting** lasts.
- `opensAt` / `closesAt` — when the quiz **accepts sittings**.
- `maxAttempts` + `scoringPolicy` (`BEST`/`FIRST`/`LATEST`) — repeat sittings,
  and which one represents the student.
- `lateStartCutoff` — when true, refuse a start that would get less than the
  full duration instead of handing out a short exam.

Build the editor so those read as three separate controls. Warn when
`closesAt - opensAt < durationSeconds` — publish will reject it.

Publish validation (all 400s, so surface them inline): at least one question;
every question at least two options; exactly one correct answer for
`SINGLE_CHOICE`/`TRUE_FALSE`; at least one for `MULTI_CHOICE`; true/false has
exactly two options.

**Link creation response carries `token` and `url` exactly once.** Show a
copy-to-clipboard step there and then; it can never be retrieved again.

### Attempts

| Method | Path | Gate |
| --- | --- | --- |
| POST | `/quizzes/{quizId}/attempts` ✱ | member |
| POST | `/attempts/from-link/{token}` | any signed-in user; enrols as student |
| GET | `/attempts/mine?page&limit` | own attempts, all organizations |
| GET | `/attempts/{id}` | own attempt |
| PUT | `/attempts/{id}/answers/{questionId}` | own attempt |
| POST | `/attempts/{id}/heartbeat` | own attempt |
| POST | `/attempts/{id}/submit` | own attempt |
| POST | `/attempts/{id}/events` | own attempt |
| GET | `/quizzes/{quizId}/attempts` ✱ | `VIEW_RESULTS` |
| GET | `/attempts/{id}/detail` ✱ | `VIEW_RESULTS` |

`GET /quiz-links/{token}` is public and returns a preview — title, org,
duration, question count, window, and `acceptingAttempts` — with no questions.
That is the landing page for a shared link: preview → sign in or register →
`POST /attempts/from-link/{token}`.

### Dashboards ✱

| Method | Path | Gate |
| --- | --- | --- |
| GET | `/dashboard/teacher?mine=true` | `VIEW_RESULTS` |
| GET | `/dashboard/quizzes/{quizId}` | `VIEW_RESULTS` |
| GET | `/dashboard/organization?from&to` | `VIEW_RESULTS` |
| GET | `/dashboard/student` | any signed-in user |

`/dashboard/quizzes/{id}` returns `scoreDistribution` (ten deciles),
`questionDifficulty` (`correctRate` per question — sort ascending to surface
what the class found hardest) and `submissionCauses` (how many attempts ended
by timer, disconnect, violation). `/dashboard/student` spans **every**
organization the student belongs to; group the output by `organizationName`.

Numbers move while an exam is running, because attempts settle as they are
read. Label live figures as a snapshot rather than a final count.

---

## 7. Screens

**Student**
1. Sign in / join with code (`/students/join`) / accept invite.
2. Organization picker (when several memberships).
3. Home — upcoming and available quizzes, `GET /dashboard/student` progress.
4. Link landing (`/quiz-links/{token}` preview → sign in → start).
5. **Exam runner** — see §5. Full-screen, no nav, one question or a paginated
   set, a persistent countdown, per-question saved indicator, and a submit
   confirmation that names unanswered questions.
6. Result — score, cause, attempt number, "attempts left".

**Teacher**
1. Quiz list with status filter and `mine` toggle.
2. Quiz editor — settings panel (the three timing controls) + question builder
   with the MathLive field and a live preview rendered exactly as the exam
   renders it.
3. Publish confirmation that spells out what freezes.
4. Links manager — create, copy once, use counts, revoke.
5. Results — attempt list, leaderboard, per-question difficulty, one attempt's
   detail with its proctoring timeline.

**Organization**
1. Members table with role, permissions (multi-select), status, owner flag.
2. Invites — single and batch, with the per-recipient results table.
3. Settings — name, join code with rotate.
4. Overview — `/dashboard/organization`.

**Superadmin**
1. Organizations list, create form (name + owner email).

---

## 8. Implementation notes

- **One HTTP client** with interceptors for: bearer token, `X-Device-Id`,
  401 → single-flight refresh → retry once, 403-no-org → org picker,
  429 → backoff. Everything else surfaces to the caller.
- **Do not cache exam data.** The runner reads from the server on entry and
  keeps its own in-memory state; a stale cache in an exam is a bug with
  academic consequences.
- **Permissions in the UI**: read them from the `org` claim, and hide what the
  user cannot do rather than showing it and failing. The server is still the
  authority — a hidden button is a courtesy, not a control.
- **Optimistic updates are fine everywhere except answers and submission.**
  Those must reflect what the server acknowledged.
- **Accessibility**: the exam must be operable by keyboard; announce the
  remaining time politely (`aria-live="polite"`) at intervals, not every
  second; ensure formulae have text alternatives (KaTeX emits MathML).
- **Test the unhappy paths deliberately**: device conflict, expired invite,
  link revoked mid-exam, tab hidden three times, network dropped for two
  minutes, refresh token reuse. They are the ones that will actually happen.
