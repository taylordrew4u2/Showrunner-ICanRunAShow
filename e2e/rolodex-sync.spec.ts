import { expect, test, type Locator, type Page } from '@playwright/test';
import type { AppSettings, Show } from '../src/types';
import { decryptWithKey, deriveKey } from '../src/utils/encryption';
import { emptyState, installFakeApi } from './support/fake-api.mjs';
import { createShow, gotoTab, openSection, signUpAndOnboard } from './support/app';

const profileFields = {
  'Name': 'Mona Sable',
  'Instagram / Social': '@monasable',
  'Email': 'mona@example.com',
  'Phone': '212-555-0198',
  'Credits for the stage introduction': 'Host of the Late Set',
  'Notes': 'Pronounced MOH-na. Available after 7 pm.',
  'Walk-On Song': 'Opening track',
  'Artist': 'The House Band',
  'Start Timestamp': '0:12',
  'YouTube / Spotify Link': 'https://open.spotify.com/track/opening',
  'Video link': 'https://youtu.be/monasable',
};

async function expectProfile(profile: Locator, values: Record<string, string>, photo: string) {
  for (const [label, value] of Object.entries(values)) {
    await expect(profile.getByLabel(label, { exact: true }), label).toHaveValue(value);
  }
  await expect(profile.locator('.headshot__image')).toHaveAttribute('src', photo);
}

async function uploadHeadshot(page: Page, color: string): Promise<string> {
  const panel = page.getByRole('region', { name: 'Headshot', exact: true });
  const png = await page.evaluate((fill) => {
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 320;
    const context = canvas.getContext('2d')!;
    context.fillStyle = fill;
    context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png').split(',')[1];
  }, color);
  const oldPhoto = await panel.locator('.headshot__image').count()
    ? await panel.locator('.headshot__image').getAttribute('src') : null;
  await panel.getByLabel('Choose headshot file', { exact: true }).setInputFiles({
    name: 'headshot.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64'),
  });
  await expect(panel.locator('.headshot__image')).toBeVisible();
  await expect.poll(() => panel.locator('.headshot__image').getAttribute('src')).not.toBe(oldPhoto);
  return (await panel.locator('.headshot__image').getAttribute('src'))!;
}

async function openShow(page: Page, name: string) {
  await gotoTab(page, 'Shows');
  await page.getByRole('button', { name: new RegExp(`^Open ${name},`) }).click();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
}

async function openShowProfile(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'Show sections' })
    .getByRole('button', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: `Open ${name}'s profile`, exact: true }).click();
  await expect(page.locator('.perf-drawer')).toBeVisible();
  return page.locator('.perf-drawer');
}

test('a Rolodex comic keeps the same complete profile in every show, after edits and reloads', async ({ page, context }, testInfo) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const state = emptyState();
  const key = deriveKey('correct horse battery staple');
  await installFakeApi(context, state);
  await signUpAndOnboard(page);
  await gotoTab(page, 'Rolodex');
  await page.locator('.rolodex__input').first().fill('Mona Sable');
  await page.locator('.rolodex__form button[type="submit"]').click();
  await page.getByRole('button', { name: "Open Mona Sable's full profile", exact: true }).click();
  const rolodexProfile = page.locator('.perf-profile');
  for (const [label, value] of Object.entries(profileFields)) {
    await rolodexProfile.getByLabel(label, { exact: true }).fill(value);
  }
  await rolodexProfile.getByRole('button', { name: 'Save Changes', exact: true }).click();
  const originalPhoto = await uploadHeadshot(page, '#bd7188');
  await expectProfile(rolodexProfile, profileFields, originalPhoto);
  await expect.poll(() => state.settings && decryptWithKey<AppSettings>(state.settings, key)
    .potentialComics?.[0]?.photo).toMatch(/^media:/);
  const originalPhotoRef = decryptWithKey<AppSettings>(state.settings!, key).potentialComics![0].photo;
  await rolodexProfile.getByRole('button', { name: '← Back', exact: true }).click();

  // Both bookings must bring the complete existing profile with them.
  for (const name of ['First Shared Show', 'Second Shared Show']) {
    await gotoTab(page, 'Shows');
    await createShow(page, name, '2026-10-20');
    await page.getByRole('button', { name: 'From Rolodex', exact: true }).click();
    await page.locator('.section-rolodex-picker__item').filter({ hasText: 'Mona Sable' }).click();
    const profile = await openShowProfile(page, 'Mona Sable');
    await expectProfile(profile, profileFields, originalPhoto);
    await profile.locator('.perf-profile__back').click();
  }

  // Generate the order before renaming, so its existing slot must keep its link.
  await openSection(page, 'Schedule');
  await page.locator('.schedule-choice__option').filter({ hasText: 'Build from the lineup' }).click();
  await page.locator('.gen').getByRole('button', { name: /Use this running order/ }).click();
  await openShow(page, 'First Shared Show');
  let profile = await openShowProfile(page, 'Mona Sable');
  const renamedFields = {
    ...profileFields,
    'Name': 'Mona Sol',
    'Instagram / Social': '@monasol',
    'Credits for the stage introduction': 'Creator of the Late Set',
  };
  for (const label of ['Name', 'Instagram / Social', 'Credits for the stage introduction'] as const) {
    await profile.getByLabel(label, { exact: true }).fill(renamedFields[label]);
  }
  await profile.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expectProfile(profile, renamedFields, originalPhoto);
  await profile.locator('.perf-profile__back').click();

  await gotoTab(page, 'Rolodex');
  await expect(page.locator('.rolodex__item')).toHaveCount(1);
  await page.getByRole('button', { name: "Open Mona Sol's full profile", exact: true }).click();
  await expectProfile(rolodexProfile, renamedFields, originalPhoto);
  await rolodexProfile.getByRole('button', { name: '← Back', exact: true }).click();
  await openShow(page, 'Second Shared Show');
  profile = await openShowProfile(page, 'Mona Sol');
  await expectProfile(profile, renamedFields, originalPhoto);
  await profile.locator('.perf-profile__back').click();

  // The same data reaches producer tools, not only the profile editors.
  await page.getByRole('button', { name: 'Post copy', exact: true }).click();
  await expect(page.getByLabel('Post caption', { exact: true })).toHaveValue(/Mona Sol @monasol/);
  await expect(page.getByLabel('Post caption', { exact: true })).not.toHaveValue(/Mona Sable|@monasable/);
  await page.locator('.announce').getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Run Show', exact: true }).click();
  await expect(page.locator('.rs-lineup__who').filter({ hasText: 'Mona Sol' })).toHaveCount(1);
  await expect(page.locator('.run-show')).not.toContainText('Mona Sable');
  await page.getByRole('button', { name: 'Close run show', exact: true }).click();

  // Changing the saved profile works in the other direction, including a
  // deliberate clear. Old show snapshots must not refill that cleared value.
  await gotoTab(page, 'Rolodex');
  await page.getByRole('button', { name: "Open Mona Sol's full profile", exact: true }).click();
  const finalFields = { ...renamedFields, 'Email': 'mona.sol@example.com', 'Instagram / Social': '' };
  await rolodexProfile.getByLabel('Email', { exact: true }).fill(finalFields.Email);
  await rolodexProfile.getByLabel('Instagram / Social', { exact: true }).fill('');
  await rolodexProfile.getByRole('button', { name: 'Save Changes', exact: true }).click();
  const replacementPhoto = await uploadHeadshot(page, '#487eb0');
  expect(replacementPhoto).not.toBe(originalPhoto);

  // Wait for the encrypted backend records, then verify from a fresh load.
  await expect.poll(() => {
    if (!state.settings || state.shows.length !== 2) return false;
    const comic = decryptWithKey<AppSettings>(state.settings, key).potentialComics?.[0];
    const shows = state.shows.map(row => decryptWithKey<Show>(row.encryptedData, key));
    return !!comic?.photo && comic.photo !== originalPhotoRef &&
      comic.email === finalFields.Email && !comic.socialMedia &&
      shows.every(show => show.performers.length === 1 &&
        show.performers[0].comicId === comic.id &&
        show.performers[0].photo === comic.photo &&
        show.performers[0].email === finalFields.Email &&
        !show.performers[0].socialMedia);
  }).toBe(true);
  await page.reload();
  await gotoTab(page, 'Rolodex');
  await expect(page.locator('.rolodex__item')).toHaveCount(1);
  await page.getByRole('button', { name: "Open Mona Sol's full profile", exact: true }).click();
  await expectProfile(rolodexProfile, finalFields, replacementPhoto);
  await rolodexProfile.getByRole('button', { name: '← Back', exact: true }).click();
  for (const name of ['First Shared Show', 'Second Shared Show']) {
    await openShow(page, name);
    profile = await openShowProfile(page, 'Mona Sol');
    await expectProfile(profile, finalFields, replacementPhoto);
    if (name === 'Second Shared Show') {
      await profile.evaluate(element => { element.scrollTop = 0; });
      await page.screenshot({ path: testInfo.outputPath('shared-comic-profile.png'), animations: 'disabled' });
      await profile.getByRole('region', { name: 'Headshot', exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath('shared-comic-headshot.png'), animations: 'disabled' });
    }
    await profile.locator('.perf-profile__back').click();
  }
  expect(state.mediaDeletes).toEqual([]);
});
