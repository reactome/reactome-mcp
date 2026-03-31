"""
executor.py
-----------
Executes the structured plan produced by the Planner.

Execution modes
---------------
sequential
    Steps run one after another.  A step's input may reference the output of
    a previous step using the notation  "$<step_id>.<field>".
    Example:  "$step1.stId"  resolves to the "stId" key of step1's result.

parallel
    All steps are dispatched concurrently using a thread pool, then results
    are collected in order.

single
    Convenience alias for a plan with exactly one step (runs sequentially).

none
    The plan contains no steps (usually an error from the planner).
"""

from __future__ import annotations
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

from real_adapter import call_tool


class Executor:
    """
    Runs a plan dict produced by Planner.generate_plan().

    Usage
    -----
    >>> executor = Executor()
    >>> result   = executor.run(plan)
    """

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def run(self, plan: dict) -> dict:
        """
        Execute *plan* and return a result dict.

        Parameters
        ----------
        plan : dict
            Output of Planner.generate_plan().

        Returns
        -------
        dict with keys:
            query       – original query string
            execution   – execution mode used
            steps       – list of {id, tool, input, result, duration_ms}
            total_ms    – total wall-clock time in milliseconds
        """
        mode  = plan.get("execution", "none")
        steps = plan.get("steps", [])
        query = plan.get("query", "")

        start = time.perf_counter()
        if mode in ("sequential", "single"):
            executed = self._run_sequential(steps)
        elif mode == "parallel":
            executed = self._run_parallel(steps)
        else:
            executed = []

        total_ms = round((time.perf_counter() - start) * 1000, 2)

        return {
            "query":     query,
            "execution": mode,
            "steps":     executed,
            "total_ms":  total_ms,
            "error":     plan.get("error"),
        }

    # ------------------------------------------------------------------
    # Execution strategies
    # ------------------------------------------------------------------

    def _run_sequential(self, steps: list[dict]) -> list[dict]:
        """Run steps one at a time; later steps may reference earlier results."""
        results: dict[str, dict] = {}   # step_id → result dict
        executed: list[dict] = []

        for step in steps:
            resolved_input = self._resolve_input(step["input"], results)
            step_result    = self._execute_step(step, resolved_input)
            results[step["id"]] = step_result["result"]
            executed.append(step_result)

        return executed

    def _run_parallel(self, steps: list[dict]) -> list[dict]:
        """Dispatch all steps concurrently; collect results in original order."""
        futures = {}
        executed_map: dict[str, dict] = {}

        with ThreadPoolExecutor(max_workers=min(len(steps), 8)) as pool:
            for step in steps:
                future = pool.submit(self._execute_step, step, step["input"])
                futures[future] = step["id"]

            for future in as_completed(futures):
                step_id = futures[future]
                executed_map[step_id] = future.result()

        # Return in original plan order
        return [executed_map[s["id"]] for s in steps]

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _execute_step(self, step: dict, resolved_input: str) -> dict:
        """Call the tool and capture timing."""
        t0     = time.perf_counter()
        result = call_tool(step["tool"], resolved_input)
        ms     = round((time.perf_counter() - t0) * 1000, 2)
        return {
            "id":          step["id"],
            "tool":        step["tool"],
            "input":       resolved_input,
            "result":      result,
            "duration_ms": ms,
        }

    def _resolve_input(self, input_value: str, results: dict[str, dict]) -> str:
        """
        Resolve step-reference tokens of the form  $<step_id>.<field>.

        Example
        -------
        input_value = "$step1.stId"
        results     = {"step1": {"stId": "R-HSA-199420", ...}}
        returns       "R-HSA-199420"

        If the reference cannot be resolved, the original token is returned
        unchanged so the error is visible in the output.
        """
        m = re.match(r"^\$(\w+)\.(\w+)$", str(input_value))
        if not m:
            return input_value          # plain string, no substitution needed

        step_id, field = m.groups()
        step_result    = results.get(step_id, {})
        return str(step_result.get(field, input_value))   # fallback to token


# ---------------------------------------------------------------------------
# Quick smoke-test
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import json
    from planner import Planner

    planner  = Planner()
    executor = Executor()

    for query in [
        "Compare TP53 and BRCA1",
        "Find apoptosis pathways for BCL2",
        "Analyse EGFR",
        "Search PTEN",
    ]:
        plan   = planner.generate_plan(query)
        result = executor.run(plan)
        print(f"\n{'='*60}")
        print(f"Query : {query}")
        print(json.dumps(result, indent=2))
