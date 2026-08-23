import { randomInt } from 'crypto';

export const VERIFICATION_CODE_LENGTH = 6;

/** A numeric, human-readable code for email verification (ADR-0017). */
export function generateVerificationCode(): string {
  return randomInt(0, 10 ** VERIFICATION_CODE_LENGTH)
    .toString()
    .padStart(VERIFICATION_CODE_LENGTH, '0');
}
