// Types for what build-openai-plugin.mjs exports, so src/utils/pluginPackaging.test.ts
// can check the ZIP's .mcp.json without building a ZIP.

/**
 * The ZIP's .mcp.json, from the text of the plugin's own: the same servers,
 * with the connector's entry declaring OAuth with dynamic client registration
 * under extensions["com.openai"].auth. Throws if the connector's entry is missing.
 */
export function openaiMcpJson(text: string): string;
