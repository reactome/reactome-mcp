import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { createFakeServer, textOf, calledUrl } from "./helpers/fake-server.js";

import { registerPathwayTools } from "../src/tools/pathway.js";
import { registerSearchTools } from "../src/tools/search.js";
import { registerEntityTools } from "../src/tools/entity.js";
import { registerInteractorTools } from "../src/tools/interactors.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("pathway tools", () => {
  let fetchSpy: MockInstance<typeof fetch>;
  const fake = createFakeServer();
  registerPathwayTools(fake.server);

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("reactome_get_pathway formats a pathway response as markdown", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        dbId: 109582,
        stId: "R-HSA-109582",
        displayName: "Hemostasis",
        schemaClass: "Pathway",
        speciesName: "Homo sapiens",
        hasDiagram: true,
        summation: [{ text: "Process that stops bleeding." }],
      })
    );

    const result = await fake.invoke("reactome_get_pathway", { id: "R-HSA-109582" });

    expect(calledUrl(fetchSpy.mock.calls)).toContain("/data/query/enhanced/R-HSA-109582");
    expect(textOf(result)).toContain("Hemostasis");
    expect(textOf(result)).toContain("R-HSA-109582");
    expect(textOf(result)).toContain("Process that stops bleeding.");
  });

  it("reactome_top_pathways lists pathways for the given species", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse([
        {
          dbId: 1,
          stId: "R-HSA-1",
          displayName: "Cell Cycle",
          hasDiagram: true,
          schemaClass: "Pathway",
        },
        {
          dbId: 2,
          stId: "R-HSA-2",
          displayName: "Metabolism",
          hasDiagram: true,
          schemaClass: "Pathway",
        },
      ])
    );

    const result = await fake.invoke("reactome_top_pathways", { species: "Homo sapiens" });

    expect(calledUrl(fetchSpy.mock.calls)).toContain("/data/pathways/top/Homo%20sapiens");
    expect(textOf(result)).toContain("Cell Cycle");
    expect(textOf(result)).toContain("Metabolism");
    expect(textOf(result)).toContain("**Total:** 2");
  });
});

describe("search tools", () => {
  let fetchSpy: MockInstance<typeof fetch>;
  const fake = createFakeServer();
  registerSearchTools(fake.server);

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("reactome_search forwards query + species params and formats entries", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        results: [
          {
            typeName: "Pathway",
            entriesCount: 1,
            entries: [
              {
                stId: "R-HSA-1",
                name: "TP53 Regulates Transcription",
                exactType: "Pathway",
                species: ["Homo sapiens"],
                referenceIdentifier: "P04637",
                referenceName: "UniProt",
                summation: "Some summary.",
              },
            ],
          },
        ],
      })
    );

    const result = await fake.invoke("reactome_search", {
      query: "TP53",
      species: "Homo sapiens",
      rows: 25,
      cluster: true,
    });

    expect(calledUrl(fetchSpy.mock.calls)).toContain("/search/query");
    expect(calledUrl(fetchSpy.mock.calls)).toContain("query=TP53");
    expect(calledUrl(fetchSpy.mock.calls)).toContain("species=Homo+sapiens");
    expect(textOf(result)).toContain("TP53 Regulates Transcription");
    expect(textOf(result)).toContain("**Found:** 1 results");
  });

  it("reactome_search joins array filters into comma-separated params", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ results: [{ entriesCount: 0, entries: [] }] }));

    await fake.invoke("reactome_search", {
      query: "x",
      types: ["Pathway", "Reaction"],
      compartments: ["nucleus"],
      rows: 10,
      cluster: true,
    });

    expect(calledUrl(fetchSpy.mock.calls)).toContain("types=Pathway%2CReaction");
    expect(calledUrl(fetchSpy.mock.calls)).toContain("compartments=nucleus");
  });
});

describe("entity tools", () => {
  let fetchSpy: MockInstance<typeof fetch>;
  const fake = createFakeServer();
  registerEntityTools(fake.server);

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("reactome_get_entity renders details for a PhysicalEntity", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        dbId: 123456,
        stId: "R-HSA-123456",
        displayName: "TP53 protein",
        schemaClass: "EntityWithAccessionedSequence",
        speciesName: "Homo sapiens",
      })
    );

    const result = await fake.invoke("reactome_get_entity", { id: "R-HSA-123456" });

    expect(calledUrl(fetchSpy.mock.calls)).toContain("/data/query/enhanced/R-HSA-123456");
    expect(textOf(result)).toContain("TP53 protein");
    expect(textOf(result)).toContain("R-HSA-123456");
  });
});

describe("interactor tools", () => {
  let fetchSpy: MockInstance<typeof fetch>;
  const fake = createFakeServer();
  registerInteractorTools(fake.server);

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("reactome_psicquic_resources lists active resources", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse([
        { name: "IntAct", active: true },
        { name: "BioGRID", active: false },
      ])
    );

    const result = await fake.invoke("reactome_psicquic_resources", {});

    expect(calledUrl(fetchSpy.mock.calls)).toContain("/interactors/psicquic/resources");
    expect(textOf(result)).toContain("IntAct");
    expect(textOf(result)).toContain("BioGRID");
  });
});
