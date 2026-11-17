import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deliverFile } from '../utils/download';
import { gatherHeadshots, loadHeadshot, shareHeadshots } from '../utils/headshotExport';
import { resolveMediaUrl } from '../utils/mediaStore';
import { exportDJListToPDF, exportShowToPDF } from '../utils/pdfExport';
import { approvedLabel, prepareApproved } from './deliverApproved';
import { deliveryAllowed, setDeliveryGate } from './gates';
import { fullPerformer, fullSettings, fullShow } from './testFixtures';
import type { ApprovalResult, CoproducerRequestDetail, DownloadAction, ShareAction } from './types';

vi.mock('../utils/download', () => ({ deliverFile: vi.fn() }));
vi.mock('../utils/mediaStore', () => ({ resolveMediaUrl: vi.fn(), isMediaRef: (value: string) => value.startsWith('media:') }));
vi.mock('../utils/pdfExport', () => ({ exportShowToPDF: vi.fn(), exportDJListToPDF: vi.fn() }));
vi.mock('../utils/headshotExport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/headshotExport')>()),
  loadHeadshot: vi.fn(),
  gatherHeadshots: vi.fn(),
  shareHeadshots: vi.fn(),
}));

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const data = {
  shows: [fullShow({ performers: [fullPerformer(), fullPerformer({ id: 'p2', name: 'Guest Star', surpriseGuest: true, photo: 'media:22222222-aaaa-bbbb-cccc-000000000009#1' })] })],
  settings: fullSettings(),
};

function approved(action: ShareAction | DownloadAction, result: ApprovalResult | null = null): CoproducerRequestDetail {
  const kind = action.type in KINDS ? 'download' : 'share';
  return {
    id: 'r1',
    kind,
    status: 'approved',
    createdAt: '2026-11-01T10:00:00.000Z',
    decidedAt: '2026-11-02T10:00:00.000Z',
    usedAt: null,
    outline: { kind },
    result,
    payload: kind === 'download' ? { kind, action: action as DownloadAction } : { kind, action: action as ShareAction },
  };
}
const KINDS = { backup: 1, headshot: 1, 'headshot-pack': 1, flyer: 1, 'signed-agreement': 1, 'dj-list-text': 1, 'runsheet-pdf': 1, 'dj-list-pdf': 1 };

/** Whether the delivery gate was open at each call of the helper that hands the item over. */
let allowed: boolean[] = [];

beforeEach(() => {
  allowed = [];
  setDeliveryGate(true);
  vi.mocked(deliverFile).mockReset().mockImplementation(async () => {
    allowed.push(deliveryAllowed());
    return 'downloaded';
  });
  vi.mocked(loadHeadshot).mockReset().mockResolvedValue({ bytes: PNG, type: 'image/png' });
  vi.mocked(resolveMediaUrl).mockReset().mockResolvedValue('data:application/pdf;base64,JVBERi0xLjQK');
  vi.mocked(exportShowToPDF).mockReset().mockImplementation(() => void allowed.push(deliveryAllowed()));
  vi.mocked(exportDJListToPDF).mockReset().mockImplementation(() => void allowed.push(deliveryAllowed()));
  vi.mocked(gatherHeadshots).mockReset().mockResolvedValue({
    files: [{ performer: 'Sam Lee', fileName: 'Sam Lee.png', type: 'image/png', bytes: PNG }],
    missing: [],
  });
  vi.mocked(shareHeadshots).mockReset();
});

afterEach(() => {
  setDeliveryGate(false);
  vi.unstubAllGlobals();
});

async function fileFor(action: DownloadAction): Promise<{ name: string; blob: Blob; label: string }> {
  const prepared = await prepareApproved(approved(action), data);
  expect(prepared).not.toBeNull();
  expect(await prepared!.deliver()).toBe('done');
  const [blob, name] = vi.mocked(deliverFile).mock.calls[0];
  return { name, blob, label: prepared!.label };
}

describe('handing over an approved download', () => {
  it('builds the backup from what the co-producer can see', async () => {
    const { name, blob, label } = await fileFor({ type: 'backup' });
    expect(name).toBe(`showrunner-backup-${new Date().toISOString().slice(0, 10)}.json`);
    expect(label).toBe('Approved — tap to download');
    const file = JSON.parse(await blob.text());
    expect(file.sharedBy).toBe('co-producer view');
    expect(file.shows.map((s: { id: string }) => s.id)).toEqual(['show1']);
    expect(file.settings.brandName).toBe('Laugh Co');
    expect(allowed).toEqual([true]);
  });

  it('finds a headshot from the subject in its own data, never from the request', async () => {
    const { name, blob } = await fileFor({ type: 'headshot', subject: { kind: 'performer', showId: 'show1', personId: 'p1' } });
    expect(vi.mocked(loadHeadshot)).toHaveBeenCalledWith(fullPerformer().photo);
    expect(name).toBe('Sam Lee-headshot.png');
    expect(blob.type).toBe('image/png');

    vi.mocked(deliverFile).mockClear();
    const contact = await fileFor({ type: 'headshot', subject: { kind: 'contact', contactId: 'c1' } });
    expect(contact.name).toBe('Sam Lee-headshot.png');

    vi.mocked(deliverFile).mockClear();
    const artist = await fileFor({ type: 'headshot', subject: { kind: 'artist', showId: 'show1', personId: 'a1' } });
    expect(artist.name).toBe('Bea Painter-headshot.png');
    expect(allowed.every(Boolean)).toBe(true);
  });

  it('downloads the flyer under the show’s name', async () => {
    const { name } = await fileFor({ type: 'flyer', showId: 'show1' });
    expect(vi.mocked(loadHeadshot)).toHaveBeenCalledWith(fullShow().flyer);
    expect(name).toBe('Friday Laughs-flyer.png');
  });

  it('zips the bill’s headshots, leaving out surprise guests unless asked', async () => {
    const { name } = await fileFor({ type: 'headshot-pack', showId: 'show1', includesGuests: false });
    expect(name).toBe('Friday Laughs headshots.zip');
    expect(vi.mocked(gatherHeadshots).mock.calls[0][0].map((p) => p.id)).toEqual(['p1']);

    vi.mocked(deliverFile).mockClear();
    const guests = await fileFor({ type: 'headshot-pack', showId: 'show1', includesGuests: true });
    expect(guests.name).toBe('Friday Laughs headshots with surprise guests.zip');
    expect(vi.mocked(gatherHeadshots).mock.calls[1][0].map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  it('opens the share sheet on an iPhone, inside the allowance', async () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
      maxTouchPoints: 5,
      canShare: () => true,
      share: vi.fn(),
    });
    vi.mocked(shareHeadshots).mockImplementation(async () => {
      allowed.push(deliveryAllowed());
      return 'shared';
    });
    const prepared = await prepareApproved(approved({ type: 'headshot-pack', showId: 'show1', includesGuests: false }), data);
    expect(await prepared!.deliver()).toBe('done');
    expect(allowed).toEqual([true]);
    expect(vi.mocked(deliverFile)).not.toHaveBeenCalled();

    vi.mocked(shareHeadshots).mockResolvedValue('failed');
    expect(await prepared!.deliver()).toBe('done');
    expect(vi.mocked(deliverFile).mock.calls[0][1]).toBe('Friday Laughs headshots.zip');
  });

  it('downloads a signed agreement under its file name', async () => {
    const { name, blob } = await fileFor({ type: 'signed-agreement', agreementId: 'ag1' });
    expect(vi.mocked(resolveMediaUrl)).toHaveBeenCalledWith(data.settings.signedAgreements[0].fileRef);
    expect(name).toBe('venue.pdf');
    expect(blob.type).toBe('application/pdf');
  });

  it('writes the DJ list as text', async () => {
    const { name, blob } = await fileFor({ type: 'dj-list-text', showId: 'show1' });
    expect(name).toBe('DJ-List-Friday-Laughs.txt');
    expect(await blob.text()).toContain('Song One');
  });

  it('prints the run sheet and the DJ list inside the allowance', async () => {
    const sheet = await prepareApproved(approved({ type: 'runsheet-pdf', showId: 'show1' }), data);
    expect(sheet!.label).toBe('Approved — tap to print or save');
    expect(await sheet!.deliver()).toBe('done');
    expect(vi.mocked(exportShowToPDF)).toHaveBeenCalledWith(data.shows[0], data.settings);

    const list = await prepareApproved(approved({ type: 'dj-list-pdf', showId: 'show1' }), data);
    expect(await list!.deliver()).toBe('done');
    expect(vi.mocked(exportDJListToPDF)).toHaveBeenCalledWith(data.shows[0], data.settings.musicLibrary);
    expect(allowed).toEqual([true, true]);
  });

  it('says it did not go when the browser would not take the file', async () => {
    vi.mocked(deliverFile).mockResolvedValueOnce('cancelled').mockResolvedValueOnce('failed').mockRejectedValueOnce(new Error('no'));
    const prepared = await prepareApproved(approved({ type: 'backup' }), data);
    expect(await prepared!.deliver()).toBe('cancelled');
    expect(await prepared!.deliver()).toBe('failed');
    expect(await prepared!.deliver()).toBe('failed');
  });

  it('gives null when the thing asked for is no longer there', async () => {
    const gone: DownloadAction[] = [
      { type: 'flyer', showId: 'nope' },
      { type: 'headshot', subject: { kind: 'performer', showId: 'show1', personId: 'nope' } },
      { type: 'headshot', subject: { kind: 'contact', contactId: 'nope' } },
      { type: 'headshot-pack', showId: 'nope', includesGuests: false },
      { type: 'signed-agreement', agreementId: 'nope' },
      { type: 'dj-list-text', showId: 'nope' },
      { type: 'runsheet-pdf', showId: 'nope' },
      { type: 'dj-list-pdf', showId: 'nope' },
    ];
    for (const action of gone) expect(await prepareApproved(approved(action), data), action.type).toBeNull();
    const noFlyer = { ...data, shows: [fullShow({ flyer: '' })] };
    expect(await prepareApproved(approved({ type: 'flyer', showId: 'show1' }), noFlyer)).toBeNull();
    expect(await prepareApproved({ ...approved({ type: 'backup' }), kind: 'edit', payload: { kind: 'edit', shows: [], settings: null } }, data)).toBeNull();
  });

  it('rejects when a file will not load, so it can be tried again', async () => {
    vi.mocked(loadHeadshot).mockResolvedValue(null);
    await expect(prepareApproved(approved({ type: 'flyer', showId: 'show1' }), data)).rejects.toThrow();
    vi.mocked(loadHeadshot).mockResolvedValue({ bytes: new Uint8Array([1, 2]), type: 'text/html' });
    await expect(prepareApproved(approved({ type: 'flyer', showId: 'show1' }), data)).rejects.toThrow();
    vi.mocked(resolveMediaUrl).mockResolvedValue(null);
    await expect(prepareApproved(approved({ type: 'signed-agreement', agreementId: 'ag1' }), data)).rejects.toThrow();
  });
});

describe('handing over an approved share', () => {
  it('copies the text the request carries', async () => {
    const writeText = vi.fn(async () => {
      allowed.push(deliveryAllowed());
    });
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const prepared = await prepareApproved(approved({ type: 'copy-text', source: 'announce-post', showId: 'show1', text: 'Tonight!' }), data);
    expect(prepared!.label).toBe('Approved — tap to copy');
    expect(await prepared!.deliver()).toBe('done');
    expect(writeText).toHaveBeenCalledWith('Tonight!');
    expect(allowed).toEqual([true]);
  });

  it('opens the email, and only a mailto: link', async () => {
    const location = { href: 'https://coproduce.example/coproduce' };
    vi.stubGlobal('window', { location });
    const href = 'mailto:sam@example.com?subject=Hi';
    const prepared = await prepareApproved(approved({ type: 'email', source: 'person', href }), data);
    expect(prepared!.label).toBe('Approved — tap to open email');
    expect(await prepared!.deliver()).toBe('done');
    expect(location.href).toBe(href);
    expect(await prepareApproved(approved({ type: 'email', source: 'person', href: 'javascript:alert(1)' }), data)).toBeNull();
  });

  it('shares the one link the owner’s app made', async () => {
    const share = vi.fn(async () => {
      allowed.push(deliveryAllowed());
    });
    vi.stubGlobal('navigator', { share });
    const link = { label: '“Performer Agreement” for Sam Lee', url: 'https://icanrunashow.com/sign?t=abc#k=def' };
    const prepared = await prepareApproved(
      approved({ type: 'signing-link', contractId: 'ct1', signer: { name: 'Sam Lee' } }, { links: [link] }),
      data,
    );
    expect(prepared!.label).toBe('Approved — tap to share');
    expect(await prepared!.deliver()).toBe('done');
    expect(share).toHaveBeenCalledWith({ title: link.label, url: link.url });
    expect(allowed).toEqual([true]);

    share.mockRejectedValueOnce(Object.assign(new Error('closed'), { name: 'AbortError' }));
    expect(await prepared!.deliver()).toBe('cancelled');
  });

  it('copies several links as the owner’s text', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const result: ApprovalResult = {
      links: [{ label: 'Sam', url: 'https://icanrunashow.com/sign?t=1' }, { label: 'Jo', url: 'https://icanrunashow.com/sign?t=2' }],
      text: 'Sam — https://icanrunashow.com/sign?t=1\nJo — https://icanrunashow.com/sign?t=2',
    };
    const prepared = await prepareApproved(approved({ type: 'existing-signing-link', requestIds: ['a', 'b'] }, result), data);
    expect(prepared!.label).toBe('Approved — tap to copy');
    await prepared!.deliver();
    expect(writeText).toHaveBeenCalledWith(result.text);
  });

  it('gives null for a link share with no usable link', async () => {
    const viewer: ShareAction = { type: 'viewer-link', showId: 'show1' };
    expect(await prepareApproved(approved(viewer), data)).toBeNull();
    expect(await prepareApproved(approved(viewer, { links: [{ label: 'x', url: 'javascript:alert(1)' }] }), data)).toBeNull();
  });
});

describe('what an approved control says', () => {
  it('names the hand-over for each kind of action', () => {
    expect(approvedLabel({ type: 'flyer', showId: 's' })).toBe('Approved — tap to download');
    expect(approvedLabel({ type: 'backup' })).toBe('Approved — tap to download');
    expect(approvedLabel({ type: 'runsheet-pdf', showId: 's' })).toBe('Approved — tap to print or save');
    expect(approvedLabel({ type: 'dj-list-pdf', showId: 's' })).toBe('Approved — tap to print or save');
    expect(approvedLabel({ type: 'copy-text', source: 'season-pitch', text: 'x' })).toBe('Approved — tap to copy');
    expect(approvedLabel({ type: 'email', source: 'lineup', href: 'mailto:a@b.c' })).toBe('Approved — tap to open email');
    expect(approvedLabel({ type: 'viewer-link', showId: 's' })).toBe('Approved — tap to share');
    expect(approvedLabel({ type: 'existing-signing-link', requestIds: ['a'] })).toBe('Approved — tap to share');
    expect(approvedLabel({ type: 'existing-signing-link', requestIds: ['a', 'b'] })).toBe('Approved — tap to copy');
    expect(approvedLabel({ type: 'existing-signing-link', requestIds: ['a', 'b'] }, { links: [{ label: 'a', url: 'https://x.example/' }] })).toBe('Approved — tap to share');
  });
});
