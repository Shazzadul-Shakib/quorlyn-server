import { randomInt } from 'crypto';

// Excludes visually ambiguous characters (0/O, 1/I/L).
const JOIN_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateJoinCode(length = 8): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += JOIN_CODE_ALPHABET[randomInt(JOIN_CODE_ALPHABET.length)];
  }
  return code;
}
