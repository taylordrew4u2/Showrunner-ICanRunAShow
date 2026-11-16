import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ASSISTANT_TOOLS } from '../../api/_lib/assistantTools';

// The real files, not fixtures. Claude Code reads these JSON files straight
// from the repository when a producer adds the marketplace, so a typo here
// ships to them with nothing in the build to catch it.
const root = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const exists = (path: string) => existsSync(new URL(path, root));

const CONNECTOR_URL = 'https://icanrunashow.com/api/mcp';
const GUIDE_URL = 'https://icanrunashow.com/guides/ai-assistants.html';

interface MarketplaceEntry { name?: unknown; source?: unknown; description?: unknown }
interface Marketplace { name?: unknown; owner?: { name?: unknown }; description?: unknown; plugins?: MarketplaceEntry[] }
interface PluginManifest {
  name?: unknown; version?: unknown; description?: unknown; author?: { name?: unknown };
  homepage?: unknown; icon?: unknown; documentationUrl?: unknown; supportUrl?: unknown;
  privacyPolicyUrl?: unknown; termsOfServiceUrl?: unknown;
}
interface McpConfig { mcpServers?: Record<string, { type?: unknown; url?: unknown; headers?: unknown }> }

const marketplace = JSON.parse(read('.claude-plugin/marketplace.json')) as Marketplace;
const entry = marketplace.plugins?.[0] ?? {};
// "./plugins/icanrunashow" as a path relative to the repository root.
const pluginDir = typeof entry.source === 'string' ? entry.source.replace(/^\.\//, '').replace(/\/?$/, '/') : '';
const plugin = JSON.parse(read(`${pluginDir}.claude-plugin/plugin.json`)) as PluginManifest;
const mcp = JSON.parse(read(`${pluginDir}.mcp.json`)) as McpConfig;

// Claude Code refuses ids outside these characters, and names that pass as
// one of Anthropic's own plugins.
const PLUGIN_ID = /^[a-z0-9][a-z0-9._-]*$/;
const RESERVED = /^(claude|anthropic|anthropics|cc-plugin)(-|$)/;

describe('the plugin marketplace', () => {
  it('names itself and its one plugin so the documented install command works', () => {
    expect(marketplace.name).toBe('icanrunashow');
    expect(marketplace.owner?.name).toEqual(expect.any(String));
    expect(marketplace.description).toEqual(expect.any(String));
    expect(marketplace.plugins).toHaveLength(1);
    expect(entry.name).toBe('icanrunashow');
    for (const name of [marketplace.name, entry.name] as string[]) {
      expect(name).toMatch(PLUGIN_ID);
      expect(name).not.toMatch(RESERVED);
    }
  });

  it('points at a plugin directory inside the repository', () => {
    // A relative source must start with ./ and may not climb out of the
    // marketplace root, or Claude Code rejects the entry.
    expect(entry.source).toMatch(/^\.\/[\w./-]+$/);
    expect(entry.source).not.toContain('..');
    expect(exists(`${pluginDir}.claude-plugin/plugin.json`)).toBe(true);
  });
});

describe('the plugin manifest', () => {
  it('has the metadata Claude Code and the plugin directory read', () => {
    expect(plugin.name).toBe(entry.name);
    expect(plugin.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(plugin.description).toEqual(expect.any(String));
    expect(plugin.author?.name).toEqual(expect.any(String));
  });

  it('links to pages the site actually serves', () => {
    expect(plugin.homepage).toBe(GUIDE_URL);
    expect(plugin.documentationUrl).toBe(GUIDE_URL);
    expect(plugin.supportUrl).toBe(`${GUIDE_URL}#help`);
    expect(read('public/guides/ai-assistants.html')).toContain('id="help"');
    expect(plugin.privacyPolicyUrl).toBe('https://icanrunashow.com/privacy.html');
    expect(exists('public/privacy.html')).toBe(true);
    expect(plugin.termsOfServiceUrl).toBe('https://icanrunashow.com/terms.html');
    expect(exists('public/terms.html')).toBe(true);
  });

  it('ships a square PNG icon the plugin directory accepts', () => {
    expect(plugin.icon).toMatch(/^\.\/[\w./-]+\.png$/);
    const png = readFileSync(new URL(`${pluginDir}${String(plugin.icon).slice(2)}`, root));
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const width = png.readUInt32BE(16);
    expect(png.readUInt32BE(20)).toBe(width);
    expect(width).toBeGreaterThanOrEqual(512);
    expect(width).toBeLessThanOrEqual(2048);
  });
});

describe('the connector the plugin adds', () => {
  it('is the hosted remote MCP server, over HTTP', () => {
    const servers = Object.entries(mcp.mcpServers ?? {});
    expect(servers).toHaveLength(1);
    const [name, server] = servers[0];
    expect(name).toBe('icanrunashow');
    expect(server.type).toBe('http');
    expect(server.url).toBe(CONNECTOR_URL);
    expect(exists('api/mcp.ts')).toBe(true);
  });

  it('carries no credential, so every producer signs in through OAuth', () => {
    // A header here would be the same secret for everyone who installs it.
    expect(mcp.mcpServers?.icanrunashow.headers).toBeUndefined();
  });
});

describe('the run-a-show skill', () => {
  const path = `${pluginDir}skills/run-a-show/SKILL.md`;

  it('exists with the frontmatter Claude Code loads it by', () => {
    expect(exists(path)).toBe(true);
    const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(read(path))?.[1] ?? '';
    expect(frontmatter).toMatch(/^name: run-a-show$/m);
    expect(frontmatter).toMatch(/^description: \S.+$/m);
  });

  it('teaches the rules that keep an assistant from doing damage', () => {
    const skill = read(path);
    expect(skill).toContain('expected_revision');
    expect(skill).toMatch(/Confirm before `delete_show`/);
    expect(skill).toContain('`send_contract`');
    expect(skill).toMatch(/surprise guest/i);
    expect(skill).toMatch(/local time/i);
  });

  it('lists every tool the server offers, and names no tool or argument it does not have', () => {
    const skill = read(path);
    const tools = ASSISTANT_TOOLS.map((tool) => tool.definition.name);
    const table = skill.split('\n').filter((line) => line.startsWith('| ') && line.includes('`'));
    const listed = table.flatMap((line) => [...line.matchAll(/`([^`]+)`/g)].map((match) => match[1]));
    expect([...listed].sort()).toEqual([...tools].sort());
    const args = new Set(ASSISTANT_TOOLS.flatMap((tool) => Object.keys((tool.definition.inputSchema.properties ?? {}) as object)));
    for (const [, word] of skill.matchAll(/`([a-z_]+)`/g)) {
      expect(tools.includes(word) || args.has(word) || word === 'icanrunashow', word).toBe(true);
    }
  });
});

describe('where producers are told how to connect', () => {
  // Built from the manifests, so renaming the plugin or the marketplace
  // without updating what the docs tell people to type fails here.
  const install = `/plugin install ${String(entry.name)}@${String(marketplace.name)}`;
  const addMarketplace = '/plugin marketplace add taylordrew4u2/showrunner-icanrunashow';
  const guide = read('public/guides/ai-assistants.html');
  const readme = read('README.md');

  it('gives the same connector address and install commands as the manifests', () => {
    for (const page of [guide, readme]) {
      expect(page).toContain(CONNECTOR_URL);
      expect(page).toContain(addMarketplace);
      expect(page).toContain(install);
      expect(page).toContain(`claude mcp add --transport http icanrunashow ${CONNECTOR_URL}`);
    }
    expect(readme).toContain(GUIDE_URL);
  });

  it('lists the guide in the sitemap and the guides index under its canonical address', () => {
    expect(guide).toContain(`<link rel="canonical" href="${GUIDE_URL}" />`);
    expect(read('public/sitemap.xml')).toContain(`<loc>${GUIDE_URL}</loc>`);
    expect(read('public/guides/index.html')).toContain('href="/guides/ai-assistants.html"');
  });

  it('leaves no guide out of the sitemap', () => {
    const sitemap = read('public/sitemap.xml');
    const pages = readdirSync(new URL('public/guides/', root)).filter((name) => name.endsWith('.html') && name !== 'index.html');
    expect(pages.length).toBeGreaterThan(0);
    for (const page of pages) expect(sitemap, page).toContain(`<loc>https://icanrunashow.com/guides/${page}</loc>`);
  });
});
