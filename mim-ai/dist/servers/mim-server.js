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
import * as readline from 'node:readline';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
import { z } from 'zod';
import { logInfo, logWarn, logError, AGENTS } from '../utils/logger.js';
/**
 * Queue Processor Output Schema (Zod)
 */
const QueueProcessorOutputSchema = z.object({
    status: z.enum(['processed', 'conflict_detected']),
    action: z.enum(['added', 'updated', 'duplicate_skipped', 'created_review']),
    file_modified: z.string().nullable(),
    ready_for_next: z.boolean(),
});
// ============================================
// Configuration
// ============================================
const KNOWLEDGE_BASE_DIR = '.claude/knowledge';
const QUEUE_DIR = `${KNOWLEDGE_BASE_DIR}/remember-queue`;
const PENDING_REVIEW_DIR = `${KNOWLEDGE_BASE_DIR}/pending-review`;
// Core categories - but any category is allowed
const CORE_CATEGORIES = ['architecture', 'patterns', 'dependencies', 'workflows', 'gotchas'];
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
function recoverStaleQueueEntries(projectRoot) {
    const queueDir = path.join(projectRoot, '.claude/knowledge/remember-queue');
    if (!fs.existsSync(queueDir))
        return;
    const files = fs.readdirSync(queueDir).filter(f => f.endsWith('.json'));
    const staleThreshold = 5 * 60 * 1000; // 5 minutes
    for (const file of files) {
        const filePath = path.join(queueDir, file);
        try {
            const entry = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            if (entry.status === 'processing') {
                const processingTime = entry.processingStartedAt || 0;
                if (Date.now() - processingTime > staleThreshold) {
                    entry.status = 'pending';
                    entry.lastError = 'Recovered from stale processing state';
                    delete entry.processingStartedAt;
                    fs.writeFileSync(filePath, JSON.stringify(entry, null, 2));
                    logInfo(AGENTS.MCP_SERVER, `Recovered stale queue entry: ${entry.id}`);
                }
            }
        }
        catch (e) {
            // Skip corrupted files
        }
    }
}
function findClaudeExecutable() {
    try {
        // Try 'which claude' first
        const result = execSync('which claude', { encoding: 'utf8' }).trim();
        if (result && fs.existsSync(result)) {
            // Follow symlinks to get the real path
            return fs.realpathSync(result);
        }
    }
    catch (e) {
        // which failed, try common paths
    }
    // Common installation paths
    const home = homedir();
    const commonPaths = [
        path.join(home, '.local', 'bin', 'claude'),
        '/usr/local/bin/claude',
        '/usr/bin/claude',
    ];
    for (const p of commonPaths) {
        if (fs.existsSync(p)) {
            return fs.realpathSync(p);
        }
    }
    // Fallback - assume 'claude' is in PATH
    return 'claude';
}
// ============================================
// Queue Processor Agent (Agent 1)
// ============================================
/**
 * Agent 1 System Prompt - Knowledge processor
 */
const QUEUE_PROCESSOR_SYSTEM_PROMPT = `You are the Knowledge Processor for Mim, a persistent memory system.

Your job is to process incoming knowledge entries and organize them into the appropriate files, then update the knowledge maps.

## Available Tools

You have access to: Read, Write, Edit, Glob, Grep, Bash
You do NOT have access to: AskUserQuestion (you cannot ask the user anything)

Use these tools to examine existing knowledge and write new entries.

## Knowledge Structure

The knowledge base is organized under .claude/knowledge/:

**Category Directories:**
- architecture/ - System design, component relationships, data flow
- patterns/ - Code patterns, conventions, idioms used in the project
- dependencies/ - External dependencies, their purposes, version notes
- workflows/ - Development workflows, deployment processes, common tasks
- gotchas/ - Pitfalls, gotchas, things that don't work as expected

**Knowledge Maps (MUST UPDATE BOTH):**
- KNOWLEDGE_MAP.md - User-facing index with markdown links like [Topic Name](category/file.md)
- KNOWLEDGE_MAP_CLAUDE.md - Claude-facing index with RELATIVE @ references like @category/file.md

Both maps should have identical structure, just different link formats.

## Entry Format

Each entry you receive has:
- category: The knowledge category (architecture, patterns, etc.)
- topic: Brief descriptive title
- details: Full content/explanation
- files: Optional related file paths (comma-separated)

## Your Task

When you receive a knowledge entry to process:

1. **Check for duplicates**: Use Grep to search existing files for similar content
2. **Check for conflicts**: Look for existing knowledge that contradicts the new entry
3. **Take action**:
   - If duplicate: Skip it (action: duplicate_skipped)
   - If conflicts: Create a pending-review JSON file (action: created_review)
   - Otherwise: Append to the appropriate file or create a new one (action: added/updated)
4. **UPDATE BOTH KNOWLEDGE MAPS** when adding/updating:
   - Add entry to KNOWLEDGE_MAP.md with markdown link: [Topic](category/file.md)
   - Add entry to KNOWLEDGE_MAP_CLAUDE.md with @ reference: @category/file.md
   - Place under the appropriate category section (## Architecture, ## Patterns, etc.)

## Pending Review Format

When conflicts are detected, write to .claude/knowledge/pending-review/{id}-{subject}.json:

{
  "id": "short-id",
  "subject": "brief-subject-slug",
  "type": "conflict",
  "question": "Explain the situation in 2-4 sentences. The user sees BOTH this AND the options list below, so do NOT repeat or list the options here - just explain what happened and what needs deciding.",
  "options": ["First option", "Second option"],
  "knowledge_file": "category/filename.md",
  "agent_notes": "Technical details for applying the decision - file paths, what to change, etc. Human does NOT see this."
}

## File Organization

When adding new knowledge:
- Use descriptive filenames based on topic: architecture/api-design.md
- Append to existing files when the topic matches
- Create new files for distinct topics
- Use markdown formatting with headers
- Include the topic as an H2 header (## Topic Name)
- Include related files if provided

Example file content:
\`\`\`markdown
## Redis Caching Strategy

The application uses Redis for session caching with a 30-minute TTL.

**Related files:** src/cache/redis.js, config/redis.yml
\`\`\`

## Structured Output

Your response MUST be valid JSON with these exact fields:
- status: "processed" or "conflict_detected"
- action: "added", "updated", "duplicate_skipped", or "created_review"
- file_modified: path to the file you modified, or null if none
- ready_for_next: always set to true when done with this entry

Example: {"status":"processed","action":"added","file_modified":"architecture/api.md","ready_for_next":true}

## Important

- Be ruthless about avoiding duplicates - skip anything that's essentially the same
- When in doubt about conflicts, create a review entry
- Always signal ready_for_next: true when done processing an entry
- If you encounter errors, still output valid JSON with ready_for_next: true
- **ALWAYS update both knowledge maps when adding or updating entries**

## Output Schema (REQUIRED)

You MUST always respond with this exact JSON structure:

{
  "status": "processed" | "conflict_detected",
  "action": "added" | "updated" | "duplicate_skipped" | "created_review",
  "file_modified": "/path/to/file.md" | null,
  "ready_for_next": true | false
}

- status: Whether processing completed normally or found a conflict
- action: What you did with the entry
- file_modified: Path to the file you modified, or null if none
- ready_for_next: Always set to true when done with the current entry

## Tool Restrictions

You have access to file tools (Read, Write, Edit, Grep, Glob) but NOT AskUserQuestion.
When facing decisions, use your best judgment rather than asking.`;
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
    projectRoot;
    session;
    sessionId;
    isProcessing;
    query;
    constructor(projectRoot) {
        this.projectRoot = projectRoot;
        this.session = null;
        this.sessionId = null;
        this.isProcessing = false;
        this.query = null;
    }
    /**
     * Initialize the SDK (dynamic import for ESM in CJS)
     */
    async initSDK() {
        if (this.query)
            return;
        try {
            // Dynamic import of ESM module in CommonJS
            const sdk = await import('@anthropic-ai/claude-agent-sdk');
            this.query = sdk.query;
            logInfo(AGENTS.QUEUE_PROCESSOR, 'Claude Agent SDK imported successfully');
        }
        catch (err) {
            logError(AGENTS.QUEUE_PROCESSOR, `Failed to import Claude Agent SDK: ${err.message}`);
            throw err;
        }
    }
    /**
     * Load all existing knowledge for context
     */
    async loadAllKnowledge() {
        const knowledgeDir = path.join(this.projectRoot, KNOWLEDGE_BASE_DIR);
        let content = '';
        for (const category of CORE_CATEGORIES) {
            const categoryDir = path.join(knowledgeDir, category);
            if (!fs.existsSync(categoryDir))
                continue;
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
        logInfo(AGENTS.QUEUE_PROCESSOR, 'Starting new agent session');
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
            pathToClaudeCodeExecutable: findClaudeExecutable(),
            // Don't load project CLAUDE.md - agent has its own instructions
        };
        this.session = this.query({ prompt, options });
        // Process initial response to get session ID
        for await (const message of this.session) {
            if (message.type === 'system' && message.subtype === 'init') {
                this.sessionId = message.session_id;
                logInfo(AGENTS.QUEUE_PROCESSOR, `Session started with ID ${this.sessionId}`);
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
    async sendToAgent(message, isRetry = false) {
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
            },
            pathToClaudeCodeExecutable: findClaudeExecutable(),
        };
        try {
            const session = this.query({ prompt: message, options });
            let structuredOutput = null;
            for await (const msg of session) {
                if (msg.type === 'result' && msg.subtype === 'success') {
                    structuredOutput = msg.structured_output || null;
                }
            }
            return structuredOutput;
        }
        catch (err) {
            // Check for context exhaustion
            if (err.message && err.message.toLowerCase().includes('context') && !isRetry) {
                logWarn(AGENTS.QUEUE_PROCESSOR, 'Context exhaustion detected, resetting session');
                this.resetSession();
                // Retry once with fresh session
                return this.sendToAgent(message, true);
            }
            throw err;
        }
    }
    /**
     * Process a single queue entry
     */
    async processEntry(entry, isRetry = false) {
        logInfo(AGENTS.QUEUE_PROCESSOR, `Processing queue entry ${entry.id} [${entry.entry.category}]`);
        try {
            // Ensure session is started
            await this.getSession();
            const prompt = `Process this knowledge entry:

Category: ${entry.entry.category}
Content: ${entry.entry.content}

Timestamp: ${entry.timestamp}
ID: ${entry.id}

Analyze this against existing knowledge and take the appropriate action.`;
            const result = await this.sendToAgent(prompt);
            if (result) {
                logInfo(AGENTS.QUEUE_PROCESSOR, `Entry ${entry.id} processed: ${result.action}${result.file_modified ? ` -> ${result.file_modified}` : ''}`);
            }
            return result || {
                status: 'processed',
                action: 'added',
                file_modified: null,
                ready_for_next: true
            };
        }
        catch (err) {
            // Check for context exhaustion
            if (err.message && err.message.toLowerCase().includes('context') && !isRetry) {
                logWarn(AGENTS.QUEUE_PROCESSOR, 'Context exhaustion detected in processEntry, resetting session');
                this.resetSession();
                // Retry once with fresh session
                return this.processEntry(entry, true);
            }
            logError(AGENTS.QUEUE_PROCESSOR, `Error processing entry ${entry.id}: ${err.message}`);
            throw err;
        }
    }
    /**
     * Process all pending queue entries
     */
    async processQueue() {
        if (this.isProcessing)
            return;
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
            if (files.length === 0) {
                this.isProcessing = false;
                return;
            }
            logInfo(AGENTS.QUEUE_PROCESSOR, `Starting queue processing: ${files.length} entries`);
            for (const file of files) {
                const filePath = path.join(queueDir, file);
                try {
                    const content = fs.readFileSync(filePath, 'utf8');
                    const entry = JSON.parse(content);
                    if (entry.status !== 'pending')
                        continue;
                    // Mark as processing
                    entry.status = 'processing';
                    entry.processingStartedAt = Date.now();
                    fs.writeFileSync(filePath, JSON.stringify(entry, null, 2));
                    // Process the entry
                    const result = await this.processEntry(entry);
                    if (result.ready_for_next) {
                        // Delete the processed queue file
                        fs.unlinkSync(filePath);
                    }
                    else {
                        // Mark as failed for retry
                        entry.status = 'pending';
                        entry.lastError = 'Agent not ready for next';
                        fs.writeFileSync(filePath, JSON.stringify(entry, null, 2));
                        logWarn(AGENTS.QUEUE_PROCESSOR, `Entry ${entry.id} marked for retry: agent not ready`);
                    }
                }
                catch (err) {
                    // Log error but continue processing queue
                    logError(AGENTS.QUEUE_PROCESSOR, `Error processing queue entry ${file}: ${err.message}`);
                    // Reset status to pending for retry
                    try {
                        const content = fs.readFileSync(filePath, 'utf8');
                        const entry = JSON.parse(content);
                        entry.status = 'pending';
                        entry.lastError = err.message;
                        fs.writeFileSync(filePath, JSON.stringify(entry, null, 2));
                    }
                    catch (e) {
                        // File may have been deleted or corrupted
                    }
                }
            }
            logInfo(AGENTS.QUEUE_PROCESSOR, 'Queue processing completed');
        }
        finally {
            this.isProcessing = false;
        }
    }
    /**
     * Reset the session (called on context exhaustion)
     */
    resetSession() {
        logInfo(AGENTS.QUEUE_PROCESSOR, `Resetting session${this.sessionId ? ` (previous ID: ${this.sessionId})` : ''}`);
        this.session = null;
        this.sessionId = null;
    }
}
// ============================================
// Remember Tool Handler
// ============================================
let queueProcessor = null;
async function handleRemember(params) {
    const { category, topic, details, files } = params;
    // Validate category (any string allowed, but must be provided)
    if (!category || typeof category !== 'string' || category.trim().length === 0) {
        throw new Error('Category is required and must be a non-empty string');
    }
    // Validate topic
    if (!topic || typeof topic !== 'string' || topic.trim().length === 0) {
        throw new Error('Topic is required and must be a non-empty string');
    }
    // Validate details
    if (!details || typeof details !== 'string' || details.trim().length === 0) {
        throw new Error('Details is required and must be a non-empty string');
    }
    // Normalize category to match core categories or use as-is
    const normalizedCategory = normalizeCategory(category.trim().toLowerCase());
    const projectRoot = getProjectRoot();
    const queueDir = path.join(projectRoot, QUEUE_DIR);
    // Ensure queue directory exists
    ensureDir(queueDir);
    // Create queue entry with v1-style structure
    const timestamp = Date.now();
    const id = generateShortId();
    const entry = {
        id,
        timestamp,
        status: 'pending',
        entry: {
            category: normalizedCategory,
            topic: topic.trim(),
            details: details.trim(),
            files: files ? files.trim() : null
        }
    };
    // Write to queue file
    const filename = `${timestamp}-${id}.json`;
    const filepath = path.join(queueDir, filename);
    fs.writeFileSync(filepath, JSON.stringify(entry, null, 2));
    logInfo(AGENTS.MCP_SERVER, `Entry queued: ${id} [${normalizedCategory}] ${topic}`);
    // Initialize queue processor if needed
    if (!queueProcessor) {
        queueProcessor = new QueueProcessor(projectRoot);
    }
    // Trigger async processing (non-blocking)
    setImmediate(() => {
        queueProcessor.processQueue().catch(err => {
            logError(AGENTS.MCP_SERVER, `Queue processing error: ${err.message}`);
        });
    });
    // Return immediately (non-blocking)
    return `✓ Remembered: [${normalizedCategory}] ${topic}`;
}
/**
 * Normalize category names to core categories where appropriate
 */
function normalizeCategory(category) {
    // Map common synonyms to core categories
    const categoryMap = {
        // architecture
        'architecture': 'architecture',
        'design': 'architecture',
        'structure': 'architecture',
        'system': 'architecture',
        // patterns
        'patterns': 'patterns',
        'pattern': 'patterns',
        'convention': 'patterns',
        'conventions': 'patterns',
        'idiom': 'patterns',
        'idioms': 'patterns',
        // dependencies
        'dependencies': 'dependencies',
        'dependency': 'dependencies',
        'deps': 'dependencies',
        'packages': 'dependencies',
        'libs': 'dependencies',
        'libraries': 'dependencies',
        // workflows
        'workflows': 'workflows',
        'workflow': 'workflows',
        'process': 'workflows',
        'processes': 'workflows',
        'deployment': 'workflows',
        'build': 'workflows',
        // gotchas
        'gotchas': 'gotchas',
        'gotcha': 'gotchas',
        'pitfall': 'gotchas',
        'pitfalls': 'gotchas',
        'bug': 'gotchas',
        'bugs': 'gotchas',
        'quirk': 'gotchas',
        'quirks': 'gotchas',
    };
    return categoryMap[category] || category;
}
// ============================================
// MCP Tool Definitions
// ============================================
const REMEMBER_TOOL = {
    name: 'remember',
    description: `Capture project discoveries and learnings for persistent documentation. Automatically preserves knowledge about architecture, patterns, workflows, dependencies, and unique behaviors.

🎯 USE THIS TOOL when you:
• Discover how something works in this project
• Learn project-specific patterns or conventions
• Find configuration details or requirements
• Understand architecture or system design
• Encounter non-obvious behaviors or gotchas
• Figure out dependencies or integrations
• Realize your assumptions were incorrect

💡 KEY TRIGGERS - phrases that signal discovery:
"I learned that", "turns out", "actually it's", "I discovered", "for future reference", "good to know", "interesting that"

⚡ ALWAYS CAPTURE project-specific knowledge immediately - this creates the persistent memory that survives context resets.

✓ Examples: Database schema conventions, API authentication flows, build system quirks
✗ Skip: Current bug fixes, temporary debug output, generic programming concepts

Knowledge is automatically deduplicated and organized. Conflicts are queued for human review.`,
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
// ============================================
// MCP Request Handler
// ============================================
async function handleRequest(request) {
    const { id, method, params } = request;
    switch (method) {
        case 'initialize':
            return createResponse(id ?? null, {
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
            // Process any pending queue entries on startup
            const projectRoot = getProjectRoot();
            if (!queueProcessor) {
                queueProcessor = new QueueProcessor(projectRoot);
            }
            // Recover stale entries before processing
            recoverStaleQueueEntries(projectRoot);
            setImmediate(() => {
                queueProcessor.processQueue().catch(err => {
                    logError(AGENTS.MCP_SERVER, `Startup queue processing error: ${err.message}`);
                });
            });
            // This is a notification, no response needed
            return null;
        case 'tools/list':
            return createResponse(id ?? null, {
                tools: [REMEMBER_TOOL]
            });
        case 'tools/call':
            const toolParams = params;
            if (toolParams?.name === 'remember') {
                try {
                    const result = await handleRemember((toolParams.arguments || {}));
                    return createResponse(id ?? null, {
                        content: [
                            {
                                type: 'text',
                                text: result
                            }
                        ]
                    });
                }
                catch (err) {
                    return createResponse(id ?? null, {
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
            return createError(id ?? null, -32601, `Unknown tool: ${toolParams?.name}`);
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
        if (!line.trim())
            return;
        try {
            const request = JSON.parse(line);
            const response = await handleRequest(request);
            if (response) {
                process.stdout.write(response + '\n');
            }
        }
        catch (err) {
            const errorResponse = createError(null, -32700, 'Parse error');
            process.stdout.write(errorResponse + '\n');
        }
    });
    rl.on('close', () => {
        process.exit(0);
    });
}
main();
//# sourceMappingURL=mim-server.js.map