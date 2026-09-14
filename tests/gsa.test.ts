/**
 * ReactomeGSA tools.
 *
 * Every fixture is copied from the live service (2026-09-14). These exist
 * because of a real failure: a Reactome chatbot, asked to "run a GSEA with my
 * list of genes", answered that Reactome could not and offered fgsea and a
 * YouTube tutorial. Reactome can. Nothing could reach the service that does it.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { createFakeServer, textOf, calledUrl } from "./helpers/fake-server.js";
import { registerGsaTools } from "../src/tools/gsa.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("reactome gsa tools", () => {
  let fetchSpy: MockInstance<typeof fetch>;
  const fake = createFakeServer();
  registerGsaTools(fake.server);

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  // GET /methods
  const METHODS = [
    {
      name: "PADOG",
      description:
        "Weighted gene set analysis method that down-weighs genes present in many pathways",
      data_types: ["rnaseq_counts", "proteomics_int"],
      parameters: [
        { name: "use_interactors", type: "bool", description: "x".repeat(300) },
        { name: "sample_groups", type: "string", description: "y".repeat(300) },
      ],
    },
    {
      name: "Camera",
      description: "A gene set analysis algorithm similar to the classical GSEA algorithm",
      data_types: ["rnaseq_counts"],
      parameters: [],
    },
  ];

  it("names the methods and where to run them", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(METHODS));

    const text = textOf(await fake.invoke("reactome_gsa_methods", {}));

    expect(text).toContain("PADOG");
    expect(text).toContain("Camera");
    expect(text).toContain("similar to the classical GSEA algorithm");
    // The answer a user actually needs: where to go to run one.
    expect(text).toContain("reactome.org/gsa");
    expect(text).not.toContain("undefined");
  });

  it("lists parameter names but not their prose", async () => {
    // Ten parameters with a paragraph each is most of a context window spent
    // before the question has been answered.
    fetchSpy.mockResolvedValueOnce(jsonResponse(METHODS));

    const text = textOf(await fake.invoke("reactome_gsa_methods", {}));

    expect(text).toContain("use_interactors, sample_groups");
    expect(text).not.toContain("x".repeat(50));
    expect(text.length).toBeLessThan(4000);
  });

  it("says so when the service reports no methods", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse([]));
    expect(textOf(await fake.invoke("reactome_gsa_methods", {}))).toContain("No methods reported");
  });

  // GET /types
  it("explains that every accepted type is a matrix, not a gene list", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse([
        {
          id: "rnaseq_counts",
          name: "RNA-seq (raw counts)",
          description: "Raw read counts per gene",
        },
      ])
    );

    const text = textOf(await fake.invoke("reactome_gsa_data_types", {}));

    expect(text).toContain("rnaseq_counts");
    // The distinction that caused the original failure.
    expect(text).toContain("reactome_analyze_identifiers");
    expect(text).not.toContain("undefined");
  });

  // GET /data/search
  const SEARCH = [
    {
      id: "GSE50535",
      title: "RNA-seq melanoma",
      description: "Using a chromatin regulator-focused shRNA library...",
      species: "Homo sapiens",
      resource_name: "GREIN",
      web_link: "https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE50535",
    },
  ];

  it("searches public datasets so a user with no data can still be helped", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(SEARCH));

    const text = textOf(
      await fake.invoke("reactome_gsa_search_datasets", { keywords: "melanoma" })
    );

    expect(text).toContain("GSE50535");
    expect(text).toContain("GREIN");
    expect(text).not.toContain("undefined");
  });

  it("passes the species through as a name", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(SEARCH));

    await fake.invoke("reactome_gsa_search_datasets", {
      keywords: "melanoma",
      species: "Homo sapiens",
    });

    // This service wants the name; a taxonomy id returns zero results with no
    // error -- the opposite of the Content Service's eventsHierarchy, which
    // wants the id and answers 500 for the name.
    const url = calledUrl(fetchSpy.mock.calls);
    expect(url).toContain("species=Homo+sapiens");
    expect(url).toContain("keywords=melanoma");
  });

  it("points at the species trap when a search comes back empty", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse([]));

    const text = textOf(
      await fake.invoke("reactome_gsa_search_datasets", { keywords: "zzz", species: "9606" })
    );

    expect(text).toContain("No datasets found");
    expect(text).toContain("taxonomy id");
  });

  it("caps how many datasets it renders", async () => {
    const many = Array.from({ length: 100 }, (_, i) => ({
      id: `GSE${i}`,
      title: `Dataset ${i}`,
      species: "Homo sapiens",
    }));
    fetchSpy.mockResolvedValueOnce(jsonResponse(many));

    const text = textOf(await fake.invoke("reactome_gsa_search_datasets", { keywords: "cancer" }));

    expect(text).toContain("**Found:** 100");
    expect(text).toContain("and 85 more");
    expect(text).not.toContain("Dataset 90");
  });

  // GET /data/examples and /data/sources
  it("lists example datasets someone can try immediately", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse([
        {
          id: "EXAMPLE_MEL_RNA",
          title: "Melanoma RNA-seq example",
          type: "rnaseq_counts",
          description: "RNA-seq analysis of melanoma associated B cells.",
        },
      ])
    );

    const text = textOf(await fake.invoke("reactome_gsa_examples", {}));
    expect(text).toContain("EXAMPLE_MEL_RNA");
    expect(text).not.toContain("undefined");
  });

  it("lists the repositories it can pull from", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse([
        { id: "ebi_gxa", name: "Expression Atlas", description: "EBI's Expression Atlas" },
      ])
    );

    const text = textOf(await fake.invoke("reactome_gsa_sources", {}));
    expect(text).toContain("Expression Atlas");
    expect(text).toContain("ebi_gxa");
    expect(text).not.toContain("undefined");
  });

  it("reports a service error rather than rendering an empty answer", async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ detail: "Not Found" }, 404));
    await expect(fake.invoke("reactome_gsa_methods", {})).rejects.toThrow(/GSA Service error 404/);
  });
});
