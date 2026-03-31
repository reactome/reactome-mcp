"""
mock_adapter.py
---------------
Simulates the Reactome MCP tools by name.

In a real deployment this module would be replaced (or augmented) by a thin
client that sends JSON-RPC requests to the running MCP server over stdio/SSE.
Tool names here intentionally mirror those registered in src/tools/ so the
executor can call them without modification once the real adapter is wired in.

Tools simulated
---------------
  reactome_search              – full-text search
  reactome_analyze_identifiers – pathway enrichment for a gene list
  reactome_get_pathway         – pathway/event detail by stable ID
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Simulated tool implementations
# ---------------------------------------------------------------------------

def reactome_search(query: str) -> dict:
    """
    Simulate the Reactome full-text search tool.

    In the real MCP this calls the Reactome Search Service REST API.
    Returns a stable ID (stId) and basic metadata for the top hit.
    """
    gene = query.strip().upper()
    catalogue = {
        "TP53":  {"stId": "R-HSA-5633007",  "name": "TP53 Regulates Transcription of Genes Involved in G1 Cell Cycle Arrest", "type": "Pathway"},
        "BRCA1": {"stId": "R-HSA-5685942",  "name": "HDR through MMEJ (alt-NHEJ)", "type": "Pathway"},
        "BCL2":  {"stId": "R-HSA-199420",   "name": "BCL2 [cytosol]",               "type": "Protein"},
        "EGFR":  {"stId": "R-HSA-177929",   "name": "Signaling by EGFR",            "type": "Pathway"},
        "PTEN":  {"stId": "R-HSA-6796648",  "name": "TP53 Regulates Transcription of Genes Involved in G2 Cell Cycle Arrest", "type": "Pathway"},
    }
    return catalogue.get(gene, {"stId": "R-HSA-UNKNOWN", "name": f"Unknown Entity ({query})", "type": "Unknown"})


def reactome_analyze_identifiers(gene: str) -> dict:
    """
    Simulate the Reactome Analysis Service identifier-mapping tool.

    In the real MCP this submits a POST to the Analysis Service and returns
    over-representation results (p-values, FDR, found/not-found identifiers).
    """
    gene = gene.strip().upper()
    pathway_map = {
        "TP53":  ["Apoptosis", "Cell Cycle Arrest", "DNA Repair", "p53-Dependent G1/S DNA damage checkpoint"],
        "BRCA1": ["DNA Repair", "Homologous Recombination", "Cell Cycle", "Fanconi Anemia Pathway"],
        "BCL2":  ["Intrinsic Pathway for Apoptosis", "Programmed Cell Death", "BCL-2 family proteins"],
        "EGFR":  ["Signaling by EGFR", "PI3K/AKT Signaling", "MAPK Cascade", "RAS Signaling"],
        "PTEN":  ["PI3K/AKT Signaling", "Cellular Senescence", "DNA Damage Response"],
    }
    pathways = pathway_map.get(gene, ["General Signaling", "Metabolism"])
    return {"gene": gene, "pathways": pathways, "token": f"mock-token-{gene.lower()}"}


def reactome_get_pathway(stId: str) -> dict:
    """
    Simulate the Reactome Content Service pathway-detail tool.

    In the real MCP this calls /data/query/{id} and returns full event metadata.
    """
    pathway_db = {
        "R-HSA-5633007": {"stId": "R-HSA-5633007", "name": "TP53 Regulates Transcription of G1 Arrest Genes", "species": "Homo sapiens", "type": "Pathway"},
        "R-HSA-5685942": {"stId": "R-HSA-5685942", "name": "HDR through MMEJ",                                 "species": "Homo sapiens", "type": "Pathway"},
        "R-HSA-199420":  {"stId": "R-HSA-199420",  "name": "Intrinsic Pathway of Apoptosis",                   "species": "Homo sapiens", "type": "Pathway"},
        "R-HSA-177929":  {"stId": "R-HSA-177929",  "name": "Signaling by EGFR",                                "species": "Homo sapiens", "type": "Pathway"},
        "R-HSA-6796648": {"stId": "R-HSA-6796648", "name": "TP53 Regulates G2/S DNA Damage Checkpoint Genes",  "species": "Homo sapiens", "type": "Pathway"},
    }
    return pathway_db.get(stId, {"stId": stId, "name": "Generic Pathway", "species": "Homo sapiens", "type": "Pathway"})


# ---------------------------------------------------------------------------
# Registry – maps tool name (string) → callable
# ---------------------------------------------------------------------------

TOOL_REGISTRY: dict[str, callable] = {
    "reactome_search":              reactome_search,
    "reactome_analyze_identifiers": reactome_analyze_identifiers,
    "reactome_get_pathway":         reactome_get_pathway,
}


def call_tool(name: str, input_value: str) -> dict:
    """
    Dispatch a tool call by name.

    Parameters
    ----------
    name:        MCP tool name (must match a key in TOOL_REGISTRY)
    input_value: Primary argument for the tool

    Returns
    -------
    dict with the tool result, or an error dict if the tool is unknown.
    """
    fn = TOOL_REGISTRY.get(name)
    if fn is None:
        return {"error": f"Unknown tool: '{name}'"}
    return fn(input_value)
