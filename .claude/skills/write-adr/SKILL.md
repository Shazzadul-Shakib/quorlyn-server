---
name: write-adr
description: Record a decision or a solved non-obvious problem as an ADR in docs/adr, and link it from the README's "Notable problems solved" list when it earns a place there. Use after making an architectural call, after debugging something whose fix revealed a hidden constraint, or when the user asks to document what was decided or what issue was solved.
---

# Writing an ADR

This project's decision log is the record of *what issue was solved and why it
was solved that way*. [docs/README.md](../../../docs/README.md) is the policy;
this skill is the procedure.

## 1. Is it ADR-worthy?

Write one when a reviewer could reasonably ask "why not the other way?":

- Two or more approaches were genuinely on the table and one was chosen.
- The decision would be expensive or awkward to reverse.
- Debugging revealed a non-obvious constraint — the fix only makes sense if
  you know what was hiding
  ([ADR-0004](../../../docs/adr/0004-tsconfig-project-scoping.md) is the model
  for this kind: small, but the constraint is invisible in the diff).

**Skip it** when there was one obvious answer, when it's a routine feature
addition, or when the "decision" is just following an existing ADR. Say so
plainly instead of writing a hollow one — an ADR log padded with non-decisions
stops being read.

If it's not ADR-worthy but still worth recording, put it in the commit message
body. `git log` is authoritative for history; the docs never carry a
hand-maintained changelog.

## 2. Write it

```bash
ls docs/adr/                       # next sequential number, zero-padded to 4
cp docs/adr/template.md docs/adr/00NN-short-decision-focused-title.md
```

Fill the template's five sections
([template.md](../../../docs/adr/template.md)):

- **Status / Date** — `Accepted` and today's real date (check it; don't guess).
- **Context** — the problem *as it looked before the decision*. No hindsight,
  no "we obviously needed to". Name the concrete symptom: the duplicated
  helper, the failing build, the leaked type.
- **Decision** — what was chosen, naming real files, models, and functions
  with relative links (`../../src/...` from inside `docs/adr/`). A record, not
  an essay.
- **Alternatives considered** — only ones actually weighed, each with the
  specific reason it lost. This section is what makes an ADR worth reading in
  six months; an ADR with no rejected alternatives is a description, not a
  decision.
- **Consequences** — the trade-off you accepted: what got easier, what got
  harder, what now needs discipline. Be honest. If you can't name a downside,
  you probably haven't found it yet.

Match the register of the existing ADRs — [ADR-0005](../../../docs/adr/0005-repository-pattern-for-data-access.md)
is the fullest example.

## 3. Link it

1. If the story is genuinely interesting to a first-time reader, add **one**
   bullet under *Notable problems solved* in the root
   [README.md](../../../README.md) — problem in the first clause, the
   non-obvious part in the second, then `→ [ADR-00NN](docs/adr/…)`. Keep that
   list at 3–6 items; if adding one pushes it past six, argue for which
   existing bullet is now the weakest rather than letting it sprawl.
2. If the ADR changes how the system works day to day, update
   [ARCHITECTURE.md](../../../docs/ARCHITECTURE.md) in the same change and
   link the ADR from the relevant section.
3. Reference the number in the commit that implements it (`refs adr-00NN`).

## 4. Never rewrite history

ADRs are append-only once accepted. A reversal is a *new* ADR, and the old
one's status becomes `Superseded by ADR-00NN` — that status line is the only
edit an accepted ADR ever gets.
