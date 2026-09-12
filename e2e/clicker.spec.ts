import { expect, test } from '@playwright/test';
import { deriveKey, encryptWithKey } from '../src/utils/encryption';
import { emptyState, installFakeApi } from './support/fake-api.mjs';
import { signUp } from './support/app';

// Valid silent audio keeps this test deterministic without playing sound in CI.
function silentWav(): string {
  const samples = 8000 * 30;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  return 'data:audio/wav;base64,' + wav.toString('base64');
}

for (const remoteKey of ['F18', ' ']) {
  test(`clicker ${remoteKey === ' ' ? 'Space' : remoteKey} toggles selected music after adjusting a slider, independently of the timer`, async ({ page, context }) => {
    const key = deriveKey('correct horse battery staple');
    const show = {
      id: 'clicker-show', name: 'Clicker Test', date: '2026-09-24', status: 'upcoming',
      time: '', location: '', venueName: '', performers: [], artists: [], hosts: [],
      staff: [], expenses: [],
      schedule: [
        { id: 'welcome', time: '0:00', description: 'Welcome', durationMin: 10 },
        { id: 'next', time: '0:10', description: 'Next section', durationMin: 10 },
      ],
      djSongs: [{ id: 'music', title: 'Test music', artist: '', music: silentWav() }],
    };
    await installFakeApi(context, emptyState({
      shows: [{ id: show.id, encryptedData: encryptWithKey(show, key) }],
      settings: encryptWithKey({ onboarded: true, remoteMusicKey: remoteKey, brandName: 'Test', musicLibrary: [] }, key),
    }));
    await signUp(page);
    await page.getByRole('button', { name: 'Clicker Test', exact: true }).click();
    await page.getByRole('button', { name: 'Run Show', exact: true }).click();
    const run = page.locator('.run-show');
    const pad = run.locator('.rs-pad').filter({ hasText: 'Test music' });
    await expect(run.locator('.rs-board__now')).toContainText('Choose a song');
    await pad.click();
    await expect(pad).toHaveAttribute('aria-pressed', 'true');
    await expect(run.locator('.rs-board__now')).toContainText('Playing:');

    const slider = run.locator('input[type=range]').last();
    await slider.focus();
    await page.keyboard.press('ArrowRight');
    const level = await slider.inputValue();
    // Playwright's keyboard API does not expose F18; dispatch the key reported
    // by the paired Mac clicker. Space uses native keyboard events/defaults.
    const remoteDown = async (repeat = false) => {
      if (remoteKey === 'F18') {
        await page.locator(':focus').dispatchEvent('keydown', { key: 'F18', code: 'F18', repeat, bubbles: true });
      } else await page.keyboard.down('Space');
    };
    const remoteUp = async () => {
      if (remoteKey === 'F18') {
        await page.locator(':focus').dispatchEvent('keyup', { key: 'F18', code: 'F18', bubbles: true });
      } else await page.keyboard.up('Space');
    };
    const remotePress = async () => { await remoteDown(); await remoteUp(); };
    await remotePress();
    await expect(pad).toHaveAttribute('aria-pressed', 'false');
    await expect(slider).toHaveValue(level);
    await expect(run.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
    await remotePress();
    await expect(pad).toHaveAttribute('aria-pressed', 'true');

    // A held button must not alternate stop/start on key-repeat.
    await remoteDown();
    await expect(pad).toHaveAttribute('aria-pressed', 'false');
    await remoteDown(true);
    await expect(pad).toHaveAttribute('aria-pressed', 'false');
    await remoteUp();

    // Moving the timer neither starts music nor discards the selected song.
    await run.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(pad).toHaveAttribute('aria-pressed', 'false');
    await remotePress();
    await expect(pad).toHaveAttribute('aria-pressed', 'true');
    await expect(run.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
    await run.getByRole('button', { name: 'Stop audio', exact: true }).click();
  });
}
