import { Prisma } from '@prisma/client';

export class UniqueConstraintViolationError extends Error {
  constructor(public readonly target: string[]) {
    super(`Unique constraint violation on: ${target.join(', ')}`);
    this.name = 'UniqueConstraintViolationError';
  }

  violates(field: string): boolean {
    return this.target.includes(field);
  }
}

export function toUniqueConstraintError(
  error: unknown,
): UniqueConstraintViolationError | null {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002' &&
    Array.isArray(error.meta?.target)
  ) {
    return new UniqueConstraintViolationError(error.meta.target as string[]);
  }
  return null;
}
