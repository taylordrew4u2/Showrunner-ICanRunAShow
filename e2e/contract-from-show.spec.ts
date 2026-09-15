import { expect, test } from '@playwright/test';
import { emptyState, installFakeApi } from './support/fake-api.mjs';
import { gotoTab, signUpAndOnboard } from './support/app';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** A one-page PDF. This spec is about the form, not the document. */
function writeTestPdf(): string {
  const body = 'BT /F1 16 Tf 72 700 Td (Performer Agreement) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${body.length} >>\nstream\n${body}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const path = join(mkdtempSync(join(tmpdir(), 'showrunner-e2e-')), 'agreement.pdf');
  writeFileSync(path, out, 'latin1');
  return path;
}

/**
 * Sending an agreement from inside the show it is for.
 *
 * The producer is standing in a show that knows its own date and venue, and
 * looking at a performer they booked by name. None of that should be typed
 * again by anybody — least of all by the performer, who does not know which
 * of the producer's venues it is.
 */
test.describe('a contract sent from inside a show', () => {
  test('arrives with the show date, the venue and their name already filled in', async ({ page, context, browser }) => {
    const state = emptyState();
    await installFakeApi(context, state);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await signUpAndOnboard(page);

    // A contract in the library, before there is a show to send it from.
    await gotoTab(page, 'More');
    await page.locator('.more-item').filter({ hasText: 'Contracts' }).click();
    await page.locator('.contracts__file').setInputFiles(writeTestPdf());
    await expect(page.locator('.contracts__item-name')).toHaveText('agreement');

    // A show that knows where and when it is.
    await gotoTab(page, 'Shows');
    await page.locator('button').filter({ hasText: /New Show/i }).first().click();
    await page.getByPlaceholder('Show name').fill('Basement Comedy Hour');
    await page.locator('input[type=date]').fill('2026-10-03');
    await page.getByPlaceholder('Venue name').fill('The Bell House');
    await page.getByPlaceholder(/City, address/).fill('Brooklyn');
    await page.locator('button').filter({ hasText: /^Save$/ }).last().click();
    await expect(
      page.getByRole('heading', { name: 'Basement Comedy Hour', level: 1 }),
    ).toBeVisible();

    // A performer booked on it.
    if ((await page.locator('.lineup-add__name').count()) === 0) {
      await page.locator('button', { hasText: 'Performers' }).first().click();
    }
    const toggle = page.locator('.lineup-add__toggle');
    if ((await toggle.count()) && /Add performer/.test((await toggle.textContent()) ?? '')) {
      await toggle.click();
    }
    await page.locator('.lineup-add__name').fill('Nadia Okonjo');
    await page.locator('.lineup-add__submit').click();
    // A second name on the same bill, for the library send further down.
    if (await toggle.isVisible().catch(() => false)) {
      if (/Add performer/.test((await toggle.textContent()) ?? '')) await toggle.click();
    }
    await page.locator('.lineup-add__name').fill('Dev Marchetti');
    await page.locator('.lineup-add__submit').click();

    // Booking someone already files them in the Rolodex, so their profile has
    // nothing left to offer — and the offer is gone. It used to sit there
    // regardless, a button whose only effect was to make a producer press it
    // and wonder whether the last press had worked.
    await page.getByRole('button', { name: "Open Dev Marchetti's profile" }).click();
    await expect(page.getByRole('button', { name: 'Save to Rolodex' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Saved!' })).toHaveCount(0);
    await page.locator('.perf-profile__back').click();

    // Nobody on this bill has signed anything, so nobody on it is booked —
    // and the section says so in those words, rather than counting two names
    // and calling it a lineup.
    await expect(page.locator('.lineup-booked')).toContainText('0 of 2 booked');
    await expect(page.locator('.lineup-signed--none')).toHaveCount(2);

    // Their profile, and the contract sent from inside it.
    // By its accessible name, not its label text — the label is hidden on a
    // phone, where most of this actually happens.
    await page.getByRole('button', { name: "Open Nadia Okonjo's profile" }).click();
    const send = page.locator('.perf-contracts__send button').filter({ hasText: 'Send agreement' });
    await expect(send).toBeEnabled();
    await send.click();
    // The row appears once the document and the request are both filed.
    await expect(page.locator('.perf-contracts__row')).toContainText('not signed yet');

    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link, 'a link should have been copied').toContain('/sign?t=');

    // What the performer opens.
    const signerContext = await browser.newContext({ viewport: page.viewportSize()! });
    await installFakeApi(signerContext, state);
    const signer = await signerContext.newPage();
    await signer.goto(link);
    await expect(signer.locator('.signing__title')).toBeVisible();

    await expect(signer.locator('.signing__field--name input')).toHaveValue('Nadia Okonjo');
    await expect(signer.getByLabel('Show date')).toHaveValue(/October 3, 2026/);
    await expect(signer.getByLabel('Venue')).toHaveValue(/Bell House/);
    await signerContext.close();

    // ── What they typed survives the page going away ───────────────────────
    //
    // A phone reclaiming a backgrounded tab, a back gesture, a reload after
    // losing signal. Retyping a long agreement's answers is where someone
    // stops and texts the producer instead.
    const reload = await browser.newContext({ viewport: page.viewportSize()! });
    await installFakeApi(reload, state);
    const typed = await reload.newPage();
    await typed.goto(link);
    await expect(typed.locator('.signing__title')).toBeVisible();
    await typed.getByLabel('Email').fill('nadia@example.com');
    await typed.locator('.signing__field--signature input').fill('Nadia Okonjo');
    await typed.locator('.signing__agree input').check();

    await typed.reload();
    await expect(typed.locator('.signing__title')).toBeVisible();
    await expect(typed.getByLabel('Email')).toHaveValue('nadia@example.com');
    await expect(typed.locator('.signing__field--signature input')).toHaveValue('Nadia Okonjo');
    await expect(typed.locator('.signing__agree input')).toBeChecked();
    // And the show's own answers are still there underneath.
    await expect(typed.getByLabel('Show date')).toHaveValue(/October 3, 2026/);
    await reload.close();

    // ── A signature that lands and loses its answer ────────────────────────
    //
    // Venue wifi. The server records the signature and the reply never gets
    // back. That is not a failed signature, and the performer must not be
    // told it is — they press again, are told again, and text the producer.
    const flaky = await browser.newContext({ viewport: page.viewportSize()! });
    await installFakeApi(flaky, state);
    const late = await flaky.newPage();
    // Added after the fake API, so this route wins: do the write the server
    // would have done, then drop the connection before answering.
    await late.route('**/api/sign', async (route, request) => {
      if (request.method() !== 'POST') return route.fallback();
      const body = request.postDataJSON() as { token: string; signature: string };
      const row = state.sign[body.token];
      if (row && !row.signedAt) {
        row.signature = body.signature;
        row.signedAt = new Date().toISOString();
      }
      await route.abort('connectionreset');
    });

    await late.goto(link);
    await expect(late.locator('.signing__title')).toBeVisible();
    await late.getByLabel('Email').fill('nadia@example.com');
    await late.locator('.signing__field--signature input').fill('Nadia Okonjo');
    await late.locator('.signing__agree input').check();
    // Optional headshots never add a second submission step.
    await late.locator('.signing__cta').click();

    // Signed, because it was. Not an error telling them to try again.
    await expect(late.getByRole('heading', {name:'Signed',exact:true})).toBeVisible();
    await expect(late.locator('.signing__error')).toHaveCount(0);
    await flaky.close();

    // Back on the bill: the one who signed is booked, the one who has not is
    // not, and the count is of signatures rather than of names.
    await page.goto('/');
    await gotoTab(page, 'Shows');
    await page.getByRole('button', { name: 'Open show' }).first().click();
    await expect(
      page.getByRole('heading', { name: 'Basement Comedy Hour', level: 1 }),
    ).toBeVisible();
    if ((await page.locator('.lineup-add__toggle').count()) === 0) {
      await page.locator('button', { hasText: 'Performers' }).first().click();
    }
    await expect(page.locator('.lineup-booked')).toContainText('1 of 2 booked');
    await expect(page.locator('.lineup-signed--signed')).toHaveCount(1);

    // And what she filled in on the contract is on her profile, without an
    // import being pressed. She was booked by name alone, with no email; the
    // one she typed herself is the only one the app will ever have.
    await page.getByRole('button', { name: "Open Nadia Okonjo's profile" }).click();
    await expect(page.getByLabel('Email')).toHaveValue('nadia@example.com');
    await page.locator('.perf-profile__back').click();

    // And again from the library, where nothing says which night it is for.
    // The producer picks a name; the app knows what that person is booked on.
    await page.goto('/');
    await gotoTab(page, 'More');
    await page.locator('.more-item').filter({ hasText: 'Contracts' }).click();
    await page.locator('.contracts__item').first().click();
    await page.locator('.contracts__send-btn').click();
    await page.locator('.contracts__manual input').fill('Dev Marchetti');
    await page.locator('.contracts__manual button').click();
    await expect(page.locator('.contracts__rows')).toContainText('Dev Marchetti');

    const fromLibrary = await page.evaluate(() => navigator.clipboard.readText());
    expect(fromLibrary).not.toBe(link);
    const second = await browser.newContext({ viewport: page.viewportSize()! });
    await installFakeApi(second, state);
    const other = await second.newPage();
    await other.goto(fromLibrary);
    await expect(other.locator('.signing__title')).toBeVisible();
    await expect(other.getByLabel('Show date')).toHaveValue(/October 3, 2026/);
    await expect(other.getByLabel('Venue')).toHaveValue(/Bell House/);
    await second.close();

    // ── Signing with no connection at all ──────────────────────────────────
    //
    // The case that used to end in "that did not go through". A signature
    // given in a basement is held and sent when the signal returns. The page
    // distinguishes that pending submission from a confirmed signature.
    const offline = await browser.newContext({ viewport: page.viewportSize()! });
    await installFakeApi(offline, state);
    const basement = await offline.newPage();
    await basement.goto(fromLibrary);
    await expect(basement.locator('.signing__title')).toBeVisible();
    await basement.getByLabel('Email').fill('dev@example.com');
    await basement.locator('.signing__field--signature input').fill('Dev Marchetti');
    await basement.locator('.signing__agree input').check();

    // Now the connection dies — every attempt, for as long as it is down.
    let attempts = 0;
    await basement.route('**/api/sign', async (route, request) => {
      if (request.method() !== 'POST') return route.fallback();
      attempts++;
      await route.abort('internetdisconnected');
    });
    await basement.locator('.signing__cta').click();

    await expect(basement.getByRole('heading', { name: 'Sending your signature', exact: true })).toBeVisible();
    await expect(basement.getByRole('heading', { name: 'Signed', exact: true })).toHaveCount(0);
    await expect(basement.locator('.signing__sending')).toContainText('saved on this device');
    await expect(basement.locator('.signing__error')).toHaveCount(0);
    expect(attempts, 'it should have tried and been cut off').toBeGreaterThan(0);

    // It is still trying on its own, and lands the moment the line is back.
    await basement.unroute('**/api/sign');
    await expect(basement.locator('.signing__sending')).toHaveCount(0, { timeout: 30_000 });
    await expect(basement.getByRole('heading', { name: 'Signed', exact: true })).toBeVisible();
    expect(state.sign[new URL(fromLibrary).searchParams.get('t')!].signedAt).toBeTruthy();
    await offline.close();

    // A third link, because each of these signs the one it is given.
    await page.goto('/');
    await gotoTab(page, 'More');
    await page.locator('.more-item').filter({ hasText: 'Contracts' }).click();
    await page.locator('.contracts__item').first().click();
    await page.locator('.contracts__send-btn').click();
    await page.locator('.contracts__manual input').fill('Priya Raghunathan');
    await page.locator('.contracts__manual button').click();
    await expect(page.locator('.contracts__rows')).toContainText('Priya Raghunathan');
    const thirdLink = await page.evaluate(() => navigator.clipboard.readText());
    expect(thirdLink).toContain('/sign?t=');

    // ── A photo too big for the server ─────────────────────────────────────
    //
    // It gets made smaller and sent, not dropped and not refused. The server
    // is the judge of what fits, so this stands in for one with a tighter
    // cap: refuse anything over the limit, and let the page work its way
    // down until it fits.
    const CAP = 120_000;
    const big = await browser.newContext({ viewport: page.viewportSize()! });
    await installFakeApi(big, state);
    const withPhoto = await big.newPage();
    const refused: number[] = [];
    await withPhoto.route('**/api/sign', async (route, request) => {
      if (request.method() !== 'POST') return route.fallback();
      const body = request.postDataJSON() as { signature: string };
      if (body.signature.length > CAP) {
        refused.push(body.signature.length);
        return route.fulfill({
          status: 413,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'too_large' }),
        });
      }
      return route.fallback();
    });

    await withPhoto.goto(thirdLink);
    await expect(withPhoto.locator('.signing__title')).toBeVisible();
    // A photo far too large at full size: 2000px of noise, which survives
    // JPEG compression rather than collapsing to nothing.
    const photo = await withPhoto.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 2000;
      canvas.height = 2000;
      const ctx = canvas.getContext('2d')!;
      const image = ctx.createImageData(2000, 2000);
      for (let i = 0; i < image.data.length; i += 4) {
        image.data[i] = Math.random() * 255;
        image.data[i + 1] = Math.random() * 255;
        image.data[i + 2] = Math.random() * 255;
        image.data[i + 3] = 255;
      }
      ctx.putImageData(image, 0, 0);
      return canvas.toDataURL('image/jpeg', 0.95);
    });
    // What a performer on an iPhone actually picks first. The browser cannot
    // decode HEIC at all, so the only thing that matters is whether the page
    // tells them something they can do about it on the phone in their hand.
    await withPhoto.setInputFiles('.signing__photo-pick input[type=file]', {
      name: 'IMG_4021.HEIC',
      mimeType: 'image/heic',
      buffer: Buffer.from('not really an image'),
    });
    const photoError = withPhoto.locator('.signing__photo-error');
    await expect(photoError).toContainText('HEIC');
    await expect(photoError).toContainText('screenshot');
    await expect(withPhoto.locator('.signing__photo-preview')).toHaveCount(0);

    await withPhoto.setInputFiles('.signing__photo-pick input[type=file]', {
      name: 'headshot.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from(photo.split(',')[1], 'base64'),
    });
    await expect(withPhoto.locator('.signing__photo-preview')).toBeVisible();
    // The advice goes once the photo lands; a stale warning beside a working
    // picture reads as the picture being the problem.
    await expect(photoError).toHaveCount(0);

    await withPhoto.getByLabel('Email').fill('priya@example.com');
    await withPhoto.locator('.signing__field--signature input').fill('Priya Raghunathan');
    await withPhoto.locator('.signing__agree input').check();
    await withPhoto.locator('.signing__cta').click();

    // Signed, with a photo that was made to fit — not refused, not dropped.
    await expect(withPhoto.locator('.signing__panel--done')).toContainText('Signed', {
      timeout: 30_000,
    });
    await expect(withPhoto.locator('.signing__panel--done')).toContainText('made smaller');
    expect(refused.length, 'the first attempt should have been refused').toBeGreaterThan(0);
    await big.close();
  });
});
