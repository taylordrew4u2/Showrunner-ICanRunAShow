import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The real files, not fixtures. The bug was in what the published copy says
// the app does, so a fixture that had drifted from it would prove nothing.
const root = new URL('../../', import.meta.url);
const llms = readFileSync(new URL('public/llms.txt', root), 'utf8');
const indexHtml = readFileSync(new URL('index.html', root), 'utf8');
const readme = readFileSync(new URL('README.md', root), 'utf8');
const guidesDir = new URL('public/guides/', root);
const guides = readdirSync(guidesDir)
  .filter((name) => name.endsWith('.html'))
  .map((name) => ({ name, html: readFileSync(new URL(name, guidesDir), 'utf8') }));

// Schedule import is PDF.js, on-device OCR and a line parser; nothing leaves
// the phone. The copy used to describe a paid vision model behind a keyed
// server proxy that the code never had, so a producer read that importing a
// run sheet needed an API key, and crawlers were told about a feature that
// was never shipped.
const modelOrProxyClaims = [
  /gpt/i,
  /openai/i,
  /vision model/i,
  /extraction proxy/i,
  /server-side (image )?extraction/i,
  /extraction key/i,
];

describe('what the published copy says about schedule import', () => {
  it('does not promise a model or a server proxy that the app never had', () => {
    for (const claim of modelOrProxyClaims) {
      expect(llms).not.toMatch(claim);
      expect(readme).not.toMatch(claim);
    }
    // The README may say "there is no AI key"; the crawler summary must not
    // mention AI at all, because a crawler keeps the noun and drops the "no".
    expect(llms).not.toMatch(/\bAI\b/);
  });

  it('does not tell a producer that importing a schedule needs an API key', () => {
    expect(llms).not.toMatch(/api key/i);
    expect(readme).not.toMatch(/schedule import.*api key|api key.*schedule import/i);
    expect(readme).not.toMatch(/schedule extractor/i);
  });

  it('lists the import to search engines as what it is: reading a photo or PDF on the device', () => {
    expect(indexHtml).not.toMatch(/AI schedule import/);
    expect(indexHtml).toMatch(/"Schedule import from a photo, PDF or pasted text"/);
  });

  it('still says the import exists, so the feature is not hidden along with the claim', () => {
    expect(llms).toMatch(/Schedule import/);
    expect(llms).toMatch(/OCR/);
    expect(readme).toMatch(/Tesseract/);
  });
});

// What the Producer plan adds (PlanCard's PRODUCER_PERKS, llms.txt), in the
// words a guide might use for them.
const producerFeatures = [
  /live (view|link)|audience link|lineup link/i,
  /contract|e-?sign/i,
  /import|photo or PDF/i,
  /season report/i,
  /stage remote|bluetooth/i,
];

describe('what the guides say is free', () => {
  it('says a feature is on the Producer plan wherever a call to action that says "free" offers one', () => {
    // Two guides ended on the public live view and then "Free to use." A
    // producer who signed up for it met an Upgrade button.
    const ctas = guides.flatMap(({ name, html }) =>
      [...html.matchAll(/<div class="cta">([\s\S]*?)<\/div>/g)].map((match) => ({ name, text: match[1] })),
    );
    expect(ctas.length).toBeGreaterThan(0);
    for (const { name, text } of ctas) {
      if (!/free/i.test(text)) continue;
      if (!producerFeatures.some((feature) => feature.test(text))) continue;
      expect(text, name).toMatch(/Producer plan/);
    }
  });
});
