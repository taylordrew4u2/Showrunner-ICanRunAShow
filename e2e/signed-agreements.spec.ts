import { expect, test } from '@playwright/test';
import { emptyState, installFakeApi } from './support/fake-api.mjs';
import { gotoTab, signUpAndOnboard } from './support/app';

const pdf = Buffer.from('%PDF-1.4\nSigned agreement fixture\n%%EOF');
test('signed venue and producer PDFs persist and download without signature requests', async ({ page, context }) => {
  const state = emptyState();
  await installFakeApi(context, state);
  await signUpAndOnboard(page);
  await gotoTab(page, 'More');
  await page.getByRole('button', { name: /Contracts/ }).click();
  const section = page.getByRole('region', { name: 'Signed agreements' });
  for (const category of ['venue', 'producer']) {
    await section.getByRole('button', { name: `Upload signed ${category} contract` }).click();
    await section.getByLabel('Signed PDF').setInputFiles({ name: `${category}.pdf`, mimeType: 'application/pdf', buffer: pdf });
    const saved = page.waitForResponse(r => r.url().includes('/api/settings') && r.request().method() === 'PUT' && r.ok());
    await section.getByRole('button', { name: 'Save signed agreement' }).click();
    await saved;
    await expect(section.getByRole('button', { name: 'Download', exact: true })).toHaveCount(category === 'venue' ? 1 : 2);
  }
  // Wait for the encrypted settings write before discarding the app's state.
  await page.reload();
  await gotoTab(page, 'More');
  await page.getByRole('button', { name: /Contracts/ }).click();
  await expect(section.getByRole('button', { name: 'Download', exact: true })).toHaveCount(2);
  const venue = section.getByRole('region', { name: 'Venue contracts' });
  await expect(venue.getByRole('button', { name: 'Download', exact: true })).toHaveCount(1);
  await expect(venue.locator('li')).toContainText('venue.pdf');
  const downloadPromise = page.waitForEvent('download');
  await venue.getByRole('button', { name: 'Download', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('venue.pdf');
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream!) chunks.push(chunk);
  expect(Buffer.concat(chunks)).toEqual(pdf);
  expect(Object.keys(state.media)).toHaveLength(2);
});

test('rejects a non-PDF without uploading it', async ({ page, context }) => {
  const state = emptyState();
  await installFakeApi(context, state);
  await signUpAndOnboard(page);
  await gotoTab(page, 'More');
  await page.getByRole('button', { name: /Contracts/ }).click();
  const section = page.getByRole('region', { name: 'Signed agreements' });
  await section.getByRole('button', { name: 'Upload signed venue contract' }).click();
  await section.getByLabel('Signed PDF').setInputFiles({ name: 'fake.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a PDF') });
  await section.getByRole('button', { name: 'Save signed agreement' }).click();
  await expect(section.getByRole('alert')).toContainText('Choose a PDF');
  expect(Object.keys(state.media)).toHaveLength(0);
});
