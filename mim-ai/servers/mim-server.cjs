#!/usr/bin/env node

/**
 * Mim MCP Server v2
 *
 * Queue-based MCP server with Agent 1 (Queue Processor) integration.
 *
 * This server:
 * 1. Provides a `remember` tool that queues entries to disk
 * 2. Hosts Agent 1 (Queue Processor) that processes entries
 */

const readline = require('readline');
const fs = require('fs');
const path = require('path');

// ============================================
// Configuration
// ============================================

const KNOWLEDGE_BASE_DIR = '.claude/knowledge';
const QUEUE_DIR = `${KNOWLEDGE_BASE_DIR}/remember-queue`;
const PENDING_REVIEW_DIR = `${KNOWLEDGE_BASE_DIR}/pending-review`;
const CATEGORIES = ['architecture', 'patterns', 'dependencies', 'workflows', 'gotchas'];

// ============================================
// JSON-RPC Helpers
// ============================================

function createResponse(id, result) {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    result
  });
}

function createError(id, code, message) {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    error: { code, message }
  });
}

// ============================================
// Short ID Generator
// ============================================

function generateShortId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 6; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

// ============================================
// File System Helpers
// ============================================

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function getProjectRoot() {
  // Try to find project root by looking for .git directory
  let dir = process.cwd();
  while (dir !== '/') {
    if (fs.existsSync(path.join(dir, '.git'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return process.cwd();
}

// ============================================
// Queue Processor Agent (Agent 1)
// ============================================

/**
 * Agent 1 System Prompt - Knowledge processor
 */
const QUEUE_PROCESSOR_SYSTEM_PROMPT = `You are the Knowledge Processor for Mim, a persistent memory system.

Your job is to process incoming knowledge entries and organize them into the appropriate files.

## Knowledge Structure

The knowledge base is organized into these directories under .claude/knowledge/:
- architecture/ - System design, component relationships, data flow
- patterns/ - Code patterns, conventions, idioms used in the project
- dependencies/ - External dependencies, their purposes, version notes
- workflows/ - Development workflows, deployment processes, common tasks
- gotchas/ - Pitfalls, gotchas, things that don't work as expected

Each directory contains markdown files organized by topic.

## Your Task

When you receive a knowledge entry to process:

1. **Check for duplicates**: Use Grep to search existing files for similar content
2. **Check for conflicts**: Look for existing knowledge that contradicts the new entry
3. **Take action**:
   - If duplicate: Skip it (action: duplicate_skipped)
   - If conflicts: Create a pending-review JSON file (action: created_review)
   - Otherwise: Append to the appropriate file or create a new one (action: added/updated)

## Pending Review Format

When conflicts are detected, write to .claude/knowledge/pending-review/{timestamp}-{id}.json:

{
  "id": "short-id",
  "category": "the-category",
  "question": "Human-readable question about the conflict",
  "options": [
    { "label": "A", "description": "First option" },
    { "label": "B", "description": "Second option" }
  ],
  "context": "Details about what conflicted and where"
}

## File Organization

When adding new knowledge:
- Use descriptive filenames like architecture/api-design.md
- Append to existing files when the topic matches
- Create new files for distinct topics
- Use markdown formatting with headers

## Important

- Be ruthless about avoiding duplicates - skip anything that's essentially the same
- When in doubt about conflicts, create a review entry
- Always signal ready_for_next: true when done processing an entry`;

/**
 * Queue Processor Output Schema (JSON Schema format)
 */
const QUEUE_PROCESSOR_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    status: {
      type: 'string',
      enum: ['processed', 'conflict_detected'],
      description: 'Result of processing the entry'
    },
    action: {
      type: 'string',
      enum: ['added', 'updated', 'duplicate_skipped', 'created_review'],
      description: 'What action was taken'
    },
    file_modified: {
      type: ['string', 'null'],
      description: 'Path to modified knowledge file, or null'
    },
    ready_for_next: {
      type: 'boolean',
      description: 'True if ready to process another entry'
    }
  },
  required: ['status', 'action', 'file_modified', 'ready_for_next'],
  additionalProperties: false
};

/**
 * QueueProcessor class - manages Agent 1 lifecycle
 */
class QueueProcessor {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.session = null;
    this.sessionId = null;
    this.isProcessing = false;
    this.query = null; // Will be dynamically imported
  }

  /**
   * Initialize the SDK (dynamic import for ESM in CJS)
   */
  async initSDK() {
    if (this.query) return;

    try {
      // Dynamic import of ESM module in CommonJS
      const sdk = await import('@anthropic-ai/claude-agent-sdk');
      this.query = sdk.query;
    } catch (err) {
      console.error('Failed to import Claude Agent SDK:', err.message);
      throw err;
    }
  }

  /**
   * Load all existing knowledge for context
   */
  async loadAllKnowledge() {
    const knowledgeDir = path.join(this.projectRoot, KNOWLEDGE_BASE_DIR);
    let content = '';

    for (const category of CATEGORIES) {
      const categoryDir = path.join(knowledgeDir, category);
      if (!fs.existsSync(categoryDir)) continue;

      const files = fs.readdirSync(categoryDir).filter(f => f.endsWith('.md'));
      for (const file of files) {
        const filePath = path.join(categoryDir, file);
        const fileContent = fs.readFileSync(filePath, 'utf8');
        content += `\n--- ${category}/${file} ---\n${fileContent}\n`;
      }
    }

    return content || '(No existing knowledge files)';
  }

  /**
   * Start or get the agent session
   */
  async getSession() {
    await this.initSDK();

    if (this.session && this.sessionId) {
      return this.session;
    }

    // Load existing knowledge for context
    const knowledge = await this.loadAllKnowledge();

    // Create canUseTool function to deny AskUserQuestion
    const canUseTool = async (toolName, input) => {
      if (toolName === 'AskUserQuestion') {
        return {
          behavior: 'deny',
          message: 'This tool is not available. Process the entry based on your analysis.'
        };
      }
      return { behavior: 'allow', updatedInput: input };
    };

    // Start a new session
    const prompt = `You are the Knowledge Processor. Here is all current knowledge in the repository:

${knowledge}

I will send you knowledge entries to process. For each entry, analyze it against existing knowledge, then take the appropriate action (add, update, skip duplicate, or create review for conflicts).

Reply with your structured output indicating ready_for_next: true when you're ready for the first entry.`;

    const options = {
      model: 'opus',
      systemPrompt: QUEUE_PROCESSOR_SYSTEM_PROMPT,
      canUseTool,
      outputFormat: {
        type: 'json_schema',
        schema: QUEUE_PROCESSOR_OUTPUT_SCHEMA
      },
      // Don't load project CLAUDE.md - agent has its own instructions
    };

    this.session = this.query({ prompt, options });

    // Process initial response to get session ID
    for await (const message of this.session) {
      if (message.type === 'system' && message.subtype === 'init') {
        this.sessionId = message.session_id;
      }
      if (message.type === 'result' && message.subtype === 'success') {
        // Initial response complete
        break;
      }
    }

    return this.session;
  }

  /**
   * Send a message to the agent and get structured response
   */
  async sendToAgent(message) {
    await this.initSDK();

    const options = {
      model: 'opus',
      systemPrompt: QUEUE_PROCESSOR_SYSTEM_PROMPT,
      resume: this.sessionId,
      canUseTool: async (toolName, input) => {
        if (toolName === 'AskUserQuestion') {
          return {
            behavior: 'deny',
            message: 'This tool is not available. Process the entry based on your analysis.'
          };
        }
        return { behavior: 'allow', updatedInput: input };
      },
      outputFormat: {
        type: 'json_schema',
        schema: QUEUE_PROCESSOR_OUTPUT_SCHEMA
      }
    };

    const session = this.query({ prompt: message, options });
    let structuredOutput = null;

    for await (const msg of session) {
      if (msg.type === 'result' && msg.subtype === 'success') {
        structuredOutput = msg.structured_output;
      }
    }

    return structuredOutput;
  }

  /**
   * Process a single queue entry
   */
  async processEntry(entry) {
    // Ensure session is started
    await this.getSession();

    const prompt = `Process this knowledge entry:

Category: ${entry.entry.category}
Content: ${entry.entry.content}

Timestamp: ${entry.timestamp}
ID: ${entry.id}

Analyze this against existing knowledge and take the appropriate action.`;

    const result = await this.sendToAgent(prompt);

    return result || {
      status: 'processed',
      action: 'added',
      file_modified: null,
      ready_for_next: true
    };
  }

  /**
   * Process all pending queue entries
   */
  async processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const queueDir = path.join(this.projectRoot, QUEUE_DIR);
      if (!fs.existsSync(queueDir)) {
        this.isProcessing = false;
        return;
      }

      const files = fs.readdirSync(queueDir)
        .filter(f => f.endsWith('.json'))
        .sort(); // Sort by timestamp (filename starts with timestamp)

      for (const file of files) {
        const filePath = path.join(queueDir, file);

        try {
          const content = fs.readFileSync(filePath, 'utf8');
          const entry = JSON.parse(content);

          if (entry.status !== 'pending') continue;

          // Mark as processing
          entry.status = 'processing';
          fs.writeFileSync(filePath, JSON.stringify(entry, null, 2));

          // Process the entry
          const result = await this.processEntry(entry);

          if (result.ready_for_next) {
            // Delete the processed queue file
            fs.unlinkSync(filePath);
          } else {
            // Mark as failed for retry
            entry.status = 'pending';
            entry.lastError = 'Agent not ready for next';
            fs.writeFileSync(filePath, JSON.stringify(entry, null, 2));
          }
        } catch (err) {
          // Log error but continue processing queue
          console.error(`Error processing queue entry ${file}:`, err.message);

          // Reset status to pending for retry
          try {
            const content = fs.readFileSync(filePath, 'utf8');
            const entry = JSON.parse(content);
            entry.status = 'pending';
            entry.lastError = err.message;
            fs.writeFileSync(filePath, JSON.stringify(entry, null, 2));
          } catch (e) {
            // File may have been deleted or corrupted
          }
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Reset the session (called on context exhaustion)
   */
  resetSession() {
    this.session = null;
    this.sessionId = null;
  }
}

// ============================================
// Remember Tool Handler
// ============================================

let queueProcessor = null;

async function handleRemember(params) {
  const { category, content } = params;

  // Validate category
  if (!CATEGORIES.includes(category)) {
    throw new Error(`Invalid category: ${category}. Must be one of: ${CATEGORIES.join(', ')}`);
  }

  // Validate content
  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    throw new Error('Content is required and must be a non-empty string');
  }

  const projectRoot = getProjectRoot();
  const queueDir = path.join(projectRoot, QUEUE_DIR);

  // Ensure queue directory exists
  ensureDir(queueDir);

  // Create queue entry
  const timestamp = Date.now();
  const id = generateShortId();
  const entry = {
    id,
    timestamp,
    status: 'pending',
    entry: {
      category,
      content: content.trim()
    }
  };

  // Write to queue file
  const filename = `${timestamp}-${id}.json`;
  const filepath = path.join(queueDir, filename);
  fs.writeFileSync(filepath, JSON.stringify(entry, null, 2));

  // Initialize queue processor if needed
  if (!queueProcessor) {
    queueProcessor = new QueueProcessor(projectRoot);
  }

  // Trigger async processing (non-blocking)
  setImmediate(() => {
    queueProcessor.processQueue().catch(err => {
      console.error('Queue processing error:', err.message);
    });
  });

  // Return immediately (non-blocking)
  return `Queued for processing: [${category}] ${content.substring(0, 50)}${content.length > 50 ? '...' : ''}`;
}

// ============================================
// MCP Tool Definitions
// ============================================

const REMEMBER_TOOL = {
  name: 'remember',
  description: `Capture a discovery or insight for the project's persistent knowledge base.

Use this tool to record:
- Architecture decisions and patterns discovered
- Gotchas and pitfalls encountered
- Dependency information and quirks
- Workflow optimizations and processes
- Code patterns and conventions

Knowledge is automatically deduplicated and organized. Conflicts are queued for review.`,
  inputSchema: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        enum: ['architecture', 'patterns', 'dependencies', 'workflows', 'gotchas'],
        description: 'The category of knowledge: architecture (system design), patterns (code conventions), dependencies (external libs), workflows (processes), gotchas (pitfalls)'
      },
      content: {
        type: 'string',
        description: 'The knowledge to remember - be specific and include context'
      }
    },
    required: ['category', 'content']
  }
};

// ============================================
// MCP Request Handler
// ============================================

async function handleRequest(request) {
  const { id, method, params } = request;

  switch (method) {
    case 'initialize':
      return createResponse(id, {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: 'mim',
          version: '2.0.0'
        }
      });

    case 'notifications/initialized':
      // This is a notification, no response needed
      return null;

    case 'tools/list':
      return createResponse(id, {
        tools: [REMEMBER_TOOL]
      });

    case 'tools/call':
      if (params?.name === 'remember') {
        try {
          const result = await handleRemember(params.arguments || {});
          return createResponse(id, {
            content: [
              {
                type: 'text',
                text: result
              }
            ]
          });
        } catch (err) {
          return createResponse(id, {
            content: [
              {
                type: 'text',
                text: `Error: ${err.message}`
              }
            ],
            isError: true
          });
        }
      }
      return createError(id, -32601, `Unknown tool: ${params?.name}`);

    default:
      if (id !== undefined) {
        return createError(id, -32601, `Method not found: ${method}`);
      }
      // Notifications don't need responses
      return null;
  }
}

// ============================================
// Main Server Loop
// ============================================

function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  rl.on('line', async (line) => {
    if (!line.trim()) return;

    try {
      const request = JSON.parse(line);
      const response = await handleRequest(request);
      if (response) {
        process.stdout.write(response + '\n');
      }
    } catch (err) {
      const errorResponse = createError(null, -32700, 'Parse error');
      process.stdout.write(errorResponse + '\n');
    }
  });

  rl.on('close', () => {
    process.exit(0);
  });
}

main();
