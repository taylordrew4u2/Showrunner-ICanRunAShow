import { expect, test } from '@playwright/test';
import { emptyState, installFakeApi } from './support/fake-api.mjs';
import { gotoTab, signUpAndOnboard } from './support/app';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A genuinely valid two-page PDF to stand in for an agreement.
 *
 * Two pages on purpose: the signing page has to show the whole document, and a
 * one-page fixture cannot tell the difference between "rendered the contract"
 * and "rendered the first page of it".
 */
function writeTestPdf(): string {
  const text = (line: string) => `BT /F1 16 Tf 72 700 Td (${line}) Tj ET`;
  const pageOne = text('Performer Agreement');
  const pageTwo = text('Page two - clause 7');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${pageOne.length} >>\nstream\n${pageOne}\nendstream`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',
    `<< /Length ${pageTwo.length} >>\nstream\n${pageTwo}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const path = join(mkdtempSync(join(tmpdir(), 'showrunner-e2e-')), 'agreement.pdf');
  writeFileSync(path, out, 'latin1');
  return path;
}

test.describe('contracts', () => {
  test('a recipient with no saved email can receive a link and supply their details while signing', async ({ page, context, browser }, testInfo) => {
    const state = emptyState();
    await installFakeApi(context, state);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const apiCalls: string[] = [];
    context.on('request', (r) => {
      if (r.url().includes('/api/')) apiCalls.push(`${r.url()} ${r.postData() ?? ''}`);
    });

    await signUpAndOnboard(page);

    // Create the recipient with only a name; no email is known before sharing.
    await gotoTab(page, 'Rolodex');
    await page.locator('.rolodex__input').first().fill('Nadia Okonjo');
    await page.locator('button').filter({ hasText: /^Add$/ }).first().click();

    await gotoTab(page, 'More');
    await page.locator('.more-item').filter({ hasText: 'Contracts' }).click();
    await page.locator('.contracts__file').setInputFiles(writeTestPdf());
    await expect(page.locator('.contracts__item-name')).toHaveText('agreement');

    await page.locator('.contracts__item').first().click();
    await page.locator('.contracts__send-btn').click();
    await page.locator('.contracts__candidate').first().click();
    await expect(page.locator('.contracts__row')).toContainText('Nadia Okonjo');
    const originalViewport = page.viewportSize()!;
    await page.setViewportSize({ width: 320, height: 844 });
    const recipient = page.locator('.contracts__row-name').first();
    expect(await recipient.evaluate((el) => el.scrollWidth > el.clientWidth + 1)).toBe(false);
    const recipientBox = (await recipient.boundingBox())!;
    const actionBox = (await page.locator('.contracts__row .btn').first().boundingBox())!;
    expect(actionBox.y).toBeGreaterThanOrEqual(recipientBox.y + recipientBox.height);
    await page.setViewportSize(originalViewport);
    if (originalViewport.width >= 900) {
      // Let the desktop drawer replace the phone bar before navigating.
      await expect(page.locator('.bottom-nav')).toBeHidden();
      await expect(page.getByRole('button', { name: 'Open navigation menu' })).toBeVisible();
    }


    const link = await page.evaluate(() => navigator.clipboard.readText());
    const key = link.split('#k=')[1];
    expect(key, 'the link must carry a key').toBeTruthy();

    // Chasing is a pass through a list of people, so the list exists and can
    // be copied in one go — a producer should never have to open each
    // agreement in turn to work out who has not come back.
    await gotoTab(page, 'More');
    await page.locator('.more-item').filter({ hasText: 'Contracts' }).click();
    await expect(page.locator('.contracts__chase')).toContainText('Waiting on 1');
    await expect(page.locator('.contracts__chase')).toContainText('Nadia Okonjo');
    await page.locator('.contracts__chase-head .btn').click();
    const all = await page.evaluate(() => navigator.clipboard.readText());
    expect(all).toContain('Nadia Okonjo — ');
    expect(all).toContain('/sign?t=');
    expect(all).toContain('#k=');

    // The security claim, asserted rather than described: the key that
    // decrypts the document is in the fragment, which browsers never send.
    expect(link.split('#')[0]).not.toContain(key);
    expect(apiCalls.filter((c) => c.includes(key))).toEqual([]);
    expect(JSON.stringify(state.sign) + JSON.stringify(state.doc)).not.toContain('Nadia');

    // The signer: a different browser context, no session, no account.
    // Carry the project's phone/desktop viewport into the anonymous context.
    const signerContext = await browser.newContext({ viewport: page.viewportSize()! });
    await installFakeApi(signerContext, state);
    const signer = await signerContext.newPage();
    await signer.goto(link);
    await expect(signer.locator('.signing__title')).toBeVisible();

    // The document itself, every page of it. An <object> was used here before
    // and renders nothing on iOS, which is what most signers hold — so the
    // pages are drawn as images, and both of them have to arrive.
    await expect(signer.locator('.signing__page img')).toHaveCount(2);
    await expect(signer.locator('.signing__page img').first()).toHaveAttribute(
      'alt',
      /page 1 of 2/,
    );
    await expect(signer.locator('.signing__page img').last()).toBeVisible();

    // One continuous page: all PDF pages, then the form, with no layered
    // panel or separate step. Check their real positions throughout scrolling.
    await expect(signer.locator('.signing__page img').first()).toBeInViewport();
    await expect(signer.locator('.signing__field--name input')).not.toBeInViewport();
    await expect(signer.getByRole('button', { name: 'Continue to signature' })).toHaveCount(0);
    const assertStacked = async () => {
      const lastPage = (await signer.locator('.signing__page').last().boundingBox())!;
      const panel = (await signer.locator('.signing__panel').boundingBox())!;
      expect(panel.y).toBeGreaterThanOrEqual(lastPage.y + lastPage.height);
    };
    await assertStacked();
    await signer.locator('.signing__page').last().scrollIntoViewIfNeeded();
    await assertStacked();
    await signer.getByRole('heading', { name: 'Your details and signature' }).scrollIntoViewIfNeeded();
    await assertStacked();
    await signer.screenshot({ path: testInfo.outputPath('stacked-contract.png'), fullPage: true });

    // A link that lost its token on the way — trimmed by a messaging app, or
    // broken across two lines in a text — is still someone holding a link.
    // They have no account, so a login screen is the one thing that cannot be
    // shown to them; the signing page can at least say what went wrong.
    const truncated = await signerContext.newPage();
    await truncated.goto(`${new URL(link).origin}/sign`);
    await expect(truncated.locator('.signing__card')).toContainText('will not open');
    await expect(truncated.locator('.login__form')).toHaveCount(0);
    await truncated.close();

    // A PDF that cannot render must never reveal fields or a signing action.
    const broken = await signerContext.newPage();
    await broken.route('**/*pdf.worker*', (route) => route.abort());
    await broken.goto(link);
    await expect(broken.getByRole('alert')).toContainText('full contract could not be displayed');
    await expect(broken.locator('.signing__field input')).toHaveCount(0);
    await expect(broken.getByRole('button', { name: 'Continue to signature' })).toHaveCount(0);
    await expect(broken.getByRole('button', { name: 'Agree and sign' })).toHaveCount(0);
    await broken.close();

    // Sent from a name the producer already had, so the name arrives filled in
    // — and the signature does not. A contract that opens already signed is
    // not an agreement, whatever the person then ticks.
    await expect(signer.locator('.signing__field--name input')).toHaveValue('Nadia Okonjo');
    await expect(signer.locator('.signing__field--signature input')).toHaveValue('');

    // Every field is in the page's own typeface. A <textarea> falls back to
    // monospace unless told otherwise, and the credit-line box was rendering
    // in it — a performer typing into a field that looks like a terminal.
    for (const field of ['.signing__field textarea', '.signing__field input']) {
      const font = await signer.locator(field).first()
        .evaluate((el) => getComputedStyle(el).fontFamily);
      expect(font, `${field} should not fall back to a default font`).toContain('Inter');
    }

    // An incomplete form responds to the sign action with specific guidance.
    await expect(signer.locator('.signing__cta')).toBeEnabled();
    await signer.locator('.signing__cta').click();
    await expect(signer.getByRole('dialog')).toContainText('Your signature');
    await signer.getByRole('button', {name: 'Go to first missing field'}).click();

    // A headshot, which is the one thing on this form the producer cannot get
    // any other way.
    const photo = await signer.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 400;
      canvas.height = 400;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#c0392b';
      ctx.fillRect(0, 0, 400, 400);
      return canvas.toDataURL('image/jpeg', 0.9);
    });
    await signer.setInputFiles('.signing__photo-pick input[type=file]', {
      name: 'headshot.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from(photo.split(',')[1], 'base64'),
    });
    await expect(signer.locator('.signing__photo-preview')).toBeVisible();

    // The contract asks for a few details as well as a signature; Email and the
    // handle to tag them by are the ones it insists on.
    await signer.getByLabel('Email').fill('nadia@example.com');
    await signer.getByLabel('Instagram or main social').fill('@nadiaokonjo');
    await signer.locator('.signing__agree:not(.signing__rule-agree) input').check();
    // Everything else answered, and it still will not sign until they sign it.
    await expect(signer.locator('.signing__cta')).toBeEnabled();

    await signer.locator('.signing__field--signature input').fill('Nadia Okonjo');
    await expect(signer.locator('.signing__cta')).toBeEnabled();

    // The day-of rule is said plainly on the page, not buried in the PDF, and
    // agreeing to the document is not agreeing to it: it has its own tick,
    // and the signature waits for it.
    const rule = signer.locator('.signing__rule');
    await expect(rule).toContainText("we won't be able to book you on future lineups");
    await signer.locator('.signing__cta').click();
    await expect(signer.locator('.signing__hint')).toContainText('Tick the day-of cancellation rule');
    await signer.getByRole('button', { name: 'Go to first missing field' }).click();
    await signer.locator('.signing__rule-agree input').check();
    await signer.locator('.signing__cta').click();
    await expect(signer.getByRole('heading', {name:'Signed',exact:true})).toBeVisible();
    await expect(signer.locator('.signing__done-rule')).toHaveText('Day-of cancellation rule acknowledged.');
    await expect(signer.locator('.signing__page')).toHaveCount(2);
    await assertStacked();

    // Reopening cannot re-sign: the row is spent.
    const replay = await signerContext.newPage();
    await replay.goto(link);
    await expect(replay.getByRole('heading', {name:'Signed',exact:true})).toBeVisible();
    await expect(replay.locator('.signing__cta')).not.toHaveText(/Agree and sign/);

    // And the producer sees it, without being told.
    const storedBefore = Object.keys(state.media).length;
    await page.reload();
    await gotoTab(page, 'More');
    await page.locator('.more-item').filter({ hasText: 'Contracts' }).click();
    await expect(page.locator('.contracts__item-meta')).toContainText('1 of 1 signed');
    // With the rule on the record, so a day-of drop-out is not a he-said-she-said.
    await page.locator('.contracts__item').first().click();
    await expect(page.locator('.contracts__row-rule')).toContainText('Day-of cancellation rule acknowledged');

    // And the headshot is on their profile, with nothing pressed. A face that
    // needs a button is a face the producer does not have when they are
    // making the flyer at midnight.
    await gotoTab(page, 'Rolodex');
    const filed = page.locator('.rolodex__item').filter({ hasText: 'Nadia Okonjo' });
    await expect(filed.locator('.rolodex__photo')).toBeVisible();

    // Filed as a stored file rather than left as a picture inside the settings
    // blob — that blob is rewritten on every save and copied into every
    // snapshot, so a data URL kept in it is paid for again and again.
    expect(Object.keys(state.media).length).toBe(storedBefore + 1);

    await signerContext.close();
  });
});
