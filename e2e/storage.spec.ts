import { expect, test } from '@playwright/test';
import { emptyState, installFakeApi } from './support/fake-api.mjs';
import { gotoTab, signUp, signUpAndOnboard } from './support/app';

test.describe('storage', () => {
  test('the sweep clears an orphan and leaves everything in use alone', async ({ page, context }) => {
    // Seeded as an older build would have left it: a blob from a show that was
    // deleted back when deletion freed nothing. Nothing in the account points
    // at it, which is exactly why nothing could find it.
    const state = emptyState({ media: { 'ghost-from-a-deleted-show': ['x'.repeat(2048)] } });
    await installFakeApi(context, state);

    await signUpAndOnboard(page);
    await gotoTab(page, 'Settings');

    // The data card's parts are folded; the sweep is the last of them.
    await page.locator('summary:has-text("Unused files")').click();
    await page.locator('button:has-text("Find unused files")').click();
    await expect(page.locator('.settings__sweep-result')).toContainText('1 unused file');

    page.once('dialog', (d) => d.accept());
    await page.locator('button:has-text("Delete them")').click();
    const confirm = page.locator('button').filter({ hasText: /^Delete them$/ }).last();
    if (await confirm.count()) await confirm.click();

    await expect(page.locator('.settings__sweep-result')).toContainText('Cleared 1 file');
    expect(state.media['ghost-from-a-deleted-show']).toBeUndefined();
  });

  test('the sweep is not offered before the account has loaded', async ({ page, context }) => {
    // The failure that would empty an account rather than a bin: a client that
    // cannot see its own data would judge every stored file unused.
    await installFakeApi(context, emptyState({ media: { orphan: ['x'] } }));
    // Registered *after* the fake, because Playwright tries the most recently
    // added route first — the other order leaves the fake answering happily
    // and the load never fails at all.
    await context.route('**/api/shows', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' }),
    );

    // No onboarding to walk: a launch that could not load the account shows
    // the shows page with the error on it, not the first-run questions.
    await signUp(page);
    await expect(page.getByRole('alert')).toContainText("Couldn't load your shows");
    await gotoTab(page, 'Settings');
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    // The sweep's whole section is withheld, not just its button.
    await expect(page.locator('summary:has-text("Unused files")')).toHaveCount(0);
    await expect(page.locator('button:has-text("Find unused files")')).toHaveCount(0);
  });
});
