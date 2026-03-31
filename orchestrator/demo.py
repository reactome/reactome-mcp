"""
Real demonstration of the Reactome MCP Orchestration Layer calls.

Run from inside the orchestrator/ directory:

    python demo.py

Or from the repo root:

    python orchestrator/demo.py

What it does
------------
1. Creates a Planner and an Executor.
2. Runs four representative queries that cover every execution mode.
3. Prints a formatted summary of plans and results to stdout.

Network access is required – the real_adapter.py module calls the Reactome
REST APIs (Content and Analysis services) directly.
"""

from __future__ import annotations
import json
import sys
import os
import time

# ---------------------------------------------------------------------------
# Allow running from repo root without modifying PYTHONPATH
# ---------------------------------------------------------------------------
sys.path.insert(0, os.path.dirname(__file__))

from planner  import Planner
from executor import Executor


# ---------------------------------------------------------------------------
# Formatting helpers
# ---------------------------------------------------------------------------

DIVIDER      = "=" * 70
THIN_DIVIDER = "-" * 70

ANSI = {
    "reset":  "\033[0m",
    "bold":   "\033[1m",
    "cyan":   "\033[96m",
    "green":  "\033[92m",
    "yellow": "\033[93m",
    "red":    "\033[91m",
    "grey":   "\033[90m",
}

def c(color: str, text: str) -> str:
    """Wrap *text* in an ANSI colour code (skipped on non-TTY outputs)."""
    if not sys.stdout.isatty():
        return text
    return f"{ANSI.get(color, '')}{text}{ANSI['reset']}"


def print_plan(plan: dict) -> None:
    print(c("cyan", f"  Execution mode : {plan['execution']}"))
    if plan.get("error"):
        print(c("red", f"  Planner error  : {plan['error']}"))
        return
    for step in plan.get("steps", []):
        print(c("grey", f"    [{step['id']}]  {step['tool']}({step['input']!r})"))


def print_result(result: dict) -> None:
    if not result.get("steps"):
        print(c("red", "  No steps executed."))
        return
    for step in result["steps"]:
        status = c("green", "OK") if "error" not in step["result"] else c("red", "ERR")
        print(f"  [{status}] {step['id']} – {step['tool']}({step['input']!r})  "
              f"{c('grey', str(step['duration_ms']) + ' ms')}")
        print(f"        {json.dumps(step['result'])}")
    print(c("yellow", f"  Total : {result['total_ms']} ms"))


# ---------------------------------------------------------------------------
# Demo queries
# ---------------------------------------------------------------------------

DEMO_QUERIES = [
    # (label, query)
    ("Parallel — compare two genes",            "Compare TP53 and BRCA1"),
    ("Sequential — 3-step pathway chain",       "Find apoptosis pathways for BCL2"),
    ("Single step — enrichment analysis",       "Analyse EGFR"),
    ("Single step — free-text search",          "Search PTEN signaling"),
    ("Error handling — unrecognised query",     "Do something completely unknown"),
]


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    planner  = Planner()
    executor = Executor()

    print(f"\n{c('bold', DIVIDER)}")
    print(c("bold", "  Reactome MCP Orchestration Layer  --  Demo"))
    print(c("bold", DIVIDER))
    print(
        "  This demo runs the Planner -> Executor pipeline with REAL API calls.\n"
        "  Tool calls are handled by real_adapter.py which calls the Reactome\n"
        "  REST APIs directly, mirroring the production MCP server behavior.\n"
    )

    overall_start = time.perf_counter()

    for label, query in DEMO_QUERIES:
        print(f"\n{THIN_DIVIDER}")
        print(c("bold", f"  {label}"))
        print(f"  Query : {c('cyan', query)}")
        print()

        # --- Plan ---
        print(c("bold", "  [PLAN]"))
        plan = planner.generate_plan(query)
        print_plan(plan)
        print()

        # --- Execute ---
        print(c("bold", "  [RESULT]"))
        result = executor.run(plan)
        print_result(result)

    overall_ms = round((time.perf_counter() - overall_start) * 1000, 2)
    print(f"\n{DIVIDER}")
    print(c("green", f"  [OK]  All demo queries completed in {overall_ms} ms"))
    print(f"{DIVIDER}\n")


if __name__ == "__main__":
    main()
