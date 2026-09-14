import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { nonEmptyString } from "../schemas.js";
import { contentClient } from "../clients/content.js";
import type { Pathway } from "../types/index.js";

interface PsicquicResource {
  name: string;
  active: boolean;
}

/**
 * All four interactor endpoints -- psicquic summary/details and static
 * summary/details -- return the SAME envelope. Verified against the live
 * Content Service:
 *
 *   GET /interactors/static/molecule/P04637/details
 *   {"resource": "static",
 *    "entities": [{"acc": "P04637", "count": 249,
 *                  "interactors": [{"acc": "Q00987", "alias": "MDM2",
 *                                   "score": 0.995, "evidences": 122}]}]}
 *
 * `entities` is the list of molecules that were *queried*, not the list of
 * interactors -- those hang off each entity. The previous types flattened the
 * two levels and used `accession` where the API says `acc`, so the summary
 * tools printed "undefined" for both protein and count, and the details tools
 * crashed on `e.score.toFixed` because `score` lives one level down.
 */
interface InteractorEnvelope {
  resource: string;
  entities?: InteractorEntity[];
}

interface InteractorEntity {
  acc: string;
  count: number;
  interactors?: Interactor[];
}

interface Interactor {
  acc: string;
  score: number;
  alias?: string;
  evidences?: number;
  id?: number;
}

/**
 * Reduce the envelope to the single queried molecule. These tools always ask
 * about one accession, so there is exactly one entity -- but the API still
 * wraps it in an array, and an unknown accession yields an empty one.
 */
function firstEntity(result: InteractorEnvelope): InteractorEntity | undefined {
  return result.entities?.[0];
}

function formatInteractors(interactors: Interactor[], limit = 30): string[] {
  const lines = [...interactors]
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, limit)
    .map(i => {
      const score = typeof i.score === "number" ? i.score.toFixed(3) : "n/a";
      return `- **${i.acc}** (score: ${score})${i.alias ? ` - ${i.alias}` : ""}`;
    });

  if (interactors.length > limit) {
    lines.push(`... and ${interactors.length - limit} more interactors`);
  }
  return lines;
}

export function registerInteractorTools(server: McpServer) {
  // List PSICQUIC resources
  server.tool(
    "reactome_psicquic_resources",
    "List available PSICQUIC registry services for protein-protein interaction data.",
    {},
    async () => {
      const resources = await contentClient.get<PsicquicResource[]>(
        "/interactors/psicquic/resources"
      );

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
      resource: z
        .string()
        .max(2048)
        .describe("PSICQUIC resource name (e.g., 'IntAct', 'MINT', 'BioGRID')"),
      accession: nonEmptyString.describe("Protein accession (e.g., UniProt ID)"),
    },
    async ({ resource, accession }) => {
      const result = await contentClient.get<InteractorEnvelope>(
        `/interactors/psicquic/molecule/${encodeURIComponent(resource)}/${encodeURIComponent(accession)}/summary`
      );
      const entity = firstEntity(result);

      const lines = [
        `## PSICQUIC Interaction Summary`,
        `**Protein:** ${entity?.acc ?? accession}`,
        `**Resource:** ${resource}`,
        `**Interaction count:** ${entity?.count ?? 0}`,
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
      resource: nonEmptyString.describe("PSICQUIC resource name"),
      accession: nonEmptyString.describe("Protein accession"),
    },
    async ({ resource, accession }) => {
      const result = await contentClient.get<InteractorEnvelope>(
        `/interactors/psicquic/molecule/${encodeURIComponent(resource)}/${encodeURIComponent(accession)}/details`
      );
      const entity = firstEntity(result);
      const interactors = entity?.interactors ?? [];

      const lines = [
        `## PSICQUIC Interactions for ${entity?.acc ?? accession}`,
        `**Resource:** ${resource}`,
        `**Interactors found:** ${interactors.length}`,
        "",
      ];

      if (interactors.length > 0) {
        lines.push(
          "### Interacting Proteins (sorted by score):",
          ...formatInteractors(interactors)
        );
      } else {
        lines.push(`*No interactions found in ${resource}.*`);
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
      accession: nonEmptyString.describe("Protein accession (e.g., UniProt ID)"),
    },
    async ({ accession }) => {
      const result = await contentClient.get<InteractorEnvelope>(
        `/interactors/static/molecule/${encodeURIComponent(accession)}/details`
      );
      const entity = firstEntity(result);
      const interactors = entity?.interactors ?? [];

      const lines = [
        `## Static Interactors for ${entity?.acc ?? accession}`,
        `**Interactors found:** ${interactors.length}`,
        "",
      ];

      if (interactors.length > 0) {
        lines.push("### Interacting Proteins:", ...formatInteractors(interactors));
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
      accession: nonEmptyString.describe("Protein accession"),
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
      accession: nonEmptyString.describe("Protein accession"),
    },
    async ({ accession }) => {
      const result = await contentClient.get<InteractorEnvelope>(
        `/interactors/static/molecule/${encodeURIComponent(accession)}/summary`
      );
      const entity = firstEntity(result);

      const lines = [
        `## Interactor Summary for ${entity?.acc ?? accession}`,
        `**Total interactions:** ${entity?.count ?? 0}`,
      ];

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );
}
