# Maintaining this documentation

This file explains how the docs are organized and, more importantly, **when
to update which file** as the project grows. Read this once; it shouldn't
need to change often itself.

## The three layers

| Layer | File(s) | Audience | Update frequency |
| --- | --- | --- | --- |
| Front door | [../README.md](../README.md) | Someone skimming for 30 seconds (recruiter, interviewer, future you) | Rarely — only when the pitch, stack, or setup steps change |
| System map | [ARCHITECTURE.md](ARCHITECTURE.md) | Someone about to work in the codebase who needs the mental model | When a flow changes shape (new guard, new model relationship, new module) |
| Decision log | [adr/](adr/) | Someone asking "why is it built this way" | Every time you make a non-obvious call — append-only, never edited after acceptance |

The rule of thumb: **README says what and why this project exists,
ARCHITECTURE says how it works today, ADRs say why it works that way instead
of some other way.** If you're not sure which one a change belongs in, ask
"will this still be true in a month?" — if yes, it's ARCHITECTURE or README;
if it's a point-in-time decision with trade-offs, it's an ADR.

## When to write a new ADR

Write one when you catch yourself making a choice that has a real
alternative — i.e. a reviewer or future-you could reasonably ask "why not do
it the other way?" Signs it's ADR-worthy:

- You considered two or more approaches and picked one for a specific reason.
- The decision would be expensive or awkward to reverse later.
- You spent real time debugging something and the fix reveals a
  non-obvious constraint (see [ADR-0004](adr/0004-tsconfig-project-scoping.md)
  — a good example of a "small" ADR that's still worth writing down).

Skip an ADR for things with one obvious right answer (there's no ADR for
"we used Prisma's generated types instead of hand-rolling them" — there was
no real alternative on the table).

### How to write one

1. Copy [adr/template.md](adr/template.md) to `adr/00NN-short-title.md`,
   using the next sequential number.
2. Write it **at the time you make the decision**, not after — a
   reconstructed rationale months later is worse than two honest sentences
   written in the moment, and you will not remember the alternatives you
   rejected.
3. Reference the ADR number in the commit or PR that implements it (e.g.
   `refs adr-0005`), so git history and the decision log stay linked.
4. Once written, treat it as append-only. If a later decision reverses it,
   write a *new* ADR and mark the old one's status
   `Superseded by ADR-00NN` — don't edit history away.
5. If the ADR is genuinely worth a reader's attention (most are, for a
   portfolio project), add one bullet linking to it under **Notable problems
   solved** in the root [README.md](../README.md).

## When to update ARCHITECTURE.md

Update it in the same PR as the code change, when:

- A new module/guard/interceptor changes the request lifecycle.
- The data model gains a table or a relationship that isn't obvious from
  `schema.prisma` alone (i.e. it needs the *why*, not just the *what* —
  the *what* is already fully captured by the schema file itself).
- An existing flow diagram (Mermaid) no longer matches reality.

Don't restate what's already self-evident from reading the code — link to
the file instead of duplicating its logic in prose. The diagrams and the
"why" are what earn their place here; a paragraph that just narrates a
function line-by-line doesn't.

## When to update the root README

Only for things a first-time reader needs: the pitch, the stack, setup
steps, and the "Notable problems solved" list. If you add a new ADR that's
genuinely a good story, add one bullet there — but keep the list short (3-6
items); if everything is "notable," nothing is.

## What NOT to document

- Anything fully derivable from reading the code once (don't narrate that a
  controller has a POST endpoint — the code already says that as clearly as
  prose could).
- Anything that changes on every commit (don't hand-maintain a changelog
  here — `git log` is authoritative).
- Planning/TODO content — that belongs in issues/a project board, not in
  docs describing the system as it exists today.
