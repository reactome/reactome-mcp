/**
 * Regression tests for response *shapes*.
 *
 * Every payload below is copied verbatim from the live Reactome services. The
 * bugs these pin were not logic errors -- the code read field paths that the
 * API never returned, so the tools rendered "undefined" (or, worse, silently
 * rendered nothing at all) while still reporting success. Type annotations
 * alone could not catch that: `contentClient.get<T>` asserts T, it does not
 * verify it.
 *
 * If a payload here stops matching production, that is the signal to update
 * the formatter -- not the fixture.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { createFakeServer, textOf } from "./helpers/fake-server.js";

import { registerSearchTools } from "../src/tools/search.js";
import { registerEntityTools } from "../src/tools/entity.js";
import { registerInteractorTools } from "../src/tools/interactors.js";
import { registerAnalysisTools } from "../src/tools/analysis.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("response shape regressions", () => {
  let fetchSpy: MockInstance<typeof fetch>;
  const fake = createFakeServer();
  registerSearchTools(fake.server);
  registerEntityTools(fake.server);
  registerInteractorTools(fake.server);
  registerAnalysisTools(fake.server);

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  // GET /search/suggest?query=TP53
  it("reactome_search_suggest reads the bare array the API returns", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(["tp53:banp", "tp53aip1", "tp53bp1"]));

    const result = await fake.invoke("reactome_search_suggest", { query: "TP53" });
    const text = textOf(result);

    expect(text).toContain("- tp53:banp");
    expect(text).toContain("- tp53bp1");
    expect(text).not.toContain("undefined");
    expect(text).not.toContain("No suggestions found");
  });

  it("reactome_search_suggest reports emptiness rather than crashing on a non-array", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ suggestions: [] }));

    const result = await fake.invoke("reactome_search_suggest", { query: "TP53" });
    expect(textOf(result)).toContain("No suggestions found");
  });

  // GET /search/spellcheck?query=kinse
  it("reactome_search_spellcheck reads the bare array the API returns", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(["kinase", "kinases", "kinae"]));

    const text = textOf(await fake.invoke("reactome_search_spellcheck", { query: "kinse" }));

    // The old code guarded `result.suggestions`, so this branch was
    // unreachable: every spellcheck reported "no suggestions".
    expect(text).toContain("**Did you mean:**");
    expect(text).toContain("- kinase");
    expect(text).not.toContain("No spelling suggestions");
  });

  // GET /data/entity/R-HSA-109581/componentOf
  it("reactome_entity_component_of expands the parallel-array entries", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse([
        {
          type: "hasEvent",
          names: ["Programmed Cell Death", "Apoptosis"],
          stIds: ["R-HSA-5357801", "R-HSA-109581"],
          schemaClasses: ["TopLevelPathway", "Pathway"],
          species: ["Homo sapiens", "Homo sapiens"],
        },
      ])
    );

    const text = textOf(await fake.invoke("reactome_entity_component_of", { id: "R-HSA-109581" }));

    // One entry, two containers -- the count is of containers, not entries.
    expect(text).toContain("**Total:** 2");
    expect(text).toContain("**Programmed Cell Death** (R-HSA-5357801) [TopLevelPathway]");
    expect(text).toContain("**Apoptosis** (R-HSA-109581) [Pathway]");
    expect(text).not.toContain("undefined");
  });

  it("reactome_entity_component_of falls back when names are absent", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse([{ type: "hasComponent", stIds: ["R-HSA-1"] }]));

    const text = textOf(await fake.invoke("reactome_entity_component_of", { id: "R-HSA-1" }));
    expect(text).toContain("(R-HSA-1) [hasComponent]");
    expect(text).not.toContain("undefined");
  });

  // GET /data/participants/R-HSA-109581
  it("reactome_participants reads peDbId and refEntities", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse([
        {
          displayName: "TRADD:TRAF2:RIP1:FADD:CASP8(1-479) [cytosol]",
          peDbId: 140976,
          schemaClass: "Complex",
          refEntities: [
            {
              dbId: 1,
              identifier: "Q12933",
              displayName: "TRAF2",
              schemaClass: "ReferenceGeneProduct",
            },
            {
              dbId: 2,
              identifier: "Q15628",
              displayName: "TRADD",
              schemaClass: "ReferenceGeneProduct",
            },
          ],
        },
      ])
    );

    const text = textOf(await fake.invoke("reactome_participants", { id: "R-HSA-109581" }));

    expect(text).toContain("(140976)");
    // Identifiers were dropped entirely before: the endpoint returns
    // `refEntities` (plural, an array), never a singular `referenceEntity`.
    expect(text).toContain("[Q12933, Q15628]");
    expect(text).not.toContain("undefined");
  });

  it("reactome_participants omits the bracket when a participant has no references", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse([{ displayName: "ATP [cytosol]", peDbId: 113592, schemaClass: "SimpleEntity" }])
    );

    const text = textOf(await fake.invoke("reactome_participants", { id: "R-HSA-1" }));
    expect(text).toContain("- ATP [cytosol] (113592)");
    expect(text).not.toContain("undefined");
  });

  // GET /search/facet
  it("reactome_search_facets reads facet.available, not the facet itself", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        totalNumFount: 388394,
        typeFacet: { available: [{ name: "Complex", count: 111374 }] },
        speciesFacet: { available: [{ name: "Homo sapiens", count: 57354 }] },
        compartmentFacet: { available: [{ name: "cytosol", count: 94077 }] },
        keywordFacet: { available: [{ name: "binds", count: 20173 }] },
      })
    );

    const text = textOf(await fake.invoke("reactome_search_facets", {}));

    // Every section was silently skipped before: a facet is an object with an
    // `available` array, so reading `.length` on it gave undefined.
    expect(text).toContain("### Types:");
    expect(text).toContain("- Complex: 111374");
    expect(text).toContain("### Species:");
    expect(text).toContain("- Homo sapiens: 57354");
    expect(text).toContain("### Compartments:");
    expect(text).toContain("### Keywords:");
    expect(text).toContain("388394");
    expect(text).not.toContain("No facets available");
  });

  it("reactome_search_facets says so when there are no facets", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ totalNumFount: 0 }));

    const text = textOf(await fake.invoke("reactome_search_facets", {}));
    expect(text).toContain("*No facets available.*");
  });

  // GET /interactors/static/molecule/P04637/details
  const interactorEnvelope = {
    resource: "static",
    entities: [
      {
        acc: "P04637",
        count: 249,
        interactors: [
          { acc: "Q00987", alias: "MDM2", id: 10089669, evidences: 122, score: 0.995 },
          { acc: "P38936", alias: "CDKN1A", id: 10089670, evidences: 40, score: 0.8 },
        ],
      },
    ],
  };

  it("reactome_static_interactors descends into entities[].interactors", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(interactorEnvelope));

    const text = textOf(await fake.invoke("reactome_static_interactors", { accession: "P04637" }));

    // `entities` lists the molecules queried, not the interactors -- reading
    // score off it threw "Cannot read properties of undefined (reading 'toFixed')".
    expect(text).toContain("Static Interactors for P04637");
    expect(text).toContain("**Interactors found:** 2");
    expect(text).toContain("**Q00987** (score: 0.995) - MDM2");
    expect(text).not.toContain("undefined");
  });

  it("reactome_static_interactors survives an interactor with no score", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        resource: "static",
        entities: [{ acc: "P04637", count: 1, interactors: [{ acc: "Q00987" }] }],
      })
    );

    const text = textOf(await fake.invoke("reactome_static_interactors", { accession: "P04637" }));
    expect(text).toContain("(score: n/a)");
    expect(text).not.toContain("undefined");
  });

  it("reactome_static_interactors handles an unknown accession", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ resource: "static", entities: [] }));

    const text = textOf(await fake.invoke("reactome_static_interactors", { accession: "NOPE" }));
    expect(text).toContain("Static Interactors for NOPE");
    expect(text).toContain("*No interactors found in the static database.*");
    expect(text).not.toContain("undefined");
  });

  // GET /interactors/static/molecule/P04637/summary
  it("reactome_interactor_summary reads entities[0]", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ resource: "static", entities: [{ acc: "P04637", count: 249 }] })
    );

    const text = textOf(await fake.invoke("reactome_interactor_summary", { accession: "P04637" }));
    expect(text).toContain("Interactor Summary for P04637");
    expect(text).toContain("**Total interactions:** 249");
    expect(text).not.toContain("undefined");
  });

  // GET /interactors/psicquic/molecule/IntAct/P04637/details -- same envelope
  it("reactome_psicquic_details uses the same envelope as the static endpoint", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ ...interactorEnvelope, resource: "IntAct" }));

    const text = textOf(
      await fake.invoke("reactome_psicquic_details", { resource: "IntAct", accession: "P04637" })
    );

    expect(text).toContain("**Interactors found:** 2");
    expect(text).toContain("**Q00987** (score: 0.995) - MDM2");
    expect(text).not.toContain("undefined");
  });

  it("reactome_psicquic_summary reads entities[0]", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ resource: "IntAct", entities: [{ acc: "P04637", count: 144 }] })
    );

    const text = textOf(
      await fake.invoke("reactome_psicquic_summary", { resource: "IntAct", accession: "P04637" })
    );

    expect(text).toContain("**Protein:** P04637");
    expect(text).toContain("**Interaction count:** 144");
    expect(text).not.toContain("undefined");
  });

  // GET /token/{token}/found/all/{pathway}
  it("reactome_analysis_found_entities renders mapsTo.ids", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        pathway: "R-HSA-109581",
        foundEntities: 1,
        foundInteractors: 0,
        entities: [{ id: "TP53", exp: [], mapsTo: [{ resource: "UNIPROT", ids: ["P04637"] }] }],
        interactors: [],
      })
    );

    const text = textOf(
      await fake.invoke("reactome_analysis_found_entities", {
        token: "tok",
        pathway: "R-HSA-109581",
      })
    );

    // A mapsTo entry has `ids` (plural); there is no singular `identifier`.
    expect(text).toContain("- TP53 -> P04637 (UNIPROT)");
    expect(text).not.toContain("undefined");
  });

  // GET /search/diagram/{id}?query=...
  it("reactome_search_diagram reads the flat entries array", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        entries: [
          {
            dbId: "69488",
            stId: "R-HSA-69488",
            id: "R-HSA-69488",
            name: "TP53",
            exactType: "ReferenceGeneProduct",
            species: ["Homo sapiens"],
            referenceIdentifier: "P04637",
            referenceName: "TP53",
          },
        ],
        facets: [{ name: "Complex", count: 4 }],
        found: 13,
      })
    );

    const text = textOf(
      await fake.invoke("reactome_search_diagram", { diagram: "R-HSA-109581", query: "TP53" })
    );

    // This endpoint returns a flat `entries` list, not the grouped `results`
    // shape /search/query uses. Sharing the grouped helper threw
    // "result.results is not iterable" -- the tool never returned an answer.
    expect(text).toContain("**Found:** 13 results");
    expect(text).toContain("TP53");
    expect(text).toContain("R-HSA-69488");
    expect(text).not.toContain("undefined");
  });

  it("reactome_search_diagram reports an empty diagram search", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ entries: [], facets: [], found: 0 }));

    const text = textOf(
      await fake.invoke("reactome_search_diagram", { diagram: "R-HSA-1", query: "zzz" })
    );
    expect(text).toContain("*No matches in this diagram.*");
  });
});
