import { test, expect } from '@playwright/test';
import { emptyState, installFakeApi } from './support/fake-api.mjs';
import { createShow, gotoTab, openSection, signUpAndOnboard } from './support/app';

test('an older tab cannot erase a newly saved show', async ({ page, context }) => {
  const state = emptyState();
  await installFakeApi(context, state);
  await signUpAndOnboard(page);
  const oldTab = await context.newPage();
  await oldTab.goto('/');
  await expect(oldTab.locator('.app-main')).toBeVisible();
  await createShow(page, 'Newly saved show');
  await expect.poll(() => state.shows.length).toBe(1);
  const firstId = state.shows[0].id;
  // The old tab still holds the empty list it loaded earlier.
  await createShow(oldTab, 'Show from older tab');
  await expect.poll(() => state.shows.some(s => s.id !== firstId)).toBe(true);
  expect(state.shows.some(s => s.id === firstId)).toBe(true);
  expect(state.shows).toHaveLength(2);
  await page.reload();
  await expect(page.locator('.show-card')).toHaveCount(2);
  await oldTab.close();
});


test('a conflicting edit stays on screen and reports that it has not saved', async ({ page, context }) => {
  const state = emptyState();
  await installFakeApi(context, state);
  await signUpAndOnboard(page);
  await createShow(page, 'Conflict test');
  await expect.poll(() => state.shows.length).toBe(1);
  await expect(page.locator('.sync-status--saved')).toBeVisible();
  // A different version reached the account after this tab loaded the show.
  const remote = state.shows[0].encryptedData + '-changed-elsewhere';
  state.shows[0].encryptedData = remote;
  await openSection(page, 'Schedule');
  // Named rather than taken by position: the choice screen leads with whatever
  // route is fastest for the show in front of you, and these tests are about
  // typing cues in by hand.
  const build = page.locator('.schedule-choice__option').filter({ hasText: 'Build Your Own' });
  if (await build.count()) await build.first().click();
  await page.locator('input[aria-label="Description"]').fill('Unsaved local cue');
  await page.locator('button[aria-label="Add cue"]').click();
  await expect(page.getByRole('alert')).toContainText('changed in another tab or device');
  await expect(page.locator('.sync-status--blocked')).toBeVisible();
  await expect(page.locator('.cue-list')).toContainText('Unsaved local cue');
  expect(state.shows[0].encryptedData).toBe(remote);
  const pending = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('showrunner:pendingShows')).map(k => JSON.parse(localStorage.getItem(k)!)));
  expect(JSON.stringify(pending)).toContain('Unsaved local cue');
});


test('an unsaved new show survives a failed request and a reload', async ({ page, context }) => {
  const state = emptyState();
  await installFakeApi(context, state);
  await signUpAndOnboard(page);
  await page.route('**/api/shows', route => route.request().method() === 'PUT'
    ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"unavailable"}' })
    : route.fallback());
  await createShow(page, 'Held show');
  await expect(page.locator('.sync-status--retrying')).toBeVisible();
  expect(state.shows).toHaveLength(0);
  await page.unroute('**/api/shows');
  page.on('dialog', dialog => dialog.accept());
  await page.reload();
  await expect.poll(() => state.shows.length).toBe(1);
  await expect(page.locator('.dash-next__name')).toHaveText('Held show');
});

test('storage exhaustion is visible rather than a promise of a safe local copy', async ({ page, context }) => {
  await installFakeApi(context, emptyState());
  await signUpAndOnboard(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith('showrunner:pending')) throw new DOMException('Full', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await createShow(page, 'No local space');
  await expect(page.getByRole('alert')).toContainText('could not store a backup');
});

test('a stale settings save cannot erase another tab’s contact list', async ({ page, context }) => {
  const state = emptyState();
  await installFakeApi(context, state);
  await signUpAndOnboard(page);
  const oldTab = await context.newPage();
  await oldTab.goto('/');
  await expect(oldTab.locator('.app-main')).toBeVisible();
  await gotoTab(page, 'Rolodex');
  await page.locator('.rolodex__input').first().fill('First contact');
  await page.locator('button').filter({ hasText: /^Add$/ }).first().click();
  await expect(page.locator('.sync-status--saved')).toBeVisible();
  const first = state.settings;
  await gotoTab(oldTab, 'Rolodex');
  await oldTab.locator('.rolodex__input').first().fill('Second contact');
  await oldTab.locator('button').filter({ hasText: /^Add$/ }).first().click();
  await expect(oldTab.getByRole('alert')).toContainText('Settings changed in another tab');
  await expect(oldTab.locator('.rolodex__name')).toContainText('Second contact');
  expect(state.settings).toBe(first);
  await oldTab.close();
});
