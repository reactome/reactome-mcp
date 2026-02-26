import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
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

  if ("summation" in pathway && pathway.summation && pathway.summation.length > 0) {
    lines.push("", "### Summary:", pathway.summation[0].text);
  }

  if ("literatureReference" in pathway && pathway.literatureReference && pathway.literatureReference.length > 0) {
    lines.push("", "### References:");
    pathway.literatureReference.slice(0, 5).forEach(ref => {
      if (ref.pubMedIdentifier) {
        lines.push(`- [${ref.displayName}](https://pubmed.ncbi.nlm.nih.gov/${ref.pubMedIdentifier})`);
      } else {
        lines.push(`- ${ref.displayName}`);
      }
    });
  }

  return lines.join("\n");
}

function formatEventHierarchy(event: EventHierarchy, indent = 0): string[] {
  const prefix = "  ".repeat(indent);
  const lines = [`${prefix}- **${event.name}** (${event.stId}) [${event.type}]`];

  if (event.children) {
    for (const child of event.children) {
      lines.push(...formatEventHierarchy(child, indent + 1));
    }
  }

  return lines;
}

export function registerPathwayTools(server: McpServer) {
  // Get pathway details
  server.tool(
    "reactome_get_pathway",
    "Get detailed information about a specific pathway or reaction by its Reactome ID.",
    {
      id: z.string().describe("Reactome stable ID (e.g., R-HSA-109582) or database ID"),
    },
    async ({ id }) => {
      const pathway = await contentClient.get<Event>(`/data/query/enhanced/${encodeURIComponent(id)}`);
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
      species: z.string().optional().default("Homo sapiens").describe("Species name or taxonomy ID"),
    },
    async ({ species }) => {
      const pathways = await contentClient.get<Pathway[]>(`/data/pathways/top/${encodeURIComponent(species)}`);

      const lines = [
        `## Top-Level Pathways for ${species}`,
        `**Total:** ${pathways.length}`,
        "",
        ...pathways.map(p => `- **${p.displayName}** (${p.stId})${p.hasDiagram ? " [has diagram]" : ""}`),
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
      id: z.string().describe("Reactome stable ID or database ID"),
    },
    async ({ id }) => {
      const ancestors = await contentClient.get<Event[][]>(`/data/event/${encodeURIComponent(id)}/ancestors`);

      const lines = [
        `## Ancestor Pathways for ${id}`,
        "",
      ];

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
      id: z.string().describe("Pathway stable ID or database ID"),
    },
    async ({ id }) => {
      const events = await contentClient.get<Event[]>(`/data/pathway/${encodeURIComponent(id)}/containedEvents`);

      const reactions = events.filter(e => e.schemaClass === "Reaction" || e.schemaClass === "BlackBoxEvent");
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
      id: z.string().describe("Entity stable ID or database ID"),
      all_forms: z.boolean().optional().default(false).describe("Include all forms of the entity (modified, in complexes, etc.)"),
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
        ...pathways.slice(0, 50).map(p => `- **${p.displayName}** (${p.stId}) - ${p.speciesName || "Unknown species"}`),
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
      id: z.string().describe("Entity stable ID or database ID"),
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

  // Get full events hierarchy
  server.tool(
    "reactome_events_hierarchy",
    "Get the complete event hierarchy (pathways and reactions tree) for a species. Warning: This returns a large data structure.",
    {
      species: z.string().optional().default("Homo sapiens").describe("Species name or taxonomy ID"),
    },
    async ({ species }) => {
      const hierarchy = await contentClient.get<EventHierarchy[]>(`/data/eventsHierarchy/${encodeURIComponent(species)}`);

      const lines = [
        `## Events Hierarchy for ${species}`,
        `**Top-level pathways:** ${hierarchy.length}`,
        "",
      ];

      // Show first 3 top-level pathways with their immediate children
      hierarchy.slice(0, 3).forEach(top => {
        lines.push(...formatEventHierarchy(top, 0));
        lines.push("");
      });

      if (hierarchy.length > 3) {
        lines.push(`... and ${hierarchy.length - 3} more top-level pathways`);
      }

      lines.push("", "*Note: Use reactome_pathway_contained_events for detailed exploration of specific pathways.*");

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );
}
