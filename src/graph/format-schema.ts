import type { GraphSchema } from "./schema.js";

/**
 * Render a GraphSchema (as produced by fetchGraphSchema) as a compact
 * markdown summary suitable for direct LLM consumption. The raw APOC
 * payload is ~500 KB — much too large to return whole. This digest keeps
 * the signal (labels with counts, relationship cardinalities, property
 * types with mandatory flags, indexes, constraints) and drops the
 * verbose apoc.meta.schema() object. Clients that need the full
 * structure can read the `reactome://graph/schema` resource.
 */
export function formatGraphSchemaMarkdown(schema: GraphSchema): string {
  const { stats, nodeTypeProperties, relTypeProperties, indexes, constraints } = schema;

  const labelEntries = Object.entries(stats.labels ?? {}).sort(([, a], [, b]) => b - a);
  const relEntries = Object.entries(stats.relTypesCount ?? {}).sort(([, a], [, b]) => b - a);

  const propsByLabel = new Map<string, Array<{ name: string; types: string[]; mandatory: boolean }>>();
  for (const p of nodeTypeProperties) {
    const key = (p.nodeLabels?.join(":") || p.nodeType) ?? p.nodeType;
    const entry = propsByLabel.get(key) ?? [];
    entry.push({ name: p.propertyName, types: p.propertyTypes ?? [], mandatory: p.mandatory });
    propsByLabel.set(key, entry);
  }

  const propsByRel = new Map<string, Array<{ name: string; types: string[]; mandatory: boolean }>>();
  for (const p of relTypeProperties) {
    const entry = propsByRel.get(p.relType) ?? [];
    entry.push({ name: p.propertyName, types: p.propertyTypes ?? [], mandatory: p.mandatory });
    propsByRel.set(p.relType, entry);
  }

  const lines: string[] = [];
  lines.push(`## Reactome Graph Schema`);
  const dbComp = schema.dbComponents[0];
  lines.push(
    `**Neo4j:** ${dbComp?.versions?.[0] ?? "?"} ${dbComp?.edition ?? ""} · **Fetched:** ${schema.fetchedAt}`
  );
  lines.push(
    `**Totals:** ${stats.nodeCount.toLocaleString()} nodes · ${stats.relCount.toLocaleString()} relationships · ${labelEntries.length} labels · ${Object.keys(stats.relTypes ?? {}).length} relationship types`
  );
  lines.push("");

  lines.push(`### Labels (${labelEntries.length}, by node count)`);
  for (const [label, count] of labelEntries) {
    lines.push(`- \`${label}\` — ${count.toLocaleString()}`);
  }
  lines.push("");

  lines.push(`### Relationship types (${relEntries.length}, by relationship count)`);
  for (const [relType, count] of relEntries) {
    lines.push(`- \`${relType}\` — ${count.toLocaleString()}`);
  }
  lines.push("");

  lines.push(`### Node properties (by label)`);
  const sortedLabels = Array.from(propsByLabel.keys()).sort();
  for (const label of sortedLabels) {
    lines.push(`- **${label}**`);
    for (const p of propsByLabel.get(label)!) {
      const t = p.types.length ? ` _(${p.types.join("|")})_` : "";
      const m = p.mandatory ? " **required**" : "";
      lines.push(`  - \`${p.name}\`${t}${m}`);
    }
  }
  lines.push("");

  if (propsByRel.size > 0) {
    lines.push(`### Relationship properties (by type)`);
    const sortedRels = Array.from(propsByRel.keys()).sort();
    for (const rel of sortedRels) {
      const props = propsByRel.get(rel)!;
      if (props.length === 0) continue;
      lines.push(`- **${rel}**`);
      for (const p of props) {
        const t = p.types.length ? ` _(${p.types.join("|")})_` : "";
        const m = p.mandatory ? " **required**" : "";
        lines.push(`  - \`${p.name}\`${t}${m}`);
      }
    }
    lines.push("");
  }

  if (indexes.length > 0) {
    lines.push(`### Indexes (${indexes.length})`);
    for (const ix of indexes) {
      const row = ix as { name?: string; labelsOrTypes?: string[]; properties?: string[]; type?: string; state?: string };
      const labels = row.labelsOrTypes?.join(",") ?? "?";
      const props = row.properties?.join(",") ?? "?";
      lines.push(`- \`${row.name ?? "?"}\` — ${labels}(${props}) [${row.type ?? "?"}, ${row.state ?? "?"}]`);
    }
    lines.push("");
  }

  if (constraints.length > 0) {
    lines.push(`### Constraints (${constraints.length})`);
    for (const c of constraints) {
      const row = c as { name?: string; description?: string };
      lines.push(`- \`${row.name ?? "?"}\` — ${row.description ?? ""}`);
    }
    lines.push("");
  }

  lines.push(
    "_For programmatic access to the full schema (including the raw `apoc.meta.schema()` output with per-relationship cardinalities and full property type inventories), read the `reactome://graph/schema` resource._"
  );

  return lines.join("\n");
}
