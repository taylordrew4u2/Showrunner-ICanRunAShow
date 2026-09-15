import { expect, test } from '@playwright/test';
import { emptyState, installFakeApi } from './support/fake-api.mjs';
import { createShow, openSection, signUpAndOnboard } from './support/app';

test('every show has the workspace with private notes and working planning tools', async ({page, context}, testInfo) => {
  if (testInfo.project.name === 'desktop') await page.setViewportSize({width:1440,height:1000});
  await page.emulateMedia({reducedMotion:'reduce'});
  await installFakeApi(context, emptyState());
  await signUpAndOnboard(page);
  await createShow(page, 'Bad Decisions', '2026-09-24');
  await expect(page.getByRole('navigation', {name:'Show sections'})).toBeVisible();
  for (const name of ['Mona Sable', 'Dev Okonjo', 'Renata Cruz']) {
    await page.getByLabel('Performer name', {exact:true}).fill(name);
    await page.getByRole('button', {name:'Add', exact:true}).first().click();
  }
  await page.getByLabel('Host', {exact:true}).fill('Taylor Drew');
  await page.getByLabel('Production notes', {exact:true}).fill('Soundcheck at 7. Bring spare batteries.');
  await openSection(page, 'Basic Info');
  await page.getByLabel('Venue Name', {exact:true}).fill('Pixelated Records');
  await openSection(page, 'Schedule');
  await page.locator('.schedule-choice__option').filter({hasText:'Build from the lineup'}).click();
  await page.locator('.gen').getByRole('button', {name:/Use this running order/}).click();
  await expect(page.getByRole('complementary', {name:'Running order'})).toContainText('Mona Sable');
  // Close expanded editors for the overview screenshot; all remain accessible.
  await page.locator('#show-section-header-performers').click();
  await page.locator('#show-section-header-basic').click();
  await page.locator('#show-section-header-schedule').click();
  await page.getByRole('navigation', {name:'Show sections'}).getByRole('button', {name:'Overview',exact:true}).click();
  await page.evaluate(() => { document.querySelector('.app-main')?.scrollTo(0,0); window.scrollTo(0,0); });
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.screenshot({path:testInfo.outputPath('workspace.png'),fullPage:false});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByText('Everything is saved',{exact:false})).toBeVisible();
  await page.getByRole('button', {name:'Back to shows',exact:true}).click();
  await createShow(page, 'Second show');
  await expect(page.getByLabel('Production notes', {exact:true})).toHaveValue('');
  await expect(page.locator('.show-workspace')).toBeVisible();
  await page.getByRole('button',{name:'Back to shows',exact:true}).click();
  await page.getByRole('button',{name:/^Open Bad Decisions,/}).click();
  await expect(page.getByLabel('Production notes',{exact:true})).toHaveValue('Soundcheck at 7. Bring spare batteries.');
  await page.getByRole('button', {name: "Open Mona Sable's profile", exact:true}).click();
  await expect(page.locator('.perf-drawer')).toBeVisible();
  await expect(page.locator('.perf-drawer').getByLabel('Name', {exact:true})).toHaveValue('Mona Sable');
  await page.locator('.perf-profile__back').click();
  await page.getByRole('button',{name:'Run Show',exact:true}).click();
  await expect(page.locator('.run-show')).toBeVisible();
});
