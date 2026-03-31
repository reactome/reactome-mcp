"""
real_adapter.py
---------------
Real implementation of Reactome MCP tools by calling Reactome REST APIs.
Uses only the Python standard library (urllib.request).

Tools implemented:
  reactome_search              – full-text search
  reactome_analyze_identifiers – pathway enrichment for a gene list
  reactome_get_pathway         – pathway/event detail by stable ID
"""

import json
import urllib.request
import urllib.parse
from typing import Any

CONTENT_SERVICE_BASE = "https://reactome.org/ContentService"
ANALYSIS_SERVICE_BASE = "https://reactome.org/AnalysisService"
USER_AGENT = "reactome-mcp-orchestrator/1.0"
TIMEOUT_SECONDS = 15

def _make_request(url: str, data: bytes | None = None, method: str = 'GET') -> dict[str, Any]:
    """Helper to perform requests with standard headers and timeout."""
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header('User-Agent', USER_AGENT)
    req.add_header('Accept', 'application/json')
    if data and method == 'POST':
        req.add_header('Content-Type', 'text/plain')
    
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as response:
            return json.loads(response.read().decode())
    except Exception as e:
        return {"error": f"Request failed: {str(e)}"}

def reactome_search(query: str) -> dict[str, Any]:
    """
    Search Reactome for a query string.
    Returns the top hit's stId, name, and type.
    """
    params = {
        "query": query,
        "cluster": "true",
        "rows": 10
    }
    url = f"{CONTENT_SERVICE_BASE}/search/query?{urllib.parse.urlencode(params)}"
    
    data = _make_request(url)
    if "error" in data: return data

    results = data.get("results", [])
    if not results:
        return {"stId": "UNKNOWN", "name": f"No results for {query}", "type": "Unknown"}
    
    # Find the first entry in the first cluster
    for group in results:
        if group.get("entries"):
            top = group["entries"][0]
            return {
                "stId": top.get("stId"),
                "name": top.get("name"),
                "type": top.get("exactType", "Unknown")
            }
    
    return {"stId": "UNKNOWN", "name": f"No entries for {query}", "type": "Unknown"}

def reactome_analyze_identifiers(gene: str) -> dict[str, Any]:
    """
    Perform pathway enrichment analysis for a single gene (or comma-separated list).
    Returns basic result summary and a token.
    """
    url = f"{ANALYSIS_SERVICE_BASE}/identifiers/projection?interactors=false&pageSize=20&sortBy=ENTITIES_PVALUE&order=ASC&resource=TOTAL"
    
    # POST body is text/plain with identifiers separated by newlines
    body = gene.replace(",", "\n").encode('utf-8')
    result = _make_request(url, data=body, method='POST')
    if "error" in result: return result

    pathways = [p["name"] for p in result.get("pathways", [])[:5]]
    return {
        "gene": gene,
        "pathways": pathways,
        "token": result.get("summary", {}).get("token"),
        "pathwaysFound": result.get("pathwaysFound", 0)
    }

def reactome_get_pathway(stId: str) -> dict[str, Any]:
    """
    Get details of a pathway or reaction by stable ID.
    """
    url = f"{CONTENT_SERVICE_BASE}/data/query/{stId}"
    
    data = _make_request(url)
    if "error" in data: return data

    return {
        "stId": data.get("stId"),
        "name": data.get("displayName"),
        "species": data.get("speciesName", "Homo sapiens"),
        "type": data.get("schemaClass", "Pathway")
    }

# ---------------------------------------------------------------------------
# Registry – maps tool name (string) → callable
# ---------------------------------------------------------------------------

TOOL_REGISTRY: dict[str, callable] = {
    "reactome_search":              reactome_search,
    "reactome_analyze_identifiers": reactome_analyze_identifiers,
    "reactome_get_pathway":         reactome_get_pathway,
}

def call_tool(name: str, input_value: str) -> dict[str, Any]:
    """
    Dispatch a tool call to the real API.
    """
    fn = TOOL_REGISTRY.get(name)
    if fn is None:
        return {"error": f"Unknown tool: '{name}'"}
    return fn(input_value)
