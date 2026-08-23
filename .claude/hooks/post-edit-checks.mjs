#!/usr/bin/env node
/**
 * PostToolUse hook: advisory conventions check for Quorlyn.
 *
 * Reads the hook payload on stdin, inspects the file that was just written,
 * and feeds any convention gaps back as additional context. Advisory only —
 * it never blocks an edit, and it stays silent when everything looks right.
 */
import { readFileSync } from 'node:fs';
import { relative, isAbsolute, join } from 'node:path';

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function emit(notes) {
  if (notes.length === 0) return;
  const context = [
    'Convention check on the file you just edited:',
    ...notes.map((n) => `  - ${n}`),
    'Fix these now, or state explicitly why they do not apply. See CLAUDE.md.',
  ].join('\n');
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: context,
      },
    }),
  );
}

function count(source, pattern) {
  return (source.match(pattern) ?? []).length;
}

let payload;
try {
  payload = JSON.parse(readStdin());
} catch {
  process.exit(0);
}

const filePath = payload?.tool_input?.file_path;
if (typeof filePath !== 'string' || filePath.length === 0) process.exit(0);

const abs = isAbsolute(filePath) ? filePath : join(root, filePath);
const rel = relative(root, abs).split('\\').join('/');
if (rel.startsWith('..')) process.exit(0);

let src;
try {
  src = readFileSync(abs, 'utf8');
} catch {
  process.exit(0);
}

const notes = [];

// --- ADR-0005: services never touch Prisma directly -----------------------
if (rel.startsWith('src/module/') && rel.endsWith('.ts')) {
  if (/\bPrismaService\b/.test(src)) {
    notes.push(
      'ADR-0005 violation: PrismaService is imported under src/module/. Move the query into the model repository in src/common/repositories/ and inject that instead.',
    );
  }
  if (/\bprisma\.[a-z][A-Za-z]*\.(find|create|update|delete|upsert|count|aggregate|groupBy)/.test(src)) {
    notes.push(
      'ADR-0005 violation: a Prisma query is being built under src/module/. Services call named repository methods, never prisma.<model>.<op>().',
    );
  }
  if (/P2002|PrismaClientKnownRequestError/.test(src)) {
    notes.push(
      'ADR-0005 violation: Prisma error internals under src/module/. Repositories translate via toUniqueConstraintError; services check error.violates(field).',
    );
  }
}

// --- Swagger completeness on controllers ---------------------------------
if (rel.endsWith('.controller.ts')) {
  const routes = count(src, /@(Get|Post|Put|Patch|Delete|Head|Options)\s*\(/g);
  const operations = count(src, /@ApiOperation\s*\(/g);
  const publicRoutes = count(src, /@Public\s*\(\s*\)/g);
  const bearer = count(src, /@ApiBearerAuth\s*\(/g);

  if (routes > 0 && !/@ApiTags\s*\(/.test(src)) {
    notes.push('Swagger: controller has no @ApiTags(...).');
  }
  if (operations < routes) {
    notes.push(
      `Swagger: ${routes} route handler(s) but ${operations} @ApiOperation(...) — every handler needs a summary.`,
    );
  }
  if (bearer < routes - publicRoutes) {
    notes.push(
      `Swagger: ${routes - publicRoutes} authenticated route(s) but ${bearer} @ApiBearerAuth('access-token') — protected routes must declare it.`,
    );
  }
}

// --- @ApiProperty coverage on DTO classes --------------------------------
if (/\/dto\/.*\.dto\.ts$/.test(rel)) {
  const fields = count(src, /^\s{2}(?:readonly\s+)?[a-zA-Z_]\w*\??!?:\s/gm);
  const properties = count(src, /@ApiProperty(?:Optional)?\s*\(/g);
  if (fields > properties) {
    notes.push(
      `Swagger: ${fields} DTO field(s) but ${properties} @ApiProperty(...) — every field must be documented.`,
    );
  }
  if (/passwordHash|tokenHash/.test(src)) {
    notes.push(
      'Leak risk: a DTO references passwordHash/tokenHash. Hashes never leave the repository layer.',
    );
  }
}

// --- Schema edits carry a migration + regenerate + diagram ---------------
if (rel === 'prisma/schema.prisma') {
  notes.push(
    'Schema edited: run pnpm prisma:generate, create a named migration with pnpm prisma:migrate (ask first), read the generated SQL for destructive statements, and update the erDiagram in docs/ARCHITECTURE.md if a model or relation changed. See /schema-change.',
  );
}

// --- Env schema and .env.example stay in sync ----------------------------
if (rel === 'src/common/config/env.validation.ts') {
  notes.push(
    'Env schema edited: mirror every new variable in .env.example with a placeholder (never a real value).',
  );
}

emit(notes);
