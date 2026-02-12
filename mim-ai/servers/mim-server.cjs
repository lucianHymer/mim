'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// --- Project root detection ---

function getProjectRoot() {
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

const PROJECT_ROOT = getProjectRoot();
const KNOWLEDGE_DIR = path.join(PROJECT_ROOT, '.claude', 'knowledge');
const MAP_FILE = path.join(KNOWLEDGE_DIR, 'KNOWLEDGE_MAP_CLAUDE.md');

// --- Helpers ---

function log(msg) { console.error('[mim] ' + msg); }

function atomicWrite(filePath, content) {
  const tmp = filePath + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, filePath);
}

// NOTE: This logic is duplicated in scripts/session-start.mjs for v2 migration.
// Keep both in sync if changing the slugify algorithm.
function slugify(str) {
  let s = str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!s) s = 'untitled-' + Date.now();
  if (s.length > 100) s = s.substring(0, 100).replace(/-$/, '');
  return s;
}

const PLURAL = { pattern: 'patterns', dependency: 'dependencies', gotcha: 'gotchas', workflow: 'workflows' };

function normalizeCategory(raw) {
  const slug = slugify(raw);
  return PLURAL[slug] || slug;
}

function jsonRpcResult(id, result) {
  return JSON.stringify({ jsonrpc: '2.0', id, result });
}

function jsonRpcError(id, code, message) {
  return JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
}

function toolResult(text, isError) {
  const res = { content: [{ type: 'text', text }] };
  if (isError) res.isError = true;
  return res;
}

// --- remember() handler ---

function handleRemember(args) {
  const category = args && args.category;
  const topic = args && args.topic;
  const details = args && args.details;
  const files = (args && typeof args.files === 'string' && args.files.trim()) || 'none';

  if (!category || typeof category !== 'string' || !category.trim())
    return toolResult('Error: category is required', true);
  if (!topic || typeof topic !== 'string' || !topic.trim())
    return toolResult('Error: topic is required', true);
  if (!details || typeof details !== 'string' || !details.trim())
    return toolResult('Error: details is required', true);

  const safeCategory = normalizeCategory(category.trim());
  if (!safeCategory) return toolResult('Error: invalid category', true);

  const slug = slugify(topic.trim());
  const categoryDir = path.resolve(KNOWLEDGE_DIR, safeCategory);
  const targetPath = path.resolve(categoryDir, slug + '.md');

  // Path traversal check
  if (!targetPath.startsWith(KNOWLEDGE_DIR + path.sep))
    return toolResult('Error: path traversal detected', true);

  // Ensure category directory
  fs.mkdirSync(categoryDir, { recursive: true });

  // Build content (append if file exists, create otherwise)
  const existed = fs.existsSync(targetPath);
  let content;
  if (existed) {
    const existing = fs.readFileSync(targetPath, 'utf8');
    content = existing + '\n\n---\n\n' + details.trim() + '\n\n**Related files:** ' + files;
  } else {
    content = '# ' + topic.trim() + '\n\n' + details.trim() + '\n\n**Related files:** ' + files;
  }

  // Atomic write knowledge file
  atomicWrite(targetPath, content);
  log('Wrote ' + safeCategory + '/' + slug + '.md');

  // Update knowledge map
  updateMap(safeCategory, slug);

  return toolResult('Remembered: [' + safeCategory + '] ' + topic.trim() + (existed ? ' (appended)' : ' (new)'));
}

// --- Map update ---

function updateMap(category, slug) {
  const entry = '- @' + category + '/' + slug + '.md';

  let mapContent;
  try { mapContent = fs.readFileSync(MAP_FILE, 'utf8'); }
  catch (_) { mapContent = '# Knowledge Map (Claude Reference)\n'; }

  // Check if entry already exists
  if (mapContent.includes(entry)) return;

  // Find the category section (case-insensitive)
  const headerRe = new RegExp('^## ' + category.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'im');
  const match = headerRe.exec(mapContent);

  if (match) {
    // Insert after header line (skip comment line if present)
    let insertPos = match.index + match[0].length;
    const afterHeader = mapContent.substring(insertPos);
    const commentMatch = afterHeader.match(/^\n<!-- [^\n]* -->/);
    if (commentMatch) insertPos += commentMatch[0].length;
    mapContent = mapContent.substring(0, insertPos) + '\n' + entry + mapContent.substring(insertPos);
  } else {
    // Append new section
    mapContent = mapContent.trimEnd() + '\n\n## ' + category.charAt(0).toUpperCase() + category.slice(1) + '\n' + entry + '\n';
  }

  atomicWrite(MAP_FILE, mapContent);
  log('Updated map: ' + entry);
}

// --- MCP protocol handler ---

function handleRequest(req) {
  const id = req.id !== undefined ? req.id : null;

  switch (req.method) {
    case 'initialize':
      return jsonRpcResult(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'mim', version: '3.0.0' }
      });

    case 'notifications/initialized':
      log('Server initialized (project: ' + PROJECT_ROOT + ')');
      return null;

    case 'tools/list':
      return jsonRpcResult(id, { tools: [REMEMBER_TOOL] });

    case 'tools/call': {
      const p = req.params || {};
      if (p.name === 'remember')
        return jsonRpcResult(id, handleRemember(p.arguments || {}));
      return jsonRpcError(id, -32601, 'Unknown tool: ' + p.name);
    }

    default:
      if (id != null) return jsonRpcError(id, -32601, 'Method not found: ' + req.method);
      return null; // unknown notification
  }
}

// --- Tool definition ---

const REMEMBER_TOOL = {
  name: 'remember',
  description: 'Capture project discoveries and learnings for persistent documentation. Automatically preserves knowledge about architecture, patterns, workflows, dependencies, and unique behaviors.\n\n\ud83c\udfaf USE THIS TOOL when you:\n\u2022 Discover how something works in this project\n\u2022 Learn project-specific patterns or conventions\n\u2022 Find configuration details or requirements\n\u2022 Understand architecture or system design\n\u2022 Encounter non-obvious behaviors or gotchas\n\u2022 Figure out dependencies or integrations\n\u2022 Realize your assumptions were incorrect\n\n\ud83d\udca1 KEY TRIGGERS - phrases that signal discovery:\n"I learned that", "turns out", "actually it\'s", "I discovered", "for future reference", "good to know", "interesting that"\n\n\u26a1 ALWAYS CAPTURE project-specific knowledge immediately - this creates the persistent memory that survives context resets.\n\n\u2713 Examples: Database schema conventions, API authentication flows, build system quirks\n\u2717 Skip: Current bug fixes, temporary debug output, generic programming concepts\n\nKnowledge is automatically deduplicated and organized.',
  inputSchema: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        description: 'Category name for organizing this knowledge. Use descriptive categories like: architecture, api, database, pattern, dependency, workflow, config, gotcha, convention, testing, security, deployment, frontend, backend, auth, etc. Any relevant category name is acceptable.',
        examples: ['architecture', 'patterns', 'dependencies', 'workflows', 'gotchas', 'api', 'database', 'config', 'testing', 'security', 'auth']
      },
      topic: {
        type: 'string',
        description: 'Brief, descriptive title for what you learned (e.g., "Redis caching strategy", "JWT authentication flow", "MongoDB connection pooling")'
      },
      details: {
        type: 'string',
        description: 'Complete details of what you discovered. Include specifics, configuration values, important notes, and any context that would help understand this knowledge later.'
      },
      files: {
        type: 'string',
        description: 'Comma-separated list of related file paths where this knowledge was discovered (optional but recommended)',
        examples: ['app.js', 'src/auth/jwt.js, src/middleware/auth.js', 'config/database.yml']
      }
    },
    required: ['category', 'topic', 'details']
  }
};

// --- Main ---

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', (line) => {
  if (!line.trim()) return;
  let req;
  try { req = JSON.parse(line); }
  catch (_) { process.stdout.write(jsonRpcError(null, -32700, 'Parse error') + '\n'); return; }
  try {
    const response = handleRequest(req);
    if (response) process.stdout.write(response + '\n');
  } catch (err) {
    log('Internal error: ' + err.message);
    process.stdout.write(jsonRpcError(req.id || null, -32603, 'Internal error') + '\n');
  }
});

rl.on('close', () => process.exit(0));
