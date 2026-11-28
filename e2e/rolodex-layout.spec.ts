import { expect, test } from '@playwright/test';
import { addCoproducerLink, emptyState, installFakeApi } from './support/fake-api.mjs';
import { gotoTab, signUpAndOnboard } from './support/app';
import { accountKeys, openAsCoproducer } from './support/coproducer';

/**
 * The Rolodex is a list of names read on a phone in a venue. Two things the
 * page must hold to at the narrowest width a phone comes in: it never
 * scrolls sideways, however long a name or a link is, and every control on a
 * row says what it is.
 */

const LONG_NAME = 'Bartholomew Featherstonehaugh-Montgomery III';

test('the Rolodex fits a 320px screen, and every control in a row has a name', async ({ page, context }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installFakeApi(context, emptyState());
  await signUpAndOnboard(page);
  await gotoTab(page, 'Rolodex');

  for (const name of ['Jo', LONG_NAME, 'Mona Sable']) {
    await page.locator('.rolodex__input').first().fill(name);
    await page.locator('.rolodex__add').click();
  }
  await expect(page.locator('.rolodex__item')).toHaveCount(3);

  // A link out asking adds the widest thing a row ever carries: the address,
  // Copy link and Withdraw.
  const asked = page.locator('.rolodex__item').filter({ hasText: 'Mona Sable' });
  await asked.getByRole('button', { name: 'Ask for details' }).click();
  await expect(asked.locator('.rolodex__link-url')).toBeVisible();

  await page.setViewportSize({ width: 320, height: 640 });
  await expect(page.locator('.rolodex__item')).toHaveCount(3);

  // Nothing wider than the screen: the page does not scroll sideways, and no
  // row hangs over its edge.
  const overflow = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    rows: [...document.querySelectorAll('.rolodex__item')].map((row) => Math.round(row.getBoundingClientRect().right - window.innerWidth)),
  }));
  expect(overflow.page).toBeLessThanOrEqual(0);
  for (const over of overflow.rows) expect(over).toBeLessThanOrEqual(0);

  // The long name is cut short on the row and still there in full: on the
  // button that opens the profile, and on the name's own title.
  const long = page.locator('.rolodex__item').filter({ hasText: LONG_NAME });
  await expect(long.getByRole('button', { name: `Open ${LONG_NAME}'s full profile`, exact: true })).toBeVisible();
  await expect(long.locator('.rolodex__name')).toHaveAttribute('title', LONG_NAME);
  expect((await long.locator('.rolodex__name').boundingBox())!.width).toBeGreaterThan(120);

  // Every button, field and link in every row can be found by a name.
  const rows = page.locator('.rolodex__item');
  for (let r = 0; r < await rows.count(); r++) {
    const controls = rows.nth(r).locator('button, input, a[href], select, textarea');
    const count = await controls.count();
    expect(count).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < count; i++) {
      const control = controls.nth(i);
      const name = await control.evaluate((el) => {
        const labelled = el.getAttribute('aria-labelledby')?.split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
        const forLabel = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent : '';
        return (el.getAttribute('aria-label') || labelled || forLabel || el.closest('label')?.textContent
          || (el.tagName === 'INPUT' ? '' : el.textContent) || '').trim();
      });
      expect(name, await control.evaluate((el) => el.outerHTML.slice(0, 120))).not.toBe('');
    }
  }
});

/** A name written right to left, and longer than a phone's row. */
const RTL_NAME = 'عبد الرحمن بن خالد بن عبد العزيز آل سعود الطويل';

test('on a phone the row reads, tabs and taps in one order, whichever way a name is written', async ({ page, context, browser }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const state = emptyState();
  await installFakeApi(context, state);
  await signUpAndOnboard(page);
  await gotoTab(page, 'Rolodex');

  for (const name of ['Sam Lee', RTL_NAME]) {
    await page.locator('.rolodex__input').first().fill(name);
    await page.locator('.rolodex__add').click();
  }
  await expect(page.locator('.rolodex__item')).toHaveCount(2);
  await expect(page.locator('.sync-status--saved')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });

  // A right-to-left name is laid out right to left, so the ellipsis takes
  // its last words and not its first: the first letter is inside the name's
  // box, at its right-hand end, and the last letter is cut off.
  const rtl = page.locator(`.rolodex__name[title="${RTL_NAME}"]`);
  const cut = await rtl.evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const text = walker.nextNode() as Text;
    const letter = (at: number) => {
      const range = document.createRange();
      range.setStart(text, at);
      range.setEnd(text, at + 1);
      return range.getBoundingClientRect();
    };
    const box = el.getBoundingClientRect();
    const [first, last] = [letter(0), letter(text.length - 1)];
    return {
      overflows: el.scrollWidth > el.clientWidth,
      firstInside: first.left >= box.left - 1 && first.right <= box.right + 1,
      firstAtRight: box.right - first.right < 4,
      lastInside: last.left >= box.left - 1 && last.right <= box.right + 1,
    };
  });
  expect(cut).toEqual({ overflows: true, firstInside: true, firstAtRight: true, lastInside: false });
  // A Latin name starts on the same left edge as it always did.
  const latin = page.locator('.rolodex__name[title="Sam Lee"]');
  expect(await latin.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return Math.round(range.getBoundingClientRect().left - el.getBoundingClientRect().left);
  })).toBe(0);

  // Tab order is reading order: the person, then the ask under the name,
  // then Edit at the end of that line. Never back up the page.
  const row = page.locator('.rolodex__item').filter({ hasText: 'Sam Lee' });
  await row.locator('.rolodex__open-profile').focus();
  await page.keyboard.press('Tab');
  await expect(row.getByRole('button', { name: 'Ask for details' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(row.getByRole('button', { name: 'Edit' })).toBeFocused();
  const stops = await row.locator('.rolodex__item-main button').evaluateAll((els) => els.map((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height };
  }));
  expect(stops).toHaveLength(3);
  for (let i = 1; i < stops.length; i++) {
    const [a, b] = [stops[i - 1], stops[i]];
    const below = b.top >= a.bottom - 1;
    const alongside = Math.abs(b.top - a.top) < 2 && b.left >= a.right - 1;
    expect(below || alongside, `stop ${i + 1} follows stop ${i}: ${JSON.stringify([a, b])}`).toBe(true);
    expect(b.height).toBeGreaterThanOrEqual(44);
  }

  // Back on the profile is a full-size target, and its focus ring is whole:
  // none of it falls off the edge of the screen.
  await row.locator('.rolodex__open-profile').click();
  const back = page.getByRole('dialog').getByRole('button', { name: '← Back' });
  await expect(back).toBeVisible();
  expect((await back.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await back.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(back).toBeFocused();
  const ring = await back.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const reach = parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth);
    return { width: parseFloat(style.outlineWidth), left: r.left - reach, right: r.right + reach - window.innerWidth };
  });
  expect(ring.width).toBeGreaterThan(0);
  expect(ring.left).toBeGreaterThanOrEqual(0);
  expect(ring.right).toBeLessThanOrEqual(0);
  await back.click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // The co-producer's Add is a full-size target at the same width.
  const token = addCoproducerLink(state, { ...accountKeys(), label: 'Sam Rivera', expiresAt: Date.now() + 86_400_000 });
  const co = await openAsCoproducer(browser, state, token);
  await co.setViewportSize({ width: 390, height: 844 });
  await gotoTab(co, 'Rolodex');
  await expect(co.locator('.rolodex__item')).toHaveCount(2);
  expect((await co.locator('.new-comic__add').boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await co.context().close();

  // Two columns, at their narrowest: the address, Copy link and Withdraw
  // stay on one line, with the hint under them.
  await page.setViewportSize({ width: 1100, height: 800 });
  await row.getByRole('button', { name: 'Ask for details' }).click();
  await expect(row.locator('.rolodex__link-url')).toBeVisible();
  const tops = await row.locator('.rolodex__link > *').evaluateAll((els) => els.map((el) => {
    const r = el.getBoundingClientRect();
    return Math.round(r.top + r.height / 2);
  }));
  expect(tops).toHaveLength(4);
  expect(Math.abs(tops[1] - tops[0])).toBeLessThanOrEqual(2);
  expect(tops[2]).toBe(tops[1]);
  expect(tops[3]).toBeGreaterThan(tops[2]);
});
