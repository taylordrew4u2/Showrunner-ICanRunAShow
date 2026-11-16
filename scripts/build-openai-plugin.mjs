// Build the ZIP to upload at platform.openai.com/plugins.
//
//   npm run plugin:openai                 → dist-plugin/icanrunashow-<version>.zip
//   node scripts/build-openai-plugin.mjs --out <dir>
//
// OpenAI's plugin directory (ChatGPT and Codex) takes a plugin as one ZIP: a
// manifest at .codex-plugin/plugin.json, the .mcp.json it points to, at least
// one skill and the icons, with the plugin's folder at the archive root. It is
// the same folder the Claude plugin uses, less .claude-plugin/: OpenAI's docs
// leave open which manifest wins when both are in one archive, so only theirs
// goes in. See docs/PLUGIN-SUBMISSION.md.
//
// One file differs from the folder: the ZIP's .mcp.json also tells OpenAI how
// the connector signs in (extensions["com.openai"].auth: OAuth, with dynamic
// client registration), which OpenAI reads from each server's entry. The
// folder's own .mcp.json stays as Claude reads it. openaiMcpJson makes the
// ZIP's copy, and src/utils/pluginPackaging.test.ts checks it.
//
// The archive is written here rather than by a zip tool, so it comes out the
// same on every machine: entries in name order, one fixed timestamp, regular
// files only. Uploading a changed plugin needs a higher version in both
// manifests (src/utils/pluginPackaging.test.ts keeps them equal).

import { lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pluginDir = join(root, 'plugins', 'icanrunashow');

// Left out of the upload: Claude's own manifest, and anything OpenAI rejects
// (hooks, app configuration) or a desktop leaves behind.
const EXCLUDED = new Set(['.claude-plugin', 'hooks', '.app.json', 'node_modules', '.DS_Store', 'Thumbs.db', 'desktop.ini', '__MACOSX']);

// The connector's entry in .mcp.json, and how OpenAI is to sign in to it.
const SERVER = 'icanrunashow';
const OPENAI_AUTH = { type: 'oauth', client: { mode: 'dcr' } };

function fail(message) {
  console.error(`[plugin:openai] ${message}`);
  process.exit(1);
}

/**
 * The ZIP's .mcp.json, from the text of the plugin's own: the same servers,
 * with the connector's entry declaring OAuth with dynamic client registration
 * under extensions["com.openai"].auth. Anything else already under
 * extensions is kept. Throws if the connector's entry is missing.
 */
export function openaiMcpJson(text) {
  const config = JSON.parse(text);
  const server = config?.mcpServers?.[SERVER];
  if (!server || typeof server !== 'object' || Array.isArray(server)) throw new Error(`.mcp.json has no "${SERVER}" server.`);
  const extensions = server.extensions ?? {};
  config.mcpServers[SERVER] = {
    ...server,
    extensions: { ...extensions, 'com.openai': { ...extensions['com.openai'], auth: OPENAI_AUTH } },
  };
  return `${JSON.stringify(config, null, 2)}\n`;
}

/** Every file to upload, as archive paths with "/" separators, in name order. */
function collect(dir) {
  const files = [];
  for (const name of readdirSync(dir).sort()) {
    if (EXCLUDED.has(name)) continue;
    const path = join(dir, name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) fail(`${relative(root, path)} is a symbolic link; the upload takes regular files only.`);
    if (stat.isDirectory()) files.push(...collect(path));
    else if (stat.isFile()) files.push(relative(pluginDir, path).split(sep).join('/'));
  }
  return files;
}

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** A deflated .zip of the given files, every entry dated 1980-01-01. */
function zip(entries) {
  const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01
  const UTF8_NAMES = 0x0800;
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const packed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8_NAMES, 6);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4); // made on Unix, so the mode below is read
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(UTF8_NAMES, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(((0o100644 << 16) >>> 0), 38); // a regular file, rw-r--r--
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, packed);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

function main() {
  const outArg = process.argv.indexOf('--out');
  const outDir = outArg > 0 && process.argv[outArg + 1] ? resolve(process.argv[outArg + 1]) : join(root, 'dist-plugin');

  const manifest = JSON.parse(readFileSync(join(pluginDir, '.codex-plugin', 'plugin.json'), 'utf8'));
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.name ?? '')) fail('The manifest name must be lowercase letters and digits, with single hyphens.');
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version ?? '')) fail('The manifest version must be semver, such as 1.0.0.');

  const files = collect(pluginDir);
  if (typeof manifest.mcpServers !== 'string') fail('The manifest must point at the connector with mcpServers.');
  const referenced = [manifest.mcpServers, manifest.interface?.logo, manifest.interface?.composerIcon, manifest.interface?.logoDark, manifest.interface?.composerIconDark]
    .filter(Boolean)
    .map(path => path.replace(/^\.\//, ''));
  for (const path of referenced) if (!files.includes(path)) fail(`The manifest points at ./${path}, which is not in the plugin.`);
  if (!files.some(path => /^skills\/[^/]+\/SKILL\.md$/.test(path))) fail('The upload needs at least one skill at skills/<name>/SKILL.md.');

  const mcpPath = manifest.mcpServers.replace(/^\.\//, '');
  const contents = name => {
    const data = readFileSync(join(pluginDir, name));
    if (name !== mcpPath) return data;
    try { return Buffer.from(openaiMcpJson(data.toString('utf8')), 'utf8'); }
    catch (error) { return fail(`./${name}: ${error.message}`); }
  };
  const archive = zip(files.map(name => ({ name, data: contents(name) })));
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, `${manifest.name}-${manifest.version}.zip`);
  writeFileSync(out, archive);

  console.log(`[plugin:openai] ${out.startsWith(root + sep) ? relative(root, out) : out} (${archive.length} bytes)`);
  for (const name of files) console.log(`  ${name}${name === mcpPath ? ' (with OpenAI\'s OAuth declaration)' : ''}`);
  if (!manifest.extensions?.['com.openai']?.review?.demo_recording_url) {
    console.log('[plugin:openai] No demo_recording_url in the manifest: add the demo video in the portal, or to the manifest before building.');
  }
}

// Build only when run, not when a test imports openaiMcpJson. Both paths are
// resolved through any symbolic link, as Node resolves the script it runs.
function runDirectly() {
  try { return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
}
if (runDirectly()) main();
