import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logger } from "../src/logger.js";
import { withNewRequestContext, currentReqId } from "../src/context.js";

describe("request context", () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  it("logger omits reqId when no context is active", () => {
    logger.info("outside context");
    const payload = JSON.parse(String(writeSpy.mock.calls.at(-1)?.[0] ?? "{}"));
    expect(payload.reqId).toBeUndefined();
    expect(payload.msg).toBe("outside context");
  });

  it("logger includes reqId inside withNewRequestContext", async () => {
    await withNewRequestContext(async () => {
      logger.info("inside context");
    });
    const payload = JSON.parse(String(writeSpy.mock.calls.at(-1)?.[0] ?? "{}"));
    expect(typeof payload.reqId).toBe("string");
    expect(payload.reqId.length).toBeGreaterThan(0);
  });

  it("nested invocations get distinct reqIds", async () => {
    const ids: (string | undefined)[] = [];
    await withNewRequestContext(async () => {
      ids.push(currentReqId());
    });
    await withNewRequestContext(async () => {
      ids.push(currentReqId());
    });
    expect(ids[0]).toBeDefined();
    expect(ids[1]).toBeDefined();
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("concurrent contexts do not leak reqIds across async boundaries", async () => {
    const seen: Array<{ name: string; id: string | undefined }> = [];

    async function runUnderContext(name: string) {
      return withNewRequestContext(async () => {
        // Simulate async work that could race with the other context
        await new Promise((r) => setTimeout(r, 10));
        seen.push({ name, id: currentReqId() });
      });
    }

    await Promise.all([runUnderContext("a"), runUnderContext("b")]);
    const aId = seen.find((s) => s.name === "a")?.id;
    const bId = seen.find((s) => s.name === "b")?.id;
    expect(aId).toBeDefined();
    expect(bId).toBeDefined();
    expect(aId).not.toBe(bId);
  });
});
