import { describe, it, expect } from "vitest";
import { capCypherRows } from "../src/tools/cypher.js";

describe("capCypherRows", () => {
  it("passes small rows through unchanged", () => {
    const rows = [{ a: 1 }, { b: 2 }, { c: 3 }];
    const { output, stats } = capCypherRows(rows, 100, 2000, 40000);
    expect(output).toEqual(rows);
    expect(stats).toEqual({
      rowCountTruncated: false,
      rowsWidthTruncated: 0,
      stoppedAtTotal: false,
    });
  });

  it("truncates row count when rows.length exceeds max_rows", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ i }));
    const { output, stats } = capCypherRows(rows, 3, 2000, 40000);
    expect(output).toHaveLength(3);
    expect(stats.rowCountTruncated).toBe(true);
  });

  it("replaces wide rows with a summary object", () => {
    const wide = { big: "x".repeat(3000) };
    const { output, stats } = capCypherRows([wide], 10, 500, 40000);
    expect(stats.rowsWidthTruncated).toBe(1);
    const entry = output[0] as Record<string, unknown>;
    expect(entry.__truncated).toBe(true);
    expect(entry.reason).toBe("row_too_large");
    expect(entry.keys).toEqual(["big"]);
    expect(entry.original_chars).toBeGreaterThan(3000);
  });

  it("stops accumulating rows when total char budget is exhausted", () => {
    const rows = Array.from({ length: 10 }, () => ({ payload: "y".repeat(100) }));
    const { output, stats } = capCypherRows(rows, 100, 2000, 300);
    expect(output.length).toBeLessThan(10);
    expect(stats.stoppedAtTotal).toBe(true);
  });

  it("reports both width and total-cap truncation together", () => {
    const rows = [
      { big: "z".repeat(3000) },
      { small: "ok" },
      { small: "ok" },
    ];
    const { stats } = capCypherRows(rows, 10, 500, 500);
    expect(stats.rowsWidthTruncated).toBeGreaterThan(0);
  });
});
