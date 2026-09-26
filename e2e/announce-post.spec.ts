import { expect, test } from '@playwright/test';
import { emptyState, installFakeApi } from './support/fake-api.mjs';
import { createShow, openSection, signUpAndOnboard } from './support/app';

/**
 * The announcement, composed from the booking.
 *
 * Worth an end-to-end test because the value is entirely in the assembly: the
 * caption has to carry the show's own details and the handles saved against the
 * bill, and it has to name whoever has no handle. A post that quietly drops
 * someone is the failure this is meant to prevent.
 */
test.describe('post copy', () => {
  test('writes the bill, the details and the handles, and names who is missing one', async ({
    page,
    context,
  }, testInfo) => {
    await installFakeApi(context, emptyState());

    await signUpAndOnboard(page);
    await createShow(page, 'Basement Comedy Hour');

    // One comic with a handle saved, one without.
    await page.locator('button').filter({ hasText: /^Contact details$/ }).click();
    await page.getByLabel('Performer name').fill('Mona Sable');
    await page.getByLabel('Instagram handle').fill('@monasable');
    await page.getByLabel('Email address', {exact:true}).fill('mona@example.com');
    await page.locator('button').filter({ hasText: /^Add$/ }).first().click();
    await expect(page.locator('.section-list')).toContainText('Mona Sable');

    await page.getByLabel('Performer name').fill('Dev Okonjo');
    await page.locator('button').filter({ hasText: /^Add$/ }).first().click();
    await expect(page.locator('.section-list')).toContainText('Dev Okonjo');

    await openSection(page, 'Basic Info');
    await page.getByLabel('Venue Name').fill('The Cellar');
    // The host is on the bill too, and the post used to leave them out.
    await page.locator('#show-host-input').fill('Jo Park');
    await page.locator('#show-host-input').blur();

    // Copy and email must remain available without expanding the lineup editor.
    await page.getByRole('navigation', {name:'Show sections'}).getByRole('button', {name:'Overview', exact:true}).click();
    await page.getByRole('button', {name: "Open Mona Sable's profile", exact:true}).click();
    await page.getByLabel('Walk-On Song', {exact:true}).fill('Opening track');
    await page.getByRole('button', {name:'Save Changes', exact:true}).click();
    await page.locator('.perf-profile__back').click();
    await page.getByRole('navigation', {name:'Show sections'}).getByRole('button', {name:'Overview', exact:true}).click();
    await expect(page.locator('.show-workspace__people')).toContainText('@monasable');
    await expect(page.locator('.show-workspace__people')).toContainText('Opening track');
    await expect(page.getByRole('link', {name:/Email all performers/})).toHaveAttribute('href', /bcc=mona%40example.com/);
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
      configurable: true, value: {writeText: async (value: string) => { sessionStorage.setItem('copied-text', value); }},
    }));
    await page.locator('.show-workspace__lineup-preview').screenshot({path:testInfo.outputPath('lineup-actions.png')});
    await page.getByRole('button', {name:'Post copy', exact:true}).click();

    const caption = page.locator('.announce__text');
    await expect(caption).toBeVisible();
    await expect(caption).toHaveValue(/BASEMENT COMEDY HOUR/);
    await expect(caption).toHaveValue(/The Cellar/);
    await expect(caption).toHaveValue(/Hosted by Jo Park/);
    await expect(caption).toHaveValue(/Mona Sable @monasable/);

    // The person with nothing saved is named, not silently left off.
    await expect(page.locator('.announce__missing')).toContainText('Dev Okonjo');
    await page.getByRole('button', {name:'Copy tags (1)', exact:true}).click();
    expect(await page.evaluate(() => sessionStorage.getItem('copied-text'))).toBe('@monasable');
    await caption.fill((await caption.inputValue()) + '\nSee you there!');
    await page.getByRole('button', {name:'Copy everything', exact:true}).click();
    expect(await page.evaluate(() => sessionStorage.getItem('copied-text'))).toBe(await caption.inputValue());
    // A denied clipboard still leaves editable text available to select and paste.
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
      configurable:true, value:{writeText:async () => {throw new Error('denied');}},
    }));
    await page.getByRole('button', {name:'Copy tags (1)', exact:true}).click();
    await expect(page.locator('.announce__failed')).toContainText("Couldn't reach the clipboard");
  });
});
