import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { contentClient } from "../clients/content.js";
import type { Pathway } from "../types/index.js";

interface PsicquicResource {
  name: string;
  active: boolean;
}

interface InteractorSummary {
  accession: string;
  count: number;
}

interface InteractionDetails {
  accession: string;
  entities: InteractionEntity[];
}

interface InteractionEntity {
  accession: string;
  score: number;
  interactorId?: number;
  alias?: string;
}

interface StaticInteractionDetails {
  accession: string;
  interactsWith: StaticInteractor[];
}

interface StaticInteractor {
  accession: string;
  score: number;
  chemicalId?: string;
}

export function registerInteractorTools(server: McpServer) {
  // List PSICQUIC resources
  server.tool(
    "reactome_psicquic_resources",
    "List available PSICQUIC registry services for protein-protein interaction data.",
    {},
    async () => {
      const resources = await contentClient.get<PsicquicResource[]>("/interactors/psicquic/resources");

      const active = resources.filter(r => r.active);
      const inactive = resources.filter(r => !r.active);

      const lines = [
        `## PSICQUIC Resources`,
        `**Total:** ${resources.length} (${active.length} active)`,
        "",
        "### Active Resources:",
        ...active.map(r => `- ${r.name}`),
      ];

      if (inactive.length > 0) {
        lines.push("");
        lines.push("### Inactive Resources:");
        lines.push(...inactive.map(r => `- ${r.name}`));
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );

  // Get PSICQUIC interaction summary
  server.tool(
    "reactome_psicquic_summary",
    "Get a summary of protein-protein interactions from a PSICQUIC resource.",
    {
      resource: z.string().max(2048).describe("PSICQUIC resource name (e.g., 'IntAct', 'MINT', 'BioGRID')"),
      accession: z.string().max(2048).describe("Protein accession (e.g., UniProt ID)"),
    },
    async ({ resource, accession }) => {
      const result = await contentClient.get<InteractorSummary>(
        `/interactors/psicquic/molecule/${encodeURIComponent(resource)}/${encodeURIComponent(accession)}/summary`
      );

      const lines = [
        `## PSICQUIC Interaction Summary`,
        `**Protein:** ${result.accession}`,
        `**Resource:** ${resource}`,
        `**Interaction count:** ${result.count}`,
      ];

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );

  // Get PSICQUIC interaction details
  server.tool(
    "reactome_psicquic_details",
    "Get detailed protein-protein interactions from a PSICQUIC resource.",
    {
      resource: z.string().max(2048).describe("PSICQUIC resource name"),
      accession: z.string().max(2048).describe("Protein accession"),
    },
    async ({ resource, accession }) => {
      const result = await contentClient.get<InteractionDetails>(
        `/interactors/psicquic/molecule/${encodeURIComponent(resource)}/${encodeURIComponent(accession)}/details`
      );

      const lines = [
        `## PSICQUIC Interactions for ${result.accession}`,
        `**Resource:** ${resource}`,
        `**Interactors found:** ${result.entities.length}`,
        "",
        "### Interacting Proteins (sorted by score):",
        ...result.entities
          .sort((a, b) => b.score - a.score)
          .slice(0, 30)
          .map(e => `- **${e.accession}** (score: ${e.score.toFixed(3)})${e.alias ? ` - ${e.alias}` : ""}`),
      ];

      if (result.entities.length > 30) {
        lines.push(`... and ${result.entities.length - 30} more interactors`);
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );

  // Get static (curated) interactors
  server.tool(
    "reactome_static_interactors",
    "Get curated protein-protein interactions from Reactome's static interactor database.",
    {
      accession: z.string().max(2048).describe("Protein accession (e.g., UniProt ID)"),
    },
    async ({ accession }) => {
      interface StaticDetailsResult {
        accession: string;
        entities: Array<{
          acc: string;
          score: number;
        }>;
      }

      const result = await contentClient.get<StaticDetailsResult>(
        `/interactors/static/molecule/${encodeURIComponent(accession)}/details`
      );

      const lines = [
        `## Static Interactors for ${result.accession}`,
        `**Interactors found:** ${result.entities?.length || 0}`,
        "",
      ];

      if (result.entities && result.entities.length > 0) {
        lines.push("### Interacting Proteins:");
        result.entities
          .sort((a, b) => b.score - a.score)
          .slice(0, 30)
          .forEach(e => {
            lines.push(`- **${e.acc}** (score: ${e.score.toFixed(3)})`);
          });

        if (result.entities.length > 30) {
          lines.push(`... and ${result.entities.length - 30} more interactors`);
        }
      } else {
        lines.push("*No interactors found in the static database.*");
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );

  // Get interactor pathways
  server.tool(
    "reactome_interactor_pathways",
    "Find Reactome pathways where the interactors of a protein are found.",
    {
      accession: z.string().max(2048).describe("Protein accession"),
    },
    async ({ accession }) => {
      const pathways = await contentClient.get<Pathway[]>(
        `/interactors/static/molecule/${encodeURIComponent(accession)}/pathways`
      );

      const lines = [
        `## Pathways for Interactors of ${accession}`,
        `**Total pathways:** ${pathways.length}`,
        "",
        ...pathways.slice(0, 50).map(p => `- **${p.displayName}** (${p.stId})`),
      ];

      if (pathways.length > 50) {
        lines.push(`... and ${pathways.length - 50} more pathways`);
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );

  // Get static interactor summary
  server.tool(
    "reactome_interactor_summary",
    "Get a summary of curated interactions for a protein.",
    {
      accession: z.string().max(2048).describe("Protein accession"),
    },
    async ({ accession }) => {
      interface SummaryResult {
        accession: string;
        count: number;
      }

      const result = await contentClient.get<SummaryResult>(
        `/interactors/static/molecule/${encodeURIComponent(accession)}/summary`
      );

      const lines = [
        `## Interactor Summary for ${result.accession}`,
        `**Total interactions:** ${result.count}`,
      ];

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );
}
