/**
 * Event ordering — what has to happen before something.
 *
 * Harvested from reactome/reactome_chatbot#153 by @bhavyakeerthi3, which built
 * its own Content Service client inside the chatbot to do this. The idea was
 * the valuable part: containment ("what is this pathway made of") was already
 * covered and ordering ("what leads up to this") was not.
 *
 * Reactome models ordering on the *later* event: an event lists what precedes
 * it. The forward direction is not symmetrically available -- `followingEvent`
 * appears only nested, as bare dbIds with no stable IDs -- so this walks
 * backwards, which is the direction the data supports.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { createFakeServer, textOf } from "./helpers/fake-server.js";
import { registerPathwayTools } from "../src/tools/pathway.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Shapes copied from GET /data/query/R-HSA-69205 on 2026-09-16. */
const G1S = {
  displayName: "G1/S-Specific Transcription",
  schemaClass: "Pathway",
  precedingEvent: [
    {
      stId: "R-HSA-69227",
      displayName: "Cyclin D:CDK4/6 phosphorylates RB1",
      schemaClass: "Reaction",
    },
  ],
};

const CYCLIN_D = {
  displayName: "Cyclin D:CDK4/6 phosphorylates RB1",
  precedingEvent: [
    {
      stId: "R-HSA-8942836",
      displayName: "CDK4/6:CCND complexes are activated",
      schemaClass: "Reaction",
    },
    { stId: "R-HSA-9659820", displayName: "RB1 translocates to the nucleus" },
  ],
};

describe("reactome_preceding_events", () => {
  let fetchSpy: MockInstance<typeof fetch>;
  const fake = createFakeServer();
  registerPathwayTools(fake.server);

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("walks back more than one step", async () => {
    // The point of the tool: one step is "what is immediately before", which
    // the raw object already gives. Several steps is the upstream cascade.
    fetchSpy.mockResolvedValueOnce(jsonResponse(G1S));
    fetchSpy.mockResolvedValueOnce(jsonResponse(CYCLIN_D));

    const text = textOf(
      await fake.invoke("reactome_preceding_events", { id: "R-HSA-69205", depth: 2 })
    );

    expect(text).toContain("1 step back");
    expect(text).toContain("R-HSA-69227");
    expect(text).toContain("2 steps back");
    expect(text).toContain("R-HSA-8942836");
    expect(text).not.toContain("undefined");
  });

  it("stops at the requested depth", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(G1S));

    const text = textOf(
      await fake.invoke("reactome_preceding_events", { id: "R-HSA-69205", depth: 1 })
    );

    expect(text).toContain("R-HSA-69227");
    expect(text).not.toContain("2 steps back");
    // One lookup, not two: depth is a budget, not a suggestion.
    expect(fetchSpy.mock.calls.length).toBe(1);
  });

  it("says plainly when nothing precedes an event", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ displayName: "Apoptosis" }));

    const text = textOf(await fake.invoke("reactome_preceding_events", { id: "R-HSA-109581" }));

    // An entry point is a real answer. Rendering it as an empty list would
    // read as a failed lookup.
    expect(text).toContain("Nothing precedes this event");
    expect(text).toContain("not a lookup failure");
  });

  it("does not revisit an event it has already seen", async () => {
    // Reactome ordering can loop back; without the guard this recurses until
    // the depth budget runs out, re-fetching the same events.
    const a = { precedingEvent: [{ stId: "R-B", displayName: "B" }] };
    const b = { precedingEvent: [{ stId: "R-A", displayName: "A" }] };
    fetchSpy.mockResolvedValueOnce(jsonResponse(a));
    fetchSpy.mockResolvedValueOnce(jsonResponse(b));
    fetchSpy.mockResolvedValue(jsonResponse({}));

    const text = textOf(await fake.invoke("reactome_preceding_events", { id: "R-A", depth: 4 }));

    // R-A was the starting point; it must not reappear as its own ancestor.
    // Counted over list entries only -- the id legitimately appears in the
    // heading and in the closing sentence.
    const listed = text.split("\n").filter(line => line.startsWith("- ") && line.includes("R-A"));
    expect(listed).toEqual([]);
  });

  it("skips entries with no stable ID", async () => {
    // An entry without one cannot be followed up, so rendering it gives the
    // reader something they cannot act on.
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        precedingEvent: [{ displayName: "nameless" }, { stId: "R-X", displayName: "X" }],
      })
    );

    const text = textOf(await fake.invoke("reactome_preceding_events", { id: "R-1", depth: 1 }));

    expect(text).toContain("R-X");
    expect(text).not.toContain("nameless");
  });

  it("rejects a depth outside the allowed range", () => {
    expect(() => fake.invoke("reactome_preceding_events", { id: "R-1", depth: 99 })).toThrow();
  });
});
