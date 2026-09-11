import { expect, test } from '@playwright/test';
import { emptyState, installFakeApi } from './support/fake-api.mjs';
import { createShow, gotoTab, signUpAndOnboard } from './support/app';

/**
 * The version a save replaces is not gone. Before this, an account's history
 * was three saves deep and readable only by the server — a wrong edit and two
 * autosaves later, the past was flushed. Now it is a list on the Settings
 * page, and bringing a version back keeps the version it replaces.
 */
test.describe('earlier versions', () => {
  test('a show list can be rolled back, and the rollback itself undone', async ({ page, context }) => {
    const state = emptyState();
    await installFakeApi(context, state);

    await signUpAndOnboard(page);
    await createShow(page, 'First night');
    // Let the first save land on its own, so the second has a version to keep.
    await expect.poll(() => state.shows.length).toBe(1);
    await gotoTab(page, 'Shows');
    await createShow(page, 'Second night');
    await gotoTab(page, 'Shows');
    await expect(page.locator('.show-card')).toHaveCount(2);
    // The second save is the first with something to keep a copy of.
    await expect.poll(() => state.showSnapshots.length).toBeGreaterThan(0);

    await gotoTab(page, 'Settings');
    await page.locator('summary:has-text("Earlier versions")').click();
    await page.locator('button:has-text("Show earlier versions")').click();
    const oneShow = page.locator('.settings__version', { hasText: '1 show' }).first();
    await expect(oneShow).toBeVisible();
    await oneShow.locator('button:has-text("Restore")').click();
    await page.locator('.confirm-dialog__actions button:has-text("Restore")').click();
    await expect(page.locator('.settings__sweep-result')).toContainText('Restored the version');

    await gotoTab(page, 'Shows');
    // Back to one show, so the list gives way to the panel (see shows-list).
    await expect(page.locator('.show-card')).toHaveCount(0);
    await expect(page.locator('.dash-next__name')).toHaveText('First night');

    // A way back: the two-show list the restore replaced is now itself an
    // earlier version.
    await expect.poll(() => state.shows.length).toBe(1);
    await gotoTab(page, 'Settings');
    await page.locator('summary:has-text("Earlier versions")').click();
    await page.locator('button:has-text("Show earlier versions")').click();
    await expect(page.locator('.settings__version', { hasText: '2 shows' }).first()).toBeVisible();
  });
});
