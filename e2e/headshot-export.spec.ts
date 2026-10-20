import { expect, test, type Page } from '@playwright/test';
import { emptyState, installFakeApi } from './support/fake-api.mjs';
import { createShow, signUpAndOnboard } from './support/app';

/**
 * Every face on the bill, in one download.
 *
 * Worth an end-to-end run because the value is in the whole trip: photos
 * that went up through the encrypted media store have to come back down,
 * decrypted, and land in the archive under the names on the bill — not
 * "headshot (3).jpg", which is what the producer was renaming by hand.
 */

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

/** Each file in a zip, read the way an unzip tool finds them: from the central directory. */
function zipEntries(zip: Buffer): { name: string; data: Buffer }[] {
  const end = zip.length - 22;
  expect(zip.readUInt32LE(end)).toBe(0x06054b50);
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(at)).toBe(0x02014b50);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const local = zip.readUInt32LE(at + 42);
    expect(zip.readUInt32LE(local)).toBe(0x04034b50);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    entries.push({ name: zip.toString('utf8', at + 46, at + 46 + nameLength), data: zip.subarray(start, start + size) });
    at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
  }
  return entries;
}

test('every headshot on a show downloads as one zip, each file named after the performer', async ({ page, context }) => {
  await installFakeApi(context, emptyState());
  await signUpAndOnboard(page);
  await createShow(page, 'Late Set');

  const bill = [['Mona Sable', '#bd7188'], ['Dev Okonjo', '#487eb0']] as const;
  for (const [name] of bill) {
    await page.getByLabel('Performer name', { exact: true }).fill(name);
    await page.getByRole('button', { name: 'Add', exact: true }).first().click();
    await expect(page.locator('.section-list')).toContainText(name);
  }
  // Nobody has a photo yet, so there is nothing to offer.
  await expect(page.getByRole('button', { name: /^Download \d+ headshots?$/ })).toHaveCount(0);

  for (const [name, color] of bill) {
    await page.getByRole('button', { name: `Open ${name}'s profile`, exact: true }).click();
    const drawer = page.locator('.perf-drawer');
    const panel = drawer.getByRole('region', { name: 'Headshot', exact: true });
    await panel.getByLabel('Choose headshot file', { exact: true }).setInputFiles({
      name: 'headshot.png', mimeType: 'image/png', buffer: await pngOf(page, color),
    });
    await expect(panel.locator('.headshot__image')).toBeVisible();
    await drawer.locator('.perf-profile__back').click();
  }
  await expect(page.locator('.sync-status--saved')).toBeVisible();

  // The phone project wears an iPhone's user agent, where a browser that can
  // share files opens the share sheet instead. This one is held to the zip,
  // so both projects test the same download.
  await page.evaluate(() => Object.defineProperty(navigator, 'canShare', { configurable: true, value: undefined }));

  const button = page.getByRole('button', { name: 'Download 2 headshots', exact: true });
  const downloaded = page.waitForEvent('download');
  await button.click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe('Late Set headshots.zip');
  expect(await download.failure()).toBeNull();

  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const entries = zipEntries(Buffer.concat(chunks));
  expect(entries.map((entry) => entry.name)).toEqual(['Mona Sable.jpg', 'Dev Okonjo.jpg']);
  // The photos themselves, not empty files: each opens as a JPEG.
  for (const entry of entries) expect([...entry.data.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);

  // Everything came through, so there is nothing to report.
  await expect(button).toBeEnabled();
  await expect(page.locator('.headshot-export__note')).toHaveCount(0);
});
