/**
 * Reading JSON that came from the other producer.
 *
 * A request's payload is written by a co-producer's browser, which anyone
 * holding the link controls. The owner's app and the server both walk it,
 * look things up by the names in it and copy values out of it, so before
 * anything does that, the value as a whole is checked for the shapes that
 * turn a lookup into something else: a key that reaches an object's
 * prototype, nesting deep enough to exhaust a recursive walk, or so many
 * values that walking them stalls the page.
 *
 * Every decrypted payload, outline, result and handout goes through
 * parseUntrusted, never JSON.parse alone. The strict schema (schema.ts) then
 * checks what each value is.
 */
import { COPRODUCER_LIMITS } from './types';

/** Names that reach an object's prototype when used as a key. */
export const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

export class UntrustedJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UntrustedJsonError';
  }
}

/** JSON.parse, then checkUntrusted. Throws UntrustedJsonError on either failing. */
export function parseUntrusted(text: string): unknown {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new UntrustedJsonError('not JSON');
  }
  checkUntrusted(value);
  return value;
}

/**
 * Refuses, anywhere in the value:
 * - an own key in FORBIDDEN_KEYS;
 * - an [id, row] pair (a two-item list of a string and an object, the shape
 *   settings rows travel in) whose id is one of those names;
 * - containers nested more than 16 deep (a top-level object or list is at
 *   depth 1);
 * - more than 100,000 values in all, counting every object, list and leaf,
 *   the top-level value included.
 *
 * Walks with its own stack rather than recursion, so the depth limit is the
 * only thing nesting can run into. Throws UntrustedJsonError.
 */
export function checkUntrusted(value: unknown): void {
  const { maxPayloadDepth, maxPayloadValues } = COPRODUCER_LIMITS;
  const stack: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  let count = 0;
  while (stack.length > 0) {
    const { value: current, depth } = stack.pop()!;
    count += 1;
    if (count > maxPayloadValues) throw new UntrustedJsonError('too many values');
    if (current === null || typeof current !== 'object') continue;
    const level = depth + 1;
    if (level > maxPayloadDepth) throw new UntrustedJsonError('nested too deep');
    if (Array.isArray(current)) {
      if (
        current.length === 2 &&
        typeof current[0] === 'string' &&
        FORBIDDEN_KEYS.has(current[0]) &&
        current[1] !== null &&
        typeof current[1] === 'object'
      ) {
        throw new UntrustedJsonError('forbidden row id');
      }
      for (const item of current) stack.push({ value: item, depth: level });
      continue;
    }
    for (const key of Object.keys(current)) {
      if (FORBIDDEN_KEYS.has(key)) throw new UntrustedJsonError('forbidden key');
      stack.push({ value: (current as Record<string, unknown>)[key], depth: level });
    }
  }
}
