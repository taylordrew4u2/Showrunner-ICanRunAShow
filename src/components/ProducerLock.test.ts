import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProducerLock } from './ProducerLock';
import { PRODUCER_PRICE_LABEL } from '../utils/billing';

const render = () => renderToStaticMarkup(createElement(ProducerLock, { feature: 'The Season report' }));

describe('a Producer feature on the free plan', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('says what it costs and offers the upgrade in a browser', () => {
    vi.stubGlobal('window', {});
    const html = render();
    expect(html).toContain(`The Season report is part of the Producer plan — ${PRODUCER_PRICE_LABEL}.`);
    expect(html).toMatch(/<button[^>]*>Upgrade<\/button>/);
  });

  it('in the iOS app, only says what it is part of: no price and no way off to pay', () => {
    // App Store guideline 3.1.1: no purchase other than Apple's, and nothing
    // that points at one.
    vi.stubGlobal('window', { Capacitor: { isNativePlatform: () => true } });
    const html = render();
    expect(html).toContain('The Season report is part of the Producer plan.');
    expect(html).not.toContain(PRODUCER_PRICE_LABEL);
    expect(html).not.toContain('<button');
    expect(html).not.toContain('<a ');
  });
});
