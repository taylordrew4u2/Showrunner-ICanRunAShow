import { expect, test } from '@playwright/test';
import { emptyState, installFakeApi } from './support/fake-api.mjs';
import { gotoTab, signUpAndOnboard } from './support/app';

const oauth = () => new URLSearchParams({
  client_id: 'chatgpt-client', redirect_uri: 'https://chatgpt.com/aip/callback',
  response_type: 'code', code_challenge: 'a'.repeat(43), code_challenge_method: 'S256',
  state: 'state-kept-verbatim', scope: 'shows:read shows:write',
});
const claudeCallback = 'https://claude.ai/api/mcp/auth_callback';

test('assistant access needs explicit consent, can be read-only, and preserves state', async ({ page, context }) => {
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
  await expect(page.getByRole('heading', { name: 'ChatGPT wants access to your account' })).toBeVisible();
  await expect(page.getByText(/derived keys that decrypt your account’s data/)).toBeVisible();
  await expect(page.getByText('Returns to chatgpt.com.')).toBeVisible();
  expect(grants).toHaveLength(0);
  const group = page.getByRole('group', { name: 'Allow ChatGPT to' });
  await expect(group.getByRole('checkbox')).toHaveCount(2);
  const seeShows = group.getByRole('checkbox', { name: 'See your shows, including lineups and running orders' });
  await expect(seeShows).toBeChecked();
  await expect(seeShows).toBeDisabled();
  await group.getByRole('checkbox', { name: /^Create, duplicate and edit shows/ }).uncheck();
  await page.getByRole('button', { name: 'Allow access', exact: true }).click();
  await expect(page).toHaveURL('https://chatgpt.com/aip/callback?code=one-use-code&state=state-kept-verbatim');
  expect(grants).toHaveLength(1);
  expect(grants[0]).toMatchObject({ scope: 'shows:read', state: 'state-kept-verbatim' });
  expect(grants[0].key).toMatch(/^[a-f0-9]{64}$/);
  expect(grants[0]).not.toHaveProperty('password');
});

test('Claude asking for no particular scope is offered every permission, and gets only what stays ticked', async ({ page, context }) => {
  await installFakeApi(context, emptyState());
  const grants: Record<string, unknown>[] = [];
  await context.route('**/api/chatgpt?**', async (route) => {
    const kind = new URL(route.request().url()).searchParams.get('route');
    if (kind === 'client') return route.fulfill({ json: { clientName: 'Claude', redirectUris: [claudeCallback] } });
    if (kind === 'grant') {
      grants.push(route.request().postDataJSON());
      return route.fulfill({ json: { redirect_url: `${claudeCallback}?code=one-use-code&state=claude-state` } });
    }
    return route.fulfill({ status: 400, json: { error: 'bad_request' } });
  });
  await context.route(`${claudeCallback}**`, (route) => route.fulfill({ body: 'Connected to Claude.' }));
  await signUpAndOnboard(page);
  const query = oauth();
  query.set('client_id', 'claude-client'); query.set('redirect_uri', claudeCallback); query.set('state', 'claude-state'); query.delete('scope');
  await page.goto(`/chatgpt/authorize?${query}`);
  await expect(page.getByRole('heading', { name: 'Claude wants access to your account' })).toBeVisible();
  await expect(page.getByText('Returns to claude.ai.')).toBeVisible();
  const group = page.getByRole('group', { name: 'Allow Claude to' });
  await expect(group.getByRole('checkbox')).toHaveCount(7);
  for (const box of await group.getByRole('checkbox').all()) await expect(box).toBeChecked();
  await group.getByRole('checkbox', { name: 'Move shows to Trash' }).uncheck();
  await group.getByRole('checkbox', { name: 'Send contract and profile links to performers on your behalf' }).uncheck();
  await page.getByRole('button', { name: 'Allow access', exact: true }).click();
  await expect(page).toHaveURL(`${claudeCallback}?code=one-use-code&state=claude-state`);
  expect(grants).toHaveLength(1);
  expect(grants[0]).toMatchObject({ scope: 'shows:read shows:write rolodex:read rolodex:write contracts:read', redirect_uri: claudeCallback });
});

test('a request returning to this computer says so before anything is allowed', async ({ page, context }) => {
  await installFakeApi(context, emptyState());
  let grants = 0;
  await context.route('**/api/chatgpt?**', (route) => {
    if (route.request().method() === 'POST') grants++;
    return route.fulfill({ json: { clientName: 'Claude Code', redirectUris: ['http://127.0.0.1/callback'] } });
  });
  await signUpAndOnboard(page);
  const query = oauth(); query.set('redirect_uri', 'http://127.0.0.1:51234/callback');
  await page.goto(`/chatgpt/authorize?${query}`);
  await expect(page.getByRole('heading', { name: 'Claude Code wants access to your account' })).toBeVisible();
  await expect(page.getByText(/This request came from an app on this computer/)).toBeVisible();
  await expect(page.getByText('Returns to 127.0.0.1:51234 on this computer.')).toBeVisible();
  expect(grants).toBe(0);
});

test('cancelling assistant access grants nothing and returns an OAuth denial', async ({ page, context }) => {
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

test('Settings disconnects one assistant or all of them and reports a failed revocation honestly', async ({ page, context }) => {
  await installFakeApi(context, emptyState());
  const now = Date.now();
  let connections = [
    { id: 'grant-claude', clientName: 'Claude', scope: 'shows:read shows:write shows:delete rolodex:read rolodex:write contracts:read links:send', createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 30 * 86400_000).toISOString() },
    { id: 'grant-chatgpt', clientName: 'ChatGPT', scope: 'shows:read shows:write', createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 30 * 86400_000).toISOString() },
  ];
  let failDelete = true;
  const deletes: (string | null)[] = [];
  await context.route('**/api/chatgpt?route=connections**', (route) => {
    if (route.request().method() === 'DELETE') {
      if (failDelete) return route.fulfill({ status: 500, json: { error: 'internal_error' } });
      const id = new URL(route.request().url()).searchParams.get('id');
      deletes.push(id);
      connections = id === null ? [] : connections.filter((connection) => connection.id !== id);
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: { connections } });
  });
  await signUpAndOnboard(page);
  await gotoTab(page, 'Settings');
  const card = page.locator('.chatgpt-settings');
  await expect(card.getByRole('heading', { name: 'AI assistants' })).toBeVisible();
  await card.getByRole('button', { name: 'Manage connections' }).click();
  await expect(card).toContainText('Can see shows, edit shows, move shows to Trash, see the Rolodex, edit the Rolodex, see contracts and send links.');
  await expect(card).toContainText('Can see shows and edit shows.');
  await card.getByRole('button', { name: /^Disconnect Claude, connected / }).click();
  await expect(card.getByRole('alert')).toContainText('Access has not been revoked');
  expect(deletes).toEqual([]);
  failDelete = false;
  await card.getByRole('button', { name: /^Disconnect Claude, connected / }).click();
  await expect(card.getByRole('status')).toHaveText('Disconnected Claude. It no longer has access to your account.');
  expect(deletes).toEqual(['grant-claude']);
  await expect(card.getByRole('button', { name: /^Disconnect Claude, connected / })).toHaveCount(0);
  await expect(card).toContainText('Can see shows and edit shows.');
  await card.getByRole('button', { name: 'Disconnect all' }).click();
  await expect(card.getByRole('status')).toHaveText('Disconnected. No AI assistant has access to your account now.');
  expect(deletes).toEqual(['grant-claude', null]);
});
