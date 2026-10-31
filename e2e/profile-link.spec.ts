import { expect, test } from '@playwright/test';
import { deriveUserId } from '../src/utils/encryption';
import { LINK_STORAGE_FULL_MESSAGE } from '../src/utils/linkStorage';
import { emptyState, installFakeApi } from './support/fake-api.mjs';
import { gotoTab, signUpAndOnboard } from './support/app';

/**
 * Asking a performer for their own details, and getting them back.
 *
 * Worth an end-to-end test because every piece is wiring: the link has to be
 * made from the Rolodex, opened by someone with no account, answered once,
 * and the answers have to land on the right row when the producer comes back.
 * Any of those can fail silently, and the failure looks like "they never
 * replied" — which is the exact thing this replaces.
 */
test.describe('a self-serve profile link', () => {
  test('goes out from the Rolodex and comes back onto the profile', async ({ page, context }) => {
    const state = emptyState();
    await installFakeApi(context, state);
    await signUpAndOnboard(page);


    // Someone filed with nothing but a name.
    await gotoTab(page, 'Rolodex');
    await page.locator('.rolodex__input').first().fill('Mona Sable');
    await page.locator('.rolodex__form button[type="submit"]').click();
    const row = page.locator('.rolodex__item').filter({ hasText: 'Mona Sable' });
    await expect(row.locator('.rolodex__gaps')).toContainText('Needs email');

    // The producer asks. The link is shown on the row, not only copied —
    // a link you cannot see is a link you cannot paste.
    await row.locator('button').filter({ hasText: /^Ask for details$/ }).click();
    const url = await row.locator('.rolodex__link-url').inputValue();
    expect(url).toMatch(/\/details\?t=.+#k=.+/);
    // The "asked" pill gives way to the link while the link is fresh on the
    // row — saying both would be saying the same thing twice.
    await expect(row.getByText('Asked for details')).toHaveCount(0);

    // The performer opens it — same browser context, so the fake API applies,
    // but a fresh page with none of the producer's session.
    const performer = await context.newPage();
    await performer.goto(url);
    await expect(performer.locator('.signing__title')).toHaveText('Your details');
    await performer.getByLabel('Email').fill('mona@sable.example');
    await performer.getByLabel('Instagram or main social').fill('instagram.com/monasable');
    await performer.locator('button').filter({ hasText: /^Send my details$/ }).click();
    await expect(performer.locator('.signing__panel--done')).toContainText('Sent — thank you');

    // Reopening the link shows what was sent, not a blank form to fill twice.
    await performer.reload();
    await expect(performer.locator('.signing__panel--done')).toContainText('mona@sable.example');
    await performer.close();

    // Back on the producer's side, the Rolodex checks for replies on open.
    await gotoTab(page, 'Shows');
    await gotoTab(page, 'Rolodex');
    await expect(row.locator('.rolodex__import')).toContainText('sent their details');
    await expect(row.locator('.rolodex__import')).toContainText('mona@sable.example');
    // The pasted URL became a handle, the way the post copy reads it.
    await expect(row.locator('.rolodex__import')).toContainText('@monasable');

    await row.locator('button').filter({ hasText: /^Save to profile$/ }).click();

    // On the profile now — and the gap that prompted the ask is closed.
    await expect(row).toContainText('@monasable');
    await expect(row.locator('.rolodex__gaps')).toHaveCount(0);
    await expect(row.locator('.rolodex__import')).toHaveCount(0);
    // Retired on the server too, answers and all, so it gives its place
    // among the account's links back.
    await expect.poll(() => Object.keys(state.sign)).toEqual([]);
  });
});

test.describe('waving a reply off', () => {
  test('retires the link, so the producer can ask again', async ({ page, context }) => {
    const state = emptyState();
    await installFakeApi(context, state);
    await signUpAndOnboard(page);

    await gotoTab(page, 'Rolodex');
    await page.locator('.rolodex__input').first().fill('Dev Okonjo');
    await page.locator('.rolodex__form button[type="submit"]').click();
    const row = page.locator('.rolodex__item').filter({ hasText: 'Dev Okonjo' });
    await row.locator('button').filter({ hasText: /^Ask for details$/ }).click();
    const url = await row.locator('.rolodex__link-url').inputValue();

    const performer = await context.newPage();
    await performer.goto(url);
    await performer.getByLabel('Email').fill('dev@okonjo.example');
    await performer.locator('button').filter({ hasText: /^Send my details$/ }).click();
    await expect(performer.locator('.signing__panel--done')).toBeVisible();
    await performer.close();

    await gotoTab(page, 'Shows');
    await gotoTab(page, 'Rolodex');
    await expect(row.locator('.rolodex__import')).toContainText('sent their details');

    // Declining an answer is the moment you most want to be able to ask
    // again. A skipped reply that stayed on file would hide the ask for good.
    await row.locator('button').filter({ hasText: /^Skip$/ }).click();
    await expect(row.locator('.rolodex__import')).toHaveCount(0);
    await expect(row.locator('.rolodex__gaps')).toContainText('Needs email');
    await expect(row.locator('button').filter({ hasText: /^Ask for details$/ })).toBeVisible();
    await expect.poll(() => Object.keys(state.sign)).toEqual([]);
  });
});

test.describe('asking when the account’s links are full', () => {
  test('says what to do about it rather than blaming the connection', async ({ page, context }) => {
    // Five thousand viewer links already out: every place among the account's
    // links is taken (MAX_LINK_TOKENS in api/_lib/linkStorage.ts).
    const state = emptyState();
    for (let i = 0; i < 5000; i++) {
      state.live[`held-viewer-link-${i}`] = { userId: deriveUserId('producer'), payload: {} };
    }
    await installFakeApi(context, state);
    await signUpAndOnboard(page);

    await gotoTab(page, 'Rolodex');
    await page.locator('.rolodex__input').first().fill('Mona Sable');
    await page.locator('.rolodex__form button[type="submit"]').click();
    const row = page.locator('.rolodex__item').filter({ hasText: 'Mona Sable' });
    await row.locator('button').filter({ hasText: /^Ask for details$/ }).click();
    await expect(row.locator('.rolodex__link-error')).toHaveText(LINK_STORAGE_FULL_MESSAGE);
    expect(state.sign).toEqual({});
    await expect(row.locator('.rolodex__link-url')).toHaveCount(0);
  });
});
