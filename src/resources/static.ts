import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { contentClient } from "../clients/content.js";
import type { Species, Disease } from "../types/index.js";
import { isNeo4jConfigured, fetchGraphSchema } from "../clients/neo4j.js";

export function registerStaticResources(server: McpServer) {
  // All species
  server.resource(
    "reactome://species",
    "reactome://species",
    async () => {
      const species = await contentClient.get<Species[]>("/data/species/all");
      return {
        contents: [{
          uri: "reactome://species",
          mimeType: "application/json",
          text: JSON.stringify(species, null, 2),
        }],
      };
    }
  );

  // Main species
  server.resource(
    "reactome://species/main",
    "reactome://species/main",
    async () => {
      const species = await contentClient.get<Species[]>("/data/species/main");
      return {
        contents: [{
          uri: "reactome://species/main",
          mimeType: "application/json",
          text: JSON.stringify(species, null, 2),
        }],
      };
    }
  );

  // Diseases
  server.resource(
    "reactome://diseases",
    "reactome://diseases",
    async () => {
      const diseases = await contentClient.get<Disease[]>("/data/diseases");
      return {
        contents: [{
          uri: "reactome://diseases",
          mimeType: "application/json",
          text: JSON.stringify(diseases, null, 2),
        }],
      };
    }
  );

  // Database info
  server.resource(
    "reactome://database/info",
    "reactome://database/info",
    async () => {
      const [name, version] = await Promise.all([
        contentClient.getText("/data/database/name"),
        contentClient.getText("/data/database/version"),
      ]);

      const info = {
        name: name.trim(),
        version: parseInt(version.trim(), 10),
      };

      return {
        contents: [{
          uri: "reactome://database/info",
          mimeType: "application/json",
          text: JSON.stringify(info, null, 2),
        }],
      };
    }
  );

  // Graph schema (opt-in, requires NEO4J_URI)
  if (isNeo4jConfigured()) {
    server.resource(
      "reactome://graph/schema",
      "reactome://graph/schema",
      async () => {
        const schema = await fetchGraphSchema();
        return {
          contents: [{
            uri: "reactome://graph/schema",
            mimeType: "application/json",
            text: JSON.stringify(schema, null, 2),
          }],
        };
      }
    );
  }
}
