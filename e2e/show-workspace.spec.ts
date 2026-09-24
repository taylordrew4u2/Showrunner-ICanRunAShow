import { expect, test } from '@playwright/test';
import { emptyState, installFakeApi } from './support/fake-api.mjs';
import { createShow, daysFromNow, gotoTab, openSection, signUpAndOnboard } from './support/app';

test('every show has the workspace with private notes and working planning tools', async ({page, context}, testInfo) => {
  if (testInfo.project.name === 'desktop') await page.setViewportSize({width:1440,height:1000});
  await page.emulateMedia({reducedMotion:'reduce'});
  await installFakeApi(context, emptyState());
  await signUpAndOnboard(page);
  await createShow(page, 'Bad Decisions', daysFromNow(3));
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
  await page.locator('#show-section-header-schedule').scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.screenshot({path:testInfo.outputPath('workspace-schedule-editor.png'),fullPage:false,animations:'disabled'});
  // Close expanded editors for the overview screenshot; all remain accessible.
  await page.locator('#show-section-header-performers').click();
  await page.locator('#show-section-header-basic').click();
  await page.locator('#show-section-header-schedule').click();
  await page.getByRole('navigation', {name:'Show sections'}).getByRole('button', {name:'Overview',exact:true}).click();
  await page.evaluate(() => { document.querySelector('.app-main')?.scrollTo(0,0); window.scrollTo(0,0); });
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.screenshot({path:testInfo.outputPath('workspace.png'),fullPage:false,animations:'disabled'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('.sync-status--saved')).toBeVisible();

  // Scrolled well into the show, the Run Show bar is the only thing pinned: it
  // sits flush under the status band, spans the card edge to edge, and the
  // section tabs have scrolled away rather than stacking above it. Two pinned
  // bars ate a quarter of a phone screen with the page showing through the
  // seams between them.
  await page.evaluate(() => { document.querySelector('.app-main')?.scrollTo(0, 700); window.scrollTo(0, 700); });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const pinned = await page.evaluate(() => {
    const bar = document.querySelector('.show-detail__topbar')!.getBoundingClientRect();
    const body = document.querySelector('.show-workspace__body')!.getBoundingClientRect();
    const tabs = document.querySelector('.show-workspace__sidebar')!.getBoundingClientRect();
    const band = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--status-band'));
    return { barTop: Math.round(bar.top), band, barLeft: Math.round(bar.left), bodyLeft: Math.round(body.left),
      barRight: Math.round(bar.right), bodyRight: Math.round(body.right), tabsBottom: Math.round(tabs.bottom),
      docScrollable: document.documentElement.scrollHeight > innerHeight };
  });
  expect(pinned.barTop).toBe(pinned.band);
  expect(pinned.barLeft).toBe(pinned.bodyLeft);
  expect(pinned.barRight).toBe(pinned.bodyRight);
  expect(pinned.tabsBottom).toBeLessThanOrEqual(pinned.barTop);
  // On desktop the shell is the scroll container; the document itself must not
  // scroll, or the whole shell slides off the top of the window.
  if (testInfo.project.name === 'desktop') expect(pinned.docScrollable).toBe(false);
  await page.evaluate(() => { document.querySelector('.app-main')?.scrollTo(0,0); window.scrollTo(0,0); });
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
  await page.screenshot({path:testInfo.outputPath('workspace-run-show.png'),fullPage:false,animations:'disabled'});
  await page.getByRole('button',{name:'Close run show',exact:true}).click();

  // Capture the light planning theme and the live console, which keeps its
  // dark appearance. Theme changes stay in this isolated fake account.
  await gotoTab(page, 'Settings');
  await page.getByRole('button',{name:'Light',exact:true}).click();
  await expect(page.locator('.settings__theme--active')).toHaveText('Light');
  await gotoTab(page, 'Shows');
  await page.getByRole('button',{name:/^Open Bad Decisions,/}).click();
  await page.evaluate(() => { document.querySelector('.app-main')?.scrollTo(0,0); window.scrollTo(0,0); });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.screenshot({path:testInfo.outputPath('workspace-light.png'),fullPage:false,animations:'disabled'});
  await page.getByRole('button',{name:'Run Show',exact:true}).click();
  await expect(page.locator('.run-show')).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('workspace-run-show-light.png'),fullPage:false,animations:'disabled'});
});
