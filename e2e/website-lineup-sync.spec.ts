import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import type { Show } from '../src/types';
import { deriveKey, encryptWithKey } from '../src/utils/encryption';
import type { WebsiteShow } from '../src/utils/websiteLineups';
import { emptyState, installFakeApi } from './support/fake-api.mjs';
import { completeOnboarding, daysFromNow, gotoTab, PASSWORD, signUp, signUpAndOnboard } from './support/app';

type SourceRow = { id: string; encryptedData: string };
type Publication = WebsiteShow & { revision: string };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function savedShow(): Show {
  return {
    id: 'website-approved', name: 'Website Lineup Night', date: daysFromNow(14), time: '20:00',
    venueName: 'The Test Room', location: 'Test City', status: 'upcoming',
    ticketLink: 'https://example.com/tickets', host: 'Public Host', hostSocial: '@publichost',
    performers: [
      { id: 'first', comicId: 'comic-first', name: 'Original Bill', credits: 'First credit',
        email: 'private@example.com', phone: '555-0100', notes: 'Private booking notes' },
      { id: 'secret', comicId: 'comic-secret', name: 'Unannounced Guest', surpriseGuest: true },
    ],
    productionNotes: 'Private production notes', artists: [], schedule: [], hosts: [], djSongs: [],
    staff: [], expenses: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
}

function encrypt(show: Show): SourceRow {
  return { id: show.id, encryptedData: encryptWithKey(show, deriveKey(PASSWORD)) };
}

/** Only the two new routes are added here; account loading and editing use the shared fake API. */
async function websiteApi(page: Page, state: ReturnType<typeof emptyState>, initial: SourceRow) {
  const api = {
    rows: [initial], reads: 0, completedReads: 0, publications: [] as Publication[][],
    authenticated: [] as boolean[], beforeRead: async () => {},
  };
  const authenticated = (headers: Record<string, string>) => {
    const user = state.users[headers['x-user-id']];
    const valid = !!user && user.credential === headers['x-auth'] && !headers.authorization;
    api.authenticated.push(valid);
    return valid;
  };
  await page.route('**/api/shows?websiteLineups=1', async route => {
    if (route.request().method() !== 'GET' || !authenticated(route.request().headers())) {
      return route.fulfill({ status: 401, json: { error: 'unauthorized' } });
    }
    api.reads++;
    await api.beforeRead();
    await route.fulfill({ json: { shows: api.rows, websiteLineupShowIds: [initial.id] } });
    api.completedReads++;
  });
  await page.route('**/api/website-lineups', async route => {
    if (route.request().method() !== 'PUT' || !authenticated(route.request().headers())) {
      return route.fulfill({ status: 401, json: { error: 'unauthorized' } });
    }
    const body = route.request().postDataJSON() as { shows: Publication[] };
    api.publications.push(body.shows);
    return route.fulfill({ json: { ok: true, updatedIds: body.shows.map(show => show.id), unchangedIds: [] } });
  });
  return api;
}

async function returnToPage(page: Page) {
  await page.evaluate(() => {
    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event('focus'));
  });
}

test('cold owner load repairs the public bill only after the saved account has loaded', async ({ page, context }) => {
  const source = encrypt(savedShow());
  const state = emptyState({ shows: [source] });
  await installFakeApi(context, state);
  const api = await websiteApi(page, state, source);
  const loadingStarted = deferred();
  const releaseLoad = deferred();
  await page.route('**/api/shows', async route => {
    if (route.request().method() === 'GET') {
      loadingStarted.resolve();
      await releaseLoad.promise;
    }
    return route.fallback();
  });

  await signUp(page);
  await loadingStarted.promise;
  try {
    await expect(page.getByRole('status', { name: 'Loading your shows' })).toBeVisible();
    await returnToPage(page);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    // Give event-triggered work a chance to run while the real account read is held.
    await page.waitForTimeout(150);
    expect(api.reads).toBe(0);
    expect(api.publications).toHaveLength(0);
  } finally {
    releaseLoad.resolve();
  }
  await completeOnboarding(page);
  await expect.poll(() => api.publications.length).toBeGreaterThan(0);
  const publication = api.publications[0][0];
  expect(publication).toMatchObject({
    id: source.id, name: 'Website Lineup Night',
    revision: createHash('sha256').update(source.encryptedData).digest('hex'),
    lineup: [{ id: 'first', name: 'Original Bill', credits: 'First credit' }],
    hosts: [{ name: 'Public Host', handle: '@publichost' }],
  });
  expect(JSON.stringify(publication)).not.toMatch(/private@example|555-0100|Private booking|Private production|Unannounced Guest|comic-first/);
  expect(api.authenticated.every(Boolean)).toBe(true);
});

test('return and reconnect publish fresh saved lineups without replacing an unsaved profile edit', async ({ page, context }) => {
  const show = savedShow();
  const source = encrypt(show);
  const state = emptyState({ shows: [source] });
  await installFakeApi(context, state);
  const api = await websiteApi(page, state, source);
  await signUpAndOnboard(page);
  await expect.poll(() => api.publications.length).toBeGreaterThan(0);
  await gotoTab(page, 'Shows');
  await page.getByRole('button', { name: show.name, exact: true }).click();
  await page.getByRole('navigation', { name: 'Show sections' })
    .getByRole('button', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: "Open Original Bill's profile", exact: true }).click();
  const profile = page.locator('.perf-drawer');
  await profile.getByLabel('Name', { exact: true }).fill('Unsaved local stage name');

  const returned = encrypt({ ...show, performers: [
    { id: 'remote-second', name: 'Saved Return Bill', credits: 'Saved elsewhere' },
    { id: 'remote-first', name: 'Saved Second Act' },
    { id: 'secret', name: 'Still Unannounced', surpriseGuest: true },
  ] });
  api.rows = [returned];
  state.shows = [returned];
  const writesBeforeReturn = state.showSnapshots.length;
  await returnToPage(page);
  await expect.poll(() => api.publications.at(-1)?.[0]?.revision)
    .toBe(createHash('sha256').update(returned.encryptedData).digest('hex'));
  expect(api.publications.at(-1)?.[0].lineup.map(person => person.name))
    .toEqual(['Saved Return Bill', 'Saved Second Act']);
  await expect(profile.getByLabel('Name', { exact: true })).toHaveValue('Unsaved local stage name');
  await expect(page.getByRole('heading', { name: show.name, level: 1 })).toBeVisible();

  const reconnected = encrypt({ ...show, performers: [{ id: 'online-act', name: 'Saved Reconnect Bill' }] });
  api.rows = [reconnected];
  state.shows = [reconnected];
  await context.setOffline(true);
  await context.setOffline(false);
  await expect.poll(() => api.publications.at(-1)?.[0]?.revision)
    .toBe(createHash('sha256').update(reconnected.encryptedData).digest('hex'));
  expect(api.publications.at(-1)?.[0].lineup.map(person => person.name)).toEqual(['Saved Reconnect Bill']);
  await expect(profile.getByLabel('Name', { exact: true })).toHaveValue('Unsaved local stage name');
  expect(state.shows).toEqual([reconnected]);
  expect(state.showSnapshots).toHaveLength(writesBeforeReturn);
  expect(JSON.stringify(api.publications)).not.toContain('Unsaved local stage name');
});

test('signing out cancels publication from an in-flight read and removes return listeners', async ({ page, context }) => {
  const source = encrypt(savedShow());
  const state = emptyState({ shows: [source] });
  await installFakeApi(context, state);
  const api = await websiteApi(page, state, source);
  await signUpAndOnboard(page);
  await expect.poll(() => api.publications.length).toBeGreaterThan(0);
  await gotoTab(page, 'Settings');
  const reading = deferred();
  const releaseRead = deferred();
  api.beforeRead = async () => { reading.resolve(); await releaseRead.promise; };
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await reading.promise;
  const readsAtLogout = api.reads;
  const publicationsAtLogout = api.publications.length;
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  releaseRead.resolve();
  await expect.poll(() => api.completedReads).toBe(readsAtLogout);
  await returnToPage(page);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  // Past the lifecycle's minimum request gap: a leaked listener would fetch again.
  await page.waitForTimeout(2_200);
  expect(api.reads).toBe(readsAtLogout);
  expect(api.publications).toHaveLength(publicationsAtLogout);
});
