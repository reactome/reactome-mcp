// API endpoints - now going through MCP bridge
const API_BASE = '/api';

// For diagram images, we still need direct Reactome access
const CONTENT_API = 'https://reactome.org/ContentService';

// DOM Elements
const tabs = document.querySelectorAll('.tab');
const tabContents = document.querySelectorAll('.tab-content');

// MCP call indicator
let mcpCallLog = [];
let mcpLogMinimized = false;

// Tab Navigation
tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const tabId = tab.dataset.tab;
    tabs.forEach(t => t.classList.remove('active'));
    tabContents.forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tabId).classList.add('active');
  });
});

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadDatabaseInfo();
  loadTopPathways();
  setupEventListeners();
  setupMcpLogControls();
  checkMcpStatus();
});

// Check MCP status
async function checkMcpStatus() {
  try {
    const status = await fetch(`${API_BASE}/status`).then(r => r.json());
    if (status.initialized) {
      console.log('MCP server connected');
    }
  } catch (error) {
    console.error('MCP status check failed:', error);
  }
}

// Call MCP tool through the bridge
async function callMcpTool(toolName, args = {}) {
  const startTime = Date.now();
  showMcpIndicator(toolName, 'running');

  try {
    const response = await fetch(`${API_BASE}/tools/${toolName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args)
    });

    if (!response.ok) {
      throw new Error(`MCP call failed: ${response.status}`);
    }

    const result = await response.json();
    const duration = Date.now() - startTime;

    showMcpIndicator(toolName, 'success', duration);
    logMcpCall(toolName, args, result, duration);

    // Extract text content from MCP response
    if (result.content && result.content[0] && result.content[0].text) {
      return result.content[0].text;
    }
    return result;
  } catch (error) {
    showMcpIndicator(toolName, 'error');
    throw error;
  }
}

// Show MCP call indicator
function showMcpIndicator(toolName, status, duration = null) {
  let indicator = document.getElementById('mcp-indicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'mcp-indicator';
    document.body.appendChild(indicator);
  }

  const statusColors = {
    running: '#f39c12',
    success: '#27ae60',
    error: '#e74c3c'
  };

  const statusText = {
    running: 'Calling...',
    success: duration ? `Done (${duration}ms)` : 'Done',
    error: 'Error'
  };

  indicator.innerHTML = `
    <div class="mcp-indicator-content" style="background: ${statusColors[status]}">
      <span class="mcp-icon">🔌</span>
      <span class="mcp-tool">MCP Tool: <code>${toolName}</code></span>
      <span class="mcp-status">${statusText[status]}</span>
    </div>
  `;

  indicator.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 1000;
    animation: slideIn 0.3s ease;
  `;

  indicator.querySelector('.mcp-indicator-content').style.cssText = `
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 20px;
    border-radius: 8px;
    color: white;
    font-size: 14px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
  `;

  indicator.querySelector('code').style.cssText = `
    background: rgba(255,255,255,0.2);
    padding: 2px 6px;
    border-radius: 4px;
    font-family: monospace;
  `;

  if (status !== 'running') {
    setTimeout(() => {
      indicator.style.opacity = '0';
      indicator.style.transition = 'opacity 0.3s';
      setTimeout(() => indicator.remove(), 300);
    }, 2000);
  }
}

// Log MCP calls for display
function logMcpCall(toolName, args, result, duration) {
  mcpCallLog.unshift({
    tool: toolName,
    args,
    result,
    duration,
    timestamp: new Date().toISOString()
  });
  if (mcpCallLog.length > 50) mcpCallLog.pop();
  renderMcpLog();
}

// Render the MCP call log panel
function renderMcpLog() {
  const container = document.getElementById('mcp-log-content');
  if (!container) return;

  if (mcpCallLog.length === 0) {
    container.innerHTML = '<div class="mcp-log-empty">No MCP calls yet. Interact with the interface to see protocol traffic.</div>';
    return;
  }

  container.innerHTML = mcpCallLog.map((entry, index) => {
    const timestamp = new Date(entry.timestamp).toLocaleTimeString();
    const requestJson = JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: entry.tool, arguments: entry.args }
    }, null, 2);

    // For display, truncate very long results
    let resultForDisplay = entry.result;
    if (typeof resultForDisplay === 'string' && resultForDisplay.length > 2000) {
      resultForDisplay = resultForDisplay.substring(0, 2000) + '\n... (truncated)';
    }
    const responseJson = typeof resultForDisplay === 'string'
      ? resultForDisplay
      : JSON.stringify(resultForDisplay, null, 2);

    return `
      <div class="mcp-log-entry ${index === 0 ? 'latest' : ''}">
        <div class="mcp-log-entry-header">
          <span class="mcp-log-tool-name">${entry.tool}</span>
          <span class="mcp-log-meta">
            <span class="mcp-log-duration">${entry.duration}ms</span>
            <span class="mcp-log-time">${timestamp}</span>
          </span>
        </div>
        <div class="mcp-log-section mcp-log-request">
          <div class="mcp-log-section-title">📤 Request (tools/call)</div>
          <pre class="mcp-log-code">${syntaxHighlightJson(requestJson)}</pre>
        </div>
        <div class="mcp-log-section mcp-log-response">
          <div class="mcp-log-section-title">📥 Response</div>
          <pre class="mcp-log-code">${escapeHtml(responseJson)}</pre>
        </div>
      </div>
    `;
  }).join('');
}

// JSON syntax highlighting
function syntaxHighlightJson(json) {
  return json
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, (match) => {
      let cls = 'json-number';
      if (/^"/.test(match)) {
        if (/:$/.test(match)) {
          cls = 'json-key';
        } else {
          cls = 'json-string';
        }
      } else if (/true|false/.test(match)) {
        cls = 'json-boolean';
      } else if (/null/.test(match)) {
        cls = 'json-null';
      }
      return `<span class="${cls}">${match}</span>`;
    });
}

// Escape HTML for safe display
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Setup MCP log panel controls
function setupMcpLogControls() {
  const clearBtn = document.getElementById('clear-log-btn');
  const toggleBtn = document.getElementById('toggle-log-btn');
  const panel = document.getElementById('mcp-log-panel');
  const content = document.getElementById('mcp-log-content');

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      mcpCallLog = [];
      renderMcpLog();
    });
  }

  if (toggleBtn && panel && content) {
    toggleBtn.addEventListener('click', () => {
      mcpLogMinimized = !mcpLogMinimized;
      if (mcpLogMinimized) {
        content.style.display = 'none';
        toggleBtn.textContent = 'Expand';
        panel.classList.add('minimized');
      } else {
        content.style.display = 'block';
        toggleBtn.textContent = 'Minimize';
        panel.classList.remove('minimized');
      }
    });
  }

  // Initial render
  renderMcpLog();
}

// Load database info via MCP
async function loadDatabaseInfo() {
  try {
    const result = await callMcpTool('reactome_database_info', {});
    // Parse the markdown response
    const versionMatch = result.match(/\*\*Version:\*\* (\d+)/);
    if (versionMatch) {
      document.getElementById('db-version').textContent = `v${versionMatch[1]}`;
    }
  } catch (error) {
    document.getElementById('db-version').textContent = 'Error';
    console.error('Failed to load database info:', error);
  }
}

// Load top pathways via MCP
async function loadTopPathways() {
  try {
    const result = await callMcpTool('reactome_top_pathways', { species: 'Homo sapiens' });

    // Parse the markdown response to extract pathways
    const pathwayMatches = result.matchAll(/\*\*(.+?)\*\* \((R-HSA-\d+)\)/g);
    const pathways = Array.from(pathwayMatches).map(m => ({
      name: m[1],
      stId: m[2]
    }));

    const container = document.getElementById('top-pathways-list');
    container.innerHTML = pathways.slice(0, 12).map(p => `
      <button class="pathway-chip" data-id="${p.stId}">${p.name}</button>
    `).join('');

    container.querySelectorAll('.pathway-chip').forEach(chip => {
      chip.addEventListener('click', () => loadPathway(chip.dataset.id));
    });
  } catch (error) {
    console.error('Error loading top pathways:', error);
  }
}

// Setup event listeners
function setupEventListeners() {
  // Example gene buttons
  document.querySelectorAll('.example-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('gene-input').value = btn.dataset.genes.split(',').join('\n');
    });
  });

  // Analyze button
  document.getElementById('analyze-btn').addEventListener('click', runAnalysis);

  // Search
  document.getElementById('search-btn').addEventListener('click', runSearch);
  document.getElementById('search-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') runSearch();
  });

  // Quick search buttons
  document.querySelectorAll('.quick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('search-input').value = btn.dataset.query;
      runSearch();
    });
  });

  // Pathway loader
  document.getElementById('load-pathway-btn').addEventListener('click', () => {
    const id = document.getElementById('pathway-id-input').value.trim();
    if (id) loadPathway(id);
  });

  document.getElementById('pathway-id-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const id = e.target.value.trim();
      if (id) loadPathway(id);
    }
  });

  // Utility buttons
  document.querySelectorAll('.utility-btn').forEach(btn => {
    btn.addEventListener('click', () => handleUtilityAction(btn.dataset.action));
  });
}

// Run pathway enrichment analysis via MCP
async function runAnalysis() {
  const input = document.getElementById('gene-input').value.trim();
  if (!input) {
    alert('Please enter some gene identifiers');
    return;
  }

  const genes = input.split(/[\n,\s]+/).filter(g => g.length > 0);
  const includeInteractors = document.getElementById('include-interactors').checked;
  const includeDisease = document.getElementById('include-disease').checked;

  const btn = document.getElementById('analyze-btn');
  const btnText = btn.querySelector('.btn-text');
  const btnLoading = btn.querySelector('.btn-loading');

  btnText.classList.add('hidden');
  btnLoading.classList.remove('hidden');
  btn.disabled = true;

  try {
    const result = await callMcpTool('reactome_analyze_identifiers', {
      identifiers: genes,
      projection: true,
      interactors: includeInteractors,
      include_disease: includeDisease,
      p_value_threshold: 0.05
    });

    displayAnalysisResults(result);
  } catch (error) {
    console.error('Analysis error:', error);
    alert('Analysis failed. Please try again.');
  } finally {
    btnText.classList.remove('hidden');
    btnLoading.classList.add('hidden');
    btn.disabled = false;
  }
}

// Display analysis results from MCP markdown response
function displayAnalysisResults(markdownResult) {
  const container = document.getElementById('analysis-results');
  const tableContainer = document.getElementById('results-table-container');

  // Parse the markdown to extract pathway info
  const tokenMatch = markdownResult.match(/\*\*Token:\*\* (.+)/);
  const pathwaysFoundMatch = markdownResult.match(/\*\*Pathways found:\*\* (\d+)/);

  const token = tokenMatch ? tokenMatch[1] : 'N/A';
  const pathwaysFound = pathwaysFoundMatch ? pathwaysFoundMatch[1] : '0';

  document.getElementById('result-count').textContent = `${pathwaysFound} pathways found`;
  document.getElementById('result-token').textContent = `Token: ${token}`;

  // Parse pathway entries
  const pathwayRegex = /- \*\*(.+?)\*\* \((R-[A-Z]+-\d+)\)\s*\n\s*- Entities: (\d+)\/(\d+).*?ratio: ([\d.]+)\)\s*\n\s*- p-value: ([^,]+), FDR: ([^\n]+)/g;
  const pathways = [];
  let match;

  while ((match = pathwayRegex.exec(markdownResult)) !== null) {
    pathways.push({
      name: match[1],
      stId: match[2],
      found: parseInt(match[3]),
      total: parseInt(match[4]),
      ratio: parseFloat(match[5]),
      pValue: match[6],
      fdr: match[7]
    });
  }

  if (pathways.length === 0) {
    tableContainer.innerHTML = '<p style="padding: 2rem; text-align: center; color: var(--gray-600);">No significant pathways found. Try adding more genes or checking your identifiers.</p>';
  } else {
    tableContainer.innerHTML = `
      <table class="results-table">
        <thead>
          <tr>
            <th>Pathway</th>
            <th>ID</th>
            <th>Entities</th>
            <th>p-value</th>
            <th>FDR</th>
            <th>Ratio</th>
          </tr>
        </thead>
        <tbody>
          ${pathways.slice(0, 30).map(p => `
            <tr>
              <td class="pathway-name" data-id="${p.stId}">${p.name}</td>
              <td class="pathway-id">${p.stId}</td>
              <td>${p.found}/${p.total}</td>
              <td class="pvalue significant">${p.pValue}</td>
              <td class="pvalue">${p.fdr}</td>
              <td>
                <div class="ratio-bar">
                  <div class="ratio-bar-fill" style="width: ${Math.min(p.ratio * 1000, 100)}%"></div>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      ${pathways.length > 30 ? `<p style="padding: 1rem; text-align: center; color: var(--gray-600);">Showing top 30 of ${pathways.length} pathways</p>` : ''}
    `;

    tableContainer.querySelectorAll('.pathway-name').forEach(el => {
      el.addEventListener('click', () => {
        document.querySelector('[data-tab="pathway"]').click();
        loadPathway(el.dataset.id);
      });
    });
  }

  container.classList.remove('hidden');
  container.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Run search via MCP
async function runSearch() {
  const query = document.getElementById('search-input').value.trim();
  if (!query) return;

  const species = document.getElementById('species-filter').value;
  const type = document.getElementById('type-filter').value;

  try {
    const args = { query, rows: 25 };
    if (species) args.species = species;
    if (type) args.types = [type];

    const result = await callMcpTool('reactome_search', args);
    displaySearchResults(result, query);
  } catch (error) {
    console.error('Search error:', error);
    alert('Search failed. Please try again.');
  }
}

// Display search results from MCP markdown response
function displaySearchResults(markdownResult, query) {
  const container = document.getElementById('search-results');

  // Parse total count
  const countMatch = markdownResult.match(/\*\*Found:\*\* (\d+) results/);
  const totalCount = countMatch ? countMatch[1] : '0';

  // Parse search entries
  const entryRegex = /- \*\*(.+?)\*\* \((R-[A-Z]+-\d+)\)\s*\n\s*- Type: (\w+)\s*\n\s*(?:- Species: ([^\n]+)\s*\n)?/g;
  const entries = [];
  let match;

  while ((match = entryRegex.exec(markdownResult)) !== null) {
    entries.push({
      name: match[1],
      stId: match[2],
      type: match[3],
      species: match[4] || ''
    });
  }

  if (entries.length === 0) {
    container.innerHTML = `
      <div class="results-header">
        <h3>Search Results for "${query}"</h3>
      </div>
      <p style="padding: 2rem; text-align: center; color: var(--gray-600);">No results found.</p>
    `;
  } else {
    container.innerHTML = `
      <div class="results-header">
        <h3>Search Results for "${query}"</h3>
        <span>${totalCount} results</span>
      </div>
      ${entries.map(entry => `
        <div class="search-result-item">
          <h4 data-id="${entry.stId}">${entry.name}</h4>
          <div class="search-result-meta">
            <span class="type-badge">${entry.type}</span>
            <span>${entry.species}</span>
            <span class="pathway-id">${entry.stId}</span>
          </div>
        </div>
      `).join('')}
    `;

    container.querySelectorAll('h4[data-id]').forEach(el => {
      el.addEventListener('click', () => {
        document.querySelector('[data-tab="pathway"]').click();
        loadPathway(el.dataset.id);
      });
    });
  }

  container.classList.remove('hidden');
}

// Load pathway details via MCP
async function loadPathway(id) {
  document.getElementById('pathway-id-input').value = id;

  try {
    const result = await callMcpTool('reactome_get_pathway', { id });
    displayPathway(result, id);
  } catch (error) {
    console.error('Pathway load error:', error);
    alert('Failed to load pathway. Please check the ID and try again.');
  }
}

// Display pathway from MCP markdown response
function displayPathway(markdownResult, id) {
  const container = document.getElementById('pathway-details');

  // Parse pathway info from markdown
  const nameMatch = markdownResult.match(/## (.+)/);
  const stIdMatch = markdownResult.match(/\*\*Stable ID:\*\* (R-[A-Z]+-\d+)/);
  const typeMatch = markdownResult.match(/\*\*Type:\*\* (\w+)/);
  const speciesMatch = markdownResult.match(/\*\*Species:\*\* (.+)/);
  const summaryMatch = markdownResult.match(/### Summary:\s*\n(.+?)(?=\n###|\n\*\*|$)/s);

  const name = nameMatch ? nameMatch[1] : id;
  const stId = stIdMatch ? stIdMatch[1] : id;
  const type = typeMatch ? typeMatch[1] : 'Unknown';
  const species = speciesMatch ? speciesMatch[1] : 'Unknown';
  const summary = summaryMatch ? summaryMatch[1].trim() : '';

  document.getElementById('pathway-name').textContent = name;
  document.getElementById('pathway-stid').textContent = stId;

  const content = document.getElementById('pathway-content');
  content.innerHTML = `
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 1rem;">
      <div><strong>Type:</strong> ${type}</div>
      <div><strong>Species:</strong> ${species}</div>
    </div>
    ${summary ? `
      <div style="margin-top: 1rem;">
        <strong>Summary:</strong>
        <p style="margin-top: 0.5rem; color: var(--gray-700);">${summary}</p>
      </div>
    ` : ''}
    <div style="margin-top: 1rem;">
      <a href="https://reactome.org/content/detail/${stId}" target="_blank" style="color: var(--primary);">
        View on Reactome website →
      </a>
    </div>
  `;

  // Load diagram (still direct from Reactome as it's an image)
  const diagramContainer = document.getElementById('pathway-diagram-container');
  if (type === 'Pathway') {
    diagramContainer.innerHTML = `
      <img src="${CONTENT_API}/exporter/diagram/${encodeURIComponent(stId)}.svg?quality=7"
           alt="Pathway diagram for ${name}"
           onerror="this.parentElement.innerHTML='<p style=\\'padding: 2rem; text-align: center; color: var(--gray-600);\\'>No diagram available.</p>'"
      />
    `;
  } else {
    diagramContainer.innerHTML = '';
  }

  container.classList.remove('hidden');
  container.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Utility tool handlers
async function handleUtilityAction(action) {
  switch (action) {
    case 'species':
      await loadSpecies();
      break;
    case 'diseases':
      await loadDiseases();
      break;
    case 'dbinfo':
      await loadDatabaseInfoDetailed();
      break;
    case 'mapping':
      await mapIdentifier();
      break;
    case 'interactors':
      await loadInteractors();
      break;
    case 'complexes':
      await loadComplexes();
      break;
  }
}

async function loadSpecies() {
  const mainOnly = document.getElementById('main-species-only').checked;
  const container = document.getElementById('species-results');

  try {
    container.innerHTML = '<p>Loading via MCP...</p>';
    container.classList.remove('hidden');

    const result = await callMcpTool('reactome_species', { main_only: mainOnly });

    // Parse the markdown table
    const lines = result.split('\n').filter(l => l.includes('|') && !l.includes('---'));
    const dataLines = lines.slice(1); // Skip header

    container.innerHTML = `
      <h4>Species loaded via MCP tool: <code>reactome_species</code></h4>
      <table>
        <thead>
          <tr><th>Name</th><th>Taxonomy ID</th><th>Short Name</th></tr>
        </thead>
        <tbody>
          ${dataLines.map(line => {
            const cols = line.split('|').map(c => c.trim()).filter(c => c);
            return `<tr><td>${cols[0] || ''}</td><td>${cols[1] || ''}</td><td>${cols[2] || '-'}</td></tr>`;
          }).join('')}
        </tbody>
      </table>
    `;
  } catch (error) {
    container.innerHTML = `<p style="color: var(--danger);">Error: ${error.message}</p>`;
  }
}

async function loadDiseases() {
  const container = document.getElementById('diseases-results');

  try {
    container.innerHTML = '<p>Loading via MCP...</p>';
    container.classList.remove('hidden');

    const result = await callMcpTool('reactome_diseases', {});

    // Parse disease entries
    const diseaseRegex = /- \*\*(.+?)\*\*(?:\s*\(([^)]+)\))?/g;
    const diseases = [];
    let match;
    while ((match = diseaseRegex.exec(result)) !== null) {
      diseases.push({ name: match[1], ref: match[2] || '' });
    }

    container.innerHTML = `
      <h4>Diseases loaded via MCP tool: <code>reactome_diseases</code></h4>
      <table>
        <thead><tr><th>Disease</th><th>Reference</th></tr></thead>
        <tbody>
          ${diseases.slice(0, 100).map(d => `<tr><td>${d.name}</td><td>${d.ref}</td></tr>`).join('')}
        </tbody>
      </table>
      ${diseases.length > 100 ? `<p>Showing 100 of ${diseases.length}</p>` : ''}
    `;
  } catch (error) {
    container.innerHTML = `<p style="color: var(--danger);">Error: ${error.message}</p>`;
  }
}

async function loadDatabaseInfoDetailed() {
  const container = document.getElementById('dbinfo-results');

  try {
    container.innerHTML = '<p>Loading via MCP...</p>';
    container.classList.remove('hidden');

    const result = await callMcpTool('reactome_database_info', {});

    container.innerHTML = `
      <h4>Info loaded via MCP tool: <code>reactome_database_info</code></h4>
      <pre style="white-space: pre-wrap; font-family: inherit;">${result}</pre>
    `;
  } catch (error) {
    container.innerHTML = `<p style="color: var(--danger);">Error: ${error.message}</p>`;
  }
}

async function mapIdentifier() {
  const resource = document.getElementById('mapping-resource').value;
  const identifier = document.getElementById('mapping-id').value.trim();
  const container = document.getElementById('mapping-results');

  if (!identifier) {
    alert('Please enter an identifier');
    return;
  }

  try {
    container.innerHTML = '<p>Loading via MCP...</p>';
    container.classList.remove('hidden');

    const result = await callMcpTool('reactome_mapping_pathways', { resource, identifier });

    container.innerHTML = `
      <h4>Mapped via MCP tool: <code>reactome_mapping_pathways</code></h4>
      <pre style="white-space: pre-wrap; font-family: inherit; max-height: 250px; overflow-y: auto;">${result}</pre>
    `;
  } catch (error) {
    container.innerHTML = `<p style="color: var(--danger);">Error: ${error.message}</p>`;
  }
}

async function loadInteractors() {
  const accession = document.getElementById('interactor-id').value.trim();
  const container = document.getElementById('interactors-results');

  if (!accession) {
    alert('Please enter a UniProt ID');
    return;
  }

  try {
    container.innerHTML = '<p>Loading via MCP...</p>';
    container.classList.remove('hidden');

    const result = await callMcpTool('reactome_static_interactors', { accession });

    container.innerHTML = `
      <h4>Interactors via MCP tool: <code>reactome_static_interactors</code></h4>
      <pre style="white-space: pre-wrap; font-family: inherit; max-height: 250px; overflow-y: auto;">${result}</pre>
    `;
  } catch (error) {
    container.innerHTML = `<p style="color: var(--danger);">Error: ${error.message}</p>`;
  }
}

async function loadComplexes() {
  const accession = document.getElementById('complex-id').value.trim();
  const container = document.getElementById('complexes-results');

  if (!accession) {
    alert('Please enter a UniProt ID');
    return;
  }

  try {
    container.innerHTML = '<p>Loading via MCP...</p>';
    container.classList.remove('hidden');

    const result = await callMcpTool('reactome_complexes_containing', {
      resource: 'UniProt',
      identifier: accession
    });

    container.innerHTML = `
      <h4>Complexes via MCP tool: <code>reactome_complexes_containing</code></h4>
      <pre style="white-space: pre-wrap; font-family: inherit; max-height: 250px; overflow-y: auto;">${result}</pre>
    `;
  } catch (error) {
    container.innerHTML = `<p style="color: var(--danger);">Error: ${error.message}</p>`;
  }
}
