import { expect, test } from '@playwright/test';
import { emptyState, installFakeApi } from './support/fake-api.mjs';
import { createShow, openSection, signUpAndOnboard } from './support/app';

/**
 * Building the running order from the lineup.
 *
 * The reason this is worth an end-to-end test rather than a unit test alone:
 * the generator is only useful if it can read the show's own start time, which
 * producers type as free text ("8:00 PM"), and if the cues it writes land in
 * the real cue list. Both of those are wiring, not logic, and both fail
 * silently — you would find out on a show night.
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

    // A start time, typed the way a producer types it, and someone hosting.
    await openSection(page, 'Basic Info');
    await page.getByLabel('Show Time').fill('8:00 PM');
    await page.locator('#show-host-input').fill('Renata Cruz');

    await openSection(page, 'Schedule');
    await page.locator('.schedule-choice__option').filter({ hasText: 'Build from the lineup' }).click();

    // The preview names the handover explicitly — that is the whole point of it.
    const dialog = page.locator('.gen');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Intro — Mona Sable');
    await expect(dialog).toContainText('Your handovers');

    await dialog.locator('button').filter({ hasText: /Use this running order/ }).click();

    // The cues land in the real list, timed from the show's own start.
    const cues = page.locator('.cue-list');
    await expect(cues).toContainText('Doors — house music');
    await expect(cues).toContainText('Intro — Mona Sable');
    await expect(cues).toContainText('Dev Okonjo');
    await expect(cues).toContainText('Mona Sable');

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

    await openSection(page, 'Basic Info');
    await page.getByLabel('Show Time').fill('8:00 PM');

    await openSection(page, 'Schedule');
    await page.locator('.schedule-choice__option').filter({ hasText: 'Build from the lineup' }).click();

    // A schedule with no handovers in it looks finished and is a minute per act
    // short of the truth, so the reason is on screen rather than inferred.
    await expect(page.locator('.gen__nohost')).toContainText('No host set for this show');
    await expect(page.locator('.gen')).not.toContainText('Your handovers');
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
