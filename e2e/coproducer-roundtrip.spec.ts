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

/**
 * Someone new comes with a name, a tape and their social media, and nothing
 * else: a co-producer cannot send them for approval without all three, the
 * server refuses a request made by hand, and the owner watches the tape from
 * the request before the person goes in the Rolodex.
 */
const TAPE = 'https://youtu.be/jo-park-tape';

test('a co-producer can only add someone new with a tape and their social media', async ({ page, browser }) => {
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
  await expect.poll(() => state.shows.length).toBe(1);
  await expect(page.locator('.sync-status--saved')).toBeVisible();

  await gotoTab(page, 'Settings');
  const section = page.locator('section.coproducers');
  await section.getByLabel('Their name').fill('Sam Rivera');
  await section.getByLabel('I understand what this shares').check();
  await section.getByRole('button', { name: 'Make link' }).click();
  const url = await section.getByLabel('Link for Sam Rivera').inputValue();
  const token = /#t=([A-Za-z0-9_-]{43})$/.exec(url)![1];

  const coproducer = await openAsCoproducer(browser, state, token);
  await coproducer.locator('.show-card, .dash button').filter({ hasText: SHOW }).first().click();
  await expect(coproducer.getByRole('heading', { name: SHOW, level: 1 })).toBeVisible();
  await coproducer.locator('#show-section-header-performers').click();

  // The form asks for a name, a tape and social media, and nothing else.
  const form = coproducer.locator('form.new-comic');
  await expect(form).toBeVisible();
  await expect(form.locator('input')).toHaveCount(5);
  await expect(coproducer.locator('.lineup-add__name')).toHaveCount(0);
  await expect(coproducer.getByLabel('Email address')).toHaveCount(0);

  // A name alone is not added, and nothing is there to send.
  await form.getByLabel('Performer name').fill('Jo Park');
  await form.getByLabel('Performer name').press('Enter');
  await expect(form.getByRole('alert')).toHaveText('Not added yet. Add a tape link, the tape’s length (5 or 10 minutes) and their social media first.');
  const tape = form.getByLabel('Tape link');
  await expect(tape).toBeFocused();
  await expect(tape).toHaveAttribute('aria-invalid', 'true');
  await expect(tape).toHaveAccessibleDescription(/Add a link to their tape/);
  await expect(coproducer.locator('.section-list-item__name')).toHaveCount(0);
  await expect(coproducer.getByRole('button', { name: 'Review & send' })).toHaveCount(0);

  // Nor with a tape that has no length, or no social media.
  await tape.fill(TAPE);
  await form.getByRole('button', { name: 'Add' }).click();
  await expect(form.getByRole('alert')).toHaveText('Not added yet. Add the tape’s length (5 or 10 minutes) and their social media first.');
  await expect(coproducer.locator('.section-list-item__name')).toHaveCount(0);
  expect(Object.keys(state.coproducerRequests)).toHaveLength(0);

  // A request made by hand, without the form, is refused by the server.
  const byHand = await coproducer.evaluate(async (bearer) => {
    const payload = {
      kind: 'edit', shows: [],
      settings: {
        target: 'settings', baseRevision: null,
        fields: [{ field: 'potentialComics', kind: 'rows', idField: 'id', baseOrder: [], proposedOrder: ['by-hand'], base: [], proposed: [['by-hand', { id: 'by-hand', name: 'No Tape', email: 'no@example.com' }]] }],
      },
    };
    const res = await fetch('/api/coproducer?route=requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
      body: JSON.stringify({ kind: 'edit', payload, mediaIds: [] }),
    });
    return { status: res.status, body: await res.json() as { error: string; problems: { problem: string }[] } };
  }, token);
  expect(byHand.status).toBe(400);
  expect(byHand.body.problems.map((p) => p.problem)).toContain('someone new needs a tape length of 5 or 10 minutes');
  expect(Object.keys(state.coproducerRequests)).toHaveLength(0);

  // With the tape, its length and their social media, by keyboard, they are added and can be sent.
  await form.getByLabel('10 minutes').check();
  await form.getByLabel('Social media').fill('instagram.com/jopark');
  await form.getByLabel('Social media').press('Enter');
  await expect(coproducer.locator('.section-list-item__name')).toHaveText('Jo Park');
  await expect(form.locator('.new-comic__summary')).toBeEmpty();
  await expect(form.getByLabel('Performer name')).toHaveValue('');
  await coproducer.getByRole('button', { name: 'Review & send' }).click();
  const dialog = coproducer.getByRole('dialog');
  await expect(dialog.getByRole('link', { name: TAPE }).first()).toBeVisible();
  await expect(dialog.getByText('10 minutes').first()).toBeVisible();
  await dialog.getByRole('button', { name: 'Send for approval' }).click();
  await expect(dialog.getByText('Sent for approval')).toBeVisible();
  await dialog.getByRole('button', { name: 'OK' }).click();
  expect(Object.keys(state.coproducerRequests)).toHaveLength(1);

  // The owner's inbox shows the tape as a link that opens away from the app, its length, and the handle.
  await gotoTab(page, 'More');
  await page.locator('.more-item').filter({ hasText: 'Requests' }).click();
  const request = page.locator('.request-card').filter({ hasText: 'Jo Park' });
  const link = request.getByRole('link', { name: TAPE }).first();
  await expect(link).toHaveAttribute('href', TAPE);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(request.getByText('10 minutes').first()).toBeVisible();
  await expect(request.getByText('@jopark').first()).toBeVisible();

  // Approved, they are in the Rolodex with their name, tape and social media.
  await request.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByText("Approved. It's in your account now.")).toBeVisible();
  await expect(page.locator('.sync-status--saved')).toBeVisible();
  await gotoTab(page, 'Rolodex');
  const row = page.getByRole('button', { name: "Open Jo Park's full profile" });
  await expect(row).toBeVisible();
  await row.click();
  const profile = page.getByRole('dialog', { name: "Jo Park's profile" });
  await expect(profile.getByLabel('Video link')).toHaveValue(TAPE);
  await expect(profile.getByLabel('Tape length')).toHaveValue('10');
});
