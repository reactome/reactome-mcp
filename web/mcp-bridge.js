#!/usr/bin/env node

/**
 * MCP Bridge Server
 *
 * This server acts as a bridge between the web interface and the MCP server.
 * It spawns the MCP server as a child process and communicates via JSON-RPC over stdio.
 * The web frontend can then call MCP tools through HTTP endpoints.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8888;

// MIME types for static files
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
};

// MCP Client class to communicate with the MCP server
class McpClient {
  constructor() {
    this.process = null;
    this.requestId = 0;
    this.pendingRequests = new Map();
    this.buffer = '';
    this.initialized = false;
  }

  async start() {
    const mcpServerPath = path.join(__dirname, '..', 'dist', 'index.js');

    this.process = spawn('node', [mcpServerPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.process.stdout.on('data', (data) => {
      this.buffer += data.toString();
      this.processBuffer();
    });

    this.process.stderr.on('data', (data) => {
      // MCP server logs to stderr
      console.error('[MCP Server]', data.toString().trim());
    });

    this.process.on('close', (code) => {
      console.log(`MCP server exited with code ${code}`);
      this.initialized = false;
    });

    // Initialize the MCP connection
    await this.initialize();
  }

  processBuffer() {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.trim()) {
        try {
          const message = JSON.parse(line);
          this.handleMessage(message);
        } catch (e) {
          console.error('Failed to parse MCP message:', line);
        }
      }
    }
  }

  handleMessage(message) {
    if (message.id !== undefined && this.pendingRequests.has(message.id)) {
      const { resolve, reject } = this.pendingRequests.get(message.id);
      this.pendingRequests.delete(message.id);

      if (message.error) {
        reject(new Error(message.error.message || 'MCP error'));
      } else {
        resolve(message.result);
      }
    }
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      const message = {
        jsonrpc: '2.0',
        id,
        method,
        params
      };

      this.pendingRequests.set(id, { resolve, reject });

      const timeout = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('MCP request timeout'));
        }
      }, 30000);

      this.pendingRequests.set(id, {
        resolve: (result) => {
          clearTimeout(timeout);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        }
      });

      this.process.stdin.write(JSON.stringify(message) + '\n');
    });
  }

  async initialize() {
    const result = await this.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'reactome-web-demo',
        version: '1.0.0'
      }
    });
    this.initialized = true;
    console.log('MCP server initialized:', result.serverInfo);
    return result;
  }

  async listTools() {
    return this.send('tools/list', {});
  }

  async callTool(name, args = {}) {
    return this.send('tools/call', { name, arguments: args });
  }

  async listResources() {
    return this.send('resources/list', {});
  }

  async readResource(uri) {
    return this.send('resources/read', { uri });
  }
}

// Create MCP client
const mcpClient = new McpClient();

// Request handler
async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API routes
  if (url.pathname.startsWith('/api/')) {
    return handleApiRequest(url, req, res);
  }

  // Static files
  let filePath = path.join(__dirname, url.pathname === '/' ? 'index.html' : url.pathname);

  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'text/plain';

  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch (err) {
    if (err.code === 'ENOENT') {
      res.writeHead(404);
      res.end('Not Found');
    } else {
      res.writeHead(500);
      res.end('Server Error');
    }
  }
}

async function handleApiRequest(url, req, res) {
  res.setHeader('Content-Type', 'application/json');

  try {
    // GET /api/tools - List all tools
    if (url.pathname === '/api/tools' && req.method === 'GET') {
      const result = await mcpClient.listTools();
      res.writeHead(200);
      res.end(JSON.stringify(result));
      return;
    }

    // POST /api/tools/:name - Call a tool
    if (url.pathname.startsWith('/api/tools/') && req.method === 'POST') {
      const toolName = url.pathname.replace('/api/tools/', '');
      const body = await readBody(req);
      const args = body ? JSON.parse(body) : {};

      console.log(`[MCP Call] ${toolName}`, JSON.stringify(args).substring(0, 100));

      const result = await mcpClient.callTool(toolName, args);
      res.writeHead(200);
      res.end(JSON.stringify(result));
      return;
    }

    // GET /api/resources - List resources
    if (url.pathname === '/api/resources' && req.method === 'GET') {
      const result = await mcpClient.listResources();
      res.writeHead(200);
      res.end(JSON.stringify(result));
      return;
    }

    // GET /api/resources/read?uri=... - Read a resource
    if (url.pathname === '/api/resources/read' && req.method === 'GET') {
      const uri = url.searchParams.get('uri');
      const result = await mcpClient.readResource(uri);
      res.writeHead(200);
      res.end(JSON.stringify(result));
      return;
    }

    // GET /api/status - Check MCP status
    if (url.pathname === '/api/status' && req.method === 'GET') {
      res.writeHead(200);
      res.end(JSON.stringify({
        initialized: mcpClient.initialized,
        pendingRequests: mcpClient.pendingRequests.size
      }));
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  } catch (error) {
    console.error('API error:', error);
    res.writeHead(500);
    res.end(JSON.stringify({ error: error.message }));
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// Start server
async function main() {
  console.log('Starting MCP server...');
  await mcpClient.start();

  const server = http.createServer(handleRequest);
  server.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   🧬 Reactome MCP Demo (with MCP Bridge)                      ║
║                                                               ║
║   Web interface: http://localhost:${PORT}                       ║
║                                                               ║
║   This demo uses the actual MCP server!                       ║
║   All tool calls go through the MCP protocol.                 ║
║                                                               ║
║   Press Ctrl+C to stop.                                       ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
`);
  });
}

main().catch(console.error);
