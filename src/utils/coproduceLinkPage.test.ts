import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COPRODUCE_COPY, coproduceBootScript, coproduceLinkPage, coproduceOriginSettings } from './coproduceLinkPage';

const indexHtml = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ';

interface Ran {
  replaced: string | null;
  states: unknown[][];
  global: unknown;
}

/** Run the boot script against a fake page at `address`, as a browser would before anything else. */
function boot(address: string, override = ''): Ran {
  const url = new URL(address);
  const ran: Ran = { replaced: null, states: [], global: undefined };
  const location = {
    origin: url.origin,
    protocol: url.protocol,
    host: url.host,
    hostname: url.hostname,
    hash: url.hash,
    search: url.search,
    replace: (to: string) => { ran.replaced = to; },
  };
  const history = { replaceState: (...args: unknown[]) => { ran.states.push(args); } };
  const window: Record<string, unknown> = {};
  new Function('location', 'history', 'window', coproduceBootScript(override))(location, history, window);
  ran.global = window.__icrasCoproduceToken;
  return ran;
}

describe('the co-producer link page', () => {
  const page = coproduceLinkPage(indexHtml, '');

  it('states no address of its own, asks not to be indexed and says what the link is', () => {
    expect(indexHtml).toContain('rel="canonical"');
    expect(page).not.toContain('rel="canonical"');
    expect(page).not.toContain('og:url');
    expect(page).toContain('<meta name="robots" content="noindex, nofollow" />');
    expect(page).toContain(`<title>${COPRODUCE_COPY.title}</title>`);
    expect(page).toContain(`content="${COPRODUCE_COPY.card}"`);
    expect(page).toContain(`content="${COPRODUCE_COPY.description}"`);
  });

  it('runs its boot script before anything else in the head', () => {
    const head = /<head[^>]*>\s*([\s\S]*?)<\/head>/.exec(page)![1];
    expect(head.startsWith(`<script>${coproduceBootScript('')}</script>`)).toBe(true);
    expect(page.match(/<head[^>]*>/g)).toHaveLength(1);
  });

  it('writes an override into the script as a literal that cannot close it', () => {
    const script = coproduceBootScript('http://127.0.0.1:4173</script><script>alert(1)//');
    expect(script).not.toContain('</script>');
    expect(script).toContain('"http://127.0.0.1:4173\\u003c/script>');
  });
});

describe('the boot script', () => {
  it('moves a link on the main site to the review origin, fragment and all, and does nothing else', () => {
    const ran = boot(`https://icanrunashow.com/coproduce#t=${TOKEN}`);
    expect(ran.replaced).toBe(`https://coproduce.icanrunashow.com/coproduce#t=${TOKEN}`);
    expect(ran.global).toBeUndefined();
    expect(ran.states).toEqual([]);
  });

  it('takes the token on the review origin and strips the address at once', () => {
    const ran = boot(`https://coproduce.icanrunashow.com/coproduce?utm=x#t=${TOKEN}`);
    expect(ran.replaced).toBeNull();
    expect(ran.global).toBe(TOKEN);
    expect(ran.states).toEqual([[null, '', '/coproduce']]);
  });

  it('follows a build-time override, as the end-to-end tests serve the two origins', () => {
    const moved = boot(`http://localhost:4173/coproduce#t=${TOKEN}`, 'http://127.0.0.1:4173');
    expect(moved.replaced).toBe(`http://127.0.0.1:4173/coproduce#t=${TOKEN}`);
    const there = boot(`http://127.0.0.1:4173/coproduce#t=${TOKEN}`, 'http://127.0.0.1:4173');
    expect([there.replaced, there.global]).toEqual([null, TOKEN]);
    // The override wins over the address's own sibling.
    expect(boot(`https://icanrunashow.com/coproduce#t=${TOKEN}`, 'https://review.example.test').replaced).toBe(`https://review.example.test/coproduce#t=${TOKEN}`);
  });

  it('takes the token where it is when there is no review origin', () => {
    for (const address of [`http://localhost:4173/coproduce#t=${TOKEN}`, `https://showrunner-git-branch.vercel.app/coproduce#t=${TOKEN}`]) {
      const ran = boot(address);
      expect(ran.replaced, address).toBeNull();
      expect(ran.global, address).toBe(TOKEN);
      expect(ran.states, address).toEqual([[null, '', '/coproduce']]);
    }
  });

  it('finds the token among other fragment parameters, and takes nothing malformed', () => {
    expect(boot(`https://coproduce.icanrunashow.com/coproduce#x=1&t=${TOKEN}`).global).toBe(TOKEN);
    for (const hash of [`#t=${TOKEN.slice(1)}`, `#t=${TOKEN}A`, `#t=${TOKEN.slice(1)}!`, `#xt=${TOKEN}`, '#t=']) {
      const ran = boot(`https://coproduce.icanrunashow.com/coproduce${hash}`);
      expect(ran.global, hash).toBeUndefined();
      // The address is still cleared.
      expect(ran.states, hash).toEqual([[null, '', '/coproduce']]);
    }
    expect(boot('https://coproduce.icanrunashow.com/coproduce').states).toEqual([]);
  });
});

describe('the build’s origin overrides', () => {
  it('are normalised origins, or empty when unset', () => {
    expect(coproduceOriginSettings({})).toEqual({ review: '', main: '' });
    expect(coproduceOriginSettings({ VITE_COPRODUCE_ORIGIN: 'http://127.0.0.1:4173', VITE_MAIN_ORIGIN: 'http://localhost:4173/' }))
      .toEqual({ review: 'http://127.0.0.1:4173', main: 'http://localhost:4173' });
    expect(coproduceOriginSettings({ VITE_COPRODUCE_ORIGIN: 'https://coproduce.example.test' }).review).toBe('https://coproduce.example.test');
  });

  it('refuse anything else, so the build stops', () => {
    for (const value of ['http://coproduce.icanrunashow.com', 'https://x.test/path', 'javascript:alert(1)', 'http://localhost', 'not a url', 'https://user:pw@x.test']) {
      expect(() => coproduceOriginSettings({ VITE_COPRODUCE_ORIGIN: value }), value).toThrow(/VITE_COPRODUCE_ORIGIN/);
      expect(() => coproduceOriginSettings({ VITE_MAIN_ORIGIN: value }), value).toThrow(/VITE_MAIN_ORIGIN/);
    }
  });
});
