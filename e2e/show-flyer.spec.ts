import { expect, test, type Page } from '@playwright/test';
import { emptyState, installFakeApi } from './support/fake-api.mjs';
import { createShow, daysFromNow, gotoTab, signUpAndOnboard } from './support/app';

async function pngOf(page: Page, fill: string): Promise<Buffer> {
  const base64 = await page.evaluate((color) => {
    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 400;
    const context = canvas.getContext('2d')!;
    context.fillStyle = color;
    context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png').split(',')[1];
  }, fill);
  return Buffer.from(base64, 'base64');
}

test('every show keeps its own flyer, and the lineup comes before the running order', async ({ page, context }) => {
  await installFakeApi(context, emptyState());
  await signUpAndOnboard(page);
  await createShow(page, 'Late Set', daysFromNow(5));
  await page.getByLabel('Performer name', { exact: true }).fill('Mona Sable');
  await page.getByRole('button', { name: 'Add', exact: true }).first().click();
  await page.locator('#show-section-header-performers').click();

  // Performers are what a show opens on; the running order is further down the page.
  const lineup = (await page.locator('.show-workspace__card--performers').boundingBox())!;
  const running = (await page.getByRole('complementary', { name: 'Running order' }).boundingBox())!;
  if (lineup.x + lineup.width <= running.x) expect(lineup.x).toBeLessThan(running.x);
  else expect(lineup.y).toBeLessThan(running.y);

  const flyer = page.getByRole('region', { name: 'Flyer', exact: true });
  await expect(flyer.getByRole('button', { name: /Upload flyer/ })).toBeVisible();
  await flyer.getByLabel('Choose flyer file', { exact: true }).setInputFiles({
    name: 'flyer.png', mimeType: 'image/png', buffer: await pngOf(page, '#c33'),
  });
  await expect(flyer.getByRole('img', { name: 'Flyer for Late Set' })).toBeVisible();
  await expect(flyer.getByRole('button', { name: /Replace flyer/ })).toBeVisible();
  await expect(page.locator('.sync-status--saved')).toBeVisible();

  // A second show starts without one — the flyer belongs to its own night.
  await gotoTab(page, 'Shows');
  await createShow(page, 'Early Set', daysFromNow(9));
  await expect(page.getByRole('region', { name: 'Flyer', exact: true }).getByRole('img')).toHaveCount(0);

  // And the first one still has it after a reload.
  await page.reload();
  await gotoTab(page, 'Shows');
  await page.getByRole('button', { name: /^Open Late Set,/ }).click();
  await expect(page.getByRole('region', { name: 'Flyer', exact: true })
    .getByRole('img', { name: 'Flyer for Late Set' })).toBeVisible();
});
