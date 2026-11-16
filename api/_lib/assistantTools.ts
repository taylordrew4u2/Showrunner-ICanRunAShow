// Every tool /api/mcp offers an AI assistant, and the one place a call is
// checked against what the producer granted.
//
// A connection always reads shows (shows:read cannot be unticked at consent),
// and each tool names the one further permission it needs. tools/list shows
// only what the grant allows, and a call is checked again here, because a
// client can call a tool it was never shown.
import {
  AssistantToolError, hasScope, requireScope,
  type AssistantContext, type AssistantGrant, type AssistantScope, type AssistantTool, type ToolDefinition,
} from './assistantCore';
import { CONTRACT_TOOLS, LINK_TOOLS } from './assistantLinks';
import { OUTPUT_SCHEMAS } from './assistantOutputs';
import { ROLODEX_TOOLS } from './assistantRolodex';
import { SEARCH_TOOLS } from './assistantSearch';
import { SHOW_EDIT_TOOLS } from './assistantShowEdits';
import { deleteShow } from './assistantTrash';
import { handleShowTool, SHOW_TOOLS } from './chatgptShows';

/** The first four show tools, which the original ChatGPT connector shipped with. */
const [listShows, getShow, createShow, updateShow] = SHOW_TOOLS.map((definition): AssistantTool => ({
  scope: definition.annotations.readOnlyHint ? 'shows:read' : 'shows:write',
  definition,
  run: (ctx, input) => handleShowTool(ctx.db, ctx.grant, definition.name, input, ctx.origin),
}));

export const ASSISTANT_TOOLS: AssistantTool[] = [
  listShows, getShow, ...SEARCH_TOOLS,
  createShow, updateShow, ...SHOW_EDIT_TOOLS,
  deleteShow,
  ...ROLODEX_TOOLS,
  ...CONTRACT_TOOLS,
  ...LINK_TOOLS,
].map(tool => ({
  ...tool,
  definition: {
    ...tool.definition,
    outputSchema: OUTPUT_SCHEMAS[tool.definition.name],
    // Clients on protocols before 2025-06-18 read a tool's title only from
    // its annotations, so it is given in both places.
    annotations: { title: tool.definition.title, ...tool.definition.annotations },
  },
}));

/** Every permission some tool needs, in the order the tools come. */
export const TOOL_SCOPES: AssistantScope[] = [...new Set(ASSISTANT_TOOLS.map(tool => tool.scope))];

function allowed(grant: AssistantGrant, tool: AssistantTool): boolean {
  return hasScope(grant, 'shows:read') && hasScope(grant, tool.scope);
}

/** The OAuth scopes a tool needs, as OpenAI's per-tool securitySchemes declare them. */
export function securitySchemes(tool: AssistantTool): { type: 'oauth2'; scopes: AssistantScope[] }[] {
  return [{ type: 'oauth2', scopes: [...new Set<AssistantScope>(['shows:read', tool.scope])] }];
}

/**
 * What tools/list offers this connection. securitySchemes is given at the top
 * level and again in _meta, where clients that read only _meta look for it.
 */
export function toolsFor(grant: AssistantGrant): (ToolDefinition & { securitySchemes: unknown; _meta: Record<string, unknown> })[] {
  return ASSISTANT_TOOLS.filter(tool => allowed(grant, tool)).map(tool => {
    const schemes = securitySchemes(tool);
    return { ...tool.definition, securitySchemes: schemes, _meta: { securitySchemes: schemes } };
  });
}

/** Run one tool for this connection, refusing it unless the grant allows it. */
export async function callAssistantTool(ctx: AssistantContext, name: string, input: unknown): Promise<unknown> {
  const tool = ASSISTANT_TOOLS.find(t => t.definition.name === name);
  if (!tool) throw new AssistantToolError('Unknown tool.');
  requireScope(ctx.grant, 'shows:read');
  requireScope(ctx.grant, tool.scope);
  return tool.run(ctx, input);
}
