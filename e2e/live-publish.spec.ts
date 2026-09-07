import { expect, test } from '@playwright/test';
import { emptyState, installFakeApi } from './support/fake-api.mjs';
import { createShow, signUpAndOnboard } from './support/app';

/**
 * Who is allowed to write to the audience's page.
 *
 * The viewer token is handed to the room on purpose, so it identifies the page
 * but must not be the permission to change it. Publishing used to be
 * anonymous, which meant anyone holding a viewer link could overwrite what the
 * screen showed mid-show.
 */
test.describe('publishing to the live viewer', () => {
  test('a viewer link does not let its holder overwrite the page', async ({ page, context, browser }) => {
    const state = emptyState();
    await installFakeApi(context, state);
    await signUpAndOnboard(page);
    await createShow(page, 'Basement Comedy Hour');

    // Publish the show's viewer page as the producer.
    await page.locator('button[aria-label="More"], .more-menu__trigger').first().click();
    await page.getByText('Viewer link', { exact: true }).click();
    await expect(page.locator('.viewer-link-modal')).toBeVisible();
    // Saving is what mints the token and publishes the first payload.
    await page.locator('.viewer-link-modal__actions .btn--primary').click();
    await expect.poll(() => Object.keys(state.live).length).toBeGreaterThan(0);
    const [token, row] = Object.entries(state.live)[0];
    const owner = row.userId;
    expect(owner).toBeTruthy();

    // Now somebody who merely holds the link tries to publish over it. A
    // separate browser, sharing only the server — which is exactly what an
    // audience member with the link has. The request goes through a page so it
    // reaches the same fake backend the producer is talking to.
    const outsiderContext = await browser.newContext();
    await installFakeApi(outsiderContext, state);
    const outsider = await outsiderContext.newPage();
    await outsider.goto('/');

    const post = (headers: Record<string, string>) =>
      outsider.evaluate(
        async ({ token, headers }) => {
          const res = await fetch('/api/live', {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...headers },
            body: JSON.stringify({ token, payload: { onStage: { name: 'DEFACED' } } }),
          });
          return res.status;
        },
        { token, headers },
      );

    // Signed in as somebody else: the token is not theirs.
    expect(await post({ 'x-user-id': 'someone-else', 'x-auth': 'whatever' })).toBe(403);
    expect(state.rejectedForeignPublish).toBe(true);

    // And with no account at all.
    expect(await post({})).toBe(401);

    await outsiderContext.close();

    // The page the room is looking at is untouched.
    expect(state.live[token].userId).toBe(owner);
    expect(JSON.stringify(state.live[token].payload)).not.toContain('DEFACED');
  });
});
