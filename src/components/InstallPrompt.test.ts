import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstallPrompt } from './InstallPrompt';
import { holdInstallPrompt } from '../utils/installPrompt';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the install banner', () => {
  it('offers the install Chrome made before the banner was mounted', () => {
    const navigator = {
      userAgent:
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
      maxTouchPoints: 5,
    };
    vi.stubGlobal('navigator', navigator);
    vi.stubGlobal('window', { navigator, matchMedia: () => ({ matches: false }) });
    vi.stubGlobal('localStorage', { getItem: () => null });

    // At boot, while the sign-in screen is up.
    const page = new EventTarget();
    holdInstallPrompt(page);
    page.dispatchEvent(new Event('beforeinstallprompt', { cancelable: true }));

    // Then the producer signs in, and the app shell mounts the banner.
    const html = renderToStaticMarkup(createElement(InstallPrompt));
    expect(html).toContain('Install the app');
  });
});
