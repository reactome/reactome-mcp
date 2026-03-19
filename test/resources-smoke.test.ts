import assert from "node:assert/strict";
import test from "node:test";
import { contentClient } from "../src/clients/content.js";
import { createServer } from "../src/server.js";
import {
  getRegisteredResources,
  getRegisteredResourceTemplates,
  stubMethod,
} from "./helpers/mcp-test-utils.js";

const emptyRequestContext = {} as Parameters<
  ReturnType<typeof getRegisteredResources>[string]["readCallback"]
>[1];

test("reactome://database/info static resource returns JSON content", async () => {
  const server = createServer();
  const resources = getRegisteredResources(server);
  const restoreGetText = stubMethod(
    contentClient,
    "getText",
    (async (path: string) => {
      if (path === "/data/database/name") {
        return "Reactome";
      }

      if (path === "/data/database/version") {
        return "92";
      }

      throw new Error(`Unexpected path ${path}`);
    }) as typeof contentClient.getText
  );

  try {
    const result = await resources["reactome://database/info"].readCallback(
      new URL("reactome://database/info"),
      emptyRequestContext
    );
    const content = result.contents[0] as { text: string; mimeType?: string };
    const payload = JSON.parse(content.text);

    assert.equal(content.mimeType, "application/json");
    assert.deepEqual(payload, { name: "Reactome", version: 92 });
  } finally {
    restoreGetText();
  }
});

test("reactome://pathway/{id} template returns pathway JSON for the requested identifier", async () => {
  const server = createServer();
  const templates = getRegisteredResourceTemplates(server);
  const restoreGet = stubMethod(
    contentClient,
    "get",
    (async (path: string) => {
      assert.equal(path, "/data/query/enhanced/R-HSA-141409");

      return {
        dbId: 141409,
        stId: "R-HSA-141409",
        displayName: "Hemostasis",
        schemaClass: "Pathway",
      };
    }) as typeof contentClient.get
  );

  try {
    const result = await templates.pathway.readCallback(
      new URL("reactome://pathway/R-HSA-141409"),
      { id: "R-HSA-141409" },
      emptyRequestContext
    );
    const content = result.contents[0] as { uri: string; text: string; mimeType?: string };
    const payload = JSON.parse(content.text);

    assert.equal(content.uri, "reactome://pathway/R-HSA-141409");
    assert.equal(content.mimeType, "application/json");
    assert.equal(payload.stId, "R-HSA-141409");
    assert.equal(payload.displayName, "Hemostasis");
  } finally {
    restoreGet();
  }
});
