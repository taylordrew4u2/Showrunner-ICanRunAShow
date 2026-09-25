import { expect, test } from '@playwright/test';
import { emptyState, installFakeApi } from './support/fake-api.mjs';
import { PASSWORD, signIn, signUpAndOnboard } from './support/app';

/**
 * Getting into an account, and being kept out of one.
 *
 * Every other spec starts by creating an account, so creation itself is
 * covered many times over. What none of them reach is the door being closed:
 * a wrong password, or a name already taken. Those answers come from the
 * server, and a client that mishandled them would let every other test stay
 * green while a producer stood locked out — or, worse, walked in.
 */
test.describe('signing in', () => {
  test('a wrong password and a taken name are refused, and the right password gets in', async ({ page, context, browser }) => {
    const state = emptyState();
    await installFakeApi(context, state);
    await signUpAndOnboard(page);
    expect(Object.keys(state.users)).toHaveLength(1);

    // A second device, with nothing of the first one's session on it.
    const other = await browser.newContext({ viewport: page.viewportSize()! });
    await installFakeApi(other, state);
    const device = await other.newPage();
    await device.goto('/');

    await signIn(device, 'producer', 'not the password');
    await expect(device.getByRole('alert')).toHaveText('Invalid username or password');
    await expect(device.locator('.app-main')).toHaveCount(0);

    // The name is taken. Trying to create it again is refused rather than
    // quietly made into a second account with the same name.
    await device.getByRole('button', { name: 'New here? Create Account' }).click();
    await device.getByPlaceholder('Enter your password').fill('a different password');
    await device.getByRole('button', { name: 'Create Account', exact: true }).click();
    await expect(device.getByRole('alert')).toHaveText('Account already exists. Please sign in.');
    expect(Object.keys(state.users)).toHaveLength(1);

    // The right password, and the returning account lands on its shows rather
    // than the first-run questions.
    await device.getByRole('button', { name: 'Already have an account? Sign In' }).click();
    await signIn(device, 'producer', PASSWORD);
    await expect(device.locator('.app-main')).toBeVisible();
    await expect(device.getByRole('button', { name: 'Get started' })).toHaveCount(0);
    await other.close();
  });
});
