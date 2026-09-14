import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { gsaClient } from "../clients/gsa.js";
import { nonEmptyString } from "../schemas.js";

/**
 * ReactomeGSA — gene set analysis.
 *
 * These exist because of a real failure: asked to "run a GSEA with my list of
 * genes", a Reactome chatbot answered that Reactome could not do that and
 * offered fgsea, bigomics and a YouTube tutorial. Reactome does do it, at
 * gsa.reactome.org, through this service. Nothing could reach it.
 *
 * The tool descriptions below carry the distinction that caused the confusion,
 * because the description is the only part of this a model reads before
 * choosing:
 *
 *   over-representation   a LIST of identifiers      reactome_analyze_identifiers
 *   gene set analysis     an EXPRESSION MATRIX       here
 *
 * A user with only a gene list wants over-representation, whatever they call
 * it. GSEA needs measurements per gene per sample and a grouping to compare.
 *
 * Submitting an analysis is deliberately not here: /analysis wants the whole
 * expression matrix inline, which is neither something a chat user can paste
 * nor something to push through a tool result. These tools tell the model what
 * the service offers, help it find a public dataset, and let it explain how to
 * run one.
 */

/** GET /methods — verified 2026-09-14. */
interface GsaMethod {
  name: string;
  description?: string;
  data_types?: string[];
  parameters?: GsaParameter[];
}

interface GsaParameter {
  name: string;
  display_name?: string;
  type?: string;
  default?: string;
  description?: string;
  scope?: string;
}

/** GET /types — verified 2026-09-14. */
interface GsaDataType {
  id: string;
  name?: string;
  description?: string;
}

/** GET /data/examples — verified 2026-09-14. */
interface GsaExample {
  id: string;
  title?: string;
  description?: string;
  type?: string;
  group?: string;
}

/** GET /data/sources — verified 2026-09-14. */
interface GsaSource {
  id: string;
  name?: string;
  description?: string;
}

/** GET /data/search — verified 2026-09-14. */
interface GsaSearchResult {
  id: string;
  title?: string;
  description?: string;
  species?: string;
  resource_name?: string;
  resource_loading_id?: string;
  web_link?: string;
}

const HOW_TO_RUN =
  "To actually run one: the web interface at https://reactome.org/gsa/, or the " +
  "Galaxy tool (reactome/reactome_galaxy), or the ReactomeGSA R package. All of " +
  "them take the expression matrix as a file.";

export function registerGsaTools(server: McpServer) {
  server.tool(
    "reactome_gsa_methods",
    "List the gene set analysis methods Reactome offers (PADOG, Camera, ssGSEA, terapadog) " +
      "through ReactomeGSA. Use when asked about GSEA, GSA, gene set analysis, or a named " +
      "method. NOTE: gene set analysis needs an expression matrix with sample groups. If the " +
      "user has only a list of gene or protein names, they want reactome_analyze_identifiers " +
      "(over-representation) instead, whatever they called it.",
    {},
    async () => {
      const methods = await gsaClient.get<GsaMethod[]>("/methods");
      const list = Array.isArray(methods) ? methods : [];

      const lines = [
        "## Reactome gene set analysis methods",
        "",
        "Provided by **ReactomeGSA** (https://reactome.org/gsa/), which is a different",
        "service from Reactome's over-representation analysis.",
        "",
      ];

      for (const method of list) {
        lines.push(`### ${method.name}`);
        if (method.description) lines.push(method.description);
        if (method.data_types?.length) {
          lines.push(`**Accepts:** ${method.data_types.join(", ")}`);
        }
        // Parameter names only. Ten parameters each with a paragraph of prose
        // is most of a context window spent before the question is answered.
        const names = (method.parameters ?? []).map(p => p.name);
        if (names.length > 0) {
          lines.push(`**Parameters:** ${names.join(", ")}`);
        }
        lines.push("");
      }

      if (list.length === 0) lines.push("*No methods reported by the service.*");
      else lines.push(HOW_TO_RUN);

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  server.tool(
    "reactome_gsa_data_types",
    "List the kinds of experimental data ReactomeGSA can analyse (RNA-seq counts, " +
      "normalised RNA-seq, proteomics, microarray, Ribo-seq). Use to tell a user whether " +
      "their data is supported.",
    {},
    async () => {
      const types = await gsaClient.get<GsaDataType[]>("/types");
      const list = Array.isArray(types) ? types : [];

      const lines = [
        "## Data types ReactomeGSA accepts",
        "",
        "| id | name | description |",
        "| --- | --- | --- |",
        ...list.map(
          t => `| \`${t.id}\` | ${t.name ?? ""} | ${(t.description ?? "").replace(/\|/g, "\\|")} |`
        ),
      ];

      if (list.length === 0) lines.push("*No data types reported by the service.*");
      else {
        lines.push(
          "",
          "Every one of these is an expression matrix: genes as rows, samples as",
          "columns, plus a grouping that says which samples to compare. A bare list",
          "of gene names is not any of them — that is over-representation analysis,",
          "`reactome_analyze_identifiers`."
        );
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  server.tool(
    "reactome_gsa_search_datasets",
    "Search public expression datasets ReactomeGSA can load and analyse without the user " +
      "uploading anything — Expression Atlas, Single Cell Expression Atlas, GREIN and GEO. " +
      "Use when a user wants a gene set analysis but has no data of their own, or asks " +
      "whether a published dataset is available.",
    {
      keywords: nonEmptyString.describe("Space-delimited search terms, e.g. 'melanoma RNA-seq'"),
      species: nonEmptyString
        .optional()
        .describe(
          "Species NAME, e.g. 'Homo sapiens'. This service wants the name; a taxonomy " +
            "id such as 9606 silently returns zero results."
        ),
      limit: nonEmptyString
        .optional()
        .describe("How many results to show (default 15; the service returns up to 100)"),
    },
    async ({ keywords, species, limit }) => {
      const results = await gsaClient.get<GsaSearchResult[]>("/data/search", {
        keywords,
        species,
      });
      const list = Array.isArray(results) ? results : [];
      const max = Number(limit) > 0 ? Number(limit) : 15;

      const lines = [
        `## Public datasets matching "${keywords}"${species ? ` in ${species}` : ""}`,
        `**Found:** ${list.length}`,
        "",
      ];

      if (list.length === 0) {
        lines.push(
          "*No datasets found.*",
          "",
          "If a species filter was used, check it is a name such as 'Homo sapiens'",
          "rather than a taxonomy id — this service returns nothing for an id."
        );
      } else {
        for (const result of list.slice(0, max)) {
          lines.push(`### ${result.title ?? result.id}`);
          lines.push(
            `**ID:** ${result.id}` +
              (result.species ? ` · **Species:** ${result.species}` : "") +
              (result.resource_name ? ` · **Source:** ${result.resource_name}` : "")
          );
          if (result.description) lines.push(result.description.slice(0, 300));
          if (result.web_link) lines.push(`<${result.web_link}>`);
          lines.push("");
        }
        if (list.length > max) {
          lines.push(`... and ${list.length - max} more. Narrow the keywords to see others.`);
        }
        lines.push("", HOW_TO_RUN);
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  server.tool(
    "reactome_gsa_examples",
    "List ReactomeGSA's built-in example datasets. Use to show someone a gene set analysis " +
      "they can try immediately without data of their own.",
    {},
    async () => {
      const examples = await gsaClient.get<GsaExample[]>("/data/examples");
      const list = Array.isArray(examples) ? examples : [];

      const lines = ["## ReactomeGSA example datasets", ""];
      for (const example of list) {
        lines.push(
          `- **${example.title ?? example.id}** (\`${example.id}\`, ${example.type ?? "?"})`
        );
        if (example.description) lines.push(`  ${example.description.slice(0, 200)}`);
      }

      if (list.length === 0) lines.push("*No examples reported by the service.*");
      else lines.push("", HOW_TO_RUN);

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  server.tool(
    "reactome_gsa_sources",
    "List the public data repositories ReactomeGSA can pull expression data from.",
    {},
    async () => {
      const sources = await gsaClient.get<GsaSource[]>("/data/sources");
      const list = Array.isArray(sources) ? sources : [];

      const lines = [
        "## Where ReactomeGSA can load data from",
        "",
        ...list.map(
          s => `- **${s.name ?? s.id}** (\`${s.id}\`)${s.description ? ` — ${s.description}` : ""}`
        ),
      ];

      if (list.length === 0) lines.push("*No sources reported by the service.*");
      else {
        lines.push(
          "",
          "Search them with `reactome_gsa_search_datasets`, so a user with no data of",
          "their own can still have an analysis run on a published dataset."
        );
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );
}
