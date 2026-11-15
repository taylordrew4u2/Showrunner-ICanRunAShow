import { expect, test } from '@playwright/test';
import { emptyState, installFakeApi } from './support/fake-api.mjs';
import { gotoTab, signUpAndOnboard } from './support/app';

const oauth = () => new URLSearchParams({
  client_id: 'chatgpt-client', redirect_uri: 'https://chatgpt.com/aip/callback',
  response_type: 'code', code_challenge: 'a'.repeat(43), code_challenge_method: 'S256',
  state: 'state-kept-verbatim', scope: 'shows:read shows:write',
});

test('ChatGPT access needs explicit consent, can be read-only, and preserves state', async ({ page, context }) => {
  await installFakeApi(context, emptyState());
  const grants: Record<string, unknown>[] = [];
  await context.route('**/api/chatgpt?**', async (route) => {
    const kind = new URL(route.request().url()).searchParams.get('route');
    if (kind === 'client') return route.fulfill({ json: { clientName: 'ChatGPT', redirectUris: ['https://chatgpt.com/aip/callback'] } });
    if (kind === 'grant') {
      grants.push(route.request().postDataJSON());
      expect(route.request().headers()['x-auth']).toBeTruthy();
      return route.fulfill({ json: { redirect_url: 'https://chatgpt.com/aip/callback?code=one-use-code&state=state-kept-verbatim' } });
    }
    return route.fulfill({ status: 400, json: { error: 'bad_request' } });
  });
  await context.route('https://chatgpt.com/aip/callback**', (route) => route.fulfill({ body: 'Connected to ChatGPT.' }));
  await signUpAndOnboard(page);
  await page.goto(`/chatgpt/authorize?${oauth()}`);
  await expect(page.getByRole('heading', { name: 'ChatGPT wants access to your shows' })).toBeVisible();
  await expect(page.getByText(/sharing derived encryption keys/)).toBeVisible();
  expect(grants).toHaveLength(0);
  await page.getByRole('checkbox', { name: 'Allow creating and editing shows' }).uncheck();
  await page.getByRole('button', { name: 'Allow access', exact: true }).click();
  await expect(page).toHaveURL('https://chatgpt.com/aip/callback?code=one-use-code&state=state-kept-verbatim');
  expect(grants).toHaveLength(1);
  expect(grants[0]).toMatchObject({ scope: 'shows:read', state: 'state-kept-verbatim' });
  expect(grants[0].key).toMatch(/^[a-f0-9]{64}$/);
  expect(grants[0]).not.toHaveProperty('password');
});

test('cancelling ChatGPT access grants nothing and returns an OAuth denial', async ({ page, context }) => {
  await installFakeApi(context, emptyState());
  let grants = 0;
  await context.route('**/api/chatgpt?**', (route) => {
    if (route.request().method() === 'POST') grants++;
    return route.fulfill({ json: { clientName: 'ChatGPT', redirectUris: ['https://chatgpt.com/aip/callback'] } });
  });
  await context.route('https://chatgpt.com/aip/callback**', (route) => route.fulfill({ body: 'Access denied.' }));
  await signUpAndOnboard(page);
  await page.goto(`/chatgpt/authorize?${oauth()}`);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page).toHaveURL('https://chatgpt.com/aip/callback?error=access_denied&state=state-kept-verbatim');
  expect(grants).toBe(0);
});

test('a callback not registered to the client cannot request consent or redirect', async ({ page, context }) => {
  await installFakeApi(context, emptyState());
  await context.route('**/api/chatgpt?**', (route) => route.fulfill({ json: { clientName: 'ChatGPT', redirectUris: ['https://chatgpt.com/aip/callback'] } }));
  await signUpAndOnboard(page);
  const query = oauth(); query.set('redirect_uri', 'https://attacker.example/callback');
  await page.goto(`/chatgpt/authorize?${query}`);
  await expect(page.getByRole('alert')).toContainText('No access has been granted');
  await expect(page.getByRole('button', { name: 'Allow access', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/\/chatgpt\/authorize/);
});

test('Settings revokes ChatGPT connections and reports a failed revocation honestly', async ({ page, context }) => {
  await installFakeApi(context, emptyState());
  let failDelete = true;
  let deleted = false;
  await context.route('**/api/chatgpt?route=connections', (route) => {
    if (route.request().method() === 'DELETE') {
      if (failDelete) return route.fulfill({ status: 500, json: { error: 'internal_error' } });
      deleted = true;
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: { connections: deleted ? [] : [{ id: 'grant', clientName: 'ChatGPT', scope: 'shows:read shows:write', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600_000).toISOString() }] } });
  });
  await signUpAndOnboard(page);
  await gotoTab(page, 'Settings');
  const card = page.locator('.chatgpt-settings');
  await card.getByRole('button', { name: 'Manage connections' }).click();
  await expect(card).toContainText('Read and edit shows');
  await card.getByRole('button', { name: 'Disconnect ChatGPT' }).click();
  await expect(card.getByRole('alert')).toContainText('Access has not been revoked');
  expect(deleted).toBe(false);
  failDelete = false;
  await card.getByRole('button', { name: 'Disconnect ChatGPT' }).click();
  await expect(card.getByRole('status')).toHaveText('Disconnected. ChatGPT no longer has access to your shows.');
  expect(deleted).toBe(true);
});
