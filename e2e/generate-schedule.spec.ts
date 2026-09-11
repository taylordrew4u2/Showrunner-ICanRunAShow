import { expect, test } from '@playwright/test';
import { emptyState, installFakeApi } from './support/fake-api.mjs';
import { createShow, openSection, signUpAndOnboard } from './support/app';

/**
 * Building the running order from the lineup.
 *
 * Worth an end-to-end test rather than a unit test alone because the cues the
 * generator writes have to land in the real cue list, timed from the top of
 * the show. That is wiring, not logic, and it fails silently — you would find
 * out on a show night.
 */
test.describe('generating a run-of-show', () => {
  test('turns the booked lineup into a timed cue list with the host between acts', async ({
    page,
    context,
  }) => {
    const state = emptyState();
    await installFakeApi(context, state);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await signUpAndOnboard(page);
    await createShow(page, 'Basement Comedy Hour');

    // Two comics on the bill. Performers opens by default on a new show, so
    // the add field is already there.
    for (const name of ['Dev Okonjo', 'Mona Sable']) {
      await page.getByLabel('Performer name').fill(name);
      await page.locator('button').filter({ hasText: /^Add$/ }).first().click();
      await expect(page.locator('.section-list')).toContainText(name);
    }

    // Only a host — no start time anywhere, because the sheet does not need one.
    await openSection(page, 'Basic Info');
    await page.locator('#show-host-input').fill('Renata Cruz');

    await openSection(page, 'Schedule');
    await page.locator('.schedule-choice__option').filter({ hasText: 'Build from the lineup' }).click();

    // The preview names the handover explicitly — that is the whole point of it.
    const dialog = page.locator('.gen');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Intro — Mona Sable');
    await expect(dialog).toContainText('Your handovers');

    await dialog.locator('button').filter({ hasText: /Use this running order/ }).click();

    // The cues land in the real list, counting from the top of the night
    // rather than off a clock that will be wrong the moment doors run late.
    const cues = page.locator('.cue-list');
    await expect(cues).toContainText('Doors — house music');
    await expect(cues).toContainText('0:00');
    await expect(cues).toContainText('Intro — Mona Sable');
    await expect(cues).toContainText('Dev Okonjo');
    await expect(cues).toContainText('Mona Sable');
    // No wall-clock times anywhere on the sheet.
    await expect(cues).not.toContainText('PM');

    expect(errors).toEqual([]);
  });

  test('says so when there is no host, rather than quietly skipping the intros', async ({
    page,
    context,
  }) => {
    const state = emptyState();
    await installFakeApi(context, state);

    await signUpAndOnboard(page);
    await createShow(page, 'Hostless Night');

    await page.getByLabel('Performer name').fill('Dev Okonjo');
    await page.locator('button').filter({ hasText: /^Add$/ }).first().click();
    await expect(page.locator('.section-list')).toContainText('Dev Okonjo');

    await openSection(page, 'Schedule');
    await page.locator('.schedule-choice__option').filter({ hasText: 'Build from the lineup' }).click();

    // A schedule with no handovers in it looks finished and is a minute per act
    // short of the truth, so the reason is on screen rather than inferred.
    await expect(page.locator('.gen__nohost')).toContainText('No host set for this show');
    await expect(page.locator('.gen')).not.toContainText('Your handovers');
  });

  test('reorders the bill and re-times the sheet before anything is committed', async ({
    page,
    context,
  }) => {
    const state = emptyState();
    await installFakeApi(context, state);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await signUpAndOnboard(page);
    await createShow(page, 'Closer Closes');

    for (const name of ['Dev Okonjo', 'Mona Sable']) {
      await page.getByLabel('Performer name').fill(name);
      await page.locator('button').filter({ hasText: /^Add$/ }).first().click();
      await expect(page.locator('.section-list')).toContainText(name);
    }

    await openSection(page, 'Basic Info');
    await page.locator('#show-host-input').fill('Renata Cruz');

    await openSection(page, 'Schedule');
    await page.locator('.schedule-choice__option').filter({ hasText: 'Build from the lineup' }).click();

    const dialog = page.locator('.gen');
    await expect(dialog).toBeVisible();
    // Straight to a timed sheet: nothing to fill in first.
    await expect(dialog.locator('.gen__cue').first()).toContainText('0:00');

    // The closer closes, and gets twenty.
    await dialog.getByLabel('Move Dev Okonjo later').click();
    await dialog.getByLabel('Set length for Dev Okonjo, in minutes').fill('20');
    await expect(dialog.locator('.gen__totals')).toContainText('Runs');

    await dialog.locator('button').filter({ hasText: /Use this running order/ }).click();

    const cues = page.locator('.cue-list');
    await expect(cues).toContainText('Intro — Dev Okonjo');
    // Mona now opens, so she is the one folded into the host's welcome.
    await expect(cues).not.toContainText('Intro — Mona Sable');

    expect(errors).toEqual([]);
  });

  test('is not offered before anyone is booked', async ({ page, context }) => {
    const state = emptyState();
    await installFakeApi(context, state);

    await signUpAndOnboard(page);
    await createShow(page, 'Empty Bill');
    await openSection(page, 'Schedule');

    // Nothing to build from, so the option stays off the choice screen rather
    // than opening onto an empty preview.
    await expect(
      page.locator('.schedule-choice__option').filter({ hasText: 'Build from the lineup' }),
    ).toHaveCount(0);
  });
});
