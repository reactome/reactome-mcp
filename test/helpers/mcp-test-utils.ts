import type {
  McpServer,
  RegisteredResource,
  RegisteredResourceTemplate,
  RegisteredTool,
} from "@modelcontextprotocol/sdk/server/mcp.js";

type ServerInternals = {
  _registeredResources: Record<string, RegisteredResource>;
  _registeredResourceTemplates: Record<string, RegisteredResourceTemplate>;
  _registeredTools: Record<string, RegisteredTool>;
  validateToolInput(tool: RegisteredTool, args: unknown, toolName: string): Promise<unknown>;
  executeToolHandler(tool: RegisteredTool, args: unknown, extra: Record<string, never>): Promise<unknown>;
};

export function getRegisteredTools(server: McpServer) {
  return (server as unknown as ServerInternals)._registeredTools;
}

export function getRegisteredResources(server: McpServer) {
  return (server as unknown as ServerInternals)._registeredResources;
}

export function getRegisteredResourceTemplates(server: McpServer) {
  return (server as unknown as ServerInternals)._registeredResourceTemplates;
}

export async function invokeTool(server: McpServer, name: string, args: unknown) {
  const internals = server as unknown as ServerInternals;
  const tool = internals._registeredTools[name];

  if (!tool) {
    throw new Error(`Tool ${name} is not registered`);
  }

  const parsedArgs = await internals.validateToolInput(tool, args, name);
  return internals.executeToolHandler(tool, parsedArgs, {});
}

export function stubMethod<T extends object, K extends keyof T>(target: T, key: K, replacement: T[K]) {
  const original = target[key];
  (target as T)[key] = replacement;

  return () => {
    (target as T)[key] = original;
  };
}
