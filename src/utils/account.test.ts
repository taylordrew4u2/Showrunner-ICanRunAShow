import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type AppSettings, type ProfileRequest, type Show, type SignatureRequest } from '../types';
import { accountTokens } from './account';

const show = (id: string, viewToken?: string) => ({ id, name: id, viewToken }) as unknown as Show;

describe('the links an account names when it is deleted', () => {
  it('are every link its data says it handed out, trashed shows included, each once', () => {
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      trash: [{ id: 't1', type: 'show', data: show('gone', 'view-trashed'), deletedAt: '2026-10-01' }],
      signatureRequests: [{ token: 'contract-link-0001' } as SignatureRequest],
      profileRequests: [{ token: 'profile-link-0001' } as ProfileRequest],
    };
    const shows = [show('a', 'view-a'), show('b'), show('c', 'view-a')];
    expect(accountTokens(shows, settings).sort()).toEqual(
      ['contract-link-0001', 'profile-link-0001', 'view-a', 'view-trashed'],
    );
  });

  it('leave out anything the server would refuse the whole request over', () => {
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      signatureRequests: [{ token: 'x'.repeat(129) } as SignatureRequest, { token: '' } as SignatureRequest],
    };
    expect(accountTokens([], settings)).toEqual([]);
    const many = Array.from({ length: 6000 }, (_, i) => show(`s${i}`, `view-${i}`));
    expect(accountTokens(many, DEFAULT_SETTINGS)).toHaveLength(5000);
  });
});
