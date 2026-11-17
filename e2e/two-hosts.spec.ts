import { expect, test, type Page } from '@playwright/test';
import type { Show } from '../src/types';
import { decryptWithKey, deriveKey } from '../src/utils/encryption';
import { emptyState, installFakeApi } from './support/fake-api.mjs';
import { createShow, gotoTab, PASSWORD, signUpAndOnboard } from './support/app';

/** Publish the show's viewer page and hand back the link the room is given. */
async function publishViewerLink(page: Page): Promise<string> {
  await page.locator('button[aria-label="More"], .more-menu__trigger').first().click();
  await page.getByText('Viewer link', { exact: true }).click();
  await expect(page.locator('.viewer-link-modal')).toBeVisible();
  await page.locator('.viewer-link-modal__actions .btn--primary').click();
  const link = await page.locator('.viewer-link-modal__url-row input').inputValue();
  expect(link).toContain('/live?t=');
  await page.locator('.viewer-link-modal__actions').getByRole('button', { name: 'Close' }).click();
  return link;
}

/** Back into the account's one show from the Shows page, where it is the night coming up. */
async function reopenShow(page: Page) {
  await gotoTab(page, 'Shows');
  await page.getByRole('button', { name: 'Open show', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Basement Comedy Hour', level: 1 })).toBeVisible();
}

async function openPostCopy(page: Page) {
  await page.getByRole('navigation', { name: 'Show sections' }).getByRole('button', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: 'Post copy', exact: true }).click();
  await expect(page.locator('.announce__text')).toBeVisible();
  return page.locator('.announce__text');
}

/**
 * Two hosts, each with a handle.
 *
 * A show had one host, a name and nothing else, so the person the post most
 * needed to tag was the one it could not. Worth an end-to-end test because
 * the hosts have to arrive in three places from one edit: the show page that
 * keeps them, the caption that tags them, and the page the room is sent to.
 */
test('two hosts and their handles reach the show page, Post copy and the viewer page', async ({ page, context, browser }) => {
  test.setTimeout(120_000);
  const state = emptyState();
  await installFakeApi(context, state);
  await signUpAndOnboard(page);

  // One host is on file with a handle; the other is only a name tonight.
  await gotoTab(page, 'Rolodex');
  await page.locator('.rolodex__input').first().fill('Mona Sable');
  await page.locator('.rolodex__form button[type="submit"]').click();
  await page.getByRole('button', { name: "Open Mona Sable's full profile", exact: true }).click();
  await page.locator('.perf-profile').getByLabel('Instagram / Social', { exact: true }).fill('@monasable');
  await page.locator('.perf-profile').getByRole('button', { name: 'Save Changes', exact: true }).click();
  await page.locator('.perf-profile').getByRole('button', { name: '← Back', exact: true }).click();

  await gotoTab(page, 'Shows');
  await createShow(page, 'Basement Comedy Hour');
  await page.getByLabel('Performer name').fill('Dev Okonjo');
  await page.locator('button').filter({ hasText: /^Add$/ }).first().click();
  await expect(page.locator('.section-list')).toContainText('Dev Okonjo');

  // The first host, picked from the Rolodex: the handle comes with her.
  const hostCard = page.locator('.show-detail__host');
  await expect(page.locator('#show-cohost-input')).toHaveCount(0);
  await hostCard.locator('.show-detail__host-pick').click();
  await hostCard.locator('.show-detail__host-option').filter({ hasText: 'Mona Sable' }).click();
  await expect(page.getByLabel('Host', { exact: true })).toHaveValue('Mona Sable');
  await expect(page.getByLabel("Host's social", { exact: true })).toHaveValue('@monasable');

  // The second, typed by hand with a pasted profile link.
  await hostCard.getByRole('button', { name: 'Add a second host', exact: true }).click();
  await page.getByLabel('Second host', { exact: true }).fill('Jo Park');
  await page.getByLabel("Second host's social", { exact: true }).fill('https://www.instagram.com/joparkjokes/');
  await expect(page.getByLabel('Second host', { exact: true })).toHaveValue('Jo Park');

  // Post copy names both on one line and tags them with the bill.
  let caption = await openPostCopy(page);
  await expect(caption).toHaveValue(/Hosted by Mona Sable @monasable and Jo Park @joparkjokes/);
  await expect(caption).toHaveValue(/@monasable @joparkjokes$/);
  await expect(page.getByRole('button', { name: 'Copy tags (2)', exact: true })).toBeVisible();
  // The comic with nothing saved is still the only one to chase.
  await expect(page.locator('.announce__missing')).toContainText('Dev Okonjo');
  await expect(page.locator('.announce__missing')).not.toContainText('Jo Park');
  await page.locator('.announce__actions').getByRole('button', { name: 'Close', exact: true }).click();

  // The room's page: both hosts under the show's name, handles as links.
  const link = await publishViewerLink(page);
  const room = await browser.newContext();
  await installFakeApi(room, state);
  const screen = await room.newPage();
  await screen.goto(link);
  await expect(screen.locator('.live-viewer__show')).toHaveText('Basement Comedy Hour');
  await expect(screen.locator('.live-viewer__hosts')).toHaveText('Hosted by Mona Sable @monasable and Jo Park @joparkjokes');
  await expect(screen.getByRole('link', { name: '@monasable', exact: true })).toHaveAttribute('href', 'https://instagram.com/monasable');
  await expect(screen.getByRole('link', { name: '@joparkjokes', exact: true })).toHaveAttribute('href', 'https://www.instagram.com/joparkjokes/');

  // Saved with the show, the first host where one host always was.
  const key = deriveKey(PASSWORD);
  const saved = () => state.shows.map((row) => decryptWithKey<Show>(row.encryptedData, key))[0];
  await expect.poll(() => saved()?.coHostSocial).toBe('https://www.instagram.com/joparkjokes/');
  expect(saved()).toMatchObject({ host: 'Mona Sable', hostSocial: '@monasable', coHost: 'Jo Park' });
  expect(saved().hostComicId).toBeTruthy();
  expect(saved().coHostComicId).toBeUndefined();

  // A new handle in the Rolodex is the host's new handle, here and in the room.
  await gotoTab(page, 'Rolodex');
  await page.getByRole('button', { name: "Open Mona Sable's full profile", exact: true }).click();
  await page.locator('.perf-profile').getByLabel('Instagram / Social', { exact: true }).fill('@mona.sable.comedy');
  await page.locator('.perf-profile').getByRole('button', { name: 'Save Changes', exact: true }).click();
  await page.locator('.perf-profile').getByRole('button', { name: '← Back', exact: true }).click();
  await reopenShow(page);
  await expect(page.getByLabel("Host's social", { exact: true })).toHaveValue('@mona.sable.comedy');
  await expect(screen.locator('.live-viewer__hosts')).toHaveText('Hosted by Mona Sable @mona.sable.comedy and Jo Park @joparkjokes', { timeout: 20_000 });

  // Both survive a reload, and either can be taken off.
  await page.reload();
  await reopenShow(page);
  await expect(page.getByLabel('Second host', { exact: true })).toHaveValue('Jo Park');
  await expect(page.getByLabel("Second host's social", { exact: true })).toHaveValue('https://www.instagram.com/joparkjokes/');
  await page.getByRole('button', { name: 'Remove the host', exact: true }).click();
  // The one left is the host.
  await expect(page.getByLabel('Host', { exact: true })).toHaveValue('Jo Park');
  await expect(page.getByLabel("Host's social", { exact: true })).toHaveValue('https://www.instagram.com/joparkjokes/');
  await expect(page.locator('#show-cohost-input')).toHaveCount(0);
  caption = await openPostCopy(page);
  await expect(caption).toHaveValue(/Hosted by Jo Park @joparkjokes\n/);
  await expect(caption).not.toHaveValue(/Mona Sable/);
  await expect(screen.locator('.live-viewer__hosts')).toHaveText('Hosted by Jo Park @joparkjokes', { timeout: 20_000 });

  await room.close();
});

/**
 * A handle typed beside a host is filed on a Rolodex entry only for the name
 * the producer finished typing.
 *
 * The show is reconciled with the Rolodex on every keystroke, and "Alice" is
 * "Al" on the way: filed then, Al's entry kept Alice's handle and the host
 * lost it a key later. Only the app shows the keys arriving one at a time.
 */
test('a host name typed a key at a time keeps its handle, which is filed only on the entry it ends as', async ({ page, context }) => {
  test.setTimeout(120_000);
  const state = emptyState();
  await installFakeApi(context, state);
  await signUpAndOnboard(page);

  // Two people on file, neither with a handle.
  await gotoTab(page, 'Rolodex');
  for (const name of ['Al', 'Bea Lund']) {
    await page.locator('.rolodex__input').first().fill(name);
    await page.locator('.rolodex__form button[type="submit"]').click();
    await expect(page.getByRole('button', { name: `Open ${name}'s full profile`, exact: true })).toBeVisible();
  }

  await gotoTab(page, 'Shows');
  await createShow(page, 'Basement Comedy Hour');

  // The handle first, then a name that passes through "Al".
  await page.getByLabel("Host's social", { exact: true }).fill('@alice');
  await page.getByLabel('Host', { exact: true }).pressSequentially('Alice');
  await expect(page.getByLabel('Host', { exact: true })).toHaveValue('Alice');
  await expect(page.getByLabel("Host's social", { exact: true })).toHaveValue('@alice');

  // The second host is someone on file: leaving the field files her handle.
  await page.locator('.show-detail__host').getByRole('button', { name: 'Add a second host', exact: true }).click();
  await page.getByLabel("Second host's social", { exact: true }).fill('@bealund');
  await page.getByLabel('Second host', { exact: true }).pressSequentially('Bea Lund');
  await page.getByLabel('Second host', { exact: true }).blur();
  await expect(page.getByLabel("Second host's social", { exact: true })).toHaveValue('@bealund');

  const key = deriveKey(PASSWORD);
  const saved = () => state.shows.map((row) => decryptWithKey<Show>(row.encryptedData, key))[0];
  await expect.poll(() => saved()?.coHostComicId).toBeTruthy();
  expect(saved()).toMatchObject({ host: 'Alice', hostSocial: '@alice', coHost: 'Bea Lund', coHostSocial: '@bealund' });
  expect(saved().hostComicId).toBeUndefined();

  await gotoTab(page, 'Rolodex');
  await page.getByRole('button', { name: "Open Bea Lund's full profile", exact: true }).click();
  await expect(page.locator('.perf-profile').getByLabel('Instagram / Social', { exact: true })).toHaveValue('@bealund');
  await page.locator('.perf-profile').getByRole('button', { name: '← Back', exact: true }).click();
  await page.getByRole('button', { name: "Open Al's full profile", exact: true }).click();
  await expect(page.locator('.perf-profile').getByLabel('Instagram / Social', { exact: true })).toHaveValue('');
});
