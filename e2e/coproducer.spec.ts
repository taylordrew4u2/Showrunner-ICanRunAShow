import { expect, test, type Page } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Show } from '../src/types';
import { decryptWithKey } from '../src/utils/encryption';
import {
  addCoproducerLink,
  decideCoproducerRequest,
  emptyState,
  installFakeApi,
  readCoproducerRequest,
} from './support/fake-api.mjs';
import { daysFromNow, gotoTab, signUpAndOnboard } from './support/app';
import { accountKeys, MAIN_ORIGIN, openAsCoproducer, REVIEW_ORIGIN } from './support/coproducer';

/**
 * Co-producer view, end to end: a second producer opens the owner's account
 * from a link, sees everything, and every change, share and download they
 * make becomes a request the owner decides on. Nothing they do reaches the
 * account itself.
 */

const SHOW = 'Friday Laughs';
const VENUE = 'The Basement';

/** A 1×1 PNG, for headshots and flyers. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

/** The start of an .m4a: an ftyp box naming the M4A brand, which is all the sniffing reads. */
const M4A = Buffer.concat([
  Buffer.from([0, 0, 0, 0x20]),
  Buffer.from('ftypM4A \0\0\0\0M4A mp42isom\0\0\0\0', 'latin1'),
  Buffer.alloc(64),
]);

/** A one-page PDF, as contract-from-show.spec.ts writes one. */
function writeTestPdf(): string {
  const body = 'BT /F1 16 Tf 72 700 Td (Performer Agreement) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${body.length} >>\nstream\n${body}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const path = join(mkdtempSync(join(tmpdir(), 'showrunner-e2e-')), 'agreement.pdf');
  writeFileSync(path, out, 'latin1');
  return path;
}

/** The owner signs up and makes a show with a venue, a performer with a headshot and a flyer, and a contract to send. */
async function ownerWithShow(page: Page) {
  const state = emptyState();
  await installFakeApi(page.context(), state);
  await signUpAndOnboard(page);
  await gotoTab(page, 'More');
  await page.locator('.more-item').filter({ hasText: 'Contracts' }).click();
  await page.locator('.contracts__file').setInputFiles(writeTestPdf());
  await expect(page.locator('.contracts__item-name')).toHaveText('agreement');
  await gotoTab(page, 'Shows');
  await page.locator('button').filter({ hasText: /New Show/i }).first().click();
  await page.getByPlaceholder('Show name').fill(SHOW);
  await page.locator('input[type=date]').fill(daysFromNow(10));
  await page.getByPlaceholder('Venue name').fill(VENUE);
  await page.locator('button').filter({ hasText: /^Save$/ }).last().click();
  await expect(page.getByRole('heading', { name: SHOW, level: 1 })).toBeVisible();
  await page.locator('#show-section-header-performers').click();
  const toggle = page.locator('.lineup-add__toggle');
  if ((await toggle.count()) && /Add performer/.test((await toggle.textContent()) ?? '')) await toggle.click();
  await page.locator('.lineup-add__name').fill('Sam Lee');
  await page.locator('.lineup-add__submit').click();
  await page.getByRole('button', { name: "Open Sam Lee's profile" }).click();
  const profile = page.getByRole('dialog', { name: "Sam Lee's profile" });
  const headshot = page.waitForEvent('filechooser');
  await profile.getByRole('region', { name: 'Headshot' }).getByRole('button', { name: /Upload headshot/ }).click();
  await (await headshot).setFiles({ name: 'sam.png', mimeType: 'image/png', buffer: PNG });
  await expect(profile.getByRole('button', { name: "View Sam Lee's headshot" })).toBeVisible();
  await profile.getByRole('button', { name: 'Performers' }).click();
  const flyer = page.waitForEvent('filechooser');
  await page.getByRole('region', { name: 'Flyer' }).getByRole('button', { name: /Upload flyer/ }).click();
  await (await flyer).setFiles({ name: 'flyer.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByRole('region', { name: 'Flyer' }).getByRole('button', { name: 'Download' })).toBeVisible();
  const keys = accountKeys();
  // The show, its performer and its flyer are on the server before the link
  // is opened: the co-producer's view is what the server holds.
  await expect.poll(() => {
    const saved = state.shows[0] ? decryptWithKey<Show>(state.shows[0].encryptedData, keys.key) : null;
    return Boolean(saved?.flyer) && Boolean(saved?.performers[0]?.photo);
  }).toBe(true);
  await expect(page.locator('.sync-status--saved')).toBeVisible();
  const token = addCoproducerLink(state, { ...keys, label: 'Sam Rivera', expiresAt: Date.now() + 86_400_000 });
  return { state, keys, token };
}

/** The requests the fake holds, oldest first (they are kept by id, as the table is). */
function storedRequests(state: ReturnType<typeof emptyState>) {
  return Object.values(state.coproducerRequests).sort((a, b) => a.order - b.order);
}

/** Every request a page makes, for asserting on what left it. */
function watchRequests(page: Page) {
  const seen: { method: string; url: string; headers: Record<string, string> }[] = [];
  page.context().on('request', (request) => seen.push({ method: request.method(), url: request.url(), headers: request.headers() }));
  return seen;
}

async function openShow(page: Page, name = SHOW) {
  await page.locator('.show-card, .dash button').filter({ hasText: name }).first().click();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
}

test.describe('co-producer view', () => {
  test('a main-origin link lands on the review origin, read-only, with the token out of the address', async ({ page, browser }) => {
    const { state, token } = await ownerWithShow(page);
    const coproducer = await openAsCoproducer(browser, state, token);
    expect(coproducer.url()).toBe(`${REVIEW_ORIGIN}/coproduce`);
    await expect(coproducer.getByText(SHOW).first()).toBeVisible();
    await expect(coproducer.getByPlaceholder('Enter your password')).toHaveCount(0);
  });

  test('a change is reviewed against what is there now, sent for approval, and shown pending in place', async ({ page, browser }) => {
    const { state, keys, token } = await ownerWithShow(page);
    const before = JSON.stringify(state.shows);
    const coproducer = await openAsCoproducer(browser, state, token);
    await openShow(coproducer);
    await coproducer.locator('#show-section-header-basic').click();
    await coproducer.getByPlaceholder('Venue name').fill('The Attic');
    await expect(coproducer.getByText('1 change not sent yet')).toBeVisible();
    await coproducer.getByRole('button', { name: 'Review & send' }).click();
    const dialog = coproducer.getByRole('dialog');
    await expect(dialog.getByText('Venue name')).toBeVisible();
    await expect(dialog.getByText(VENUE)).toBeVisible();
    await expect(dialog.getByText('The Attic')).toBeVisible();
    await dialog.getByRole('button', { name: 'Send for approval' }).click();
    await expect(dialog.getByText('Sent for approval')).toBeVisible();
    await dialog.getByRole('button', { name: 'OK' }).click();
    await expect(coproducer.getByPlaceholder('Venue name')).toHaveValue(VENUE);
    await expect(coproducer.getByText('Pending approval').first()).toBeVisible();
    await expect(coproducer.getByText('The Attic').first()).toBeVisible();
    expect(JSON.stringify(state.shows)).toBe(before);
    const [stored] = storedRequests(state);
    const read = readCoproducerRequest(state, stored.id, keys.key);
    expect(read.status).toBe('pending');
    expect(read.payload.shows[0].keys).toEqual(['venueName']);
    expect(JSON.stringify(read.payload)).not.toContain('viewerKey');
  });

  test('changes on two screens go out as one request after one review', async ({ page, browser }) => {
    const { state, keys, token } = await ownerWithShow(page);
    const coproducer = await openAsCoproducer(browser, state, token);
    await openShow(coproducer);
    await coproducer.locator('#show-section-header-basic').click();
    await coproducer.getByPlaceholder('Venue name').fill('The Attic');
    await gotoTab(coproducer, 'Rolodex');
    await coproducer.getByRole('button', { name: "Open Sam Lee's full profile" }).click();
    await coproducer.getByLabel('Notes').fill('Closes strong.');
    await coproducer.getByRole('button', { name: 'Save Changes' }).click();
    // The unsent bar steps aside while a dialog is open, as the status rail does.
    await coproducer.getByRole('dialog', { name: "Sam Lee's profile" }).getByRole('button', { name: '← Back' }).click();
    await coproducer.getByRole('button', { name: 'Review & send' }).click();
    await coproducer.getByRole('dialog').getByRole('button', { name: 'Send for approval' }).click();
    await expect(coproducer.getByRole('heading', { name: 'Sent for approval' })).toBeVisible();
    expect(storedRequests(state)).toHaveLength(1);
    const read = readCoproducerRequest(state, storedRequests(state)[0].id, keys.key);
    expect(read.payload.shows).toHaveLength(1);
    expect(read.payload.settings.fields.map((f: { field: string }) => f.field)).toContain('potentialComics');
  });

  test('downloads are asked for, and handed over once approved', async ({ page, browser }) => {
    const { state, keys, token } = await ownerWithShow(page);
    const coproducer = await openAsCoproducer(browser, state, token);
    await openShow(coproducer);
    let downloads = 0;
    coproducer.on('download', () => { downloads += 1; });
    const profile = coproducer.getByRole('dialog', { name: "Sam Lee's profile" });
    const openProfile = async () => {
      await coproducer.locator('#show-section-header-performers').click();
      await coproducer.getByRole('button', { name: "Open Sam Lee's profile" }).click();
      await expect(profile).toBeVisible();
    };
    const headshot = () => profile.getByRole('region', { name: 'Headshot' });
    const flyer = () => coproducer.getByRole('region', { name: 'Flyer' });

    await openProfile();
    await headshot().getByRole('button', { name: 'Download headshot' }).click();
    await expect(coproducer.getByText('Asked for approval')).toBeVisible();
    await coproducer.getByRole('dialog', { name: 'Asked for approval' }).getByRole('button', { name: 'OK' }).click();
    await expect(headshot().getByRole('button', { name: 'Pending approval' })).toBeVisible();
    await profile.getByRole('button', { name: 'Performers' }).click();
    await flyer().getByRole('button', { name: 'Download' }).click();
    await expect(coproducer.getByText('Asked for approval')).toBeVisible();
    await coproducer.getByRole('dialog').getByRole('button', { name: 'OK' }).click();
    await expect(flyer().getByRole('button', { name: 'Pending approval' })).toBeVisible();
    expect(downloads).toBe(0);
    const ids = storedRequests(state).map((request) => request.id);
    expect(ids).toHaveLength(2);
    for (const id of ids) decideCoproducerRequest(state, id, 'approved');

    await coproducer.reload();
    await openShow(coproducer);
    const approvedFlyer = flyer().getByRole('button', { name: 'Approved — tap to download' });
    await expect(approvedFlyer).toBeVisible();
    const flyerFile = coproducer.waitForEvent('download');
    await approvedFlyer.click();
    expect((await flyerFile).suggestedFilename()).toContain('flyer');
    await expect(flyer().getByRole('button', { name: 'Download' })).toBeVisible();

    await openProfile();
    const approvedHeadshot = headshot().getByRole('button', { name: 'Approved — tap to download' });
    await expect(approvedHeadshot).toBeVisible();
    const headshotFile = coproducer.waitForEvent('download');
    await approvedHeadshot.click();
    expect((await headshotFile).suggestedFilename()).toContain('Sam Lee');
    await expect(headshot().getByRole('button', { name: 'Download headshot' })).toBeVisible();
    for (const id of ids) expect(readCoproducerRequest(state, id, keys.key).usedAt).not.toBeNull();
  });

  test('two quick taps on a slow connection ask once', async ({ page, browser }) => {
    const { state, token } = await ownerWithShow(page);
    const coproducer = await openAsCoproducer(browser, state, token);
    // Venue wifi: the ask takes a second and a half to come back.
    await coproducer.route((url) => url.pathname === '/api/coproducer' && url.searchParams.get('route') === 'requests', async (route) => {
      if (route.request().method() === 'POST') await new Promise((resolve) => setTimeout(resolve, 1_500));
      await route.fallback();
    });
    await gotoTab(coproducer, 'Settings');
    const backup = coproducer.locator('.settings__backup-btn');
    // Both taps land before the page can redraw.
    await backup.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
    await expect(backup).toHaveText('Sending…');
    await expect(backup).toBeDisabled();
    await coproducer.getByRole('dialog', { name: 'Asked for approval' }).getByRole('button', { name: 'OK' }).click();
    await expect(backup.getByText('Pending approval')).toBeVisible();
    expect(storedRequests(state)).toHaveLength(1);
  });

  test('a question that asks the owner nothing keeps its own buttons', async ({ page, browser }) => {
    const { state, token } = await ownerWithShow(page);
    const coproducer = await openAsCoproducer(browser, state, token);
    await gotoTab(coproducer, 'Settings');
    await coproducer.getByLabel('Brand name').fill('Basement Comedy');
    await gotoTab(coproducer, 'Shows');
    const leave = coproducer.getByRole('dialog', { name: 'Leave without saving?' });
    await expect(leave).toBeVisible();
    await expect(leave.getByRole('button', { name: 'Stay' })).toBeVisible();
    await expect(leave.getByRole('button', { name: 'Leave' })).toBeVisible();
    await expect(leave.getByText(/Ask the owner|owner approves/)).toHaveCount(0);
    await leave.getByRole('button', { name: 'Stay' }).click();
    await expect(coproducer.getByLabel('Brand name')).toHaveValue('Basement Comedy');
    expect(storedRequests(state)).toHaveLength(0);
  });

  test('on a desktop the unsent bar sits above the show page, not under its Run Show bar', async ({ page, browser }) => {
    const { state, token } = await ownerWithShow(page);
    const coproducer = await openAsCoproducer(browser, state, token);
    await coproducer.setViewportSize({ width: 1280, height: 720 });
    await openShow(coproducer);
    await coproducer.locator('#show-section-header-basic').click();
    await coproducer.getByPlaceholder('Venue name').fill('The Attic');
    const count = coproducer.getByText('1 change not sent yet');
    await expect(count).toBeVisible();
    const topbar = coproducer.locator('.show-detail__topbar').first();
    const onTop = async () => {
      const box = await count.boundingBox();
      if (!box) return 'no box';
      return coproducer.evaluate(({ x, y }) => {
        const hit = document.elementFromPoint(x, y);
        return hit?.closest('.unsent-bar') ? 'bar' : hit?.closest('[class]')?.getAttribute('class') ?? 'nothing';
      }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    };
    await expect.poll(onTop).toBe('bar');
    // The Run Show bar is below the unsent bar, not under it: its controls still take a tap.
    const bar = await coproducer.locator('.unsent-bar').boundingBox();
    const top = await topbar.boundingBox();
    expect(bar && top && top.y >= bar.y + bar.height - 1).toBe(true);
    // And it stays that way with the page scrolled and the Run Show bar pinned.
    await coproducer.locator('.app-main').evaluate((main) => main.scrollBy(0, 600));
    await expect.poll(onTop).toBe('bar');
    const pinned = await topbar.boundingBox();
    const barNow = await coproducer.locator('.unsent-bar').boundingBox();
    expect(pinned && barNow && pinned.y >= barNow.y + barNow.height - 1).toBe(true);
  });

  test('sending a contract asks for a signing link and touches no signing route', async ({ page, browser }) => {
    const { state, keys, token } = await ownerWithShow(page);
    const coproducer = await openAsCoproducer(browser, state, token);
    const seen = watchRequests(coproducer);
    await openShow(coproducer);
    await coproducer.locator('#show-section-header-performers').click();
    await coproducer.getByRole('button', { name: "Open Sam Lee's profile" }).click();
    await coproducer.getByRole('button', { name: 'Send agreement' }).click();
    await expect(coproducer.getByText('Asked for approval')).toBeVisible();
    expect(seen.some((r) => /^\/api\/sign(-doc)?$/.test(new URL(r.url).pathname))).toBe(false);
    const read = readCoproducerRequest(state, storedRequests(state)[0].id, keys.key);
    expect(read.payload).toMatchObject({ kind: 'share', action: { type: 'signing-link', signer: { name: 'Sam Lee' } } });
    expect(read.payload.action.contractId).toEqual(expect.any(String));
  });

  test('nothing but the co-producer route is written to, and no request carries the owner’s credential', async ({ page, browser }) => {
    const { state, token } = await ownerWithShow(page);
    const coproducer = await openAsCoproducer(browser, state, token);
    const seen = watchRequests(coproducer);
    await openShow(coproducer);
    // An edit.
    await coproducer.locator('#show-section-header-basic').click();
    await coproducer.getByPlaceholder('Venue name').fill('Upstairs');
    // A download.
    await coproducer.getByRole('region', { name: 'Flyer' }).getByRole('button', { name: 'Download' }).click();
    await coproducer.getByRole('dialog').getByRole('button', { name: 'OK' }).click();
    // An upload and a share, from the performer's profile.
    await coproducer.locator('#show-section-header-performers').click();
    await coproducer.getByRole('button', { name: "Open Sam Lee's profile" }).click();
    const profile = coproducer.getByRole('dialog', { name: "Sam Lee's profile" });
    const chooser = coproducer.waitForEvent('filechooser');
    await profile.getByRole('region', { name: 'Headshot' }).getByRole('button', { name: /Replace headshot/ }).click();
    await (await chooser).setFiles({ name: 'new.png', mimeType: 'image/png', buffer: PNG });
    await expect.poll(() => Object.keys(state.coproducerMedia).length).toBe(1);
    await profile.getByRole('button', { name: 'Send agreement' }).click();
    await expect(coproducer.getByText('Asked for approval')).toBeVisible();
    await coproducer.getByRole('dialog', { name: 'Asked for approval' }).getByRole('button', { name: 'OK' }).click();
    await profile.getByRole('button', { name: 'Performers' }).click();
    await coproducer.getByRole('button', { name: 'Review & send' }).click();
    await coproducer.getByRole('dialog').getByRole('button', { name: 'Send for approval' }).click();
    await expect(coproducer.getByRole('heading', { name: 'Sent for approval' })).toBeVisible();
    expect(storedRequests(state).map((request) => request.kind).sort()).toEqual(['download', 'edit', 'share']);
    const writes = seen.filter((request) => request.method !== 'GET' && new URL(request.url).pathname.startsWith('/api/'));
    expect(writes.length).toBeGreaterThan(0);
    for (const request of writes) expect(new URL(request.url).pathname).toBe('/api/coproducer');
    for (const request of seen) expect(request.headers['x-auth']).toBeUndefined();
  });

  test('withdrawing a request removes it and its marks', async ({ page, browser }) => {
    const { state, token } = await ownerWithShow(page);
    const coproducer = await openAsCoproducer(browser, state, token);
    await openShow(coproducer);
    await coproducer.locator('#show-section-header-basic').click();
    await coproducer.getByPlaceholder('Venue name').fill('The Attic');
    await coproducer.getByRole('button', { name: 'Review & send' }).click();
    await coproducer.getByRole('dialog').getByRole('button', { name: 'Send for approval' }).click();
    await coproducer.getByRole('dialog').getByRole('button', { name: 'OK' }).click();
    await expect(coproducer.locator('.pending-pill').first()).toBeVisible();
    await expect(coproducer.getByText('The Attic').first()).toBeVisible();
    await coproducer.getByRole('button', { name: /^Pending approval/ }).first().click();
    await coproducer.getByRole('button', { name: 'Withdraw' }).first().click();
    await coproducer.getByRole('dialog').getByRole('button', { name: 'Withdraw' }).last().click();
    await expect.poll(() => storedRequests(state)[0]?.status).toBe('withdrawn');
    await coproducer.keyboard.press('Escape');
    await expect(coproducer.locator('.pending-pill')).toHaveCount(0);
    await expect(coproducer.getByText('The Attic')).toHaveCount(0);
  });

  test('a withdrawn link says it has ended', async ({ page, browser }) => {
    const { state, token } = await ownerWithShow(page);
    const coproducer = await openAsCoproducer(browser, state, token);
    // As the owner's Withdraw does: the link's row goes.
    for (const id of Object.keys(state.coproducerLinks)) delete state.coproducerLinks[id];
    await coproducer.reload();
    await expect(coproducer.getByText('This co-producer link has ended')).toBeVisible();
  });

  test('an owner signed in on the main origin is untouched, and the review origin opens nothing else', async ({ page }) => {
    const { state, token } = await ownerWithShow(page);
    await page.goto(`${MAIN_ORIGIN}/coproduce#t=${token}`);
    await expect(page.getByText('Co-producer view').first()).toBeVisible({ timeout: 30_000 });
    expect(page.url()).toBe(`${REVIEW_ORIGIN}/coproduce`);
    await page.goto(`${REVIEW_ORIGIN}/`);
    await expect(page.getByText('This address only opens co-producer links')).toBeVisible();
    await page.goto(`${REVIEW_ORIGIN}/coproduce`);
    await gotoTab(page, 'Settings');
    await page.getByRole('button', { name: 'Leave co-producer view' }).click();
    await expect(page).toHaveURL(`${MAIN_ORIGIN}/`);
    await expect(page.getByText(SHOW).first()).toBeVisible();
    void state;
  });

  test('a session left on the review origin from when it served the whole app is never restored', async ({ page }) => {
    await installFakeApi(page.context(), emptyState());
    await page.goto(`${REVIEW_ORIGIN}/`);
    await expect(page.getByText('This address only opens co-producer links')).toBeVisible();
    // The oldest kind of stored session, which restoring would rewrite at once.
    const stored = JSON.stringify({ username: 'producer', password: 'left-behind-1' });
    await page.evaluate((value) => localStorage.setItem('showrunner_session', value), stored);
    const seen = watchRequests(page);
    for (const path of ['/', '/coproduce']) {
      await page.goto(`${REVIEW_ORIGIN}${path}`);
      await expect(page.getByRole('link', { name: 'Go to I Can Run A Show' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Go to I Can Run A Show' })).toHaveAttribute('href', `${MAIN_ORIGIN}/`);
      await expect(page.getByPlaceholder('Enter username')).toHaveCount(0);
    }
    expect(await page.evaluate(() => [localStorage.getItem('showrunner_session'), localStorage.getItem('showrunner:session:v2')])).toEqual([stored, null]);
    for (const request of seen) {
      expect(request.headers['x-auth'], request.url).toBeUndefined();
      expect(request.headers['x-user-id'], request.url).toBeUndefined();
    }
  });

  test('a new headshot is staged with the request, relabelled by its bytes, and never stored', async ({ page, browser }) => {
    const { state, keys, token } = await ownerWithShow(page);
    const mediaBefore = Object.keys(state.media).length;
    const coproducer = await openAsCoproducer(browser, state, token);
    await openShow(coproducer);
    await coproducer.locator('#show-section-header-performers').click();
    await coproducer.getByRole('button', { name: "Open Sam Lee's profile" }).click();
    const profile = coproducer.getByRole('dialog', { name: "Sam Lee's profile" });
    const chooser = coproducer.waitForEvent('filechooser');
    await profile.getByRole('region', { name: 'Headshot' }).getByRole('button', { name: /Replace headshot/ }).click();
    await (await chooser).setFiles({ name: 'sam.png', mimeType: 'image/png', buffer: PNG });
    await expect.poll(() => Object.keys(state.coproducerMedia).length).toBe(1);
    // A browser labels an .m4a as video/mp4; it is staged as what its bytes say.
    const audio = coproducer.waitForEvent('filechooser');
    await profile.getByRole('button', { name: 'Upload walk-on audio file' }).click();
    await (await audio).setFiles({ name: 'walk-on.m4a', mimeType: 'video/mp4', buffer: M4A });
    await expect(profile.locator('.perf-profile__audio-file-name')).toHaveText('walk-on.m4a');
    await profile.getByRole('button', { name: 'Performers' }).click();
    await expect(coproducer.getByText(/^\d+ changes not sent yet$/)).toBeVisible();
    await coproducer.getByRole('button', { name: 'Review & send' }).click();
    await coproducer.getByRole('dialog').getByRole('button', { name: 'Send for approval' }).click();
    await expect(coproducer.getByRole('heading', { name: 'Sent for approval' })).toBeVisible();
    expect(Object.keys(state.media)).toHaveLength(mediaBefore);
    const [stored] = storedRequests(state);
    const read = readCoproducerRequest(state, stored.id, keys.key);
    expect(stored.mediaIds).toHaveLength(2);
    for (const id of stored.mediaIds) expect(JSON.stringify(read.payload)).toContain(id);
    const types = stored.mediaIds.map((id) => {
      const head = decryptWithKey<string>(state.coproducerMedia[id].chunks[0].data, keys.key);
      return /^data:([^;,]+);base64,/.exec(head)?.[1];
    });
    expect(types).toContain('audio/mp4');
    expect(types.filter((type) => type?.startsWith('image/'))).toHaveLength(1);
  });

  test('browsing every screen sends nothing and never shows the unsent bar', async ({ page, browser }) => {
    const { state, token } = await ownerWithShow(page);
    const coproducer = await openAsCoproducer(browser, state, token);
    // The unsent bar itself: Contracts also says "not sent yet" of a contract nobody has been sent.
    const unsent = coproducer.getByRole('region', { name: 'Changes not sent yet' });
    // The Shows list, as a list and as a calendar.
    await coproducer.getByRole('button', { name: 'Calendar view' }).click();
    await coproducer.getByRole('button', { name: 'List view' }).click();
    // A show with every section open, and Run Show opened and closed without pressing anything.
    await openShow(coproducer);
    for (const header of await coproducer.locator('.accordion-section__header').all()) await header.click();
    await coproducer.getByRole('button', { name: 'Run Show' }).first().click();
    await coproducer.keyboard.press('Escape');
    await expect(unsent).toHaveCount(0);
    // The Rolodex and a profile drawer.
    await gotoTab(coproducer, 'Rolodex');
    await coproducer.getByRole('button', { name: "Open Sam Lee's full profile" }).click();
    await coproducer.getByRole('dialog', { name: "Sam Lee's profile" }).getByRole('button', { name: '← Back' }).click();
    await expect(unsent).toHaveCount(0);
    for (const tab of ['Music', 'Shows']) {
      await gotoTab(coproducer, tab);
      await expect(unsent).toHaveCount(0);
    }
    // More, and each page it leads to.
    for (const destination of ['Contracts', 'Email list', 'Expenses', 'Season report']) {
      await gotoTab(coproducer, 'More');
      await coproducer.locator('.more-item').filter({ hasText: destination }).click();
      await expect(unsent).toHaveCount(0);
    }
    await gotoTab(coproducer, 'Settings');
    await expect(unsent).toHaveCount(0);
    expect(storedRequests(state)).toHaveLength(0);
    expect(Object.keys(state.coproducerMedia)).toHaveLength(0);
  });

  test('the link page carries no canonical address and says what it is', async ({ request }) => {
    const response = await request.get(`${MAIN_ORIGIN}/coproduce`);
    const html = await response.text();
    expect(html).not.toContain('rel="canonical"');
    expect(html).not.toContain('og:url');
    expect(html).toContain('A shared show account');
  });

  test('offline, nothing can be sent; an unsent change survives a reload as a draft', async ({ page, browser }) => {
    const { state, token } = await ownerWithShow(page);
    const coproducer = await openAsCoproducer(browser, state, token);
    await openShow(coproducer);
    await coproducer.locator('#show-section-header-basic').click();
    await coproducer.getByPlaceholder('Venue name').fill('The Attic');
    await coproducer.context().setOffline(true);
    await expect(coproducer.getByText(/Offline — changes can't be sent for approval/).first()).toBeVisible();
    await coproducer.getByRole('button', { name: 'Review & send' }).click();
    const dialog = coproducer.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: 'Send for approval' })).toBeDisabled();
    await coproducer.context().setOffline(false);
    await expect(dialog.getByRole('button', { name: 'Send for approval' })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Send for approval' }).click();
    await expect(coproducer.getByRole('heading', { name: 'Sent for approval' })).toBeVisible();
    await dialog.getByRole('button', { name: 'OK' }).click();
    expect(storedRequests(state)).toHaveLength(1);

    // A change left unsent when the page is put away comes back after a reload.
    await coproducer.getByPlaceholder('Venue name').fill('The Loft');
    await expect(coproducer.getByText('1 change not sent yet')).toBeVisible();
    await coproducer.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await coproducer.waitForTimeout(500);
    await coproducer.reload();
    await expect(coproducer.getByText('Changes you didn’t send').or(coproducer.getByText("Changes you didn't send"))).toBeVisible();
    await coproducer.getByRole('dialog').getByRole('button', { name: 'Send for approval' }).click();
    await expect(coproducer.getByRole('heading', { name: 'Sent for approval' })).toBeVisible();
    expect(storedRequests(state)).toHaveLength(2);
  });
});
