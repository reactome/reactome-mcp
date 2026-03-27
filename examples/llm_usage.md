# Using Reactome MCP with LLMs

This document demonstrates how Reactome MCP tools can be used within LLM-based workflows, such as agent systems and retrieval-augmented pipelines.

The goal is to illustrate how natural language queries can be mapped to MCP tool calls and how results can be composed into structured responses.

---

## Example 1: Pathway Search

**User query:**
What pathways are related to cancer?

**LLM Action:**

- Select tool: `search_pathways`
- Input: `"cancer"`

**Expected Result:**

- List of pathways related to cancer
- Pathway identifiers
- Descriptions and summaries

**LLM Response (example):**
The following pathways are associated with cancer:

- Pathway A — Description...
- Pathway B — Description...

---

## Example 2: Gene to Pathway Mapping

**User query:**
Which pathways involve TP53?

**LLM Action:**

- Select tool: `get_pathways_by_gene`
- Input: `"TP53"`

**Expected Result:**

- Pathways involving TP53
- Associated biological processes

**LLM Response (example):**
TP53 is involved in pathways related to cell cycle regulation, apoptosis, and DNA damage response.

---

## Example 3: Multi-step Reasoning

**User query:**
Compare pathways involved in cancer and apoptosis.

**LLM Steps:**

1. Call `search_pathways("cancer")`
2. Call `search_pathways("apoptosis")`
3. Aggregate and compare results

**LLM Response (example):**
Cancer and apoptosis share overlapping pathways such as those related to cell survival and programmed cell death.

---

## Example 4: LangChain Integration

Below is a minimal example showing how Reactome APIs can be wrapped as tools and used in an LLM agent.

```python
from langchain.tools import tool
from langchain.agents import initialize_agent
from langchain.chat_models import ChatOpenAI
import requests

@tool
def search_pathways(query: str):
    """Search biological pathways in Reactome"""
    url = f"https://reactome.org/ContentService/search/query?q={query}"
    response = requests.get(url)
    return response.json()

llm = ChatOpenAI(temperature=0)

tools = [search_pathways]

agent = initialize_agent(
    tools,
    llm,
    agent="zero-shot-react-description",
    verbose=True
)

agent.run("What pathways are related to cancer?")
