import assert from "node:assert/strict";
import test from "node:test";
import { analysisClient } from "../src/clients/analysis.js";
import { contentClient } from "../src/clients/content.js";
import { createServer } from "../src/server.js";
import { invokeTool, stubMethod } from "./helpers/mcp-test-utils.js";

test("reactome_search returns formatted search results from the content client", async () => {
  const server = createServer();
  const restore = stubMethod(
    contentClient,
    "get",
    (async (path: string, params?: Record<string, unknown>) => {
      assert.equal(path, "/search/query");
      assert.equal(params?.query, "BRCA1");
      assert.equal(params?.rows, 25);
      assert.equal(params?.cluster, true);

      return {
        results: [
          {
            entriesCount: 1,
            entries: [
              {
                dbId: 123,
                stId: "R-HSA-123",
                exactType: "Pathway",
                name: "<b>BRCA1 DNA repair</b>",
                species: ["Homo sapiens"],
                summation: "<p>DNA repair pathway summary.</p>",
              },
            ],
          },
        ],
      };
    }) as typeof contentClient.get
  );

  try {
    const result = await invokeTool(server, "reactome_search", { query: "BRCA1" });
    const text = (result as { content: Array<{ text: string }> }).content[0].text;

    assert.match(text, /## Search Results for "BRCA1"/);
    assert.match(text, /\*\*BRCA1 DNA repair\*\* \(R-HSA-123\)/);
    assert.match(text, /DNA repair pathway summary\./);
    assert.doesNotMatch(text, /<b>|<p>/);
  } finally {
    restore();
  }
});

test("reactome_get_pathway returns formatted pathway details", async () => {
  const server = createServer();
  const restore = stubMethod(
    contentClient,
    "get",
    (async (path: string) => {
      assert.equal(path, "/data/query/enhanced/R-HSA-199420");

      return {
        dbId: 199420,
        stId: "R-HSA-199420",
        displayName: "Apoptosis",
        schemaClass: "Pathway",
        speciesName: "Homo sapiens",
        hasDiagram: true,
        isInDisease: false,
        summation: [{ text: "Programmed cell death pathway." }],
      };
    }) as typeof contentClient.get
  );

  try {
    const result = await invokeTool(server, "reactome_get_pathway", { id: "R-HSA-199420" });
    const text = (result as { content: Array<{ text: string }> }).content[0].text;

    assert.match(text, /## Apoptosis/);
    assert.match(text, /\*\*Stable ID:\*\* R-HSA-199420/);
    assert.match(text, /\*\*Has diagram:\*\* Yes/);
    assert.match(text, /Programmed cell death pathway\./);
  } finally {
    restore();
  }
});

test("reactome_get_analysis_result returns formatted analysis output from the analysis client", async () => {
  const server = createServer();
  const restore = stubMethod(
    analysisClient,
    "get",
    (async (path: string, params?: Record<string, unknown>) => {
      assert.equal(path, "/token/mock-token");
      assert.equal(params?.sortBy, "ENTITIES_PVALUE");
      assert.equal(params?.order, "ASC");
      assert.equal(params?.page, 1);
      assert.equal(params?.pageSize, 25);

      return {
        token: "mock-token",
        summary: {
          type: "OVERREPRESENTATION",
          species: "Homo sapiens",
          speciesName: "Homo sapiens",
        },
        pathwaysFound: 1,
        identifiersNotFound: 0,
        pathways: [
          {
            stId: "R-HSA-109581",
            name: "Apoptosis",
            entities: {
              found: 3,
              total: 100,
              ratio: 0.03,
              pValue: 0.00012,
              fdr: 0.001,
            },
            reactions: {
              found: 2,
              total: 30,
            },
          },
        ],
      };
    }) as typeof analysisClient.get
  );

  try {
    const result = await invokeTool(server, "reactome_get_analysis_result", { token: "mock-token" });
    const text = (result as { content: Array<{ text: string }> }).content[0].text;

    assert.match(text, /## Analysis Result/);
    assert.match(text, /\*\*Token:\*\* mock-token/);
    assert.match(text, /\*\*Apoptosis\*\* \(R-HSA-109581\)/);
    assert.match(text, /p-value: 1\.20e-4, FDR: 1\.00e-3/);
  } finally {
    restore();
  }
});

test("reactome_search rejects missing required query input", async () => {
  const server = createServer();

  await assert.rejects(
    () => invokeTool(server, "reactome_search", {}),
    /Invalid arguments for tool reactome_search/
  );
});

test("reactome_get_analysis_result rejects blank analysis tokens", async () => {
  const server = createServer();

  await assert.rejects(
    () => invokeTool(server, "reactome_get_analysis_result", { token: "   " }),
    /Invalid arguments for tool reactome_get_analysis_result/
  );
});
