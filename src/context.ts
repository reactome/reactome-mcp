import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export interface RequestContext {
  reqId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

function makeReqId(): string {
  // Short prefix of a UUID keeps logs readable while remaining unique enough
  // for the lifetime of a stdio MCP session.
  return randomUUID().slice(0, 8);
}

export function withNewRequestContext<T>(fn: () => T | Promise<T>): Promise<T> {
  return Promise.resolve(storage.run({ reqId: makeReqId() }, fn));
}

export function currentReqId(): string | undefined {
  return storage.getStore()?.reqId;
}
