import { describe, expect, it } from 'vitest';
import { ServerNotConfiguredError } from './api';
import { submitFailureMessage } from './submitFailure';

const err = (status?: number) => Object.assign(new Error('x'), { status });

/**
 * A performer who cannot send their contract needs to know whether to wait,
 * to move nearer the door, or to ask for a new link. Every one of these used
 * to say "check your connection", including the ones where the connection was
 * fine and trying again could never work.
 */
describe('why a submission did not go through', () => {
  it('never blames the connection when the server answered', () => {
    for (const status of [400, 401, 403, 404, 409, 413, 500, 503]) {
      expect(submitFailureMessage(err(status)), `status ${status}`).not.toMatch(/your connection/i);
    }
  });

  it('says to ask for a new link when trying again cannot work', () => {
    for (const status of [400, 401, 403, 404, 409]) {
      expect(submitFailureMessage(err(status)), `status ${status}`).toMatch(/fresh link|new (one|link)/i);
    }
  });

  it('does not tell someone to try again when it will never work', () => {
    expect(submitFailureMessage(err(409))).toMatch(/will not change that/i);
  });

  it('tells a signer with a photo that shrinking was already tried', () => {
    expect(submitFailureMessage(err(413), { hasPhoto: true })).toMatch(/even shrunk down/i);
    // Without one, the photo is not the problem and must not be blamed.
    expect(submitFailureMessage(err(413), { hasPhoto: false })).not.toMatch(/photo/i);
  });

  it('says a server problem is not their fault', () => {
    expect(submitFailureMessage(err(500))).toMatch(/not your fault/i);
    expect(submitFailureMessage(err(502))).toMatch(/not your fault/i);
    expect(submitFailureMessage(new ServerNotConfiguredError())).toMatch(/nothing you did/i);
  });

  it('tells someone offline that it was already retried and their work is safe', () => {
    const message = submitFailureMessage(new Error('network'));
    expect(message).toMatch(/already been retried/i);
    expect(message).toMatch(/saved on this device/i);
  });

  it('always ends with something to do', () => {
    const cases = [undefined, 400, 401, 403, 404, 409, 413, 500, 503];
    for (const status of cases) {
      const message = submitFailureMessage(status ? err(status) : new Error('network'));
      expect(message.length, `status ${status}`).toBeGreaterThan(40);
      expect(message, `status ${status}`).toMatch(
        /try again|ask whoever|shorten|remove the photo|sign without|come back/i,
      );
    }
  });
});
