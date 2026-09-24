import { expect, test, type Page } from '@playwright/test';
import { decryptWithKey, encryptWithKey } from '../src/utils/encryption';
import type { SignatureRecord } from '../src/types';
import { emptyState, installFakeApi } from './support/fake-api.mjs';

const token = 'signing-recovery-token';
const key = 'signing-recovery-key';
const signingPath = `/sign?t=${token}#k=${key}`;
const pendingStorageKey = `showrunner:pending-signature:${token}`;

/** A real PDF so these recovery tests exercise document decryption/rendering too. */
function agreementDataUrl(): string {
  const content = 'BT /F1 16 Tf 72 700 Td (Performer agreement) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const [index, body] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return `data:application/pdf;base64,${Buffer.from(pdf, 'latin1').toString('base64')}`;
}

function signingState() {
  return emptyState({
    doc: { [token]: [encryptWithKey(agreementDataUrl(), key)] },
    sign: {
      [token]: {
        payload: encryptWithKey({
          contractName: 'Performer agreement',
          signerName: '',
          fromName: 'Comedy Night',
          fileName: 'agreement.pdf',
          total: 1,
          createdAt: '2026-09-15T12:00:00.000Z',
          fields: [
            { id: 'email', label: 'Email', required: true },
            { id: 'intro', label: 'Introduction', multiline: true },
          ],
        }, key),
        signature: null,
        signedAt: null,
      },
    },
  });
}

async function addHeadshot(page: Page) {
  await page.locator('.signing__photo-pick input[type=file]').setInputFiles({
    name: 'headshot.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGNY5dJBEmIY1TCqYfhqAAD2lHYQsNIY7AAAAABJRU5ErkJggg==', 'base64'),
  });
  await expect(page.locator('.signing__photo-preview')).toBeVisible();
}

async function completeDetails(page: Page, withPhoto = true) {
  await page.getByLabel('Your name', { exact: true }).fill('Nadia Okonjo');
  await page.getByLabel('Email', { exact: true }).fill('nadia@example.com');
  await page.getByLabel('Introduction').fill('Please welcome Nadia.');
  await page.getByLabel('Signature', { exact: true }).fill('Nadia Okonjo');
  await page.locator('.signing__agree input').check();
  if (withPhoto) await addHeadshot(page);
}

test.describe('contract signing recovery', () => {
  test('signing requires a headshot even when all text details are complete', async ({ page, context }, testInfo) => {
    const state = signingState();
    await installFakeApi(context, state);
    let submissions = 0;
    context.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/sign' && request.method() === 'POST') submissions++;
    });
    await page.goto(signingPath);
    const submit = page.getByRole('button', { name: 'Agree and sign', exact: true });
    await expect(submit).toBeEnabled();
    await submit.click();

    const missing = page.getByRole('dialog', { name: 'Finish these details' });
    await expect(missing).toBeVisible();
    await expect(missing).toContainText(/your name/i);
    await expect(missing).toContainText('Email');
    await expect(missing).toContainText(/signature/i);
    await expect(missing).toContainText(/agree|agreement|consent/i);
    await page.screenshot({ path: testInfo.outputPath('missing-signing-details.png'), fullPage: false, animations: 'disabled' });
    expect(submissions).toBe(0);
    expect(state.sign[token].signedAt).toBeNull();
    await missing.getByRole('button', { name: 'Go to first missing field' }).click();
    await expect(page.getByLabel('Your name', { exact: true })).toBeFocused();
    await page.getByLabel('Your name', { exact: true }).fill('Nadia Okonjo');
    await submit.click();
    await missing.getByRole('button', { name: 'Go to first missing field' }).click();
    await expect(page.getByLabel('Email', { exact: true })).toBeFocused();
    expect(submissions).toBe(0);

    await completeDetails(page, false);
    await submit.click();
    await expect(missing).toContainText('Headshot');
    expect(submissions).toBe(0);
    await missing.getByRole('button', { name: 'Go to first missing field' }).click();
    await expect(page.locator('#signer-headshot')).toBeFocused();
    await addHeadshot(page);
    await submit.click();
    await expect(page.getByRole('heading', { name: 'Signed', exact: true })).toBeVisible();
    expect(submissions).toBe(1);
    const record = decryptWithKey<SignatureRecord>(state.sign[token].signature!, key);
    expect(record.typedName).toBe('Nadia Okonjo');
    expect(record.fields).toEqual([
      { label: 'Email', value: 'nadia@example.com' },
      { label: 'Introduction', value: 'Please welcome Nadia.' },
    ]);
    expect(record.headshot).toMatch(/^data:image\//);
  });

  for (const failingPath of ['/api/sign', '/api/sign-doc']) {
    test(`a temporary ${failingPath} load failure offers a working retry`, async ({ page, context }) => {
      const state = signingState();
      await installFakeApi(context, state);
      let failing = true;
      await context.route('**/api/**', async (route) => {
        if (route.request().method() === 'GET' && new URL(route.request().url()).pathname === failingPath && failing) {
          await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"temporarily_unavailable"}' });
          return;
        }
        await route.fallback();
      });
      await page.goto(signingPath);
      await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
      await expect(page.locator('.login__form')).toHaveCount(0);
      failing = false;
      await page.getByRole('button', { name: 'Try again', exact: true }).click();
      await expect(page.locator('.signing__page img')).toHaveCount(1);
      await expect(page.getByRole('button', { name: 'Agree and sign', exact: true })).toBeEnabled();
      await completeDetails(page);
      await page.getByRole('button', { name: 'Agree and sign', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Signed', exact: true })).toBeVisible();
    });
  }

  for (const failure of ['network', '503'] as const) {
    test(`${failure} submission failure survives reload and sends without re-entering answers`, async ({ page, context }) => {
      const state = signingState();
      await installFakeApi(context, state);
      let failing = true;
      const submitted: string[] = [];
      await context.route('**/api/sign', async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        submitted.push(route.request().postDataJSON().signature as string);
        if (!failing) return route.fallback();
        if (failure === 'network') return route.abort('internetdisconnected');
        return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"temporarily_unavailable"}' });
      });
      await page.goto(signingPath);
      await completeDetails(page);
      await page.getByRole('button', { name: 'Agree and sign', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Sending your signature', exact: true })).toBeVisible();
      await expect.poll(() => submitted.length).toBeGreaterThan(0);
      await expect(page.getByRole('heading', { name: 'Signed', exact: true })).toHaveCount(0);
      expect(state.sign[token].signedAt).toBeNull();

      await page.reload();
      await expect(page.getByRole('heading', { name: 'Sending your signature', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Agree and sign', exact: true })).toHaveCount(0);
      await expect(page.locator('.signing__answers')).toContainText('nadia@example.com');
      failing = false;
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await expect(page.getByRole('heading', { name: 'Signed', exact: true })).toBeVisible();
      expect(state.sign[token].signedAt).not.toBeNull();
      expect(new Set(submitted).size, 'retries must deliver the original signature without creating a new one').toBe(1);
      const record = decryptWithKey<SignatureRecord>(state.sign[token].signature!, key);
      expect(record.typedName).toBe('Nadia Okonjo');
      expect(record.fields).toContainEqual({ label: 'Introduction', value: 'Please welcome Nadia.' });
      expect(await page.evaluate((storageKey) => localStorage.getItem(storageKey), pendingStorageKey)).toBeNull();
    });
  }

  test('unavailable local storage tells the signer to keep the page open and still retries', async ({ page, context }) => {
    const state = signingState();
    await installFakeApi(context, state);
    await context.addInitScript(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (storageKey, value) {
        if (storageKey.startsWith('showrunner:pending-signature:')) throw new DOMException('Storage unavailable', 'QuotaExceededError');
        return original.call(this, storageKey, value);
      };
    });
    let failing = true;
    await context.route('**/api/sign', async (route) => {
      if (route.request().method() === 'POST' && failing) return route.abort('internetdisconnected');
      return route.fallback();
    });
    await page.goto(signingPath);
    await completeDetails(page);
    await page.getByRole('button', { name: 'Agree and sign', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Sending your signature', exact: true })).toBeVisible();
    await expect(page.getByText(/Keep this page open/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Signed', exact: true })).toHaveCount(0);
    failing = false;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.getByRole('heading', { name: 'Signed', exact: true })).toBeVisible();
  });

  test('a lost success response retries the same signature without changing the saved agreement', async ({ page, context }) => {
    const state = signingState();
    await installFakeApi(context, state);
    const submitted: string[] = [];
    let firstSignedAt: string | undefined;
    let lostStatusRead = false;
    await context.route('**/api/sign**', async (route) => {
      if (route.request().method() === 'GET' && submitted.length === 1 && !lostStatusRead) {
        // The same connection also loses the immediate status check. Once
        // connectivity returns, the original POST can safely be retried.
        lostStatusRead = true;
        return route.abort('connectionreset');
      }
      if (route.request().method() !== 'POST') return route.fallback();
      const signature = route.request().postDataJSON().signature as string;
      submitted.push(signature);
      if (submitted.length === 1) {
        // The server commits, but the phone never receives its success reply.
        firstSignedAt = new Date().toISOString();
        state.sign[token].signature = signature;
        state.sign[token].signedAt = firstSignedAt;
        return route.abort('connectionreset');
      }
      return route.fallback();
    });
    await page.goto(signingPath);
    await completeDetails(page);
    await page.getByRole('button', { name: 'Agree and sign', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Signed', exact: true })).toBeVisible();
    expect(submitted.length).toBeGreaterThan(1);
    expect(new Set(submitted).size).toBe(1);
    expect(state.sign[token].signature).toBe(submitted[0]);
    expect(state.sign[token].signedAt).toBe(firstSignedAt);
    expect(state.rejectedSecondSign).toBe(false);
  });

  test('a conflict only shows Signed after reading a confirmed signature from the server', async ({ page, context }) => {
    const state = signingState();
    await installFakeApi(context, state);
    let rejectedSignature: string | undefined;
    let reads = 0;
    await context.route('**/api/sign**', async (route) => {
      if (route.request().method() === 'GET') reads++;
      if (route.request().method() === 'POST') {
        rejectedSignature = route.request().postDataJSON().signature as string;
        return route.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"not_signable"}' });
      }
      return route.fallback();
    });
    await page.goto(signingPath);
    await completeDetails(page);
    await page.getByRole('button', { name: 'Agree and sign', exact: true }).click();
    await expect.poll(() => reads).toBeGreaterThan(1);
    await expect(page.getByRole('heading', { name: 'Signed', exact: true })).toHaveCount(0);
    await expect(page.getByRole('alert')).toBeVisible();
    expect(state.sign[token].signedAt).toBeNull();

    // Another device completes the contract while this page is resolving the
    // conflict. Only a fresh server read can now justify the success receipt.
    state.sign[token].signature = rejectedSignature!;
    state.sign[token].signedAt = new Date().toISOString();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Signed', exact: true })).toBeVisible();
    await expect(page.locator('.signing__done-line')).toContainText('Nadia Okonjo');
    await expect(page.getByRole('button', { name: 'Agree and sign', exact: true })).toHaveCount(0);
  });

  test('a rejected headshot never sends a photo-free signature and preserves answers for retry', async ({ page, context }) => {
    const state = signingState();
    await installFakeApi(context, state);
    const attempts: SignatureRecord[] = [];
    let rejectPhoto = true;
    await context.route('**/api/sign', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      const record = decryptWithKey<SignatureRecord>(route.request().postDataJSON().signature as string, key);
      attempts.push(record);
      if (rejectPhoto) {
        return route.fulfill({ status: 413, contentType: 'application/json', body: '{"error":"payload_too_large"}' });
      }
      return route.fallback();
    });
    await page.goto(signingPath);
    await completeDetails(page);
    const photo = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 500;
      canvas.height = 500;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#c0392b';
      context.fillRect(0, 0, 500, 500);
      return canvas.toDataURL('image/jpeg', 0.9);
    });
    await page.locator('.signing__photo-pick input[type=file]').setInputFiles({
      name: 'headshot.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from(photo.split(',')[1], 'base64'),
    });
    await expect(page.locator('.signing__photo-preview')).toBeVisible();
    await page.getByRole('button', { name: 'Agree and sign', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Your signature has not been submitted yet' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Signed', exact: true })).toHaveCount(0);
    expect(attempts.length).toBe(2);
    expect(attempts[0].headshot).toBeTruthy();
    expect(attempts[1].headshot!.length).toBeLessThan(attempts[0].headshot!.length);
    expect(attempts.every(record => !!record.headshot)).toBe(true);
    expect(new Set(attempts.map(record => record.signedAt)).size).toBe(1);
    for (const record of attempts) {
      expect(record.typedName).toBe('Nadia Okonjo');
      expect(record.signerName).toBe('Nadia Okonjo');
      expect(record.fields).toEqual([
        { label: 'Email', value: 'nadia@example.com' },
        { label: 'Introduction', value: 'Please welcome Nadia.' },
      ]);
    }
    expect(state.sign[token].signedAt).toBeNull();
    await page.getByRole('button', { name: 'Back to form' }).click();
    await expect(page.getByLabel('Signature', { exact: true })).toHaveValue('Nadia Okonjo');
    await expect(page.locator('.signing__photo-preview')).toBeVisible();
    rejectPhoto = false;
    await addHeadshot(page);
    await page.getByRole('button', { name: 'Agree and sign', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Signed', exact: true })).toBeVisible();
    expect(decryptWithKey<SignatureRecord>(state.sign[token].signature!, key).headshot).toBeTruthy();
  });

  test('an unreadable conflict status stays pending until the server confirms the signature', async ({ page, context }) => {
    const state = signingState();
    await installFakeApi(context, state);
    let submitted: string | undefined;
    let statusAvailable = false;
    let failedStatusReads = 0;
    await context.route('**/api/sign**', async (route) => {
      if (route.request().method() === 'POST') {
        submitted = route.request().postDataJSON().signature as string;
        return route.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"not_signable"}' });
      }
      if (new URL(route.request().url()).pathname === '/api/sign' && submitted && !statusAvailable) {
        failedStatusReads++;
        return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"temporarily_unavailable"}' });
      }
      return route.fallback();
    });
    await page.goto(signingPath);
    await completeDetails(page);
    await page.getByRole('button', { name: 'Agree and sign', exact: true }).click();
    await expect.poll(() => failedStatusReads).toBeGreaterThan(0);
    await expect(page.getByRole('heading', { name: 'Sending your signature', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Signed', exact: true })).toHaveCount(0);
    expect(await page.evaluate((storageKey) => localStorage.getItem(storageKey), pendingStorageKey)).not.toBeNull();

    state.sign[token].signature = submitted!;
    state.sign[token].signedAt = new Date().toISOString();
    statusAvailable = true;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.getByRole('heading', { name: 'Signed', exact: true })).toBeVisible();
    expect(await page.evaluate((storageKey) => localStorage.getItem(storageKey), pendingStorageKey)).toBeNull();
  });

  test('Retry now cannot start overlapping signature uploads', async ({ page, context }) => {
    const state = signingState();
    await installFakeApi(context, state);
    let submissions = 0;
    let releaseUpload: (() => void) | undefined;
    const heldUpload = new Promise<void>(resolve => { releaseUpload = resolve; });
    await context.route('**/api/sign', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      submissions++;
      await heldUpload;
      return route.fallback();
    });
    await page.goto(signingPath);
    await completeDetails(page);
    await page.getByRole('button', { name: 'Agree and sign', exact: true }).click();
    await expect.poll(() => submissions).toBe(1);
    const retry = page.getByRole('button', { name: 'Retry now', exact: true });
    await retry.click();
    await retry.click();
    await retry.click();
    expect(submissions).toBe(1);
    releaseUpload!();
    await expect(page.getByRole('heading', { name: 'Signed', exact: true })).toBeVisible();
    expect(submissions).toBe(1);
  });

  test('a legacy queued signature without a photo returns to the form', async ({ page, context }) => {
    const state = signingState();
    await installFakeApi(context, state);
    await context.addInitScript(({ storageKey, signature }) => {
      localStorage.setItem(storageKey, JSON.stringify({ signature, savedAt: Date.now() }));
    }, { storageKey: pendingStorageKey, signature: encryptWithKey({
      typedName: 'Nadia Okonjo', documentHash: 'old-hash', signedAt: '2026-09-15T12:00:00Z',
    }, key) });
    let submissions = 0;
    context.on('request', request => {
      if (new URL(request.url()).pathname === '/api/sign' && request.method() === 'POST') submissions++;
    });
    await page.goto(signingPath);
    await expect(page.getByRole('button', { name: 'Agree and sign', exact: true })).toBeVisible();
    expect(submissions).toBe(0);
    expect(state.sign[token].signedAt).toBeNull();
    expect(await page.evaluate(storageKey => localStorage.getItem(storageKey), pendingStorageKey)).toBeNull();
  });

  test('a photo still processing blocks signing without a bypass', async ({ page, context }) => {
    const state = signingState();
    await installFakeApi(context, state);
    await page.goto(signingPath);
    await completeDetails(page);
    await page.evaluate(() => {
      const original = window.createImageBitmap;
      window.createImageBitmap = ((source: ImageBitmapSource, ...rest: unknown[]) => {
        if (source instanceof File) return new Promise<ImageBitmap>(() => {});
        return Reflect.apply(original, window, [source, ...rest]);
      }) as typeof createImageBitmap;
    });
    let submissions = 0;
    context.on('request', request => {
      if (new URL(request.url()).pathname === '/api/sign' && request.method() === 'POST') submissions++;
    });
    await page.locator('.signing__photo-pick input[type=file]').setInputFiles({
      name: 'headshot.png',
      mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGNY5dJBEmIY1TCqYfhqAAD2lHYQsNIY7AAAAABJRU5ErkJggg==', 'base64'),
    });
    await expect(page.locator('.signing__photo-pick')).toContainText('Adding');
    await page.getByRole('button', { name: 'Agree and sign', exact: true }).click();
    const photoDialog = page.getByRole('dialog', { name: 'Your photo is still preparing' });
    await expect(photoDialog).toBeVisible();
    expect(submissions).toBe(0);
    await photoDialog.getByRole('button', { name: 'Wait for photo', exact: true }).click();
    await expect(photoDialog).toHaveCount(0);
    await expect(page.getByLabel('Signature', { exact: true })).toHaveValue('Nadia Okonjo');
    await page.getByRole('button', { name: 'Agree and sign', exact: true }).click();
    await expect(photoDialog.getByRole('button', { name: 'Sign without photo', exact: true })).toHaveCount(0);
    expect(submissions).toBe(0);
    expect(state.sign[token].signedAt).toBeNull();
  });
});
