import { expect, test } from '@playwright/test';
import { emptyState, installFakeApi } from './support/fake-api.mjs';
import { daysFromNow, gotoTab, signUpAndOnboard } from './support/app';
import { openAsCoproducer } from './support/coproducer';

/**
 * Both producers, one account: the owner makes a link in Settings, the
 * co-producer opens it and asks for a change, the owner approves it, and
 * the co-producer then sees it in place, with nothing left pending.
 */

const SHOW = 'Friday Laughs';
const VENUE = 'The Basement';

test('a change goes from the co-producer to the owner and back', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const state = emptyState();
  await installFakeApi(page.context(), state);
  await signUpAndOnboard(page);
  await page.locator('button').filter({ hasText: /New Show/i }).first().click();
  await page.getByPlaceholder('Show name').fill(SHOW);
  await page.locator('input[type=date]').fill(daysFromNow(10));
  await page.getByPlaceholder('Venue name').fill(VENUE);
  await page.locator('button').filter({ hasText: /^Save$/ }).last().click();
  await expect(page.getByRole('heading', { name: SHOW, level: 1 })).toBeVisible();
  // The show is on the server before the link exists, or the co-producer's
  // first look finds no show until their next refresh.
  await expect.poll(() => state.shows.length).toBe(1);
  await expect(page.locator('.sync-status--saved')).toBeVisible();

  // The owner makes the link.
  await gotoTab(page, 'Settings');
  const section = page.locator('section.coproducers');
  await section.getByLabel('Their name').fill('Sam Rivera');
  await section.getByLabel('I understand what this shares').check();
  await section.getByRole('button', { name: 'Make link' }).click();
  const url = await section.getByLabel('Link for Sam Rivera').inputValue();
  const token = /#t=([A-Za-z0-9_-]{43})$/.exec(url)![1];

  // The co-producer opens it and asks for a new venue.
  const coproducer = await openAsCoproducer(browser, state, token);
  await coproducer.locator('.show-card, .dash button').filter({ hasText: SHOW }).first().click();
  await expect(coproducer.getByRole('heading', { name: SHOW, level: 1 })).toBeVisible();
  await coproducer.locator('#show-section-header-basic').click();
  await coproducer.getByPlaceholder('Venue name').fill('The Attic');
  await coproducer.getByRole('button', { name: 'Review & send' }).click();
  const dialog = coproducer.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Send for approval' }).click();
  await expect(dialog.getByText('Sent for approval')).toBeVisible();
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(coproducer.getByText('Pending approval').first()).toBeVisible();

  // The owner approves it.
  await gotoTab(page, 'More');
  await page.locator('.more-item').filter({ hasText: 'Requests' }).click();
  const request = page.locator('.request-card').filter({ hasText: `Sam Rivera asked to change “${SHOW}”` });
  await expect(request.getByText('The Attic').first()).toBeVisible();
  await request.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByText("Approved. It's in your account now.")).toBeVisible();
  await expect(page.locator('.sync-status--saved')).toBeVisible();

  // The co-producer's app notices on its next look, refreshes, and shows it added.
  await coproducer.getByRole('button', { name: /^Pending approval/ }).first().click();
  await expect(coproducer.getByText('Approved and added.')).toBeVisible({ timeout: 90_000 });
  await coproducer.keyboard.press('Escape');
  await expect(coproducer.getByPlaceholder('Venue name')).toHaveValue('The Attic');
  await expect(coproducer.locator('.pending-pill')).toHaveCount(0);
});
