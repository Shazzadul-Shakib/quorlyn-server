# ADR-0004: Scope `exclude` per tsconfig instead of one shared config

- **Status:** Accepted
- **Date:** 2026-08-21

## Context

The repo has three consumers of TypeScript config with genuinely different
`rootDir` requirements: the Nest app (`rootDir: src`), the Prisma seed script
(`prisma/seed.ts`, which imports from `src/`, so it needs a wider root), and
the editor/type-checker's default program (no explicit `tsconfig` selected —
it just resolves `tsconfig.json`).

The base [tsconfig.json](../../tsconfig.json) had `rootDir: "./src"` but no
`exclude`, so its default include pattern (`**/*`) pulled in
`prisma/seed.ts`. TypeScript flagged this as TS6059
(`File '.../prisma/seed.ts' is not under 'rootDir' '.../src'`) — the editor's
default program was including a file that structurally couldn't belong to
that `rootDir`.

The fix looked like a one-line addition (`"exclude": ["node_modules", "dist",
"prisma"]` on the base config), but `prisma/tsconfig.seed.json` extends that
same base config and explicitly `include`s `./seed.ts`. In TypeScript,
`exclude` filters `include` even when a file is explicitly listed (unless
listed under `files`), and — critically — inherited `exclude`/`include`
arrays are **not merged** across `extends`, they're fully replaced only if
the child redeclares them. Adding `exclude` to the base config silently broke
the seed config's own build (`TS18003: No inputs were found`), since the seed
config didn't redeclare `exclude` and so inherited the new `prisma`
exclusion — excluding the very file it existed to include.

## Decision

- [tsconfig.json](../../tsconfig.json) (base/editor config) gained
  `"exclude": ["node_modules", "dist", "prisma"]`.
- [prisma/tsconfig.seed.json](../../prisma/tsconfig.seed.json) gained an
  explicit `"exclude": []` to cancel the inherited exclusion, since this
  config's entire purpose is to compile a file that lives under `prisma/`.

Verified by running `tsc --noEmit` against all three configs
(`tsconfig.json`, `tsconfig.build.json`, `prisma/tsconfig.seed.json`) and
confirming `prisma/seed.ts` appears in `--listFiles` output only for the
config that's supposed to include it.

## Alternatives considered

- **Move `seed.ts` under `src/`** — would sidestep the `rootDir` mismatch
  entirely, but conflates an operational script (run once via `ts-node`,
  never bundled) with application source compiled by `nest build`. Rejected;
  the three-config split reflects a real difference in what each file is for.
- **Set `rootDir` to the repo root for the base config** — would make
  `prisma/seed.ts` structurally valid under the base config, but loosens
  `rootDir` for the *app* build too, defeating the purpose of `rootDir` as a
  guard against accidentally importing scripts into `dist`. Rejected.

## Consequences

- Three tsconfigs now need to be kept in sync by hand when shared
  compiler options change (they already partially were, via `extends`) —
  future changes to the base config must be checked against both
  `tsconfig.build.json`'s and `prisma/tsconfig.seed.json`'s `exclude`
  overrides, since neither inherits array fields by merging.
