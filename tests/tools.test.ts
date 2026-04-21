import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createFakeServer } from "./helpers/fake-server.js";

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
  let fetchSpy: ReturnType<typeof vi.spyOn>;
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
    const [url] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("/data/query/enhanced/R-HSA-109582");
    expect(result.content[0].text).toContain("Hemostasis");
    expect(result.content[0].text).toContain("R-HSA-109582");
    expect(result.content[0].text).toContain("Process that stops bleeding.");
  });

  it("reactome_top_pathways lists pathways for the given species", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse([
        { dbId: 1, stId: "R-HSA-1", displayName: "Cell Cycle", hasDiagram: true, schemaClass: "Pathway" },
        { dbId: 2, stId: "R-HSA-2", displayName: "Metabolism", hasDiagram: true, schemaClass: "Pathway" },
      ])
    );

    const result = await fake.invoke("reactome_top_pathways", { species: "Homo sapiens" });
    const [url] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("/data/pathways/top/Homo%20sapiens");
    expect(result.content[0].text).toContain("Cell Cycle");
    expect(result.content[0].text).toContain("Metabolism");
    expect(result.content[0].text).toContain("**Total:** 2");
  });
});

describe("search tools", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
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
    const [url] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("/search/query");
    expect(String(url)).toContain("query=TP53");
    expect(String(url)).toContain("species=Homo+sapiens");
    expect(result.content[0].text).toContain("TP53 Regulates Transcription");
    expect(result.content[0].text).toContain("**Found:** 1 results");
  });

  it("reactome_search joins array filters into comma-separated params", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ results: [{ entriesCount: 0, entries: [] }] })
    );

    await fake.invoke("reactome_search", {
      query: "x",
      types: ["Pathway", "Reaction"],
      compartments: ["nucleus"],
      rows: 10,
      cluster: true,
    });

    const [url] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("types=Pathway%2CReaction");
    expect(String(url)).toContain("compartments=nucleus");
  });
});

describe("entity tools", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
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
    const [url] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("/data/query/enhanced/R-HSA-123456");
    expect(result.content[0].text).toContain("TP53 protein");
    expect(result.content[0].text).toContain("R-HSA-123456");
  });
});

describe("interactor tools", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
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
    const [url] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("/interactors/psicquic/resources");
    expect(result.content[0].text).toContain("IntAct");
    expect(result.content[0].text).toContain("BioGRID");
  });
});
