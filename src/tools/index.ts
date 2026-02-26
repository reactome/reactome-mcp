import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { contentClient } from "../clients/content.js";
import type { Species, Disease, DatabaseInfo, Pathway, MappingResult } from "../types/index.js";

import { registerAnalysisTools } from "./analysis.js";
import { registerPathwayTools } from "./pathway.js";
import { registerSearchTools } from "./search.js";
import { registerEntityTools } from "./entity.js";
import { registerExportTools } from "./export.js";
import { registerInteractorTools } from "./interactors.js";

export function registerAllTools(server: McpServer) {
  // Register tools from all modules
  registerAnalysisTools(server);
  registerPathwayTools(server);
  registerSearchTools(server);
  registerEntityTools(server);
  registerExportTools(server);
  registerInteractorTools(server);

  // Register utility tools directly here
  registerUtilityTools(server);
}

function registerUtilityTools(server: McpServer) {
  // Get species list
  server.tool(
    "reactome_species",
    "Get the list of species available in Reactome.",
    {
      main_only: z.boolean().optional().default(false).describe("Only return main species with curated pathways"),
    },
    async ({ main_only }) => {
      const endpoint = main_only ? "/data/species/main" : "/data/species/all";
      const species = await contentClient.get<Species[]>(endpoint);

      const lines = [
        `## Reactome Species`,
        `**Total:** ${species.length}`,
        main_only ? "(main species with curated/inferred pathways)" : "(all species)",
        "",
        "| Name | Taxonomy ID | Short Name |",
        "|------|-------------|------------|",
        ...species.slice(0, 50).map(s => `| ${s.displayName} | ${s.taxId} | ${s.shortName || "-"} |`),
      ];

      if (species.length > 50) {
        lines.push(`... and ${species.length - 50} more species`);
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );

  // Get diseases
  server.tool(
    "reactome_diseases",
    "Get the list of diseases annotated in Reactome.",
    {},
    async () => {
      const diseases = await contentClient.get<Disease[]>("/data/diseases");

      const lines = [
        `## Reactome Diseases`,
        `**Total:** ${diseases.length}`,
        "",
        ...diseases.slice(0, 50).map(d => `- **${d.displayName}**${d.identifier ? ` (${d.databaseName}:${d.identifier})` : ""}`),
      ];

      if (diseases.length > 50) {
        lines.push(`... and ${diseases.length - 50} more diseases`);
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );

  // Get database info
  server.tool(
    "reactome_database_info",
    "Get Reactome database version and name information.",
    {},
    async () => {
      const [name, version] = await Promise.all([
        contentClient.getText("/data/database/name"),
        contentClient.getText("/data/database/version"),
      ]);

      const lines = [
        `## Reactome Database Info`,
        `**Database:** ${name.trim()}`,
        `**Version:** ${version.trim()}`,
      ];

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );

  // Map identifier to pathways
  server.tool(
    "reactome_mapping_pathways",
    "Map an external identifier to Reactome pathways.",
    {
      resource: z.string().describe("Database name (e.g., 'UniProt', 'NCBI', 'Ensembl', 'ChEBI')"),
      identifier: z.string().describe("External identifier"),
    },
    async ({ resource, identifier }) => {
      const pathways = await contentClient.get<Pathway[]>(
        `/data/mapping/${encodeURIComponent(resource)}/${encodeURIComponent(identifier)}/pathways`
      );

      const lines = [
        `## Pathways for ${resource}:${identifier}`,
        `**Found:** ${pathways.length} pathways`,
        "",
        ...pathways.slice(0, 50).map(p => `- **${p.displayName}** (${p.stId}) - ${p.speciesName || "Unknown species"}`),
      ];

      if (pathways.length > 50) {
        lines.push(`... and ${pathways.length - 50} more pathways`);
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );

  // Map identifier to reactions
  server.tool(
    "reactome_mapping_reactions",
    "Map an external identifier to Reactome reactions.",
    {
      resource: z.string().describe("Database name (e.g., 'UniProt', 'NCBI', 'Ensembl', 'ChEBI')"),
      identifier: z.string().describe("External identifier"),
    },
    async ({ resource, identifier }) => {
      interface Reaction {
        dbId: number;
        stId: string;
        displayName: string;
        speciesName?: string;
      }

      const reactions = await contentClient.get<Reaction[]>(
        `/data/mapping/${encodeURIComponent(resource)}/${encodeURIComponent(identifier)}/reactions`
      );

      const lines = [
        `## Reactions for ${resource}:${identifier}`,
        `**Found:** ${reactions.length} reactions`,
        "",
        ...reactions.slice(0, 50).map(r => `- **${r.displayName}** (${r.stId})`),
      ];

      if (reactions.length > 50) {
        lines.push(`... and ${reactions.length - 50} more reactions`);
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );

  // Get orthology
  server.tool(
    "reactome_orthology",
    "Get orthologous events or entities in a different species.",
    {
      id: z.string().describe("Reactome stable ID of an event or entity"),
      species: z.string().describe("Target species (taxonomy ID or name)"),
    },
    async ({ id, species }) => {
      interface OrthologyResult {
        dbId: number;
        stId: string;
        displayName: string;
        speciesName: string;
      }

      const result = await contentClient.get<OrthologyResult[]>(
        `/data/orthology/${encodeURIComponent(id)}/species/${encodeURIComponent(species)}`
      );

      const lines = [
        `## Orthology for ${id} in ${species}`,
        `**Found:** ${result.length} orthologous entries`,
        "",
        ...result.map(o => `- **${o.displayName}** (${o.stId}) - ${o.speciesName}`),
      ];

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );

  // Query any Reactome object
  server.tool(
    "reactome_query",
    "Query any Reactome database object by its identifier. Returns detailed information about the object.",
    {
      id: z.string().describe("Reactome stable ID or database ID"),
      attribute: z.string().optional().describe("Specific attribute to retrieve (optional)"),
    },
    async ({ id, attribute }) => {
      const endpoint = attribute
        ? `/data/query/${encodeURIComponent(id)}/${encodeURIComponent(attribute)}`
        : `/data/query/enhanced/${encodeURIComponent(id)}`;

      const result = await contentClient.get<Record<string, unknown>>(endpoint);

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
