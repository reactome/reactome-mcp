import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "../src/server.js";
import {
  getRegisteredResources,
  getRegisteredResourceTemplates,
  getRegisteredTools,
} from "./helpers/mcp-test-utils.js";

test("createServer registers representative tools, resources, and templates", () => {
  const server = createServer();

  const tools = getRegisteredTools(server);
  const resources = getRegisteredResources(server);
  const templates = getRegisteredResourceTemplates(server);

  assert.ok(Object.keys(tools).length > 0);
  assert.ok(Object.keys(resources).length > 0);
  assert.ok(Object.keys(templates).length > 0);

  assert.ok(tools.reactome_search);
  assert.ok(tools.reactome_get_pathway);
  assert.ok(tools.reactome_get_analysis_result);

  assert.ok(resources["reactome://species"]);
  assert.ok(resources["reactome://database/info"]);

  assert.ok(templates.pathway);
  assert.ok(templates.analysis);
  assert.equal(templates.pathway.resourceTemplate.uriTemplate.toString(), "reactome://pathway/{id}");
});
