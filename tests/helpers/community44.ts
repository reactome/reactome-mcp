/**
 * A scripted database that answers the way the Reactome graph database
 * container does: Neo4j 4.4 Community, no APOC, Release 97 in its DBInfo
 * node. Hand it to a fake driver as `state.respond`.
 */

export const NO_PROCEDURE = (name: string) =>
  new Error(
    `There is no procedure with the name \`${name}\` registered for this database instance.`
  );

/**
 * Answers the way Neo4j 4.4 Community without APOC does. `overrides` replaces
 * the answer for any query containing its key.
 */
export function community44(
  overrides: Record<string, (params: Record<string, unknown>) => unknown[]> = {}
) {
  return (query: string, params: Record<string, unknown>): unknown[] => {
    for (const [needle, answer] of Object.entries(overrides)) {
      if (query.includes(needle)) return answer(params);
    }
    const apoc = /\b(apoc\.[\w.]+)/.exec(query);
    if (apoc?.[1]) throw NO_PROCEDURE(apoc[1]);

    if (query.includes("dbms.components"))
      return [{ name: "Neo4j Kernel", versions: ["4.4.40"], edition: "community" }];
    if (query.includes("DBInfo")) return [{ releaseNumber: 97 }];
    if (query.includes("db.info")) return [{ name: "neo4j" }];
    if (query.includes("db.propertyKeys"))
      return [{ propertyKey: "stId" }, { propertyKey: "dbId" }, { propertyKey: "stoichiometry" }];
    if (query.includes("db.labels")) return [{ label: "Pathway" }, { label: "Reaction" }];
    if (query.includes("db.relationshipTypes"))
      return [{ relationshipType: "hasEvent" }, { relationshipType: "input" }];
    if (query.includes("db.schema.nodeTypeProperties"))
      return [
        {
          nodeType: ":`Pathway`",
          nodeLabels: ["Pathway"],
          propertyName: "stId",
          propertyTypes: ["String"],
          mandatory: true,
        },
      ];
    if (query.includes("db.schema.relTypeProperties"))
      return [
        {
          relType: ":`input`",
          propertyName: "stoichiometry",
          propertyTypes: ["Long"],
          mandatory: true,
        },
      ];
    if (query.includes("db.schema.visualization"))
      return [
        {
          nodes: [
            { identity: -1, labels: ["Pathway"], properties: { name: "Pathway" } },
            { identity: -2, labels: ["Reaction"], properties: { name: "Reaction" } },
          ],
          relationships: [{ identity: -3, start: -1, end: -2, type: "hasEvent", properties: {} }],
        },
      ];
    if (query.includes("SHOW INDEXES"))
      return [
        {
          name: "index_pathway_stId",
          type: "BTREE",
          entityType: "NODE",
          labelsOrTypes: ["Pathway"],
          properties: ["stId"],
          state: "ONLINE",
        },
      ];
    if (query.includes("SHOW CONSTRAINTS"))
      return [
        {
          name: "constraint_dbId",
          type: "UNIQUENESS",
          entityType: "NODE",
          labelsOrTypes: ["DatabaseObject"],
          properties: ["dbId"],
        },
      ];
    // Per-token counts: one UNION ALL query each for labels and for
    // relationship types, keyed by parameter so the names need no escaping.
    if (query.includes("UNION ALL") || /RETURN \$\w+ AS key/.test(query)) {
      return Object.entries(params).map(([, key]) => ({
        key,
        count: key === "Pathway" ? 2_000 : key === "hasEvent" ? 9_000 : 500,
      }));
    }
    if (/MATCH \(n\) RETURN count\(n\)/.test(query)) return [{ count: 3_000_000 }];
    if (/MATCH \(\)-\[r\]->\(\) RETURN count\(r\)/.test(query)) return [{ count: 12_000_000 }];
    throw new Error(`unscripted query: ${query}`);
  };
}
