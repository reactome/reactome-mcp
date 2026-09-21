import { describe, it, expect } from "vitest";
import { buildServerInstructions } from "../src/instructions.js";
import { registerAllResources, RESOURCE_URIS } from "../src/resources/index.js";
import {
  ALL_TOOL_GROUPS,
  TOOL_GROUPS,
  registerAllTools,
  resolveToolGroups,
  type ToolGroup,
} from "../src/tools/index.js";

/**
 * Which tools an instance publishes.
 *
 * This server is hosted publicly, and the public surface is a decision
 * somebody makes rather than everything that happens to be implemented.
 * `MCP_TOOL_GROUPS` is a *registration* switch on purpose: a tool documented
 * nowhere but still answering is the same divergence that let this repo
 * advertise Cypher tools it had not registered, and publish a graph schema
 * nobody had chosen to expose. What the server offers has to be one fact.
 */

function namesFor(register: (server: never) => void): string[] {
  const names: string[] = [];
  register({
    tool: (...args: unknown[]) => {
      if (typeof args[0] === "string") names.push(args[0]);
      return undefined;
    },
  } as never);
  return names;
}

function registeredWith(groups: string | undefined): string[] {
  const previous = process.env.MCP_TOOL_GROUPS;
  if (groups === undefined) delete process.env.MCP_TOOL_GROUPS;
  else process.env.MCP_TOOL_GROUPS = groups;
  try {
    return namesFor(registerAllTools);
  } finally {
    if (previous === undefined) delete process.env.MCP_TOOL_GROUPS;
    else process.env.MCP_TOOL_GROUPS = previous;
  }
}

describe("tool groups", () => {
  it("accounts for every tool, with no tool in two groups", () => {
    // A tool that belongs to no group could not be switched off, and nobody
    // would find out until it was published somewhere it should not be.
    const all = namesFor(registerAllTools);
    const grouped = ALL_TOOL_GROUPS.flatMap(g => namesFor(TOOL_GROUPS[g]));

    expect(all.length).toBe(59);
    expect([...grouped].sort()).toEqual([...all].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  it("registers everything when unset, so a local user is unaffected", () => {
    expect(registeredWith(undefined)).toHaveLength(59);
  });

  it("registers only what is named", () => {
    const names = registeredWith("search,pathway");
    expect(names).toContain("reactome_search");
    expect(names).toContain("reactome_get_pathway");
    expect(names).not.toContain("reactome_export_pdf");
    expect(names).not.toContain("reactome_analyze_identifiers");
    // The positive half matters: without it, a switch that registered
    // *nothing* would satisfy every "not.toContain" here.
    expect(names.length).toBeGreaterThan(10);
    expect(names.length).toBeLessThan(59);
  });
});

describe("MCP_TOOL_GROUPS parsing", () => {
  it("is order- and case-insensitive, and tolerates spacing", () => {
    expect(resolveToolGroups("PATHWAY, search")).toEqual(["search", "pathway"] as ToolGroup[]);
  });

  it("deduplicates", () => {
    expect(resolveToolGroups("search,search")).toEqual(["search"] as ToolGroup[]);
  });

  it("registers everything only when genuinely unset", () => {
    expect(resolveToolGroups(undefined)).toEqual(ALL_TOOL_GROUPS);
  });

  it("refuses an empty value rather than falling back to everything", () => {
    // The dangerous case. A restriction that degrades to "publish all" on a
    // blank or whitespace value is worse than no restriction, because the
    // config file still says it is restricted.
    expect(() => resolveToolGroups("")).toThrow(/names no group/);
    expect(() => resolveToolGroups("  ,  ")).toThrow(/names no group/);
  });

  it("refuses an unknown group rather than ignoring it", () => {
    expect(() => resolveToolGroups("serch,pathway")).toThrow(/unknown group/);
  });

  it("names the known groups in the error, so the fix is in the message", () => {
    expect(() => resolveToolGroups("nope")).toThrow(/search/);
  });
});

describe("instructions match what is registered", () => {
  /**
   * The strongest version of the check, because it does not care where in
   * the text a tool is named. It extracts every `reactome_*` reference from
   * the instructions and requires each one to be a tool this instance
   * actually registered.
   *
   * The category list was the obvious place for these to drift. The
   * recommended-workflow and resources prose name tools too, and would have
   * drifted just as quietly — which is the whole lesson of the Cypher
   * instructions: the surface that describes the server is a surface.
   */
  // Tool names AND resource URIs. The first version matched only
  // `reactome_*`, and the instructions also list `reactome://analysis/{token}`
  // and friends -- so a restricted instance could still have advertised a
  // resource it withheld, which is the same drift one noun over.
  const referenced = (text: string): string[] => {
    const found = new Set<string>();
    for (const m of text.matchAll(/reactome_[a-z_]*\*?/g)) found.add(m[0]);
    for (const m of text.matchAll(/reactome:\/\/[a-z-]+(?:\/\{?[a-z]+\}?)*/g)) found.add(m[0]);
    return [...found];
  };

  const satisfied = (reference: string, registered: string[]): boolean =>
    reference.endsWith("*")
      ? registered.some(name => name.startsWith(reference.slice(0, -1)))
      : registered.includes(reference);

  const registeredNames = (groups: ToolGroup[]): string[] => {
    const tools = groups.flatMap(g => namesFor(TOOL_GROUPS[g]));
    const resources: string[] = [];
    const server = {
      resource: (...args: unknown[]) => {
        const uri = typeof args[1] === "string" ? args[1] : undefined;
        const t = args[1] as { uriTemplate?: { toString(): string } } | undefined;
        const value = uri ?? t?.uriTemplate?.toString();
        if (value) resources.push(value);
        return undefined;
      },
    };
    registerAllResources(server as never, groups);
    return [...tools, ...resources];
  };

  it("names no tool or resource the full server does not register", () => {
    const registered = registeredNames(ALL_TOOL_GROUPS);
    const dangling = referenced(buildServerInstructions(ALL_TOOL_GROUPS)).filter(
      r => !satisfied(r, registered)
    );
    expect(dangling).toEqual([]);
  });

  it("names no tool or resource a restricted server does not register", () => {
    const groups: ToolGroup[] = ["search", "pathway", "entity", "utilities"];
    const registered = registeredNames(groups);
    const dangling = referenced(buildServerInstructions(groups)).filter(
      r => !satisfied(r, registered)
    );
    expect(dangling).toEqual([]);
  });
});

describe("resources follow the same switch", () => {
  const resourceUris = (groups: ToolGroup[]): string[] => {
    const uris: string[] = [];
    registerAllResources(
      {
        resource: (...args: unknown[]) => {
          const t = args[1] as { uriTemplate?: { toString(): string } } | undefined;
          const uri = typeof args[1] === "string" ? args[1] : t?.uriTemplate?.toString();
          if (uri) uris.push(uri);
          return undefined;
        },
      } as never,
      groups
    );
    return uris;
  };

  it("registers every known resource when all groups are on", () => {
    expect([...resourceUris(ALL_TOOL_GROUPS)].sort()).toEqual([...RESOURCE_URIS].sort());
  });

  it("withholds the resources of an omitted group", () => {
    // An instance that withholds the analysis *tools* but still serves
    // reactome://analysis/{token} has not restricted anything; it has moved
    // the capability to a URI.
    const uris = resourceUris(["pathway", "utilities"]);
    expect(uris).not.toContain("reactome://analysis/{token}");
    expect(uris).not.toContain("reactome://entity/{id}");
    expect(uris).toContain("reactome://pathway/{id}");
    expect(uris).toContain("reactome://species");
  });

  it("refuses a resource that belongs to no group", () => {
    // Fails loudly rather than defaulting to always-on, so a new resource
    // cannot escape the switch by nobody remembering it exists.
    const server = {
      resource: (...args: unknown[]) => args,
    };
    const rogue = {
      resource: (..._args: unknown[]) => undefined,
    };
    void server;
    expect(() => {
      registerAllResources(rogue as never, ALL_TOOL_GROUPS);
      (rogue as { resource: (...a: unknown[]) => unknown }).resource(
        "rogue",
        "reactome://not-classified",
        () => undefined
      );
    }).toThrow(/not assigned to a tool group/);
  });
});
