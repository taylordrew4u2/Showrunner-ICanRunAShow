import { describe, expect, it } from 'vitest';
import { actionKey, buildOutline } from './outline';
import { fullShow } from './testFixtures';
import type { DownloadAction, EditPayload, ShareAction } from './types';

const FREE_TEXT = ['Totally legit post', 'mailto:everyone@example.com?subject=Hi&body=Secrets', 'Typed Signer', 'typed@example.com'];

const shares: ShareAction[] = [
  { type: 'copy-text', source: 'announce-post', showId: 's1', text: FREE_TEXT[0] },
  { type: 'email', source: 'lineup', showId: 's1', href: FREE_TEXT[1] },
  { type: 'signing-link', contractId: 'ct1', signer: { name: FREE_TEXT[2], email: FREE_TEXT[3], contactId: 'c1' } },
  { type: 'existing-signing-link', requestIds: ['r2', 'r1'] },
  { type: 'profile-link', contactId: 'c1' },
  { type: 'existing-profile-link', requestId: 'r9' },
  { type: 'viewer-link', showId: 's1' },
];
const downloads: DownloadAction[] = [
  { type: 'backup' },
  { type: 'headshot', subject: { kind: 'performer', showId: 's1', personId: 'p1' } },
  { type: 'headshot', subject: { kind: 'contact', contactId: 'c1' } },
  { type: 'headshot-pack', showId: 's1', includesGuests: false },
  { type: 'flyer', showId: 's1' },
  { type: 'signed-agreement', agreementId: 'ag1' },
  { type: 'dj-list-text', showId: 's1' },
  { type: 'runsheet-pdf', showId: 's1' },
  { type: 'dj-list-pdf', showId: 's1' },
];

describe('outlines', () => {
  it('keeps no free text from a share', () => {
    for (const action of shares) {
      const json = JSON.stringify(buildOutline({ kind: 'share', action }));
      for (const text of FREE_TEXT) expect(json).not.toContain(text);
    }
  });

  it('keeps the ids each action is about', () => {
    expect(buildOutline({ kind: 'share', action: shares[2] })).toEqual({
      kind: 'share',
      action: { type: 'signing-link', key: 'share:signing-link:ct1:c1', contractId: 'ct1', contactId: 'c1' },
    });
    expect(buildOutline({ kind: 'share', action: shares[3] }).action!.requestIds).toEqual(['r2', 'r1']);
    expect(buildOutline({ kind: 'share', action: shares[5] }).action!.requestIds).toEqual(['r9']);
    expect(buildOutline({ kind: 'download', action: downloads[1] }).action).toEqual({
      type: 'headshot',
      key: 'download:headshot:performer:s1:p1',
      subject: { kind: 'performer', showId: 's1', personId: 'p1' },
      showId: 's1',
    });
    expect(buildOutline({ kind: 'download', action: downloads[5] }).action).toEqual({ type: 'signed-agreement', key: 'download:signed-agreement:ag1', agreementId: 'ag1' });
    expect(buildOutline({ kind: 'download', action: downloads[0] })).toEqual({ kind: 'download', action: { type: 'backup', key: 'download:backup' } });
  });

  it('lists the shows and settings fields an edit touches', () => {
    const show = fullShow({ id: 'new', name: 'Brand new night' });
    const payload: EditPayload = {
      kind: 'edit',
      shows: [
        { target: 'show', op: 'create', showId: 'new', show },
        { target: 'show', op: 'update', showId: 's1', baseRevision: null, keys: ['venueName'], base: { venueName: 'A' }, proposed: { venueName: 'B' } },
        { target: 'show', op: 'delete', showId: 's2', baseRevision: null, base: fullShow({ id: 's2' }) },
      ],
      settings: { target: 'settings', baseRevision: null, fields: [{ field: 'brandName', kind: 'value', base: 'A', proposed: 'B' }] },
    };
    expect(buildOutline(payload)).toEqual({
      kind: 'edit',
      shows: [{ id: 'new', op: 'create', createName: 'Brand new night' }, { id: 's1', op: 'update' }, { id: 's2', op: 'delete' }],
      settingsFields: ['brandName'],
    });
    expect(buildOutline({ ...payload, settings: null })).not.toHaveProperty('settingsFields');
  });
});

describe('action keys', () => {
  it('is one key per action, stable, and different for different actions', () => {
    const keys = [...shares, ...downloads].map(actionKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect([...shares, ...downloads].map(actionKey)).toEqual(keys);
    expect(actionKey(downloads[4])).toBe('download:flyer:s1');
    expect(actionKey({ type: 'headshot-pack', showId: 's1', includesGuests: true })).not.toBe(actionKey(downloads[3]));
  });

  it('ignores free text', () => {
    expect(actionKey({ type: 'copy-text', source: 'announce-post', showId: 's1', text: 'Something else entirely' })).toBe(actionKey(shares[0]));
    expect(actionKey({ type: 'email', source: 'lineup', showId: 's1', href: 'mailto:other@example.com' })).toBe(actionKey(shares[1]));
    expect(actionKey({ type: 'signing-link', contractId: 'ct1', signer: { name: 'Other', contactId: 'c1' } })).toBe(actionKey(shares[2]));
    for (const action of [...shares, ...downloads]) {
      for (const text of FREE_TEXT) expect(actionKey(action)).not.toContain(text);
    }
  });

  it('reads a list of links the same in any order', () => {
    expect(actionKey({ type: 'existing-signing-link', requestIds: ['r1', 'r2'] })).toBe(actionKey(shares[3]));
  });

  it('keeps ids from running into each other', () => {
    expect(actionKey({ type: 'headshot', subject: { kind: 'performer', showId: 'a:b', personId: 'c' } }))
      .not.toBe(actionKey({ type: 'headshot', subject: { kind: 'performer', showId: 'a', personId: 'b:c' } }));
    expect(actionKey({ type: 'existing-signing-link', requestIds: ['a,b'] })).not.toBe(actionKey({ type: 'existing-signing-link', requestIds: ['a', 'b'] }));
  });
});
