#!/usr/bin/env node
import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';

// Helper to send JSON-RPC responses
function respond(id: number | string, result: any): void {
    const response = { jsonrpc: '2.0', id, result };
    console.log(JSON.stringify(response));
}

function respondError(id: number | string, code: number, message: string): void {
    const response = { jsonrpc: '2.0', id, error: { code, message } };
    console.log(JSON.stringify(response));
}

// The actual remembering function
function remember(args: {
    category: string;
    topic: string;
    details: string;
    files?: string;
}): string {
    const { category, topic, details, files } = args;

    // Ensure knowledge directory exists
    const knowledgeDir = path.join(process.cwd(), '.claude', 'knowledge');
    if (!fs.existsSync(knowledgeDir)) {
        fs.mkdirSync(knowledgeDir, { recursive: true });
    }

    const sessionFile = path.join(knowledgeDir, 'session.md');

    // Create session file header if it doesn't exist
    if (!fs.existsSync(sessionFile)) {
        const date = new Date().toISOString().split('T')[0];
        fs.writeFileSync(sessionFile, `# Knowledge Capture Session - ${date}\n\n`);
    }

    // Format the entry
    const time = new Date().toTimeString().slice(0, 5);
    let entry = `### [${time}] [${category}] ${topic}\n`;
    entry += `**Details**: ${details}\n`;
    if (files) {
        entry += `**Files**: ${files}\n`;
    }
    entry += `---\n\n`;

    // Atomic append
    fs.appendFileSync(sessionFile, entry);

    return `✓ Remembered in .claude/knowledge/session.md: [${category}] ${topic}`;
}

// Set up stdin reader for JSON-RPC
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
});

// Handle incoming JSON-RPC requests
rl.on('line', (line: string) => {
    try {
        const request = JSON.parse(line);

        if (request.method === 'initialize') {
            respond(request.id, {
                protocolVersion: '2024-11-05',
                serverInfo: { name: 'mim', version: '1.0.0' },
                capabilities: {
                    tools: {}
                }
            });
        } else if (request.method === 'tools/list') {
            respond(request.id, {
                tools: [{
                    name: 'remember',
                    description: `Capture project discoveries and learnings for persistent documentation. Automatically preserves knowledge about architecture, patterns, workflows, dependencies, configurations, and unique behaviors.

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
✗ Skip: Current bug fixes, temporary debug output, generic programming concepts`,
                    inputSchema: {
                        type: 'object',
                        properties: {
                            category: {
                                type: 'string',
                                description: 'Category name for organizing this knowledge. Use descriptive categories like: architecture, api, database, pattern, dependency, workflow, config, gotcha, convention, testing, security, deployment, frontend, backend, auth, etc. Any relevant category name is acceptable.',
                                examples: ['architecture', 'api', 'database', 'pattern', 'dependency', 'workflow', 'config', 'gotcha', 'testing', 'security', 'auth', 'frontend', 'backend']
                            },
                            topic: {
                                type: 'string',
                                description: 'Short, descriptive title of what you learned (5-10 words)'
                            },
                            details: {
                                type: 'string',
                                description: 'Full explanation of the discovery, including context, implications, and examples'
                            },
                            files: {
                                type: 'string',
                                description: 'Optional: Comma-separated list of relevant file paths',
                                required: false
                            }
                        },
                        required: ['category', 'topic', 'details']
                    }
                }]
            });
        } else if (request.method === 'tools/call') {
            if (request.params?.name === 'remember') {
                const result = remember(request.params.arguments);
                respond(request.id, {
                    content: [{
                        type: 'text',
                        text: result
                    }]
                });
            } else {
                respondError(request.id, -32601, `Unknown tool: ${request.params?.name}`);
            }
        } else {
            respondError(request.id, -32601, `Unknown method: ${request.method}`);
        }
    } catch (error) {
        // Invalid JSON or other errors
        console.error('Error processing request:', error);
    }
});