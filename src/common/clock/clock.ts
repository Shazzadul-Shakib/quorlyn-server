export const CLOCK = Symbol('CLOCK');

/**
 * The server's notion of "now". Injected rather than called statically so
 * exam timing (ADR-0014) can be driven deterministically in tests — every
 * deadline, heartbeat and expiry decision in this codebase reads from here.
 */
export interface Clock {
  now(): Date;
}
