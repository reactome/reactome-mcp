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

/**
 * The first argument to fetch is `string | URL | Request`. `String(...)` works
 * for the first two and yields "[object Object]" for the third, so tests that
 * assert on the URL go through this instead.
 */
export function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/**
 * Read the single text block out of a tool result.
 *
 * Under `noUncheckedIndexedAccess` every `result.content[0].text` is a possible
 * undefined, and littering tests with `!` defeats the point of the flag. This
 * asserts the shape once, with a message that says which expectation failed.
 */
export function textOf(result: { content: Array<{ type: string; text: string }> }): string {
  const first = result.content[0];
  if (!first) throw new Error("tool returned no content blocks");
  return first.text;
}

/** The first fetch call's URL, for asserting on the endpoint a tool called. */
export function calledUrl(
  calls: Array<[input: string | URL | Request, init?: RequestInit]> ,
  index = 0
): string {
  const call = calls[index];
  if (!call) throw new Error(`fetch was not called ${index + 1} time(s)`);
  return requestUrl(call[0]);
}
