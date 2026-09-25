import { expect, test, type Page } from '@playwright/test';
import { deriveUserId, hashPassword } from '../src/utils/encryption';
import { emptyState, installFakeApi } from './support/fake-api.mjs';
import { createShow, openSection, PASSWORD, signUpAndOnboard } from './support/app';

/** Publish the show's viewer page and hand back the link the room is given. */
async function publishViewerLink(page: Page): Promise<string> {
  await page.locator('button[aria-label="More"], .more-menu__trigger').first().click();
  await page.getByText('Viewer link', { exact: true }).click();
  await expect(page.locator('.viewer-link-modal')).toBeVisible();
  // Saving is what mints the token and publishes the first payload.
  await page.locator('.viewer-link-modal__actions .btn--primary').click();
  const link = await page.locator('.viewer-link-modal__url-row input').inputValue();
  expect(link).toContain('/live?t=');
  await page.locator('.viewer-link-modal__actions').getByRole('button', { name: 'Close' }).click();
  return link;
}

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
    await publishViewerLink(page);
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

    // Signed in as somebody else — a real account, made the way any producer's
    // is. Accounts are free, so having one is no claim on the token.
    const signedUp = await outsider.evaluate(async () => {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'signup', userId: 'someone-else', passwordHash: 'their-credential' }),
      });
      return res.status;
    });
    expect(signedUp).toBe(200);
    expect(await post({ 'x-user-id': 'someone-else', 'x-auth': 'their-credential' })).toBe(403);
    expect(state.rejectedForeignPublish).toBe(true);

    // The owner's name with a guessed credential is not the owner.
    expect(await post({ 'x-user-id': owner!, 'x-auth': 'a guess' })).toBe(401);

    // And with no account at all.
    expect(await post({})).toBe(401);

    await outsiderContext.close();

    // The page the room is looking at is untouched.
    expect(state.live[token].userId).toBe(owner);
    expect(JSON.stringify(state.live[token].payload)).not.toContain('DEFACED');
  });

  /**
   * The screen the room actually looks at.
   *
   * Everything above checks rows on the server. This opens the link on a
   * second browser — no account, no session, only the address — and watches
   * it follow the producer's board: the show's name before doors, then the cue
   * on stage, the clock, and the next cue when the producer moves on.
   */
  test('the room sees the show name, the cue on stage and the clock as the producer runs it', async ({ page, context, browser }) => {
    const state = emptyState();
    await installFakeApi(context, state);
    await signUpAndOnboard(page);
    await createShow(page, 'Basement Comedy Hour');
    await openSection(page, 'Schedule');
    const build = page.locator('.schedule-choice__option').filter({ hasText: 'Build Your Own' });
    if (await build.count()) await build.first().click();
    for (const cue of ['Host intro', 'Headliner']) {
      await page.locator('input[aria-label="Description"]').fill(cue);
      await page.locator('button[aria-label="Add cue"]').click();
    }
    await expect(page.locator('.cue-list')).toContainText('Headliner');
    const link = await publishViewerLink(page);

    const room = await browser.newContext();
    await installFakeApi(room, state);
    const screen = await room.newPage();
    await screen.goto(link);

    // Before the show: the name and the start, not a timer.
    await expect(screen.locator('.live-viewer__show')).toHaveText('Basement Comedy Hour');
    await expect(screen.locator('.live-viewer__pre-label')).toHaveText('Showtime');

    // The producer opens the board: the room switches to the running order.
    await page.locator('button:has-text("Run Show")').first().click();
    await expect(page.locator('.run-show')).toBeVisible();
    const onStage = screen.locator('.live-viewer__card').first().locator('.live-viewer__name');
    const upNext = screen.locator('.live-viewer__card').last().locator('.live-viewer__name');
    await expect(onStage).toHaveText('Host intro');
    await expect(upNext).toHaveText('Headliner');
    await expect(screen.locator('.live-viewer__timer')).toHaveText(/^-?\d{2,}:\d\d$/);

    const transport = page.locator('.rs-transport button');
    await transport.filter({ hasText: 'Start' }).click();
    await expect(screen.locator('.live-viewer__status')).toHaveText('running');
    await transport.filter({ hasText: 'Next' }).click();
    await expect(onStage).toHaveText('Headliner');
    await expect(upNext).toHaveText('End of show');

    // Venue wifi: the earlier publish lands after the later one. The server
    // keeps what the room is showing rather than putting the previous cue
    // back, and tells the board so.
    const token = new URL(link).searchParams.get('t')!;
    const held = (state.live[token].payload as { lastUpdateMs: number }).lastUpdateMs;
    const late = await page.evaluate(
      async ({ token, headers, lastUpdateMs }) => {
        const res = await fetch('/api/live', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...headers },
          body: JSON.stringify({
            token,
            payload: { showName: 'Basement Comedy Hour', status: 'running', segment: { name: 'Host intro' }, lastUpdateMs },
          }),
        });
        return { status: res.status, body: await res.json() };
      },
      {
        token,
        headers: { 'x-user-id': deriveUserId('producer'), 'x-auth': hashPassword(PASSWORD) },
        lastUpdateMs: held - 5_000,
      },
    );
    expect(late).toEqual({ status: 200, body: { ok: true, stale: true } });
    expect((state.live[token].payload as { lastUpdateMs: number }).lastUpdateMs).toBe(held);
    await expect(onStage).toHaveText('Headliner');

    await room.close();
  });
});
