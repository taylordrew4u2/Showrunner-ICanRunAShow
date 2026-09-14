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
    await late.locator('.signing__cta').click();

    // Signed, because it was. Not an error telling them to try again.
    await expect(late.locator('.signing__panel--done')).toContainText('Signed');
    await expect(late.locator('.signing__error')).toHaveCount(0);
    await flaky.close();

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
  });
});
