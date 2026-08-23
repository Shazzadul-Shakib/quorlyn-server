# ADR-0020: Question content is UTF-8 text with inline LaTeX, validated server-side

- **Status:** Accepted
- **Date:** 2026-08-23

## Context

Questions are written in mixed Bangla and English — often inside the same
sentence — and cover mathematics, physics, and chemistry, so a prompt or an
option may be prose, a formula, a chemical equation, or all three:

> `একটি বস্তুর ভরবেগ $p = mv$ হলে, গতিশক্তি কত?`
> `বিক্রিয়াটি সম্পন্ন করো: $\ce{2H2 + O2 -> 2H2O}$`

The authoring client is [MathLive](https://mathlive.io/mathfield/), whose
mathfield round-trips **LaTeX** losslessly (`mathfield.getValue('latex')`)
and can also emit MathML or ASCIIMath. So the storage decision is really two
questions: what serialization the database holds, and who is responsible for
the fact that this content is written by users and rendered in other users'
browsers.

Bangla itself needs no mechanism — Postgres `text` is UTF-8 and Prisma's
`String` maps to `text`. What it does need is discipline: no byte-counted
length limits, no `varchar(n)` sized for ASCII, and no validation that
assumes one character is one byte.

## Decision

**One `text` column per authored string, holding plain UTF-8 with math
delimited inline**, plus a format marker on the question:

```prisma
enum ContentFormat {
  PLAIN         // no math, render as text
  LATEX_MIXED   // UTF-8 prose with $…$ / $$…$$ segments
}

enum Language { EN BN MIXED }

model Question {
  prompt        String        // text — mixed Bangla/English + LaTeX
  contentFormat ContentFormat @default(LATEX_MIXED)
  // options inherit the question's contentFormat
}

model QuestionOption {
  text String
}

model Quiz {
  language Language @default(MIXED)   // rendering/font hint, not a constraint
  subject  String?                    // "Physics", "রসায়ন" — free text, for grouping
}
```

- `$…$` is inline math, `$$…$$` is display math; everything outside the
  delimiters is literal text and is never interpreted.
- **LaTeX only** — not MathML, not ASCIIMath, not both. One canonical form
  means one validator, one renderer configuration, and no conversion step
  that can lose a `\ce{}` or a `\overrightarrow{}`.
- **Chemistry uses mhchem** (`\ce{...}`, `\pu{...}`), which KaTeX and MathLive
  both support as an extension; physics units are plain `\mathrm{}`. No
  subject-specific storage.
- `language` and `subject` are metadata for filtering and font selection.
  They never restrict what may appear in the content, because a Bangla
  physics question legitimately contains English variable names.

**The server validates content; it does not sanitize it.** `validateContent`
([src/common/content/content.util.ts](../../src/common/content/content.util.ts))
rejects, rather than silently rewriting:

1. length over `MAX_CONTENT_LENGTH` (characters, via `Array.from`, not bytes);
2. unbalanced `$`/`$$` delimiters, or nesting;
3. any `<` followed by a letter or `/` — content is never HTML, so a tag is
   always either a mistake or an attack;
4. a denylist of LaTeX commands that are not maths: `\href`, `\url`,
   `\includegraphics`, `\input`, `\include`, `\write`, `\def`,
   `\newcommand`, `\renewcommand`, `\csname`, `\catcode`, `\usepackage`.

Rejecting is deliberate: a rewritten formula is a *changed exam question*,
and silently altering what a teacher wrote is worse than making them fix it.

The renderer is the second half of the guarantee, and it is specified in
[docs/FRONTEND.md](../FRONTEND.md): KaTeX/MathLive with `trust: false` and
`strict: 'ignore'`, output inserted as rendered nodes — never
`innerHTML` of raw content, and never `\html…` commands enabled.

## Alternatives considered

- **A JSON rich-content document (portable-text style blocks)** — the general
  answer for mixed inline content, and what a CMS would use. Rejected: exam
  questions are a paragraph with inline formulae, not documents with
  headings, embeds, and marks. JSON blocks would make every diff, every
  search, and every migration harder to reason about, and MathLive still
  produces LaTeX for the leaves.
- **Two columns: `promptText` + `promptLatex`** — clean separation, no
  parsing. Rejected because it can only express "text, then a formula", not
  the interleaving the requirement actually has ("if $p = mv$, then …").
- **Store MathML** — the accessibility-native format, and what screen readers
  consume. Rejected as the stored form: it is verbose, it is not what the
  editor round-trips, and it is trivially derivable at render time (KaTeX and
  MathLive both emit MathML alongside visual output, so accessibility is not
  lost by storing LaTeX).
- **Render to HTML/SVG at write time and store the output** — fastest reads.
  Rejected: it freezes the renderer version into the data, makes editing
  lossy, and turns every stored question into an HTML injection surface.
- **Allow HTML and sanitize it** — rejected: it adds a sanitizer dependency
  and a permanent XSS surface to solve a problem the content does not have.
  Nothing here needs markup that LaTeX and plain text cannot express.
- **A `QuestionTranslation` table (one row per language)** — rejected as a
  misreading of the requirement: the ask is for *one* question that mixes
  scripts, not the same question authored twice. If genuine per-language
  variants are ever wanted, ADR-0010's quiz duplication already produces two
  quizzes, and a translation table would then be a new decision.

## Consequences

- **Every renderer must agree on the delimiters.** `$…$` inside a question
  that is genuinely about currency ("$5") is now ambiguous. The validator
  therefore treats an unmatched `$` as an error, and authors write `\$` for a
  literal dollar sign — which MathLive already produces.
- The denylist needs review whenever KaTeX or MathLive gains commands. It is
  a denylist rather than an allowlist because maths uses hundreds of legal
  commands and an allowlist would reject valid physics notation weekly; the
  renderer's `trust: false` is the actual security boundary, and the denylist
  is defence in depth.
- Search over question text will match LaTeX source, so a search for "H2O"
  will not find `\ce{H2O}`. Acceptable now; if question search becomes a
  feature it needs a derived plain-text column, populated at write time.
- Images and diagrams are not supported. A geometry question needing a figure
  has no home here, and that is a real product gap to decide on separately —
  it would need file storage, which this backend does not have.
- Because content is validated but never transformed, the exact string a
  teacher typed is the exact string every student sees. That property is what
  makes an exam defensible after the fact.
