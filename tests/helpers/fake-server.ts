import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export interface CapturedTool {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  handler: (params: Record<string, unknown>) => Promise<{
    content: Array<{ type: string; text: string }>;
  }>;
}

export interface CapturedResource {
  uri: string;
  name: string;
  handler: () => Promise<{
    contents: Array<{ uri: string; mimeType?: string; text: string }>;
  }>;
}

export function createFakeServer() {
  const tools = new Map<string, CapturedTool>();
  const resources = new Map<string, CapturedResource>();

  const fake = {
    tool(name: string, description: string, schema: Record<string, unknown>, handler: CapturedTool["handler"]) {
      tools.set(name, { name, description, schema, handler });
    },
    resource(name: string, uri: string, handler: CapturedResource["handler"]) {
      resources.set(uri, { uri, name, handler });
    },
  };

  function toolNames(): string[] {
    return [...tools.keys()];
  }

  function invoke(name: string, params: Record<string, unknown> = {}) {
    const tool = tools.get(name);
    if (!tool) throw new Error(`tool not registered: ${name}`);
    return tool.handler(params);
  }

  function readResource(uri: string) {
    const r = resources.get(uri);
    if (!r) throw new Error(`resource not registered: ${uri}`);
    return r.handler();
  }

  return {
    server: fake as unknown as McpServer,
    tools,
    resources,
    toolNames,
    invoke,
    readResource,
  };
}
