import type { GraphSchema } from "./schema.js";

/** How many labels to name on each side of a relationship type. */
const LABELS_PER_SIDE = 4;

type Prop = { propertyName: string; propertyTypes: string[]; mandatory: boolean };

/** `stId String!` -- `!` marks a property every node of the set has. */
const propText = (p: Prop) =>
  `${p.propertyName} ${(p.propertyTypes ?? []).join("|") || "?"}${p.mandatory ? "!" : ""}`;

/**
 * Labels, most specific first, cut to a few.
 *
 * Reactome nodes carry their whole class hierarchy as labels -- a Pathway is
 * also an Event and a DatabaseObject -- so `db.schema.visualization()` lists a
 * relationship type once per pair of labels on its two ends: 749 pairs for one
 * type on the Release 97 graph. Rarer labels are the specific classes, so
 * sorting by node count puts the useful ones first.
 */
function labelList(labels: Set<string>, counts: Record<string, number>): string {
  const sorted = [...labels].sort(
    (a, b) => (counts[a] ?? Infinity) - (counts[b] ?? Infinity) || a.localeCompare(b)
  );
  const shown = sorted.slice(0, LABELS_PER_SIDE).join("|");
  return sorted.length > LABELS_PER_SIDE ? `${shown}|… +${sorted.length - LABELS_PER_SIDE}` : shown;
}

/**
 * Render a GraphSchema as a compact markdown digest for a model to read before
 * writing Cypher: labels and relationship types by count, which labels each
 * type connects, property types, indexes and constraints. The full structure
 * is the `reactome://graph/schema` resource.
 *
 * Sized for the tool response cap. Rendered naively, the Release 97 graph came
 * to 87,000 characters -- more than twice the cap, so the cap would have cut
 * it mid-way and dropped the indexes and constraints. The shape below came to
 * 34,341 characters against the same graph, inside the default 40,000 cap:
 * properties common to every label set are listed once, relationship types
 * with the same properties share a line, and each type's endpoints are
 * summarised as label sets rather than enumerated pair by pair. A much larger
 * graph could still reach the cap, which announces its cut.
 *
 * Sections the database would not give up are named under "Unavailable"
 * rather than left out, so a missing property list is not read as an empty
 * one.
 */
export function formatGraphSchemaMarkdown(schema: GraphSchema): string {
  const { stats, nodeTypeProperties, relTypeProperties, indexes, constraints, patterns } = schema;

  const labelEntries = Object.entries(stats.labels).sort(([, a], [, b]) => b - a);
  const relEntries = Object.entries(stats.relTypesCount).sort(([, a], [, b]) => b - a);

  const lines: string[] = [];
  lines.push(`## Reactome Graph Schema`);
  const dbComp = schema.dbComponents[0];
  lines.push(
    `**Neo4j:** ${dbComp?.versions?.[0] ?? "?"} ${dbComp?.edition ?? ""} · **Fetched:** ${schema.fetchedAt}`
  );
  lines.push(
    `**Totals:** ${stats.nodeCount.toLocaleString()} nodes · ${stats.relCount.toLocaleString()} relationships · ${labelEntries.length} labels · ${relEntries.length} relationship types`
  );
  lines.push("");

  if (schema.unavailable.length > 0) {
    lines.push(`### Unavailable (${schema.unavailable.length})`);
    lines.push("These sections could not be read; do not assume they are empty.");
    for (const u of schema.unavailable) lines.push(`- \`${u.section}\` — ${u.reason}`);
    lines.push("");
  }

  lines.push(`### Labels (${labelEntries.length}, by node count)`);
  lines.push(
    labelEntries.map(([label, count]) => `\`${label}\` ${count.toLocaleString()}`).join(" · ")
  );
  lines.push("");

  // Endpoints per relationship type.
  const ends = new Map<string, { start: Set<string>; end: Set<string> }>();
  for (const p of patterns) {
    const entry = ends.get(p.type) ?? { start: new Set<string>(), end: new Set<string>() };
    entry.start.add(p.start);
    entry.end.add(p.end);
    ends.set(p.type, entry);
  }

  lines.push(`### Relationship types (${relEntries.length}, by relationship count)`);
  if (ends.size > 0) {
    lines.push("Each with the labels seen at its start and end, most specific first.");
  }
  const relTypes = new Set([...relEntries.map(([t]) => t), ...ends.keys()]);
  for (const relType of relTypes) {
    const count = stats.relTypesCount[relType];
    const side = ends.get(relType);
    const shape = side
      ? ` — (:${labelList(side.start, stats.labels)})-[:${relType}]->(:${labelList(side.end, stats.labels)})`
      : "";
    lines.push(`- \`${relType}\` ${count === undefined ? "" : count.toLocaleString()}${shape}`);
  }
  lines.push("");

  // Node properties by label set, with what every set shares listed once.
  const bySet = new Map<string, { labels: string[]; props: Prop[] }>();
  for (const p of nodeTypeProperties) {
    const key = p.nodeType;
    const entry = bySet.get(key) ?? { labels: p.nodeLabels ?? [], props: [] };
    if (p.propertyName != null) entry.props.push(p);
    bySet.set(key, entry);
  }
  if (bySet.size > 0) {
    const sets = [...bySet.values()];
    const signature = (p: Prop) => propText(p);
    const shared = (sets[0]?.props ?? [])
      .map(signature)
      .filter(sig => sets.every(s => s.props.some(p => signature(p) === sig)));
    const sharedSet = new Set(shared);
    const everywhereLabels = (sets[0]?.labels ?? []).filter(l =>
      sets.every(s => s.labels.includes(l))
    );

    lines.push(`### Node properties (${bySet.size} label sets)`);
    lines.push("`!` marks a property every node of that set has.");
    if (shared.length > 0) lines.push(`**On every label set:** ${shared.join(", ")}`);
    if (everywhereLabels.length > 0) {
      lines.push(`**Labels on every node, omitted below:** ${everywhereLabels.join(", ")}`);
    }
    const rows = sets
      .map(s => ({
        name: s.labels.filter(l => !everywhereLabels.includes(l)).join(":") || "(none)",
        extra: s.props.map(signature).filter(sig => !sharedSet.has(sig)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const row of rows) {
      lines.push(`- **${row.name}**${row.extra.length ? `: ${row.extra.join(", ")}` : ""}`);
    }
    lines.push("");
  }

  // Relationship properties, grouped by identical property lists.
  if (relTypeProperties.length > 0) {
    const propsByRel = new Map<string, string[]>();
    for (const p of relTypeProperties) {
      const entry = propsByRel.get(p.relType) ?? [];
      entry.push(propText(p));
      propsByRel.set(p.relType, entry);
    }
    const bySignature = new Map<string, string[]>();
    for (const [rel, props] of propsByRel) {
      const sig = [...props].sort().join(", ");
      bySignature.set(sig, [...(bySignature.get(sig) ?? []), rel]);
    }
    lines.push(`### Relationship properties`);
    for (const [sig, rels] of [...bySignature].sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`- ${sig} — on ${rels.sort().join(", ")}`);
    }
    lines.push("");
  }

  if (indexes.length > 0) {
    lines.push(`### Indexes (${indexes.length})`);
    for (const ix of indexes) {
      const labels = ix.labelsOrTypes?.join(",") ?? "?";
      const props = ix.properties?.join(",") ?? "?";
      lines.push(`- ${labels}(${props}) [${ix.type ?? "?"}, ${ix.state ?? "?"}]`);
    }
    lines.push("");
  }

  if (constraints.length > 0) {
    lines.push(`### Constraints (${constraints.length})`);
    for (const c of constraints) {
      const what =
        c.description ??
        `${c.type ?? "?"} on ${c.labelsOrTypes?.join(",") ?? "?"}(${c.properties?.join(",") ?? "?"})`;
      lines.push(`- ${what}`);
    }
    lines.push("");
  }

  lines.push(
    "_For the full structure as JSON, including every label pair each relationship type connects, read the `reactome://graph/schema` resource._"
  );

  return lines.join("\n");
}
