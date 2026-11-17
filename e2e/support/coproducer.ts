import { expect, type Browser, type Page } from '@playwright/test';
import { deriveSessionKeys, deriveUserId } from '../../src/utils/encryption';
import { normalizeUsername } from '../../src/utils/session-vault';
import { installFakeApi } from './fake-api.mjs';
import { PASSWORD } from './app';

/**
 * Opening the owner's account as a co-producer.
 *
 * The owner's keys are derived in Node exactly as the app derives them at
 * sign-in, so a spec can make a co-producer link straight into the fake
 * server (addCoproducerLink) without driving the owner's Settings.
 */

/** Where the link is opened (the main origin) and where it lands (the review origin); see playwright.config.ts. */
export const MAIN_ORIGIN = 'http://localhost:4173';
export const REVIEW_ORIGIN = 'http://127.0.0.1:4173';

/** The account's ids and keys, derived as the app derives them. */
export function accountKeys(username = 'producer', password = PASSWORD): { userId: string; key: string; legacyKey: string } {
  const { key, legacyKey } = deriveSessionKeys(password);
  return { userId: deriveUserId(normalizeUsername(username)), key, legacyKey };
}

/**
 * A separate browser context on the same fake state, opened on the
 * co-producer link as it would be sent: the main-origin address with the
 * token in the fragment. Resolves once co-producer view is up.
 */
export async function openAsCoproducer(browser: Browser, state: unknown, token: string): Promise<Page> {
  const context = await browser.newContext();
  await installFakeApi(context, state as Parameters<typeof installFakeApi>[1]);
  const page = await context.newPage();
  await page.goto(`${MAIN_ORIGIN}/coproduce#t=${token}`);
  await expect(page.getByText('Co-producer view').first()).toBeVisible({ timeout: 30_000 });
  return page;
}
