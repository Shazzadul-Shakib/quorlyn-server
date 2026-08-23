import { BadRequestException } from '@nestjs/common';
import { ContentFormat } from '@prisma/client';

export const MAX_CONTENT_LENGTH = 4000;

/**
 * LaTeX commands that are not mathematics. KaTeX/MathLive render with
 * `trust: false`, which is the real boundary; this is defence in depth so the
 * stored content can never carry a link, an include, or a macro definition
 * (ADR-0020).
 */
const DENIED_COMMANDS = [
  'href',
  'url',
  'includegraphics',
  'input',
  'include',
  'write',
  'def',
  'newcommand',
  'renewcommand',
  'csname',
  'catcode',
  'usepackage',
  'expandafter',
  'immediate',
  'openout',
];

const DENIED_COMMAND_PATTERN = new RegExp(
  `\\\\(${DENIED_COMMANDS.join('|')})\\b`,
  'i',
);

// Any '<' that starts what a browser would treat as a tag. Content is never
// HTML, so this is always either a mistake or an injection attempt.
const HTML_TAG_PATTERN = /<\s*\/?\s*[a-zA-Z]/;

export class ContentValidationError extends Error {
  constructor(
    public readonly field: string,
    message: string,
  ) {
    super(`${field}: ${message}`);
    this.name = 'ContentValidationError';
  }
}

/**
 * Validates authored question content. Deliberately rejects rather than
 * sanitizes: silently rewriting a formula changes the exam question.
 */
export function validateContent(
  value: string,
  format: ContentFormat,
  field = 'content',
): void {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ContentValidationError(field, 'must not be empty');
  }

  // Characters, not bytes — Bangla codepoints are multi-byte (ADR-0020).
  if (Array.from(trimmed).length > MAX_CONTENT_LENGTH) {
    throw new ContentValidationError(
      field,
      `must be at most ${MAX_CONTENT_LENGTH} characters`,
    );
  }

  if (HTML_TAG_PATTERN.test(trimmed)) {
    throw new ContentValidationError(
      field,
      'must not contain HTML; use LaTeX for formatting',
    );
  }

  if (format !== ContentFormat.LATEX_MIXED) {
    return;
  }

  if (DENIED_COMMAND_PATTERN.test(trimmed)) {
    throw new ContentValidationError(
      field,
      'contains a LaTeX command that is not permitted in question content',
    );
  }

  assertBalancedMathDelimiters(trimmed, field);
}

/**
 * `$…$` is inline math and `$$…$$` is display math; a literal dollar sign is
 * written `\$`. An unmatched delimiter is an error rather than a guess,
 * because guessing changes where the maths starts.
 */
function assertBalancedMathDelimiters(value: string, field: string): void {
  let index = 0;
  let openDelimiter: '$' | '$$' | null = null;

  while (index < value.length) {
    const char = value[index];

    if (char === '\\') {
      index += 2; // escaped character — including \$
      continue;
    }

    if (char !== '$') {
      index += 1;
      continue;
    }

    const isDisplay = value[index + 1] === '$';
    const delimiter: '$' | '$$' = isDisplay ? '$$' : '$';
    index += delimiter.length;

    if (openDelimiter === null) {
      openDelimiter = delimiter;
      continue;
    }

    if (openDelimiter !== delimiter) {
      throw new ContentValidationError(
        field,
        'mixes $…$ and $$…$$ delimiters in one math segment',
      );
    }
    openDelimiter = null;
  }

  if (openDelimiter !== null) {
    throw new ContentValidationError(
      field,
      'has an unclosed math delimiter; write \\$ for a literal dollar sign',
    );
  }
}

/** Validates and translates to an HTTP error at the service boundary. */
export function assertValidContent(
  value: string,
  format: ContentFormat,
  field: string,
): void {
  try {
    validateContent(value, format, field);
  } catch (error) {
    if (error instanceof ContentValidationError) {
      throw new BadRequestException(error.message);
    }
    throw error;
  }
}
