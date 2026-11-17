import { expect, test, type Page } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPseudonymIndex, viewOfShow } from '../src/coproducer/redaction';
import type { EditPayload, RequestPayload, ShowKey } from '../src/coproducer/types';
import type { AppSettings, Show } from '../src/types';
import { decryptWithKey, encryptWithKey } from '../src/utils/encryption';
import {
  addCoproducerLink,
  addCoproducerRequest,
  emptyState,
  installFakeApi,
  readCoproducerRequest,
} from './support/fake-api.mjs';
import { daysFromNow, gotoTab, signUpAndOnboard } from './support/app';
import { accountKeys, MAIN_ORIGIN } from './support/coproducer';

/**
 * The owner's side of co-producer links: making and withdrawing a link in
 * Settings, and going through what a co-producer asked for on the Requests
 * page. Requests are seeded straight into the fake server, as a
 * co-producer's app would have sent them, so each case can be exactly the
 * one it is about.
 */

const SHOW = 'Friday Laughs';
const VENUE = 'The Basement';

type State = ReturnType<typeof emptyState>;

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

/** The owner signs up and makes a show with a venue. */
async function ownerWithShow(page: Page): Promise<{ state: State; keys: ReturnType<typeof accountKeys> }> {
  const state = emptyState();
  await installFakeApi(page.context(), state);
  await signUpAndOnboard(page);
  await page.locator('button').filter({ hasText: /New Show/i }).first().click();
  await page.getByPlaceholder('Show name').fill(SHOW);
  await page.locator('input[type=date]').fill(daysFromNow(10));
  await page.getByPlaceholder('Venue name').fill(VENUE);
  await page.locator('button').filter({ hasText: /^Save$/ }).last().click();
  await expect(page.getByRole('heading', { name: SHOW, level: 1 })).toBeVisible();
  await expect.poll(() => state.shows.length).toBe(1);
  await expect(page.locator('.sync-status--saved')).toBeVisible();
  return { state, keys: accountKeys() };
}

function savedShow(state: State, key: string): Show {
  return decryptWithKey<Show>(state.shows[0].encryptedData, key);
}

function savedSettings(state: State, key: string): AppSettings {
  return decryptWithKey<AppSettings>(state.settings!, key);
}

/** An edit as the co-producer's app captures it: what they saw of the show, and what they want instead. */
async function showEdit(show: Show, proposed: Partial<Show>, base?: Partial<Show>): Promise<EditPayload> {
  const index = await buildPseudonymIndex({ shows: [show], settings: {} as AppSettings });
  const view = viewOfShow(show, index) as unknown as Record<string, unknown>;
  const keys = Object.keys(proposed) as ShowKey[];
  const seen: Record<string, unknown> = {};
  for (const key of keys) if (key in view) seen[key] = view[key];
  return {
    kind: 'edit',
    shows: [{ target: 'show', op: 'update', showId: show.id, baseRevision: null, keys, base: (base ?? seen) as Partial<Show>, proposed }],
    settings: null,
  };
}

function seed(state: State, token: string, payload: RequestPayload): string {
  return addCoproducerRequest(state, { token, kind: payload.kind, payload });
}

async function openRequests(page: Page) {
  await gotoTab(page, 'More');
  await page.locator('.more-item').filter({ hasText: 'Requests' }).click();
  await expect(page.getByRole('heading', { name: 'Requests' })).toBeVisible();
}

function card(page: Page, text: string | RegExp) {
  return page.locator('.request-card').filter({ hasText: text });
}

test.describe('co-producer links, the owner’s side', () => {
  test('a link is made only once named and consented to, shown once, listed and withdrawn', async ({ page }) => {
    const { state } = await ownerWithShow(page);
    await gotoTab(page, 'Settings');
    const section = page.locator('section.coproducers');
    await expect(section.getByText('Making a link sends the keys that unlock your account')).toBeVisible();
    const make = section.getByRole('button', { name: 'Make link' });
    await expect(make).toBeDisabled();
    await section.getByLabel('Their name').fill('Sam Rivera');
    await expect(make).toBeDisabled();
    await section.getByLabel('I understand what this shares').check();
    await expect(make).toBeEnabled();
    await make.click();
    const link = section.getByLabel('Link for Sam Rivera');
    await expect(link).toHaveValue(/\/coproduce#t=[A-Za-z0-9_-]{43}$/);
    expect(Object.keys(state.coproducerLinks)).toHaveLength(1);

    await section.getByRole('button', { name: 'Manage links' }).click();
    await expect(section.locator('.coproducers__link')).toContainText('Sam Rivera');
    await expect(section.locator('.coproducers__link')).toContainText('First opened not yet');
    await section.getByRole('button', { name: /^Withdraw Sam Rivera's link/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText("Withdraw Sam Rivera's link?")).toBeVisible();
    await dialog.getByRole('button', { name: 'Withdraw' }).click();
    await expect(section.getByText("Withdrawn. Sam Rivera can't open your account any more.")).toBeVisible();
    expect(Object.keys(state.coproducerLinks)).toHaveLength(0);
  });

  test('a waiting edit shows on More and in a notice, and approving it saves the show', async ({ page }) => {
    const { state, keys } = await ownerWithShow(page);
    const token = addCoproducerLink(state, { ...keys, label: 'Sam Rivera' });
    const id = seed(state, token, await showEdit(savedShow(state, keys.key), { venueName: 'The Attic' }));
    await page.reload();
    await expect(page.locator('.bottom-nav__item').filter({ hasText: 'More' }).locator('.bottom-nav__badge')).toHaveText('1');
    await expect(page.locator('.system-notice').filter({ hasText: /waiting|asked for/ })).toBeVisible();
    await gotoTab(page, 'More');
    await expect(page.locator('.more-item').first()).toContainText('Requests');
    await page.locator('.more-item').filter({ hasText: 'Requests' }).click();
    const request = card(page, `Sam Rivera asked to change “${SHOW}”`);
    await expect(request.getByText('Now').first()).toBeVisible();
    await expect(request.getByText('Pending approval').first()).toBeVisible();
    await expect(request.getByText('The Attic').first()).toBeVisible();
    const saved = page.waitForRequest((r) => r.url().includes('/api/shows') && r.method() === 'PUT');
    await request.getByRole('button', { name: 'Approve', exact: true }).click();
    await saved;
    await expect(page.getByText("Approved. It's in your account now.")).toBeVisible();
    await expect.poll(() => readCoproducerRequest(state, id, keys.key)?.status).toBe('approved');
    await expect.poll(() => savedShow(state, keys.key).venueName).toBe('The Attic');
  });

  test('a request the owner has changed since reads Approve anyway, and is marked stale in one call', async ({ page }) => {
    const { state, keys } = await ownerWithShow(page);
    const token = addCoproducerLink(state, { ...keys, label: 'Sam Rivera' });
    // They asked from a copy where the venue was still the old one.
    const id = seed(state, token, await showEdit(savedShow(state, keys.key), { venueName: 'The Attic' }, { venueName: 'An older venue' }));
    const staleCalls: string[] = [];
    page.on('request', (r) => { if (r.url().includes('route=decide-many')) staleCalls.push(r.postData() ?? ''); });
    await page.reload();
    await openRequests(page);
    const request = card(page, `Sam Rivera asked to change “${SHOW}”`);
    await expect(request.getByText('Changed since they asked').first()).toBeVisible();
    await expect(request.getByRole('button', { name: 'Approve anyway' })).toBeVisible();
    await expect.poll(() => readCoproducerRequest(state, id, keys.key)?.status).toBe('stale');
    expect(staleCalls).toHaveLength(1);
    expect(JSON.parse(staleCalls[0])).toEqual({ ids: [id], decision: 'stale' });
  });

  test('rejecting leaves the show as it was', async ({ page }) => {
    const { state, keys } = await ownerWithShow(page);
    const token = addCoproducerLink(state, { ...keys, label: 'Sam Rivera' });
    const id = seed(state, token, await showEdit(savedShow(state, keys.key), { venueName: 'The Attic' }));
    const before = state.shows[0].encryptedData;
    await page.reload();
    await openRequests(page);
    await card(page, 'Sam Rivera asked to').getByRole('button', { name: 'Reject' }).click();
    await expect(page.getByText("Rejected. Sam Rivera will see it wasn't approved.")).toBeVisible();
    expect(readCoproducerRequest(state, id, keys.key)?.status).toBe('rejected');
    expect(state.shows[0].encryptedData).toBe(before);
  });

  test('approving a new signing link warns, makes it, files it and hands back the URL; withdrawing them with their links withdraws it', async ({ page }) => {
    const { state, keys } = await ownerWithShow(page);
    await gotoTab(page, 'More');
    await page.locator('.more-item').filter({ hasText: 'Contracts' }).click();
    await page.locator('.contracts__file').setInputFiles(writeTestPdf());
    await expect(page.locator('.contracts__item-name')).toHaveText('agreement');
    await expect(page.locator('.sync-status--saved')).toBeVisible();
    const contractId = savedSettings(state, keys.key).contracts[0].id;
    const token = addCoproducerLink(state, { ...keys, label: 'Sam Rivera' });
    const id = seed(state, token, { kind: 'share', action: { type: 'signing-link', contractId, signer: { name: 'Jo Bloggs', email: 'jo@example.com' } } });
    const calls: string[] = [];
    page.on('request', (r) => { if (r.url().includes('/api/sign')) calls.push(`${r.method()} ${new URL(r.url()).pathname}`); });
    await page.reload();
    await openRequests(page);
    const request = card(page, 'Sam Rivera asked to');
    await request.getByRole('button', { name: 'Approve and make the link' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(/Give Sam Rivera a signing link for Jo Bloggs\?/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText('Approved. Sam Rivera can share it now.')).toBeVisible();
    expect(calls).toContain('PUT /api/sign-doc');
    expect(calls).toContain('PUT /api/sign');
    const stored = readCoproducerRequest(state, id, keys.key)!;
    expect(stored.status).toBe('approved');
    expect((stored.result as { links: { url: string }[] }).links[0].url.startsWith(`${MAIN_ORIGIN}/sign?t=`)).toBe(true);
    expect(Object.keys(state.coproducerHandouts)).toHaveLength(1);
    await expect.poll(() => savedSettings(state, keys.key).signatureRequests.map((r) => r.signerName)).toEqual(['Jo Bloggs']);

    calls.length = 0;
    await gotoTab(page, 'Settings');
    const section = page.locator('section.coproducers');
    await section.getByRole('button', { name: 'Manage links' }).click();
    await expect(section.getByText('Links they were given: 1')).toBeVisible();
    await section.getByRole('button', { name: /^Withdraw Sam Rivera's link/ }).click();
    const withdraw = page.getByRole('dialog');
    await withdraw.getByLabel('Also withdraw the 1 link they were given').check();
    await withdraw.getByRole('button', { name: 'Withdraw' }).click();
    await expect.poll(() => calls).toContain('DELETE /api/sign');
    await expect.poll(() => savedSettings(state, keys.key).signatureRequests).toEqual([]);
  });

  test('hostile requests read as unreadable with only Reject, and the others still work', async ({ page }) => {
    const { state, keys } = await ownerWithShow(page);
    const token = addCoproducerLink(state, { ...keys, label: 'Sam Rivera' });
    const show = savedShow(state, keys.key);
    const svg = await showEdit(show, { recap: { attendance: '<svg onload=alert(1)>' as unknown as number } });
    seed(state, token, svg);
    seed(state, token, {
      kind: 'edit',
      shows: [],
      settings: { target: 'settings', baseRevision: null, fields: [{ field: 'deletedShowIds', kind: 'value', base: [], proposed: [show.id] }] },
    });
    // A Rolodex row whose id is '__proto__', as settings rows travel: [id, row].
    seed(state, token, {
      kind: 'edit',
      shows: [],
      settings: {
        target: 'settings',
        baseRevision: null,
        fields: [{ field: 'potentialComics', kind: 'rows', idField: 'id', baseOrder: [], proposedOrder: ['__proto__'], base: [], proposed: [['__proto__', { id: '__proto__', name: 'Proto' }]] }],
      },
    });
    seed(state, token, await showEdit(show, { venueName: 'The Attic' }));
    await page.reload();
    await openRequests(page);
    await expect(page.locator('.request-card')).toHaveCount(4);
    const unreadable = page.locator('.request-card').filter({ hasText: "This request couldn't be read." });
    await expect(unreadable).toHaveCount(3);
    for (const one of await unreadable.all()) {
      await expect(one.getByRole('button', { name: /Approve/ })).toHaveCount(0);
      await expect(one.getByRole('button', { name: 'Reject' })).toBeVisible();
    }
    await expect(card(page, `Sam Rivera asked to change “${SHOW}”`).getByRole('button', { name: 'Approve', exact: true })).toBeVisible();
  });

  test('a ticked to-do and the to-do the owner added meanwhile are both on the show after approval', async ({ page }) => {
    const { state, keys } = await ownerWithShow(page);
    const token = addCoproducerLink(state, { ...keys, label: 'Sam Rivera' });
    const original = { ...savedShow(state, keys.key), todos: [{ id: 'todo-a', text: 'Print the run sheet', completed: false }] };
    // What the co-producer saw had only to-do A; they ticked it.
    const id = seed(state, token, await showEdit(original, { todos: [{ ...original.todos[0], completed: true }] }));
    // Meanwhile the owner's account gained to-do B.
    const withB = { ...original, todos: [...original.todos, { id: 'todo-b', text: 'Book the DJ', completed: false }] };
    state.shows[0] = { id: withB.id, encryptedData: encryptWithKey(withB, keys.key) };
    await page.reload();
    await openRequests(page);
    await card(page, 'Sam Rivera asked to').getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(page.getByText("Approved. It's in your account now.")).toBeVisible();
    await expect.poll(() => readCoproducerRequest(state, id, keys.key)?.status).toBe('approved');
    await expect.poll(() => savedShow(state, keys.key).todos).toEqual([
      { id: 'todo-a', text: 'Print the run sheet', completed: true },
      { id: 'todo-b', text: 'Book the DJ', completed: false },
    ]);
  });
});
