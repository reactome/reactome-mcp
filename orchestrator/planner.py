"""
planner.py
----------
Converts a natural-language biological query into a structured JSON execution
plan that the Executor understands.

In a real system the generate_plan() method would be implemented by an LLM
(e.g. GPT-4 / Claude 3.5 Sonnet) that has been given the list of available
MCP tool descriptions. Here we use deterministic regex-based pattern matching
so the demo runs fully offline without any API keys.

Supported query patterns
------------------------
1.  "Compare <GENE_A> and <GENE_B>"
    → parallel analysis of both genes with reactome_analyze_identifiers

2.  "Find <keyword> pathways for <GENE>"
    → sequential chain:
        step1 – reactome_search (find the entity stId)
        step2 – reactome_analyze_identifiers (enrich the gene)
        step3 – reactome_get_pathway (detail on the stId from step1)

3.  "Analyse <GENE>" / "Analyze <GENE>"
    → single-step enrichment analysis

4.  "Search <query>"
    → single-step full-text search

Any unrecognised query returns an empty plan with a descriptive error.
"""

from __future__ import annotations
import json
import re


class Planner:
    """
    Rule-based query planner.

    Produces a plan dict with two keys:
      steps     – list of step dicts (id, tool, input)
      execution – "parallel" | "sequential" | "single" | "none"
    """

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def generate_plan(self, query: str) -> dict:
        """
        Convert *query* into a structured execution plan.

        Parameters
        ----------
        query : str
            Free-text biological query from a user or upstream LLM.

        Returns
        -------
        dict
            {
              "query":     <original query>,
              "steps":     [ {id, tool, input}, … ],
              "execution": "parallel" | "sequential" | "single" | "none"
            }
        """
        query = query.strip()

        plan = (
            self._plan_compare(query)
            or self._plan_find_pathways(query)
            or self._plan_analyse(query)
            or self._plan_search(query)
            or self._plan_fallback(query)
        )

        plan["query"] = query
        return plan

    # ------------------------------------------------------------------
    # Pattern handlers (return None if the pattern does not match)
    # ------------------------------------------------------------------

    def _plan_compare(self, query: str) -> dict | None:
        """'Compare GENE_A and GENE_B' → parallel enrichment analysis."""
        m = re.match(r"compare\s+(\w+)\s+and\s+(\w+)", query, re.I)
        if not m:
            return None
        gene1, gene2 = m.groups()
        return {
            "steps": [
                {"id": "step1", "tool": "reactome_analyze_identifiers", "input": gene1},
                {"id": "step2", "tool": "reactome_analyze_identifiers", "input": gene2},
            ],
            "execution": "parallel",
        }

    def _plan_find_pathways(self, query: str) -> dict | None:
        """'Find <keyword> pathways for <GENE>' → 3-step sequential chain."""
        m = re.match(r"find\s+(\w+)\s+pathways?\s+for\s+(\w+)", query, re.I)
        if not m:
            return None
        _, gene = m.groups()
        return {
            "steps": [
                # Step 1: locate entity, capture stId for step 3
                {"id": "step1", "tool": "reactome_search",              "input": gene},
                # Step 2: full pathway enrichment for the gene
                {"id": "step2", "tool": "reactome_analyze_identifiers", "input": gene},
                # Step 3: detailed metadata for the stId returned by step 1
                {"id": "step3", "tool": "reactome_get_pathway",         "input": "$step1.stId"},
            ],
            "execution": "sequential",
        }

    def _plan_analyse(self, query: str) -> dict | None:
        """'Analyse/Analyze <GENE>' → single enrichment step."""
        m = re.match(r"analy[sz]e\s+(\w+)", query, re.I)
        if not m:
            return None
        (gene,) = m.groups()
        return {
            "steps": [
                {"id": "step1", "tool": "reactome_analyze_identifiers", "input": gene},
            ],
            "execution": "single",
        }

    def _plan_search(self, query: str) -> dict | None:
        """'Search <query>' → single search step."""
        m = re.match(r"search\s+(.+)", query, re.I)
        if not m:
            return None
        (search_query,) = m.groups()
        return {
            "steps": [
                {"id": "step1", "tool": "reactome_search", "input": search_query},
            ],
            "execution": "single",
        }

    def _plan_fallback(self, query: str) -> dict:
        return {
            "steps": [],
            "execution": "none",
            "error": (
                "No plan could be generated for this query. "
                "Try: 'Compare GENE_A and GENE_B', "
                "'Find <keyword> pathways for GENE', "
                "'Analyse GENE', or 'Search <query>'."
            ),
        }


# ---------------------------------------------------------------------------
# Quick smoke-test
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    planner = Planner()
    test_queries = [
        "Compare TP53 and BRCA1",
        "Find apoptosis pathways for BCL2",
        "Analyse EGFR",
        "Search PTEN signaling",
        "Do something weird",
    ]
    for q in test_queries:
        print(f"\nQuery: {q}")
        print(json.dumps(planner.generate_plan(q), indent=2))
