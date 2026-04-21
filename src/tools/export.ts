import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { contentClient } from "../clients/content.js";
import { analysisClient } from "../clients/analysis.js";
import { CONTENT_SERVICE_URL, ANALYSIS_SERVICE_URL } from "../config.js";

export function registerExportTools(server: McpServer) {
  // Export pathway diagram
  server.tool(
    "reactome_export_diagram",
    "Export a pathway diagram as an image. Returns the URL to download the diagram.",
    {
      id: z.string().max(2048).describe("Pathway stable ID (e.g., R-HSA-109582)"),
      format: z.enum(["png", "jpg", "svg", "gif"]).optional().default("svg").describe("Image format"),
      quality: z.number().optional().default(5).describe("Quality/scale factor (1-10, higher = larger image)"),
      flag: z.string().max(2048).optional().describe("Identifier to highlight/flag in the diagram"),
      sel: z.array(z.string().max(2048)).optional().describe("IDs to select/highlight"),
    },
    async ({ id, format, quality, flag, sel }) => {
      const params = new URLSearchParams();
      params.set("quality", String(quality));
      if (flag) params.set("flg", flag);
      if (sel && sel.length > 0) params.set("sel", sel.join(","));

      const url = `${CONTENT_SERVICE_URL}/exporter/diagram/${encodeURIComponent(id)}.${format}?${params.toString()}`;

      const lines = [
        `## Pathway Diagram Export`,
        `**Pathway:** ${id}`,
        `**Format:** ${format}`,
        "",
        `**Download URL:**`,
        url,
        "",
        `You can use this URL to download or display the diagram.`,
      ];

      if (format === "svg") {
        lines.push("", "*SVG format is recommended for high-quality scalable diagrams.*");
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );

  // Export reaction diagram
  server.tool(
    "reactome_export_reaction",
    "Export a reaction diagram as an image.",
    {
      id: z.string().max(2048).describe("Reaction stable ID"),
      format: z.enum(["png", "jpg", "svg", "gif"]).optional().default("svg").describe("Image format"),
      quality: z.number().optional().default(5).describe("Quality/scale factor"),
    },
    async ({ id, format, quality }) => {
      const url = `${CONTENT_SERVICE_URL}/exporter/reaction/${encodeURIComponent(id)}.${format}?quality=${quality}`;

      const lines = [
        `## Reaction Diagram Export`,
        `**Reaction:** ${id}`,
        `**Format:** ${format}`,
        "",
        `**Download URL:**`,
        url,
      ];

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );

  // Export fireworks (pathway overview)
  server.tool(
    "reactome_export_fireworks",
    "Export the pathway overview (fireworks) diagram for a species.",
    {
      species: z.string().max(2048).optional().default("Homo sapiens").describe("Species name"),
      format: z.enum(["png", "jpg", "svg", "gif"]).optional().default("svg").describe("Image format"),
    },
    async ({ species, format }) => {
      // Species needs to be formatted as URL-safe string
      const speciesParam = species.replace(/\s+/g, "_");
      const url = `${CONTENT_SERVICE_URL}/exporter/fireworks/${encodeURIComponent(speciesParam)}.${format}`;

      const lines = [
        `## Pathway Overview (Fireworks) Export`,
        `**Species:** ${species}`,
        `**Format:** ${format}`,
        "",
        `**Download URL:**`,
        url,
      ];

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );

  // Export to SBGN
  server.tool(
    "reactome_export_sbgn",
    "Export a pathway or reaction to SBGN (Systems Biology Graphical Notation) XML format.",
    {
      id: z.string().max(2048).describe("Pathway or reaction stable ID"),
    },
    async ({ id }) => {
      try {
        const sbgn = await contentClient.getText(`/exporter/event/${encodeURIComponent(id)}.sbgn`);

        // Truncate if too large
        const maxLength = 10000;
        const truncated = sbgn.length > maxLength;
        const content = truncated ? sbgn.substring(0, maxLength) + "\n... (truncated)" : sbgn;

        const lines = [
          `## SBGN Export for ${id}`,
          "",
          "```xml",
          content,
          "```",
        ];

        if (truncated) {
          lines.push("");
          lines.push(`*Output truncated. Full SBGN is ${sbgn.length} characters.*`);
          lines.push(`*Download full file: ${CONTENT_SERVICE_URL}/exporter/event/${encodeURIComponent(id)}.sbgn*`);
        }

        return {
          content: [{ type: "text", text: lines.join("\n") }],
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error exporting SBGN: ${error instanceof Error ? error.message : String(error)}\n\nDirect download URL: ${CONTENT_SERVICE_URL}/exporter/event/${encodeURIComponent(id)}.sbgn`
          }],
        };
      }
    }
  );

  // Export to SBML
  server.tool(
    "reactome_export_sbml",
    "Export a pathway or reaction to SBML (Systems Biology Markup Language) format.",
    {
      id: z.string().max(2048).describe("Pathway or reaction stable ID"),
    },
    async ({ id }) => {
      const url = `${CONTENT_SERVICE_URL}/exporter/event/${encodeURIComponent(id)}.sbml`;

      const lines = [
        `## SBML Export for ${id}`,
        "",
        `SBML files can be large. Download directly from:`,
        url,
        "",
        `SBML is suitable for import into systems biology modeling tools like COPASI, CellDesigner, or libSBML.`,
      ];

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );

  // Export event to PDF
  server.tool(
    "reactome_export_pdf",
    "Export pathway or reaction documentation to PDF format.",
    {
      id: z.string().max(2048).describe("Pathway or reaction stable ID"),
    },
    async ({ id }) => {
      const url = `${CONTENT_SERVICE_URL}/exporter/document/event/${encodeURIComponent(id)}.pdf`;

      const lines = [
        `## PDF Export for ${id}`,
        "",
        `**Download URL:**`,
        url,
        "",
        `This PDF includes pathway description, participants, reactions, and literature references.`,
      ];

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );

  // Export analysis report
  server.tool(
    "reactome_export_analysis_report",
    "Generate a PDF report for an analysis result.",
    {
      token: z.string().max(2048).describe("Analysis token"),
      species: z.string().max(2048).optional().default("Homo sapiens").describe("Species for the report"),
      num_pathways: z.number().optional().default(25).describe("Number of top pathways to include"),
      resource: z.string().max(2048).optional().default("TOTAL").describe("Resource filter"),
    },
    async ({ token, species, num_pathways, resource }) => {
      const speciesParam = species.replace(/\s+/g, "_");
      const url = `${ANALYSIS_SERVICE_URL}/report/${token}/${encodeURIComponent(speciesParam)}/report.pdf?number=${num_pathways}&resource=${resource}`;

      const lines = [
        `## Analysis Report`,
        `**Token:** ${token}`,
        `**Species:** ${species}`,
        `**Top pathways:** ${num_pathways}`,
        "",
        `**Download URL:**`,
        url,
      ];

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );

  // Download analysis results as CSV
  server.tool(
    "reactome_export_analysis_csv",
    "Export analysis results as CSV files.",
    {
      token: z.string().max(2048).describe("Analysis token"),
      type: z.enum(["pathways", "found_entities", "not_found"]).describe("Type of data to export"),
      resource: z.string().max(2048).optional().default("TOTAL").describe("Resource filter (for pathways and found_entities)"),
    },
    async ({ token, type, resource }) => {
      let url: string;
      let description: string;

      switch (type) {
        case "pathways":
          url = `${ANALYSIS_SERVICE_URL}/download/${token}/pathways/${resource}/result.csv`;
          description = "Pathway analysis results with statistics";
          break;
        case "found_entities":
          url = `${ANALYSIS_SERVICE_URL}/download/${token}/entities/found/${resource}/found.csv`;
          description = "Identifiers that were mapped to Reactome";
          break;
        case "not_found":
          url = `${ANALYSIS_SERVICE_URL}/download/${token}/entities/notfound/notfound.csv`;
          description = "Identifiers that could not be mapped";
          break;
      }

      const lines = [
        `## Analysis CSV Export`,
        `**Token:** ${token}`,
        `**Type:** ${type}`,
        `**Description:** ${description}`,
        "",
        `**Download URL:**`,
        url,
      ];

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );

  // Download full analysis result as JSON
  server.tool(
    "reactome_export_analysis_json",
    "Export complete analysis result as JSON.",
    {
      token: z.string().max(2048).describe("Analysis token"),
      compressed: z.boolean().optional().default(false).describe("Return gzipped JSON"),
    },
    async ({ token, compressed }) => {
      const ext = compressed ? "json.gz" : "json";
      const url = `${ANALYSIS_SERVICE_URL}/download/${token}/result.${ext}`;

      const lines = [
        `## Analysis JSON Export`,
        `**Token:** ${token}`,
        `**Compressed:** ${compressed ? "Yes (gzip)" : "No"}`,
        "",
        `**Download URL:**`,
        url,
      ];

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );
}
