import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { contentClient } from "../clients/content.js";
import type { PhysicalEntity, Complex, ReferenceEntity, Event } from "../types/index.js";

interface Participant {
  dbId: number;
  stId?: string;
  displayName: string;
  schemaClass: string;
  referenceEntity?: ReferenceEntity;
}

interface EnhancedEntity extends PhysicalEntity {
  compartment?: Array<{ displayName: string }>;
  disease?: Array<{ displayName: string }>;
  referenceEntity?: ReferenceEntity;
  hasModifiedResidue?: Array<{ displayName: string }>;
  summation?: Array<{ text: string }>;
}

function formatEntity(entity: EnhancedEntity): string {
  const lines = [
    `## ${entity.displayName}`,
    `**Stable ID:** ${entity.stId}`,
    `**Database ID:** ${entity.dbId}`,
    `**Type:** ${entity.schemaClass}`,
  ];

  if (entity.speciesName) {
    lines.push(`**Species:** ${entity.speciesName}`);
  }

  if (entity.compartment && entity.compartment.length > 0) {
    lines.push(`**Compartment:** ${entity.compartment.map(c => c.displayName).join(", ")}`);
  }

  if (entity.referenceEntity) {
    lines.push("");
    lines.push("### Reference:");
    lines.push(`- **Database:** ${entity.referenceEntity.databaseName}`);
    lines.push(`- **Identifier:** ${entity.referenceEntity.identifier}`);
    if (entity.referenceEntity.url) {
      lines.push(`- **URL:** ${entity.referenceEntity.url}`);
    }
  }

  if (entity.hasModifiedResidue && entity.hasModifiedResidue.length > 0) {
    lines.push("");
    lines.push("### Modifications:");
    entity.hasModifiedResidue.forEach(m => {
      lines.push(`- ${m.displayName}`);
    });
  }

  if (entity.disease && entity.disease.length > 0) {
    lines.push("");
    lines.push("### Associated Diseases:");
    entity.disease.forEach(d => {
      lines.push(`- ${d.displayName}`);
    });
  }

  if (entity.summation && entity.summation.length > 0) {
    lines.push("");
    lines.push("### Summary:");
    lines.push(entity.summation[0].text);
  }

  return lines.join("\n");
}

export function registerEntityTools(server: McpServer) {
  // Get entity details
  server.tool(
    "reactome_get_entity",
    "Get detailed information about a physical entity (protein, complex, compound, etc.) by its Reactome ID.",
    {
      id: z.string().describe("Reactome stable ID (e.g., R-HSA-123456) or database ID"),
    },
    async ({ id }) => {
      const entity = await contentClient.get<EnhancedEntity>(`/data/query/enhanced/${encodeURIComponent(id)}`);
      return {
        content: [{ type: "text", text: formatEntity(entity) }],
      };
    }
  );

  // Get complex subunits
  server.tool(
    "reactome_complex_subunits",
    "Get all subunits (components) of a complex. Recursively retrieves components of nested complexes.",
    {
      id: z.string().describe("Complex stable ID or database ID"),
    },
    async ({ id }) => {
      const subunits = await contentClient.get<PhysicalEntity[]>(`/data/complex/${encodeURIComponent(id)}/subunits`);

      // Group by type
      const byType: Record<string, PhysicalEntity[]> = {};
      subunits.forEach(s => {
        const type = s.schemaClass;
        if (!byType[type]) byType[type] = [];
        byType[type].push(s);
      });

      const lines = [
        `## Subunits of Complex ${id}`,
        `**Total components:** ${subunits.length}`,
        "",
      ];

      Object.entries(byType).forEach(([type, entities]) => {
        lines.push(`### ${type} (${entities.length}):`);
        entities.forEach(e => {
          lines.push(`- ${e.displayName} (${e.stId})`);
        });
        lines.push("");
      });

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );

  // Get other forms of entity
  server.tool(
    "reactome_entity_other_forms",
    "Get all other forms of a physical entity (modified forms, in different compartments, in complexes, etc.).",
    {
      id: z.string().describe("Entity stable ID or database ID"),
    },
    async ({ id }) => {
      const otherForms = await contentClient.get<PhysicalEntity[]>(`/data/entity/${encodeURIComponent(id)}/otherForms`);

      const lines = [
        `## Other Forms of ${id}`,
        `**Total:** ${otherForms.length}`,
        "",
        ...otherForms.slice(0, 50).map(e => `- **${e.displayName}** (${e.stId}) [${e.schemaClass}]`),
      ];

      if (otherForms.length > 50) {
        lines.push(`... and ${otherForms.length - 50} more forms`);
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );

  // Get containing structures
  server.tool(
    "reactome_entity_component_of",
    "Find larger structures (complexes, sets) that contain this entity as a component.",
    {
      id: z.string().describe("Entity stable ID or database ID"),
    },
    async ({ id }) => {
      const containers = await contentClient.get<Complex[]>(`/data/entity/${encodeURIComponent(id)}/componentOf`);

      const lines = [
        `## Structures Containing ${id}`,
        `**Total:** ${containers.length}`,
        "",
        ...containers.slice(0, 50).map(c => `- **${c.displayName}** (${c.stId}) [${c.schemaClass}]`),
      ];

      if (containers.length > 50) {
        lines.push(`... and ${containers.length - 50} more structures`);
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );

  // Get event participants
  server.tool(
    "reactome_participants",
    "Get all molecular participants (inputs, outputs, catalysts, regulators) in a reaction or pathway.",
    {
      id: z.string().describe("Event (pathway or reaction) stable ID or database ID"),
    },
    async ({ id }) => {
      const participants = await contentClient.get<Participant[]>(`/data/participants/${encodeURIComponent(id)}`);

      // Group by type
      const byType: Record<string, Participant[]> = {};
      participants.forEach(p => {
        const type = p.schemaClass;
        if (!byType[type]) byType[type] = [];
        byType[type].push(p);
      });

      const lines = [
        `## Participants in ${id}`,
        `**Total:** ${participants.length}`,
        "",
      ];

      Object.entries(byType).forEach(([type, entities]) => {
        lines.push(`### ${type} (${entities.length}):`);
        entities.slice(0, 20).forEach(e => {
          const refInfo = e.referenceEntity ? ` [${e.referenceEntity.identifier}]` : "";
          lines.push(`- ${e.displayName} (${e.stId || e.dbId})${refInfo}`);
        });
        if (entities.length > 20) {
          lines.push(`... and ${entities.length - 20} more`);
        }
        lines.push("");
      });

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );

  // Get participating physical entities
  server.tool(
    "reactome_participating_physical_entities",
    "Get all physical entities participating in an event (molecules directly involved in reactions).",
    {
      id: z.string().describe("Event stable ID or database ID"),
    },
    async ({ id }) => {
      const entities = await contentClient.get<PhysicalEntity[]>(`/data/participants/${encodeURIComponent(id)}/participatingPhysicalEntities`);

      const lines = [
        `## Participating Physical Entities in ${id}`,
        `**Total:** ${entities.length}`,
        "",
        ...entities.slice(0, 50).map(e => `- **${e.displayName}** (${e.stId}) [${e.schemaClass}]`),
      ];

      if (entities.length > 50) {
        lines.push(`... and ${entities.length - 50} more entities`);
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );

  // Get reference entities
  server.tool(
    "reactome_reference_entities",
    "Get all reference entities (external database references) for participants in an event.",
    {
      id: z.string().describe("Event stable ID or database ID"),
    },
    async ({ id }) => {
      const refs = await contentClient.get<ReferenceEntity[]>(`/data/participants/${encodeURIComponent(id)}/referenceEntities`);

      // Group by database
      const byDb: Record<string, ReferenceEntity[]> = {};
      refs.forEach(r => {
        const db = r.databaseName;
        if (!byDb[db]) byDb[db] = [];
        byDb[db].push(r);
      });

      const lines = [
        `## Reference Entities in ${id}`,
        `**Total:** ${refs.length}`,
        "",
      ];

      Object.entries(byDb).forEach(([db, entities]) => {
        lines.push(`### ${db} (${entities.length}):`);
        entities.slice(0, 15).forEach(e => {
          lines.push(`- ${e.identifier}: ${e.displayName}`);
        });
        if (entities.length > 15) {
          lines.push(`... and ${entities.length - 15} more`);
        }
        lines.push("");
      });

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );

  // Find complexes containing identifier
  server.tool(
    "reactome_complexes_containing",
    "Find all Reactome complexes that contain a specific external identifier (e.g., UniProt ID).",
    {
      resource: z.string().describe("Database name (e.g., 'UniProt', 'ChEBI', 'Ensembl')"),
      identifier: z.string().describe("External identifier (e.g., 'P04637' for UniProt)"),
    },
    async ({ resource, identifier }) => {
      const complexes = await contentClient.get<Complex[]>(`/data/complexes/${encodeURIComponent(resource)}/${encodeURIComponent(identifier)}`);

      const lines = [
        `## Complexes Containing ${resource}:${identifier}`,
        `**Total:** ${complexes.length}`,
        "",
        ...complexes.slice(0, 50).map(c => `- **${c.displayName}** (${c.stId})`),
      ];

      if (complexes.length > 50) {
        lines.push(`... and ${complexes.length - 50} more complexes`);
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );
}
