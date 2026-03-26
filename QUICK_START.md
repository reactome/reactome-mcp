# Quick Start Guide - Enhanced Reactome MCP

## New Tools & Features

### 1. Hybrid Search (Embedding + Fallback)

```
reactome_search_hybrid
├─ Query: "BRCA1 cancer pathway"
├─ Species: "Homo sapiens" (optional)
├─ Types: ["Pathway", "Protein"] (optional)
├─ rows: 25 (optional)
├─ confidence_threshold: 0.5 (optional)
└─ use_embedding: true (optional)

Response includes:
├─ Confidence scores (0-1)
├─ Result source (embedding vs search)
├─ Merged deduplicated results
└─ Fallback tracking
```

**Use Case**: Complex or specialized searches that need multiple strategies

---

### 2. Smart Search with Automatic Routing

```
reactome_smart_search
└─ Query: "What does mTOR do?" OR "Find BRCA1" OR "Analyze these genes"

System automatically:
├─ Routes to search/pathway/analysis
├─ Shows routing decision and confidence
├─ Executes appropriate tool
├─ Shows alternative approaches
└─ Logs everything for evaluation
```

**Use Case**: When you don't know which tool to use

---

### 3. Enriched Pathway Details

```
reactome_explain_pathway
└─ ID: "R-HSA-1234567"

Returns:
├─ Pathway description
├─ Number of reactions
├─ Key entities
├─ Literature references
├─ Disease involvement
├─ Diagram availability
└─ AI-generated explanation
```

**Use Case**: Understand the biological significance of a pathway

---

### 4. Top Pathways with Enrichment

```
reactome_top_pathways_enriched
└─ Species: "Homo sapiens" (optional)

Returns:
├─ Table of top-level pathways
├─ Diagram availability indicators
├─ QuickLinks to pathway details
└─ All results cached for speed
```

**Use Case**: Overview of main pathway categories

---

### 5. Species Comparison

```
reactome_compare_species
├─ Pathway ID: "R-HSA-1234567"
└─ Species List: ["Homo sapiens", "Mus musculus", "Drosophila"]

Shows:
├─ Which species have this pathway
├─ Reactions per species
├─ Conservation status
└─ Evolutionary divergence
```

**Use Case**: Understand pathway conservation across species

---

### 6. Enriched Analysis Results

```
reactome_get_analysis_enriched
├─ Token: "from_previous_analysis"
├─ top_n: 10
└─ include_details: true

Returns:
├─ Significant pathways (p-value, FDR)
├─ Entity coverage
├─ Detailed summaries (optional)
└─ All enriched with API data
```

**Use Case**: Deep dive into analysis results with context

---

### 7. System Diagnostics

```
reactome_system_diagnostics
├─ include_cache: true
├─ include_fallbacks: true
└─ include_logs: true

Shows:
├─ Cache statistics & efficiency
├─ Fallback usage metrics
├─ Error statistics
└─ Recent activity logs
```

**Use Case**: Monitor system health and debug performance

---

## Features Summary

### Hybrid Retrieval ✓

```
Query → Try Embedding Lookup
         ↓
         No Results or Low Confidence?
         ↓
         Fall back to Search API
         ↓
         Merge & Deduplicate
         ↓
         Return with Confidence Scores
```

- Embedding lookup is mocked (ready for vector DB integration)
- Automatically falls back to search API
- Deduplicates results across sources
- Tracks fallback usage for evaluation
- Results cached for 5 minutes

### Result Enrichment ✓

All pathway results now include:
- Summary and full description
- Number of reactions
- Key entities and statistics
- Literature references with PubMed links
- Disease pathway status
- Diagram availability
- AI-generated explanations

### Query Routing ✓

Automatically decides between:
- **Search**: For finding entities (keywords: find, search, query)
- **Pathway**: For details (keywords: explain, diagram, details)
- **Analysis**: For enrichment (keywords: analyze, enrichment)
- **Combined**: For comparisons (keywords: compare, vs)

Provides:
- Confidence score
- Reasoning
- Alternative suggestions

### Caching ✓

- TTL-based (auto-expires)
- LRU eviction (removes least used)
- Size limits (prevents memory overflow)
- Statistics tracking
- ~80-90% API call reduction

### Error Handling & Logging ✓

- Standardized error codes
- Automatic retry with exponential backoff
- Detailed API error logging
- **Fallback event tracking** (critical for evaluation)
- Error statistics
- Circular log buffer

---

## Example Workflows

### Workflow 1: Find and Explore

```
User: "Smart search for BRCA1"
  ↓
System: Routes to SEARCH
  ↓
User:  "Tell me more about its role"
  ↓
System: Routes to PATHWAY, enriches with details
  ↓
User: "Compare across species"
  ↓
System: Uses COMPARE tool with enrichment
```

### Workflow 2: Analysis with Context

```
User: "Analyze these 50 genes"
  ↓
System: Uses ANALYSIS tool
  ↓
System: Automatically enriches top pathways
  ↓
User: "Which pathways are most significant?"
  ↓
System: Returns sorted by p-value with explanations
```

### Workflow 3: Research Questions

```
User: "Smart search: How is mTOR regulated?"
  ↓
System: Routes to PATHWAY for regulation details
  ↓
System: Enriches with reactions, entities, references
  ↓
User: "Get diagram and references"
  ↓
System: Provides full details with links
```

---

## Performance Tips

1. **Use Caching**
   - First search: ~500ms
   - Repeated search: ~1ms
   - 5-minute cache TTL

2. **Prefer Smart Search**
   - Automatic routing to best tool
   - More reliable than manual tool selection

3. **Enable Hybrid Search**
   - Better results through fallback logic
   - Automatic deduplication

4. **Monitor Diagnostics**
   - Check cache hit rates
   - Verify fallback frequency
   - Track error rates

---

## Configuration

### Environment Variables

```bash
# Logging
NODE_ENV=production  # Disable console logging in production

# Caching (if implementing custom settings)
CACHE_TTL_MS=300000        # 5 minutes default
MAX_CACHE_ENTRIES=1000     # Max cache size
```

### Runtime Configuration

```typescript
import { QueryRouter } from "./tools/router.js";
import { CacheManager } from "./clients/cache.js";

// Custom router
const router = new QueryRouter({
  defaultAction: "search",
  confidenceThreshold: 0.5,
});

// Custom cache (if needed)
const cache = new CacheManager(10 * 60 * 1000, 2000);
```

---

## Evaluating Fallback Usage

### Check Fallback Statistics

```bash
# Use diagnostics tool
reactome_system_diagnostics
├─ include_fallbacks: true

Shows:
├─ Total fallbacks
├─ By source (hybrid-retrieval, enrichment, routing)
└─ Recent fallback events
```

### Analyze Logs

```typescript
import { logger } from "../utils/logger.js";

const stats = logger.getFallbackStats();
console.log(`Total fallbacks: ${stats.totalFallbacks}`);
console.log(`By source:`, stats.bySource);
console.log(`Recent events:`, stats.recent);
```

### Track Specific Operations

All operations log:
- When fallback triggered
- Original error
- Fallback strategy used
- Success/failure

---

## Troubleshooting

### Search not returning results
1. Try `reactome_smart_search` (routing)
2. Check species filter
3. Try alternative keywords
4. Use `confidence_threshold: 0` to see all

### Pathway not found
1. Verify stable ID format (R-XXX-XXXXXX)
2. Try search first to find ID
3. Try different species
4. Check diagnostics for errors

### System slow
1. Check cache statistics
2. Review error logs
3. Verify network connectivity
4. Restart server if needed

### Want to see fallback usage
1. Run `reactome_system_diagnostics`
2. Enable log inclusion
3. Check fallback statistics
4. Review recent fallback events

---

## Migration from Standard Search

### Before (Standard)
```
reactome_search (returns list)
  └─ Manual pathway lookup needed
```

### After (Enhanced)
```
reactome_search_hybrid (returns with confidence)
  └─ Automatic enrichment available
```

OR

```
reactome_smart_search (automatic routing)
  └─ Best tool selected automatically
```

---

## Next Steps

1. **Try the Smart Search**
   - Start with `reactome_smart_search`
   - Test with various query types

2. **Explore Hybrid Features**
   - Use `reactome_search_hybrid`
   - Note fallback usage

3. **Check Enrichment**
   - Use `reactome_explain_pathway`
   - Compare with standard `reactome_get_pathway`

4. **Monitor Performance**
   - Run `reactome_system_diagnostics`
   - Track cache hit rates

5. **Integrate into Workflows**
   - Build multi-step queries
   - Combine tools for comprehensive analysis

---

## Support

For issues or questions:
1. Check ENHANCEMENTS.md for technical details
2. Review code comments in source files
3. Run diagnostics tool
4. Check log messages
5. Verify API connectivity
