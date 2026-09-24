import { describe, expect, it } from 'vitest';
import { shownProfileUrl } from './RolodexRow';
import type { ProfileRequest } from '../types';

const origin = 'https://show.example';
const request = (over: Partial<ProfileRequest> = {}): ProfileRequest => ({
  id: 'r1',
  token: 'tok-0123456789abcdef',
  key: 'key-0123456789abcdef',
  contactId: 'c1',
  personName: 'Mona Sable',
  sentAt: '2026-09-10T00:00:00.000Z',
  ...over,
});

describe('a Rolodex row with a profile link still out asking', () => {
  it('can show the link again after a reload, rebuilt from what is filed', () => {
    // The producer switched to Messages before pasting and the app was
    // discarded. The token and key are on file; the address must come back.
    expect(shownProfileUrl(origin, 'waiting', request())).toBe(
      'https://show.example/details?t=tok-0123456789abcdef#k=key-0123456789abcdef',
    );
  });

  it('shows the link just made as it was made', () => {
    const fresh = 'https://show.example/details?t=fresh#k=fresh';
    expect(shownProfileUrl(origin, 'waiting', request(), fresh)).toBe(fresh);
  });

  it('has nothing to show once the link is answered', () => {
    // An answered link is used up; sending it again reaches a page that says so.
    const answered = request({
      submitted: { submittedAt: '2026-09-11T00:00:00.000Z', typedName: 'Mona Sable', fields: [] },
    });
    expect(shownProfileUrl(origin, 'answered', answered)).toBeUndefined();
    expect(shownProfileUrl(origin, 'waiting', answered)).toBeUndefined();
  });

  it('has nothing to show when no link was ever sent', () => {
    expect(shownProfileUrl(origin, null, undefined)).toBeUndefined();
    expect(shownProfileUrl(origin, 'waiting', undefined)).toBeUndefined();
  });
});
