import { test, expect } from '@playwright/test';
import { emptyState, installFakeApi } from './support/fake-api.mjs';
import { createShow, openSection, signUpAndOnboard } from './support/app';

test('an older tab cannot erase a newly saved show', async ({ page, context }) => {
  const state = emptyState();
  await installFakeApi(context, state);
  await signUpAndOnboard(page);
  const oldTab = await context.newPage();
  await oldTab.goto('/');
  await expect(oldTab.locator('.bottom-nav__item').first()).toBeVisible();
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
  const build = page.locator('.schedule-choice__option').first();
  if (await build.count()) await build.click();
  await page.locator('input[aria-label="Description"]').fill('Unsaved local cue');
  await page.locator('button[aria-label="Add cue"]').click();
  await expect(page.getByRole('alert')).toContainText('changed in another tab or device');
  await expect(page.locator('.sync-status--blocked')).toBeVisible();
  await expect(page.locator('.cue-list')).toContainText('Unsaved local cue');
  expect(state.shows[0].encryptedData).toBe(remote);
  const pending = await page.evaluate(() => JSON.parse(localStorage.getItem('showrunner:pendingShows') ?? '{}'));
  expect(JSON.stringify(pending)).toContain('Unsaved local cue');
});
