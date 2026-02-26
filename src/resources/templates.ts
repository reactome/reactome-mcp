import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { contentClient } from "../clients/content.js";
import { analysisClient } from "../clients/analysis.js";
import { CONTENT_SERVICE_URL } from "../config.js";
import type { Event, Pathway, AnalysisResult } from "../types/index.js";
import type { Variables } from "@modelcontextprotocol/sdk/shared/uriTemplate.js";

export function registerResourceTemplates(server: McpServer) {
  // Pathway details template
  server.resource(
    "pathway",
    new ResourceTemplate("reactome://pathway/{id}", { list: undefined }),
    { description: "Pathway details by Reactome ID (e.g., R-HSA-109582)" },
    async (uri: URL, variables: Variables) => {
      const id = variables.id as string;
      const pathway = await contentClient.get<Event>(`/data/query/enhanced/${encodeURIComponent(id)}`);
      return {
        contents: [{
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(pathway, null, 2),
        }],
      };
    }
  );

  // Pathway diagram SVG template
  server.resource(
    "pathway-diagram",
    new ResourceTemplate("reactome://pathway/{id}/diagram", { list: undefined }),
    { description: "Pathway diagram as SVG" },
    async (uri: URL, variables: Variables) => {
      const id = variables.id as string;
      const svgUrl = `${CONTENT_SERVICE_URL}/exporter/diagram/${encodeURIComponent(id)}.svg?quality=7`;

      try {
        const response = await fetch(svgUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch diagram: ${response.status}`);
        }
        const svg = await response.text();
        return {
          contents: [{
            uri: uri.href,
            mimeType: "image/svg+xml",
            text: svg,
          }],
        };
      } catch (error) {
        return {
          contents: [{
            uri: uri.href,
            mimeType: "text/plain",
            text: `Error fetching diagram: ${error instanceof Error ? error.message : String(error)}\nDirect URL: ${svgUrl}`,
          }],
        };
      }
    }
  );

  // Entity details template
  server.resource(
    "entity",
    new ResourceTemplate("reactome://entity/{id}", { list: undefined }),
    { description: "Entity details by Reactome ID" },
    async (uri: URL, variables: Variables) => {
      const id = variables.id as string;
      const entity = await contentClient.get<Record<string, unknown>>(`/data/query/enhanced/${encodeURIComponent(id)}`);
      return {
        contents: [{
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(entity, null, 2),
        }],
      };
    }
  );

  // Analysis result template
  server.resource(
    "analysis",
    new ResourceTemplate("reactome://analysis/{token}", { list: undefined }),
    { description: "Analysis result by token" },
    async (uri: URL, variables: Variables) => {
      const token = variables.token as string;
      const result = await analysisClient.get<AnalysisResult>(`/token/${token}`, {
        pageSize: 100,
        sortBy: "ENTITIES_PVALUE",
        order: "ASC",
      });
      return {
        contents: [{
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(result, null, 2),
        }],
      };
    }
  );

  // Top pathways for species template
  server.resource(
    "top-pathways",
    new ResourceTemplate("reactome://top-pathways/{species}", { list: undefined }),
    { description: "Top-level pathways for a species" },
    async (uri: URL, variables: Variables) => {
      const species = variables.species as string;
      const pathways = await contentClient.get<Pathway[]>(`/data/pathways/top/${encodeURIComponent(species)}`);
      return {
        contents: [{
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(pathways, null, 2),
        }],
      };
    }
  );

  // Events hierarchy for species template
  server.resource(
    "events-hierarchy",
    new ResourceTemplate("reactome://events-hierarchy/{species}", { list: undefined }),
    { description: "Full events hierarchy for a species" },
    async (uri: URL, variables: Variables) => {
      const species = variables.species as string;
      const hierarchy = await contentClient.get<unknown>(`/data/eventsHierarchy/${encodeURIComponent(species)}`);
      return {
        contents: [{
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(hierarchy, null, 2),
        }],
      };
    }
  );
}
