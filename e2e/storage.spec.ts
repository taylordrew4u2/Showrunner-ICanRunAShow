import { expect, test } from '@playwright/test';
import { emptyState, installFakeApi } from './support/fake-api.mjs';
import { gotoTab, signUpAndOnboard } from './support/app';

test.describe('storage', () => {
  test('the sweep clears an orphan and leaves everything in use alone', async ({ page, context }) => {
    // Seeded as an older build would have left it: a blob from a show that was
    // deleted back when deletion freed nothing. Nothing in the account points
    // at it, which is exactly why nothing could find it.
    const state = emptyState({ media: { 'ghost-from-a-deleted-show': ['x'.repeat(2048)] } });
    await installFakeApi(context, state);

    await signUpAndOnboard(page);
    await gotoTab(page, 'Settings');

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

    await signUpAndOnboard(page).catch(() => {});
    await gotoTab(page, 'Settings').catch(() => {});
    await expect(page.locator('button:has-text("Find unused files")')).toHaveCount(0);
  });
});
