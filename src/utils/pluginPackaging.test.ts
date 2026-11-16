import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { ASSISTANT_TOOLS } from '../../api/_lib/assistantTools';
import { openaiMcpJson } from '../../scripts/build-openai-plugin.mjs';

// The real files, not fixtures. OpenAI's plugin portal and Anthropic's
// directory read these as they are committed (OpenAI through the ZIP that
// scripts/build-openai-plugin.mjs makes), and each rejects a submission for a
// field over its limit or a path that goes nowhere, with nothing in the build
// to catch it first. The limits are the ones in docs/PLUGIN-SUBMISSION.md's
// sources. assistantPlugin.test.ts covers the Claude manifest and marketplace.

const root = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const exists = (path: string) => existsSync(new URL(path, root));
const PLUGIN = 'plugins/icanrunashow/';

interface Interface {
  displayName?: string; shortDescription?: string; longDescription?: string; developerName?: string; category?: string;
  capabilities?: string[]; websiteURL?: string; supportURL?: string; privacyPolicyURL?: string; termsOfServiceURL?: string;
  defaultPrompt?: string[]; brandColor?: string; brandColorDark?: string; composerIcon?: string; logo?: string;
  [key: string]: unknown;
}
interface TestCase { description?: string; prompt?: string; tools_triggered?: string; expected_behavior?: string }
interface CodexManifest {
  name?: string; version?: string; description?: string; author?: { name?: string; email?: string; url?: string };
  homepage?: string; license?: string; skills?: string; mcpServers?: string; interface?: Interface;
  extensions?: { 'com.openai'?: {
    review?: { test_cases?: { positive?: TestCase[]; negative?: TestCase[] }; commerce?: unknown; commerce_description?: string };
    publication?: { release_notes?: string };
  } };
  [key: string]: unknown;
}

const codex = JSON.parse(read(`${PLUGIN}.codex-plugin/plugin.json`)) as CodexManifest;
const claude = JSON.parse(read(`${PLUGIN}.claude-plugin/plugin.json`)) as Record<string, string> & { author?: { name?: string } };
const ui = codex.interface ?? {};
const openai = codex.extensions?.['com.openai'] ?? {};
const toolNames = ASSISTANT_TOOLS.map(tool => tool.definition.name);

// OpenAI's directory categories, exactly as its submission page lists them.
const CATEGORIES = ['Productivity', 'Creativity', 'Developer Tools', 'Business & Operations', 'Data & Analytics', 'Communication',
  'Education & Research', 'Security', 'Finance', 'Healthcare', 'Travel', 'Entertainment', 'Other'];

/** Text a listing may hold: no control or invisible characters, and line breaks only where allowed. */
function plainText(value: string, lines = false): boolean {
  if (!value.trim()) return false;
  return ![...value].some(character => {
    const code = character.codePointAt(0)!;
    if (lines && character === '\n') return false;
    return code < 32 || code === 127 || (code >= 0x200b && code <= 0x200f) || code === 0x2060 || code === 0xfeff;
  });
}

/** WCAG contrast between two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** Width and height of a PNG, from its IHDR chunk. */
function pngSize(path: string): { width: number; height: number; bytes: number } {
  const png = readFileSync(new URL(path, root));
  expect([...png.subarray(0, 8)], path).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20), bytes: png.length };
}

/** The rows of the markdown table under a heading, as arrays of trimmed cells. */
function tableUnder(markdown: string, heading: string): string[][] {
  const section = markdown.split(/^## /m).find(part => part.startsWith(heading)) ?? '';
  return section.split('\n')
    .filter(line => line.startsWith('| `'))
    .map(line => line.split('|').slice(1, -1).map(cell => cell.trim()));
}

describe('the OpenAI plugin manifest', () => {
  it('has the fields a Codex-format manifest requires, within its limits', () => {
    expect(codex.name).toBe(claude.name);
    expect(codex.name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(codex.name!.length).toBeLessThanOrEqual(64);
    expect(codex.description && plainText(codex.description)).toBe(true);
    expect(codex.description!.length).toBeLessThanOrEqual(1024);
    expect(codex.author?.name).toBe(claude.author?.name);
    expect(codex.author!.name!.length).toBeLessThanOrEqual(120);
    expect(codex.author?.email).toBe('skatematesnyc@gmail.com');
    expect(codex.author?.url).toMatch(/^https:\/\//);
    expect(codex.homepage).toBe(claude.homepage);
    expect(codex.license).toBe(claude.license);
    // Rejected or ignored in this format, or barring the public directory.
    for (const key of ['$schema', 'apps', 'hooks']) expect(codex, key).not.toHaveProperty(key);
  });

  it('has the same version as the Claude manifest, so one release bumps both', () => {
    expect(codex.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(codex.version).toBe(claude.version);
  });

  it('points at the skills folder and the connector the Claude plugin uses', () => {
    expect(codex.skills).toBe('./skills/');
    expect(codex.mcpServers).toBe('./.mcp.json');
    expect(exists(`${PLUGIN}skills/run-a-show/SKILL.md`)).toBe(true);
    expect(exists(`${PLUGIN}.mcp.json`)).toBe(true);
  });

  it('fills every listing field within the final-submission limits', () => {
    expect(ui.displayName).toBe(claude.displayName);
    expect(ui.displayName!.length).toBeLessThanOrEqual(30);
    expect(ui.displayName).not.toMatch(/\b(?:MCP|Plugin)\b/i);
    expect(plainText(ui.shortDescription ?? '')).toBe(true);
    expect(ui.shortDescription!.length).toBeLessThanOrEqual(30);
    expect(plainText(ui.longDescription ?? '', true)).toBe(true);
    expect(ui.longDescription!.length).toBeLessThanOrEqual(4000);
    expect(ui.developerName).toBe(codex.author?.name);
    expect(ui.developerName!.length).toBeLessThanOrEqual(80);
    expect(CATEGORIES).toContain(ui.category);
    expect(ui.capabilities!.length).toBeLessThanOrEqual(20);
    for (const capability of ui.capabilities!) expect(capability.length).toBeLessThanOrEqual(120);
  });

  it('links to the same pages as the Claude listing, which the site serves', () => {
    expect(ui.websiteURL).toBe('https://icanrunashow.com');
    expect(ui.supportURL).toBe(claude.supportUrl);
    expect(ui.privacyPolicyURL).toBe(claude.privacyPolicyUrl);
    expect(ui.termsOfServiceURL).toBe(claude.termsOfServiceUrl);
    for (const url of [ui.websiteURL, ui.supportURL, ui.privacyPolicyURL, ui.termsOfServiceURL] as string[]) {
      expect(url).toMatch(/^https:\/\/icanrunashow\.com(?:\/|$)/);
      expect(url.length).toBeLessThanOrEqual(1024);
      const path = new URL(url).pathname;
      if (path !== '/') expect(exists(`public${path}`), url).toBe(true);
    }
  });

  it('offers at most three example prompts, each one line of 128 characters or fewer', () => {
    const prompts = ui.defaultPrompt ?? [];
    expect(prompts.length).toBeGreaterThan(0);
    expect(prompts.length).toBeLessThanOrEqual(3);
    expect(new Set(prompts).size).toBe(prompts.length);
    for (const prompt of prompts) {
      expect(plainText(prompt), prompt).toBe(true);
      expect(prompt.length, prompt).toBeLessThanOrEqual(128);
      expect(prompt, prompt).not.toContain('@');
    }
  });

  it('uses brand colours that read against ChatGPT’s light and dark backgrounds', () => {
    expect(ui.brandColor).toMatch(/^#[0-9a-f]{6}$/i);
    expect(contrast(ui.brandColor!, '#ffffff')).toBeGreaterThanOrEqual(2);
    expect(ui.brandColorDark).toMatch(/^#[0-9a-f]{6}$/i);
    expect(contrast(ui.brandColorDark!, '#212121')).toBeGreaterThanOrEqual(2);
  });

  it('uses the app icon for the logo and composer icon, square and within OpenAI’s sizes', () => {
    for (const icon of [ui.logo, ui.composerIcon]) {
      expect(icon).toBe(claude.icon);
      expect(icon).toMatch(/^\.\/assets\/[\w.-]+\.png$/);
      const { width, height, bytes } = pngSize(`${PLUGIN}${icon!.slice(2)}`);
      expect(height).toBe(width);
      expect(width).toBeGreaterThanOrEqual(48);
      expect(width).toBeLessThanOrEqual(4096);
      expect(bytes).toBeLessThanOrEqual(5 * 1024 * 1024);
    }
    // The same artwork the app installs with.
    expect(readFileSync(new URL(`${PLUGIN}assets/icon.png`, root)).equals(readFileSync(new URL('public/icons/icon-512x512.png', root)))).toBe(true);
  });

  it('says nothing about plans, prices or upgrades in what the directory shows', () => {
    // OpenAI's listing rules: no pricing, subscriptions, trials or promotions.
    const listed = [codex.description, ui.shortDescription, ui.longDescription, ...(ui.defaultPrompt ?? [])].join('\n');
    expect(listed).not.toMatch(/\b(?:price|pricing|subscri\w*|trial|discount|upgrade|free plan|producer plan|paid)\b|\$\d/i);
  });
});

describe('the review material in the OpenAI manifest', () => {
  const cases = openai.review?.test_cases ?? {};

  it('has exactly five positive and three negative test cases, each complete', () => {
    expect(cases.positive).toHaveLength(5);
    expect(cases.negative).toHaveLength(3);
    for (const test of cases.positive!) {
      for (const field of ['description', 'prompt', 'tools_triggered', 'expected_behavior'] as const) {
        expect(test[field] && plainText(test[field]!), `${test.prompt}: ${field}`).toBe(true);
      }
      expect(test.description!.length).toBeLessThanOrEqual(4000);
      // Each tool named is one the server offers.
      for (const name of test.tools_triggered!.split(/,\s*/)) expect(toolNames, test.prompt).toContain(name);
    }
    for (const test of cases.negative!) {
      expect(Object.keys(test).sort()).toEqual(['description', 'prompt']);
      expect(test.description!.length).toBeLessThanOrEqual(4000);
    }
  });

  it('declares no commerce and has release notes', () => {
    expect(openai.review?.commerce).toBe(false);
    expect(openai.review?.commerce_description).toEqual(expect.any(String));
    expect(openai.publication?.release_notes).toEqual(expect.any(String));
  });

  it('carries no reviewer credentials, which the portal rejects in a ZIP and which never belong in the repository', () => {
    const text = read(`${PLUGIN}.codex-plugin/plugin.json`);
    expect(text).not.toMatch(/test_credentials|reviewer_instructions|password"/i);
  });
});

describe('the listing copy in docs/ASSISTANT-LISTINGS.md', () => {
  const doc = read('docs/ASSISTANT-LISTINGS.md');
  /** A blockquote after a bold label, as the text it quotes. */
  const quoted = (label: string) => {
    const after = doc.slice(doc.indexOf(`**${label}**`));
    const lines = after.split('\n').slice(1);
    const start = lines.findIndex(line => line.startsWith('>'));
    const block: string[] = [];
    for (const line of lines.slice(start)) {
      if (line.startsWith('>')) block.push(line.replace(/^> ?/, ''));
      else if (line.trim() === '' && block.length) block.push('');
      else break;
    }
    return block.join('\n').trim().replace(/\n{3,}/g, '\n\n');
  };

  it('is the text the OpenAI manifest carries', () => {
    expect(ui.shortDescription).toBe(quoted('ChatGPT subtitle'));
    expect(ui.longDescription).toBe(quoted('Long description'));
    const examples = doc.slice(doc.indexOf('**ChatGPT example prompts**')).split('\n').filter(line => /^\d\. /.test(line)).slice(0, 3).map(line => line.replace(/^\d\. /, ''));
    expect(ui.defaultPrompt).toEqual(examples);
  });

  it('lists the same review test cases as the manifest', () => {
    const cases = openai.review?.test_cases ?? {};
    for (const test of [...cases.positive ?? [], ...cases.negative ?? []]) expect(doc, test.prompt).toContain(`Prompt: "${test.prompt}"`);
  });

  it('lists every tool the server offers, and no tool it does not have', () => {
    const listed = tableUnder(doc, 'Tools').map(([name]) => name.replace(/`/g, ''));
    expect([...listed].sort()).toEqual([...toolNames].sort());
  });
});

describe('the tool table in docs/PLUGIN-SUBMISSION.md', () => {
  const rows = tableUnder(read('docs/PLUGIN-SUBMISSION.md'), 'Tools and annotations');
  const yes = (cell: string) => {
    expect(['Yes', 'No']).toContain(cell);
    return cell === 'Yes';
  };

  it('has a row for every tool the server offers, with its permission and the server’s own hints', () => {
    expect(rows.map(([name]) => name.replace(/`/g, ''))).toEqual(toolNames);
    for (const [name, scope, readOnly, destructive, idempotent, openWorld, why] of rows) {
      const tool = ASSISTANT_TOOLS.find(t => `\`${t.definition.name}\`` === name)!;
      const hints = tool.definition.annotations;
      expect(scope, name).toBe(`\`${tool.scope}\``);
      expect(yes(readOnly), `${name} read-only`).toBe(hints.readOnlyHint);
      expect(yes(destructive), `${name} destructive`).toBe(hints.destructiveHint);
      expect(yes(idempotent), `${name} idempotent`).toBe(hints.idempotentHint);
      expect(yes(openWorld), `${name} open world`).toBe(hints.openWorldHint);
      expect(why.length, `${name} why`).toBeGreaterThan(20);
    }
  });
});

describe('the Codex marketplace', () => {
  const marketplace = JSON.parse(read('.agents/plugins/marketplace.json')) as {
    name?: string; interface?: { displayName?: string };
    plugins?: { name?: string; source?: { source?: string; path?: string }; policy?: { installation?: string; authentication?: string }; category?: string }[];
  };

  it('lists the one plugin, from its folder, with the policy and category every entry needs', () => {
    expect(marketplace.name).toBe(codex.name);
    expect(marketplace.interface?.displayName).toBe(ui.displayName);
    expect(marketplace.plugins).toHaveLength(1);
    const [entry] = marketplace.plugins!;
    expect(entry.name).toBe(codex.name);
    expect(entry.source).toEqual({ source: 'local', path: `./${PLUGIN.slice(0, -1)}` });
    expect(exists(`${PLUGIN}.codex-plugin/plugin.json`)).toBe(true);
    expect(['AVAILABLE', 'INSTALLED_BY_DEFAULT', 'NOT_AVAILABLE']).toContain(entry.policy?.installation);
    expect(entry.policy?.authentication).toEqual(expect.any(String));
    expect(entry.category).toBe(ui.category);
  });
});

/** Every file under a folder, as paths from the repository root. */
function filesUnder(dir: string): string[] {
  return readdirSync(new URL(dir, root), { withFileTypes: true })
    .flatMap(entry => (entry.isDirectory() ? filesUnder(`${dir}${entry.name}/`) : [`${dir}${entry.name}`]));
}

describe('the plugin folder both directories read', () => {
  const all = filesUnder(PLUGIN);

  it('has a README of at least 40 words outside code, which Anthropic shows as the description', () => {
    const prose = read(`${PLUGIN}README.md`).replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
    expect(prose.split(/\s+/).filter(word => /[A-Za-z]/.test(word)).length).toBeGreaterThanOrEqual(40);
    // It names the one place the plugin sends anything.
    expect(read(`${PLUGIN}README.md`)).toContain('https://icanrunashow.com/api/mcp');
  });

  it('gives install commands that match the manifests and the marketplaces', () => {
    const readme = read(`${PLUGIN}README.md`);
    const claudeMarketplace = JSON.parse(read('.claude-plugin/marketplace.json')) as { plugins: { name: string }[] };
    expect(claudeMarketplace.plugins.map(p => p.name)).toContain(codex.name);
    expect(readme).toContain(`/plugin install ${codex.name} --marketplace taylordrew4u2/showrunner-icanrunashow`);
    const codexInstall = 'codex plugin marketplace add taylordrew4u2/showrunner-icanrunashow';
    expect(readme).toContain(codexInstall);
    expect(read('docs/PLUGIN-SUBMISSION.md')).toContain(codexInstall);
  });

  it('holds only text and PNG files within the directories’ size limits, and nothing a desktop leaves behind', () => {
    expect(all.length).toBeLessThanOrEqual(512);
    for (const path of all) {
      expect(path, path).toMatch(/\.(?:json|md|png)$/);
      expect(path, path).not.toMatch(/(?:^|\/)(?:\.DS_Store|Thumbs\.db|desktop\.ini|__MACOSX)/);
      const size = statSync(new URL(path, root)).size;
      expect(size, path).toBeLessThan(path.endsWith('.png') ? 5 * 1024 * 1024 : 256 * 1024);
    }
    // A top-level bin/ stops the plugin installing on claude.ai; hooks keep it out of OpenAI's directory.
    expect(exists(`${PLUGIN}bin`)).toBe(false);
    expect(exists(`${PLUGIN}hooks`)).toBe(false);
  });

  it('keeps the skill provider-neutral and within the skill limits', () => {
    const skill = read(`${PLUGIN}skills/run-a-show/SKILL.md`);
    const description = /^description: (.+)$/m.exec(skill)?.[1] ?? '';
    expect(description.length).toBeGreaterThan(0);
    expect(description.length).toBeLessThanOrEqual(1024);
    expect(`${codex.name}:run-a-show`.length).toBeLessThanOrEqual(64);
    // Read by ChatGPT and Codex as well as Claude.
    expect(skill).not.toMatch(/\bClaude\b|\bChatGPT\b/);
    // OpenAI's plugin rules: nothing that sends the producer to an upgrade.
    expect(skill).not.toMatch(/Settings → Plan|upgrade (?:under|in|to)|(?:Producer|free) plan/i);
  });
});

describe('the connector configuration in the ZIP for OpenAI', () => {
  interface McpConfig { mcpServers: Record<string, { type?: string; url?: string; extensions?: Record<string, { auth?: unknown; [key: string]: unknown }>; [key: string]: unknown }> }
  const source = read(`${PLUGIN}.mcp.json`);
  const folder = JSON.parse(source) as McpConfig;
  const zipped = JSON.parse(openaiMcpJson(source)) as McpConfig;

  it('declares OAuth with dynamic client registration on the connector, where OpenAI reads it', () => {
    expect(zipped.mcpServers.icanrunashow.extensions?.['com.openai']?.auth).toEqual({ type: 'oauth', client: { mode: 'dcr' } });
    // A dcr client carries no client id or credentials.
    expect(JSON.stringify(zipped)).not.toMatch(/clientId|client_id|secret|tokenEndpointAuthMethod/i);
  });

  it('is otherwise the folder’s own, which Claude reads, left without the OpenAI declaration', () => {
    expect(folder.mcpServers.icanrunashow).not.toHaveProperty('extensions');
    expect(Object.keys(zipped.mcpServers)).toEqual(Object.keys(folder.mcpServers));
    const { extensions, ...rest } = zipped.mcpServers.icanrunashow;
    expect(rest).toEqual(folder.mcpServers.icanrunashow);
    expect(Object.keys(extensions ?? {})).toEqual(['com.openai']);
    expect(zipped.mcpServers.icanrunashow.url).toBe('https://icanrunashow.com/api/mcp');
    expect(openaiMcpJson(source).endsWith('}\n')).toBe(true);
  });

  it('keeps anything else under extensions, and refuses a configuration without the connector', () => {
    const other = { mcpServers: { icanrunashow: { type: 'http', url: 'https://icanrunashow.com/api/mcp', extensions: { 'com.example': { on: true }, 'com.openai': { note: 'kept', auth: { type: 'none' } } } } } };
    expect(JSON.parse(openaiMcpJson(JSON.stringify(other))).mcpServers.icanrunashow.extensions).toEqual({
      'com.example': { on: true }, 'com.openai': { note: 'kept', auth: { type: 'oauth', client: { mode: 'dcr' } } },
    });
    expect(() => openaiMcpJson(JSON.stringify({ mcpServers: { other: { type: 'http', url: 'https://example.test' } } }))).toThrow('icanrunashow');
    expect(() => openaiMcpJson('{}')).toThrow('icanrunashow');
  });
});

describe('the ZIP for OpenAI', () => {
  const out = mkdtempSync(join(tmpdir(), 'openai-plugin-'));
  afterAll(() => rmSync(out, { recursive: true, force: true }));

  /** The archive's entries, read from its central directory. */
  function entries(archive: Buffer): { name: string; data: Buffer; external: number }[] {
    const end = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    const count = archive.readUInt16LE(end + 10);
    let at = archive.readUInt32LE(end + 16);
    const found = [];
    for (let i = 0; i < count; i++) {
      expect(archive.readUInt32LE(at)).toBe(0x02014b50);
      const method = archive.readUInt16LE(at + 10);
      const packed = archive.readUInt32LE(at + 20);
      const nameLength = archive.readUInt16LE(at + 28);
      const extra = archive.readUInt16LE(at + 30);
      const comment = archive.readUInt16LE(at + 32);
      const external = archive.readUInt32LE(at + 38);
      const local = archive.readUInt32LE(at + 42);
      const name = archive.toString('utf8', at + 46, at + 46 + nameLength);
      const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
      const raw = archive.subarray(start, start + packed);
      found.push({ name, data: method === 8 ? inflateRawSync(raw) : raw, external });
      at += 46 + nameLength + extra + comment;
    }
    return found;
  }

  it('holds the plugin folder at its root, without the Claude manifest, byte for byte but for OpenAI’s sign-in declaration', () => {
    execFileSync(process.execPath, ['scripts/build-openai-plugin.mjs', '--out', out], { cwd: new URL('.', root), stdio: 'pipe' });
    const archive = readFileSync(join(out, `${codex.name}-${codex.version}.zip`));
    const zipped = entries(archive);
    expect(zipped.map(entry => entry.name)).toEqual([
      '.codex-plugin/plugin.json', '.mcp.json', 'README.md', 'assets/icon.png', 'skills/run-a-show/SKILL.md',
    ]);
    for (const entry of zipped) {
      const original = readFileSync(new URL(`${PLUGIN}${entry.name}`, root));
      const expected = entry.name === '.mcp.json' ? Buffer.from(openaiMcpJson(original.toString('utf8')), 'utf8') : original;
      expect(entry.data.equals(expected), entry.name).toBe(true);
      // Regular files only: no links.
      expect((entry.external >>> 16) & 0o170000, entry.name).toBe(0o100000);
    }
    // Everything in the folder but Claude's manifest.
    expect(filesUnder(PLUGIN).filter(path => !path.startsWith(`${PLUGIN}.claude-plugin/`)).length).toBe(zipped.length);
  });
});
