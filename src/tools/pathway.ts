import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { nonEmptyString } from "../schemas.js";
import { contentClient } from "../clients/content.js";
import type { Pathway, Event } from "../types/index.js";

interface EventHierarchy {
  stId: string;
  name: string;
  species: string;
  type: string;
  diagram?: string;
  children?: EventHierarchy[];
}

function formatPathway(pathway: Pathway | Event): string {
  const lines = [
    `## ${pathway.displayName}`,
    `**Stable ID:** ${pathway.stId}`,
    `**Database ID:** ${pathway.dbId}`,
    `**Type:** ${pathway.schemaClass}`,
  ];

  if (pathway.speciesName) {
    lines.push(`**Species:** ${pathway.speciesName}`);
  }

  if (pathway.isInDisease) {
    lines.push(`**Disease pathway:** Yes`);
  }

  if (pathway.hasDiagram) {
    lines.push(`**Has diagram:** Yes`);
  }

  const summary = "summation" in pathway ? pathway.summation?.[0]?.text : undefined;
  if (summary) {
    lines.push("", "### Summary:", summary);
  }

  if (
    "literatureReference" in pathway &&
    pathway.literatureReference &&
    pathway.literatureReference.length > 0
  ) {
    lines.push("", "### References:");
    pathway.literatureReference.slice(0, 5).forEach(ref => {
      if (ref.pubMedIdentifier) {
        lines.push(
          `- [${ref.displayName}](https://pubmed.ncbi.nlm.nih.gov/${ref.pubMedIdentifier})`
        );
      } else {
        lines.push(`- ${ref.displayName}`);
      }
    });
  }

  return lines.join("\n");
}

/**
 * Render a hierarchy node and its descendants, to `maxDepth` levels.
 *
 * The depth limit is the point of this function. Without one it walked the
 * whole tree: three top-level human pathways rendered ~86 KB, roughly 22,000
 * tokens spent on a single call, most of it reactions nobody asked about.
 */
function formatEventHierarchy(event: EventHierarchy, indent = 0, maxDepth = 3): string[] {
  const prefix = "  ".repeat(indent);
  const lines = [`${prefix}- **${event.name}** (${event.stId}) [${event.type}]`];

  const children = event.children ?? [];
  if (children.length === 0) return lines;

  if (indent >= maxDepth) {
    lines.push(
      `${prefix}  - *(${children.length} more below this level — use reactome_pathway_contained_events on ${event.stId})*`
    );
    return lines;
  }

  for (const child of children) {
    lines.push(...formatEventHierarchy(child, indent + 1, maxDepth));
  }

  return lines;
}

export function registerPathwayTools(server: McpServer) {
  // Get pathway details
  server.tool(
    "reactome_get_pathway",
    "Get detailed information about a specific pathway or reaction by its Reactome ID.",
    {
      id: nonEmptyString.describe("Reactome stable ID (e.g., R-HSA-109582) or database ID"),
    },
    async ({ id }) => {
      const pathway = await contentClient.get<Event>(
        `/data/query/enhanced/${encodeURIComponent(id)}`
      );
      return {
        content: [{ type: "text", text: formatPathway(pathway) }],
      };
    }
  );

  // Get top-level pathways
  server.tool(
    "reactome_top_pathways",
    "Get all top-level (root) pathways for a species. These are the main pathway categories like 'Immune System', 'Metabolism', etc.",
    {
      species: nonEmptyString
        .optional()
        .default("Homo sapiens")
        .describe("Species name or taxonomy ID"),
    },
    async ({ species }) => {
      const pathways = await contentClient.get<Pathway[]>(
        `/data/pathways/top/${encodeURIComponent(species)}`
      );

      const lines = [
        `## Top-Level Pathways for ${species}`,
        `**Total:** ${pathways.length}`,
        "",
        ...pathways.map(
          p => `- **${p.displayName}** (${p.stId})${p.hasDiagram ? " [has diagram]" : ""}`
        ),
      ];

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );

  // Get pathway ancestors
  server.tool(
    "reactome_pathway_ancestors",
    "Get the ancestor pathway hierarchy for an event (pathway or reaction). Shows how a pathway fits into the broader Reactome structure.",
    {
      id: nonEmptyString.describe("Reactome stable ID or database ID"),
    },
    async ({ id }) => {
      const ancestors = await contentClient.get<Event[][]>(
        `/data/event/${encodeURIComponent(id)}/ancestors`
      );

      const lines = [`## Ancestor Pathways for ${id}`, ""];

      ancestors.forEach((branch, i) => {
        if (ancestors.length > 1) {
          lines.push(`### Branch ${i + 1}:`);
        }
        branch.forEach((event, j) => {
          const indent = "  ".repeat(j);
          lines.push(`${indent}${j + 1}. **${event.displayName}** (${event.stId})`);
        });
        lines.push("");
      });

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );

  // Get contained events
  server.tool(
    "reactome_pathway_contained_events",
    "Get all events (sub-pathways and reactions) contained within a pathway.",
    {
      id: nonEmptyString.describe("Pathway stable ID or database ID"),
    },
    async ({ id }) => {
      const events = await contentClient.get<Event[]>(
        `/data/pathway/${encodeURIComponent(id)}/containedEvents`
      );

      const reactions = events.filter(
        e => e.schemaClass === "Reaction" || e.schemaClass === "BlackBoxEvent"
      );
      const subpathways = events.filter(e => e.schemaClass === "Pathway");

      const lines = [
        `## Contained Events in ${id}`,
        `**Total events:** ${events.length}`,
        `**Sub-pathways:** ${subpathways.length}`,
        `**Reactions:** ${reactions.length}`,
        "",
      ];

      if (subpathways.length > 0) {
        lines.push("### Sub-pathways:");
        subpathways.forEach(p => {
          lines.push(`- **${p.displayName}** (${p.stId})`);
        });
        lines.push("");
      }

      if (reactions.length > 0) {
        lines.push("### Reactions:");
        reactions.slice(0, 30).forEach(r => {
          lines.push(`- ${r.displayName} (${r.stId})`);
        });
        if (reactions.length > 30) {
          lines.push(`... and ${reactions.length - 30} more reactions`);
        }
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );

  // Get pathways for entity
  server.tool(
    "reactome_pathways_for_entity",
    "Find lower-level pathways that contain a specific entity (protein, gene, compound, etc.).",
    {
      id: nonEmptyString.describe("Entity stable ID or database ID"),
      all_forms: z
        .boolean()
        .optional()
        .default(false)
        .describe("Include all forms of the entity (modified, in complexes, etc.)"),
    },
    async ({ id, all_forms }) => {
      const endpoint = all_forms
        ? `/data/pathways/low/entity/${encodeURIComponent(id)}/allForms`
        : `/data/pathways/low/entity/${encodeURIComponent(id)}`;

      const pathways = await contentClient.get<Pathway[]>(endpoint);

      const lines = [
        `## Pathways Containing ${id}`,
        `**Total:** ${pathways.length}`,
        all_forms ? "(including all forms of the entity)" : "",
        "",
        ...pathways
          .slice(0, 50)
          .map(p => `- **${p.displayName}** (${p.stId}) - ${p.speciesName || "Unknown species"}`),
      ];

      if (pathways.length > 50) {
        lines.push(`... and ${pathways.length - 50} more pathways`);
      }

      return {
        content: [{ type: "text", text: lines.filter(Boolean).join("\n") }],
      };
    }
  );

  // Get pathways with diagrams for entity
  server.tool(
    "reactome_diagram_pathways_for_entity",
    "Find pathways with diagrams that contain a specific entity. Useful for visualization.",
    {
      id: nonEmptyString.describe("Entity stable ID or database ID"),
      all_forms: z.boolean().optional().default(false).describe("Include all forms of the entity"),
    },
    async ({ id, all_forms }) => {
      const endpoint = all_forms
        ? `/data/pathways/low/diagram/entity/${encodeURIComponent(id)}/allForms`
        : `/data/pathways/low/diagram/entity/${encodeURIComponent(id)}`;

      const pathways = await contentClient.get<Pathway[]>(endpoint);

      const lines = [
        `## Pathways with Diagrams Containing ${id}`,
        `**Total:** ${pathways.length}`,
        "",
        ...pathways.slice(0, 30).map(p => `- **${p.displayName}** (${p.stId})`),
      ];

      if (pathways.length > 30) {
        lines.push(`... and ${pathways.length - 30} more pathways`);
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );

  // What has to happen before this event
  server.tool(
    "reactome_preceding_events",
    "Find the events that must occur before a given reaction or pathway — Reactome's " +
      "event ordering. Use for mechanistic questions about sequence: what leads up to " +
      "this, what triggers it, what comes earlier in the cascade. Walks back several " +
      "steps, so it answers 'what is upstream of X' rather than only 'what is one step " +
      "before X'. This is ordering, not containment: for what a pathway is made of, use " +
      "reactome_pathway_contained_events.",
    {
      id: nonEmptyString.describe("Stable ID of a reaction or pathway, e.g. R-HSA-69205"),
      depth: z
        .number()
        .int()
        .min(1)
        .max(5)
        .optional()
        .default(2)
        .describe("How many steps back to walk (default 2). Each step multiplies the work."),
    },
    async ({ id, depth }) => {
      // Reactome models ordering on the *later* event: an event lists what
      // precedes it. The forward direction is not symmetrically available --
      // `followingEvent` appears only nested, as bare dbIds with no stable IDs
      // -- so this walks backwards, which is the direction the data supports.
      const seen = new Set<string>([id]);
      const levels: Array<Array<{ stId: string; displayName: string; schemaClass?: string }>> = [];
      let frontier = [id];

      for (let step = 0; step < depth && frontier.length > 0; step++) {
        const found: Array<{ stId: string; displayName: string; schemaClass?: string }> = [];
        for (const current of frontier) {
          const event = await contentClient.get<{
            precedingEvent?: Array<{ stId?: string; displayName?: string; schemaClass?: string }>;
          }>(`/data/query/${encodeURIComponent(current)}`);

          for (const preceding of event.precedingEvent ?? []) {
            // A stable ID is what makes the answer usable; entries without one
            // cannot be followed up and are not worth rendering.
            if (!preceding.stId || seen.has(preceding.stId)) continue;
            seen.add(preceding.stId);
            found.push({
              stId: preceding.stId,
              displayName: preceding.displayName ?? preceding.stId,
              schemaClass: preceding.schemaClass,
            });
          }
        }
        if (found.length === 0) break;
        levels.push(found);
        frontier = found.map(f => f.stId);
      }

      const lines = [`## What happens before ${id}`, ""];

      if (levels.length === 0) {
        lines.push(
          "*Nothing precedes this event in Reactome.*",
          "",
          "That is a real answer, not a lookup failure: many events are entry points,",
          "and Reactome only records ordering where it is curated."
        );
      } else {
        levels.forEach((level, index) => {
          lines.push(`### ${index + 1} step${index === 0 ? "" : "s"} back`);
          for (const event of level) {
            lines.push(
              `- **${event.displayName}** (${event.stId})` +
                (event.schemaClass ? ` [${event.schemaClass}]` : "")
            );
          }
          lines.push("");
        });
        lines.push(
          `Ordering runs earliest-last: the deepest level above is furthest upstream of ${id}.`
        );
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  // Get full events hierarchy
  server.tool(
    "reactome_events_hierarchy",
    "Get the complete event hierarchy (pathways and reactions tree) for a species. Warning: This returns a large data structure.",
    {
      // Defaults to the taxonomy ID, not the name: /data/eventsHierarchy
      // returns HTTP 500 for "Homo sapiens" but 200 for "9606", so the
      // previous default made this tool fail every time it was called without
      // an explicit species.
      species: nonEmptyString
        .optional()
        .default("9606")
        .describe(
          "Species taxonomy ID (e.g. 9606). Names are accepted by the API but are unreliable here -- prefer the ID."
        ),
      max_depth: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .default(3)
        .describe(
          "How many levels of the tree to render (default 3). Deeper trees get large fast."
        ),
      top_level_limit: z
        .number()
        .int()
        .min(1)
        .max(30)
        .optional()
        .default(3)
        .describe("How many top-level pathways to render (default 3)."),
    },
    async ({ species, max_depth, top_level_limit }) => {
      const hierarchy = await contentClient.get<EventHierarchy[]>(
        `/data/eventsHierarchy/${encodeURIComponent(species)}`
      );

      const lines = [
        `## Events Hierarchy for ${species}`,
        `**Top-level pathways:** ${hierarchy.length}`,
        "",
      ];

      hierarchy.slice(0, top_level_limit).forEach(top => {
        lines.push(...formatEventHierarchy(top, 0, max_depth));
        lines.push("");
      });

      if (hierarchy.length > top_level_limit) {
        lines.push(`... and ${hierarchy.length - top_level_limit} more top-level pathways`);
      }

      lines.push(
        "",
        "*Note: Use reactome_pathway_contained_events for detailed exploration of specific pathways.*"
      );

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );
}
