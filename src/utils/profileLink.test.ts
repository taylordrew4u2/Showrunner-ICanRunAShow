import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProfileRequest } from '../types';
import { api } from './api';
import { encryptWithKey } from './encryption';
import {
  fetchProfileRequest,
  profileFields,
  profileLinkStatus,
  profileUrl,
  refreshProfiles,
  submitProfile,
} from './profileLink';
import { profileFromAnswers } from './signatureImport';

afterEach(() => vi.restoreAllMocks());

const request = (over: Partial<ProfileRequest> = {}): ProfileRequest => ({
  id: 'r1',
  token: 'tok-0123456789abcdef',
  key: 'key-0123456789abcdef',
  contactId: 'c1',
  personName: 'Mona Sable',
  sentAt: '2026-09-10T00:00:00.000Z',
  ...over,
});

describe('the questions a profile link asks', () => {
  it('are all words the profile import already understands', () => {
    // The whole point: what comes back lands on the profile without anyone
    // retyping it. If a question here is not recognised by the import, the
    // answer is collected and then thrown away.
    const answered = profileFields().map((f) => ({
      label: f.label,
      value:
        f.id === 'email'
          ? 'mona@sable.example'
          : f.id === 'social'
            ? '@monasable'
            : `answer for ${f.id}`,
    }));

    const profile = profileFromAnswers(answered);

    expect(profile.email).toBe('mona@sable.example');
    expect(profile.phone).toBe('answer for phone');
    expect(profile.socialMedia).toBe('@monasable');
    expect(profile.credits).toBe('answer for credits');
    expect(profile.walkOnMusicName).toBe('answer for walkon');
  });

  it('collects the required email from the recipient when they fill in the form', () => {
    const required = profileFields().filter((f) => f.required).map((f) => f.id);
    expect(required).toEqual(['email']);
  });
});

describe('the link itself', () => {
  it('carries the key in the fragment, where a browser never sends it', () => {
    const url = profileUrl('https://show.example', 'tok', 'secret');
    expect(url).toBe('https://show.example/?profile=tok#k=secret');
    expect(new URL(url).search).not.toContain('secret');
  });
});

describe('opening a link as the performer', () => {
  it('refuses a contract link opened as a profile link, even under the right key', async () => {
    // Same token scheme, same key scheme — so the page has to check what it
    // has been handed, or a signing payload would render as a blank form.
    const key = 'key-0123456789abcdef';
    vi.spyOn(api, 'get').mockResolvedValue({
      payload: encryptWithKey({ contractName: 'Performer Agreement', signerName: 'Mona' }, key),
      signature: null,
    } as never);

    expect(await fetchProfileRequest('tok', key)).toBeNull();
  });

  it('shows what was already sent, so a reopened link is not a blank form', async () => {
    const key = 'key-0123456789abcdef';
    vi.spyOn(api, 'get').mockResolvedValue({
      payload: encryptWithKey(
        { kind: 'profile', fromName: 'Basement', personName: 'Mona', fields: [], createdAt: '' },
        key,
      ),
      signature: encryptWithKey(
        { submittedAt: '', typedName: 'Mona Sable', fields: [{ label: 'Email', value: 'm@x.example' }] },
        key,
      ),
    } as never);

    const view = await fetchProfileRequest('tok', key);

    expect(view?.payload.kind).toBe('profile');
    expect(view?.submitted?.typedName).toBe('Mona Sable');
  });

  it('leaves the device encrypted', async () => {
    const posts: { signature: string }[] = [];
    vi.spyOn(api, 'post').mockImplementation(async (_path, body) => {
      posts.push(body as { signature: string });
      return {} as never;
    });

    await submitProfile('tok', 'key-0123456789abcdef', 'Mona Sable', [
      { label: 'Email', value: 'mona@sable.example' },
    ]);

    expect(posts[0].signature).not.toContain('mona@sable.example');
  });
});

describe('the producer checking for replies', () => {
  it('says nothing changed when nobody has answered, so no settings are rewritten', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ payload: 'x', signature: null } as never);
    expect(await refreshProfiles([request()])).toBeNull();
  });

  it('attaches an answer to the link it came through', async () => {
    const key = 'key-0123456789abcdef';
    vi.spyOn(api, 'get').mockResolvedValue({
      payload: 'x',
      signature: encryptWithKey(
        { submittedAt: '', typedName: 'Mona', fields: [{ label: 'Email', value: 'm@x.example' }] },
        key,
      ),
    } as never);

    const updated = await refreshProfiles([request({ key })]);

    expect(updated?.[0].submitted?.fields).toEqual([{ label: 'Email', value: 'm@x.example' }]);
  });

  it('does not treat a failed check as an answer of no', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new Error('offline'));
    expect(await refreshProfiles([request()])).toBeNull();
  });
});

describe('what a Rolodex row shows about the link', () => {
  it('shows nothing for someone never asked — that is not a gap', () => {
    expect(profileLinkStatus([], 'c1')).toBeNull();
    expect(profileLinkStatus(undefined, 'c1')).toBeNull();
  });

  it('is waiting until they answer, and answered after', () => {
    expect(profileLinkStatus([request()], 'c1')).toBe('waiting');
    expect(
      profileLinkStatus(
        [request({ submitted: { submittedAt: '', typedName: 'Mona', fields: [] } })],
        'c1',
      ),
    ).toBe('answered');
  });
});
