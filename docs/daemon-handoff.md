# Mim Daemon Architecture - Implementation Handoff

## Problem Statement

Mim's current architecture has a critical memory leak caused by recursive agent spawning. When the MCP server calls `query()` from the Claude Agent SDK, it spawns a Claude Code subprocess. That subprocess loads all project MCP servers — including Mim's — which initializes its own `QueueProcessor`, calls `processQueue()`, and spawns yet another `query()`. With N pending queue entries, this creates a cascade of N nested Claude Code processes, each running an Opus agent with its own MCP server stack. A typical session where Claude calls `remember()` 15-20 times results in 15-20+ simultaneous processes, consuming 40GB+ of memory.

The root cause: the MCP server hosts an Opus agent that calls `query()`. The fix is to move all agent work into a standalone daemon process. The MCP server becomes a stateless file writer. The daemon owns a single-worker queue — only one `query()` call runs at any time.

## Success Criteria

1. The MCP server never imports or calls `query()` from the Claude Agent SDK
2. The `remember()` tool writes a JSON file and optionally pings the daemon — nothing else
3. All agent work (queue processing, inquisitors, curator, context checks) runs in a single daemon process
4. The daemon processes one job at a time via a single-worker queue — never more than one `query()` call running simultaneously
5. Memory usage stays bounded — no recursive process spawning
6. The daemon is cross-platform (Mac, Linux, Windows) using localhost HTTP
7. No user-facing workflow changes — `remember()`, `mim review`, `mim status` all work the same
8. Context usage from knowledge files is checked periodically and factors into inquisitor/curator aggressiveness

## Scope

### In Scope

- New daemon process with HTTP server and single-worker job queue
- Refactored MCP server (remove QueueProcessor class and all SDK imports)
- Refactored SessionStart hook (start daemon instead of spawning background analysis)
- New Opus curator agent (reviews pending reviews for dedup/auto-resolve)
- Context usage checking via `/context` command
- Updated `mim` CLI commands for daemon lifecycle
- Updated build pipeline for new daemon bundle

### Out of Scope

- Changes to the TUI game or Wellspring agent (stays as-is, user-initiated)
- Changes to the review file format (ReviewEntry schema) or knowledge file format
- Persistent daemon (it self-terminates after idle timeout)

---

## Architecture Overview

### Current (Broken)

```
Claude Code session
├── MCP Server (mim-server.bundled.cjs) ← RUNS OPUS AGENT VIA query()
│   ├── remember() → writes queue JSON + triggers processQueue()
│   └── QueueProcessor → query() → Claude Code subprocess
│       └── subprocess loads MCP server → recursive query() spawning
├── SessionStart Hook (session-start.bundled.mjs)
│   └── spawns detached: run-analysis.bundled.mjs
│       └── Inquisitor Swarm → query() per entry (Haiku)
│           └── each subprocess also loads MCP server → more recursion
└── User session
```

### Target

```
Claude Code session
├── MCP Server (mim-server.bundled.cjs) ← STATELESS, NO SDK
│   └── remember() → writes queue JSON → fire-and-forget HTTP ping to daemon
├── SessionStart Hook (session-start.bundled.mjs)
│   └── ensures daemon is running → HTTP ping to daemon
└── User session

Daemon process (standalone, detached Node.js process)
├── HTTP server on localhost:{random_port}
│   └── GET /ping → respond with status + trigger scheduler
├── Scheduler → scans disk state, enqueues jobs
├── Single-worker job queue (in-memory, rebuilt from disk on start)
│   ├── remember jobs (Opus) → process one queue entry
│   ├── inquisitor jobs (Haiku) → validate one knowledge entry
│   ├── curator jobs (Opus) → review all pending reviews
│   └── context-check jobs → measure memory file token usage
├── State files: ~/.mim/daemon/{repo-hash}.port, .pid
└── Self-terminates after 30 min idle
```

### Why the Recursion Dies

The daemon is a standalone Node.js process. It calls `query()`, which spawns Claude Code subprocesses. Those subprocesses load the Mim MCP server. But the MCP server is now inert — it never calls `query()`, never processes the queue, never spawns agents. It just writes files. So the recursion has nowhere to go.

---

## Daemon Process

### Lifecycle

1. **Start**: SessionStart hook (or `mim daemon start`) spawns daemon as a detached child process
2. **Run**: Daemon listens on `http://127.0.0.1:{random_port}`, processes jobs one at a time
3. **Wake**: On each `/ping`, the scheduler scans for new work and enqueues jobs
4. **Idle**: After 30 minutes with no `/ping` and no active job, daemon shuts down
5. **Shutdown**: Deletes port/PID files, exits cleanly. On SIGTERM/SIGINT: kill current job, delete files, exit.

### Port/PID Management

Location: `~/.mim/daemon/`

Files per repo:
- `{repo-hash}.port` — contains the port number (e.g., `52847`)
- `{repo-hash}.pid` — contains the process ID (e.g., `12345`)

`repo-hash`: deterministic hash of the absolute repo path (e.g., `crypto.createHash('sha256').update(repoPath).digest('hex').slice(0, 12)`)

On startup:
1. Check if PID file exists and process is alive → exit (already running)
2. Bind `http.createServer` to port `0` on `127.0.0.1` (OS assigns random available port)
3. Write port file and PID file
4. Start idle timer

On shutdown:
1. Delete port and PID files
2. Close HTTP server
3. `process.exit(0)`

### HTTP API

Single endpoint:

```
GET /ping

Response: {
  "status": "ok",
  "processing": "remember" | "inquisitor" | "curator" | "context-check" | null,
  "queue_depth": 5,
  "uptime_ms": 120000
}

Side effect: triggers scheduler to scan for new work
```

This is the only endpoint. Everything else happens through the filesystem (queue files, state files, knowledge files).

### Idle Timeout

```typescript
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
let idleTimer: NodeJS.Timeout;

function resetIdleTimer(): void {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(shutdown, IDLE_TIMEOUT_MS);
}

// Reset on every /ping AND after every job completes
```

---

## Single-Worker Job Queue

### Job Types

```typescript
interface Job {
  type: 'remember' | 'inquisitor' | 'curator' | 'context-check';
  id: string;          // unique, used for deduplication
  priority: number;    // lower number = higher priority
  data: unknown;       // job-specific payload
  enqueuedAt: string;  // ISO timestamp
}
```

### Priority Order

| Priority | Type | Rationale |
|----------|------|-----------|
| 0 | `remember` | User-initiated, should process quickly |
| 1 | `curator` | Cleans up before inquisitors add more reviews |
| 2 | `context-check` | Informs inquisitor aggressiveness |
| 3 | `inquisitor` | Bulk work, lowest priority |

### Queue Behavior

- **In-memory only.** Rebuilt from disk state on daemon start.
- **Deduplicated by job ID.** If a job with the same ID is already queued, skip.
- **Priority insert.** New jobs inserted at correct position by priority (stable within same priority — FIFO).
- **Single worker.** `processNext()` is a no-op if a job is already running. After a job completes, automatically processes the next one.
- **No persistence.** If the daemon crashes, the scheduler rebuilds the queue from disk state on next start. Queue files and state files ARE the persistence layer.

```typescript
class WorkerQueue {
  private queue: Job[] = [];
  private processing: boolean = false;
  private currentJob: Job | null = null;

  enqueue(job: Job): boolean {
    // Dedupe: skip if job.id already in queue
    if (this.queue.some(j => j.id === job.id)) return false;
    // Also skip if it's the currently processing job
    if (this.currentJob?.id === job.id) return false;

    // Insert by priority (stable: same priority → FIFO)
    const idx = this.queue.findIndex(j => j.priority > job.priority);
    if (idx === -1) this.queue.push(job);
    else this.queue.splice(idx, 0, job);

    // Kick worker if idle
    if (!this.processing) setImmediate(() => this.processNext());
    return true;
  }

  async processNext(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;
    this.currentJob = this.queue.shift()!;
    try {
      await executeJob(this.currentJob);
    } catch (err) {
      logError('DAEMON', `Job ${this.currentJob.id} failed: ${err}`);
    } finally {
      this.currentJob = null;
      this.processing = false;
      resetIdleTimer();
      if (this.queue.length > 0) setImmediate(() => this.processNext());
    }
  }

  getStatus(): { processing: string | null; depth: number } {
    return {
      processing: this.currentJob?.type ?? null,
      depth: this.queue.length,
    };
  }
}
```

---

## Scheduler

Runs on every `/ping`. Scans disk state and enqueues jobs. Must be fast (all filesystem reads, no agent calls).

```typescript
function schedule(queue: WorkerQueue, repoPath: string): void {
  const knowledgeDir = path.join(repoPath, '.claude/knowledge');

  // 1. Remember queue entries → remember jobs
  const queueDir = path.join(knowledgeDir, 'remember-queue');
  if (fs.existsSync(queueDir)) {
    const files = fs.readdirSync(queueDir).filter(f => f.endsWith('.json')).sort();
    for (const file of files) {
      const entry = JSON.parse(fs.readFileSync(path.join(queueDir, file), 'utf-8'));
      if (entry.status === 'pending') {
        queue.enqueue({
          type: 'remember',
          id: `remember:${entry.id}`,
          priority: 0,
          data: { file, entry },
          enqueuedAt: new Date().toISOString(),
        });
      }
    }
  }

  // 2. Curator — if pending reviews changed since last run
  const pendingDir = path.join(knowledgeDir, 'pending-review');
  const curatorState = readCuratorState(knowledgeDir);
  const currentReviewIds = getUnansweredReviewIds(pendingDir);
  if (currentReviewIds.length > 0 && reviewsChangedSince(curatorState, currentReviewIds)) {
    queue.enqueue({
      type: 'curator',
      id: 'curator',  // singleton — only one curator job at a time
      priority: 1,
      data: { reviewIds: currentReviewIds },
      enqueuedAt: new Date().toISOString(),
    });
  }

  // 3. Context check — at most once every 6 hours
  const contextUsage = readContextUsage(knowledgeDir);
  const sixHoursAgo = Date.now() - (6 * 60 * 60 * 1000);
  if (!contextUsage || new Date(contextUsage.checked_at).getTime() < sixHoursAgo) {
    queue.enqueue({
      type: 'context-check',
      id: 'context-check',  // singleton
      priority: 2,
      data: {},
      enqueuedAt: new Date().toISOString(),
    });
  }

  // 4. Inquisitor jobs — knowledge entries that need validation
  const manifest = readEntryManifest();  // from changes-reviewer.ts
  const currentHead = getCurrentHead(repoPath);
  const entries = getAllKnowledgeEntries(knowledgeDir);  // from inquisitor.ts parseKnowledgeEntries

  for (const entry of entries) {
    // Skip if pending review already exists
    if (pendingReviewExists(pendingDir, entry.id)) continue;
    // Skip if recently checked (same throttling as current run-analysis.ts)
    if (shouldSkipEntry(entry.id, manifest, currentHead)) continue;

    queue.enqueue({
      type: 'inquisitor',
      id: `inquisitor:${entry.id}`,
      priority: 3,
      data: { entry },
      enqueuedAt: new Date().toISOString(),
    });
  }
}
```

### Throttling Constants (carried from current run-analysis.ts)

```typescript
const MANIFEST_THROTTLE_MS = 60 * 60 * 1000;      // 1 hour — skip if different commit but checked recently
const MANIFEST_RECHECK_MS = 24 * 60 * 60 * 1000;   // 24 hours — re-check even if same commit
const CONTEXT_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
```

---

## Shared Utilities

### Context Budget Note

The `contextBudgetNote` variable appears in the remember and inquisitor prompts. It's built by reading `.claude/knowledge/context-usage.json` (written by the context-check job). If the file doesn't exist yet, it returns an empty string and the note is omitted from the prompt.

```typescript
function buildContextBudgetNote(knowledgeDir: string): string {
  const usageFile = path.join(knowledgeDir, 'context-usage.json');
  try {
    const usage = JSON.parse(fs.readFileSync(usageFile, 'utf-8'));
    const pct = (usage.memory_files_tokens / usage.budget_tokens * 100).toFixed(0);
    if (usage.memory_files_tokens > usage.budget_tokens * 0.8) {
      return `⚠️ Knowledge context is near capacity: ${usage.memory_files_tokens.toLocaleString()} / ${usage.budget_tokens.toLocaleString()} tokens (${pct}%). Only add entries that provide significant, unique value. Consider recommending removal of lower-value entries via pending review.`;
    }
    return `Current knowledge context usage: ${usage.memory_files_tokens.toLocaleString()} / ${usage.budget_tokens.toLocaleString()} tokens (${pct}%). Be selective — avoid adding low-value or redundant knowledge.`;
  } catch {
    return ''; // No context data available yet
  }
}
```

### Finding Claude Executable

All `query()` calls need `pathToClaudeCodeExecutable` because bundling breaks the SDK's auto-detection. Reuse the pattern from the current `findClaudeExecutable()` in `mim-server.ts` and `run-analysis.ts`:

```typescript
function findClaudeExecutable(): string {
  if (process.env.CLAUDE_BINARY) return process.env.CLAUDE_BINARY;
  try {
    const claudePath = execSync('which claude', { encoding: 'utf-8' }).trim();
    if (claudePath && fs.existsSync(claudePath)) return fs.realpathSync(claudePath);
  } catch {}
  const commonPaths = [
    path.join(process.env.HOME || '', '.local', 'bin', 'claude'),
    '/usr/local/bin/claude',
    '/usr/bin/claude',
  ];
  for (const p of commonPaths) {
    if (fs.existsSync(p)) return p;
  }
  return 'claude'; // Fallback: assume in PATH
}
```

---

## Job Specifications

### Remember Job

**Purpose:** Process one `remember()` queue entry — categorize, deduplicate, write to knowledge files.

**Model:** Opus

**Input:** One queue entry JSON file from `.claude/knowledge/remember-queue/`

**Queue entry format** (written by MCP server):
```json
{
  "id": "a1b2c3",
  "timestamp": 1706745600000,
  "status": "pending",
  "entry": {
    "category": "architecture",
    "topic": "Redis Caching Strategy",
    "details": "The application uses Redis for session caching with a 30-minute TTL.",
    "files": "src/cache/redis.js, config/redis.yml"
  }
}
```

**Lifecycle:**
1. Read queue file
2. Mark status as `"processing"` (write back to file)
3. Call `query()` with the prompt and system prompt below
4. On success: delete the queue file
5. On failure: mark status as `"pending"`, write `lastError` field, leave for retry

**`query()` configuration:**
```typescript
query({
  prompt: `Process this knowledge entry:

Category: ${entry.entry.category}
Topic: ${entry.entry.topic}
Details: ${entry.entry.details}
${entry.entry.files ? `Related files: ${entry.entry.files}` : ''}

Timestamp: ${entry.timestamp}
ID: ${entry.id}

${contextBudgetNote}

Analyze this against existing knowledge and take the appropriate action.`,
  options: {
    model: 'opus',
    systemPrompt: QUEUE_PROCESSOR_SYSTEM_PROMPT,  // full text below
    pathToClaudeCodeExecutable: findClaudeExecutable(),
    settingSources: ['project'],
    canUseTool: async (toolName: string, input: unknown) => {
      if (toolName === 'AskUserQuestion') {
        return { behavior: 'deny', message: 'Not available. Process based on your analysis.' };
      }
      return { behavior: 'allow', updatedInput: input };
    },
    outputFormat: {
      type: 'json_schema',
      schema: QUEUE_PROCESSOR_OUTPUT_SCHEMA,
    },
  },
});
```

**System prompt** — Copy `QUEUE_PROCESSOR_SYSTEM_PROMPT` verbatim from current `mim-server.ts` lines 286-407 into the daemon's remember job module. The full prompt:

```
You are the Knowledge Processor for Mim, a persistent memory system.

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
When facing decisions, use your best judgment rather than asking.
```

**Output schema:**
```json
{
  "type": "object",
  "properties": {
    "status": { "type": "string", "enum": ["processed", "conflict_detected"] },
    "action": { "type": "string", "enum": ["added", "updated", "duplicate_skipped", "created_review"] },
    "file_modified": { "type": ["string", "null"] },
    "ready_for_next": { "type": "boolean" }
  },
  "required": ["status", "action", "file_modified", "ready_for_next"],
  "additionalProperties": false
}
```

**Tools allowed:** Read, Write, Edit, Glob, Grep, Bash. Deny AskUserQuestion.

### Inquisitor Job

**Purpose:** Validate one knowledge entry against the current codebase. Produce auto-fix or pending review.

**Model:** Haiku

**Input:** One `KnowledgeEntry` (parsed from knowledge .md files by `parseKnowledgeEntries()` in `inquisitor.ts`).

```typescript
interface KnowledgeEntry {
  id: string;       // e.g., "architecture-mim-agent-orchestration-1"
  category: string;  // e.g., "architecture"
  file: string;      // e.g., "mim-agent-orchestration.md"
  topic: string;     // e.g., "Overall Architecture Pattern"
  content: string;   // the markdown content under the ## header
}
```

**Lifecycle:**
1. Call `query()` with investigation prompt
2. Parse structured output (`InquisitorOutput`)
3. If `status === 'valid'`: update entry manifest with `ok` status
4. If `issue.severity === 'auto_fix'`: spawn a second Haiku `query()` to apply the fix via Edit tools, then update manifest with `auto_fixed`
5. If `issue.severity === 'needs_review'`: write `ReviewEntry` JSON to `.claude/knowledge/pending-review/{entry.id}.json`, update manifest with `review_pending`

**`query()` configuration:**
```typescript
query({
  prompt: `Investigate this knowledge entry:

**Entry ID:** ${entry.id}
**Category:** ${entry.category}
**File:** ${entry.file}
**Topic:** ${entry.topic}

**Content:**
${entry.content}

${contextBudgetNote}

Verify this knowledge against the actual codebase. Check if the referenced code exists, if the claims are accurate, and recommend the best location for this knowledge.`,
  options: {
    model: 'haiku',
    pathToClaudeCodeExecutable: findClaudeExecutable(),
    settingSources: ['project'],
    systemPrompt: INQUISITOR_SYSTEM_PROMPT,  // from agents/inquisitor.ts
    canUseTool: async (tool: string, input: Record<string, unknown>) => {
      const allowedTools = ['Read', 'Glob', 'Grep'];
      if (allowedTools.includes(tool)) return { behavior: 'allow', updatedInput: input };
      if (tool === 'Bash') {
        const cmd = (input?.command as string) || '';
        const allowedPrefixes = ['git log', 'git show', 'git diff', 'git blame'];
        if (allowedPrefixes.some(p => cmd.startsWith(p))) {
          return { behavior: 'allow', updatedInput: input };
        }
        return { behavior: 'deny', message: 'Only git read commands allowed' };
      }
      return { behavior: 'deny', message: 'Tool not allowed for inquisitor' };
    },
    outputFormat: {
      type: 'json_schema',
      schema: getInquisitorOutputJsonSchema(),  // from agents/inquisitor.ts
    },
  },
});
```

**Auto-fix sub-agent** (when `issue.severity === 'auto_fix'`):
```typescript
query({
  prompt: `Apply this fix to the knowledge file:

**Knowledge File:** .claude/knowledge/${entry.category}/${entry.file}
**Entry:** ${entry.topic} (${entry.id})

**Fix to apply:**
${output.issue.suggested_fix}

Read the knowledge file, apply the fix described above, and save the file. Be precise and minimal.`,
  options: {
    model: 'haiku',
    pathToClaudeCodeExecutable: findClaudeExecutable(),
    settingSources: ['project'],
    systemPrompt: 'You are applying a small fix to a knowledge file. Be precise and minimal. Only change what is described in the fix.',
    canUseTool: async (tool: string, input: Record<string, unknown>) => {
      const allowed = ['Read', 'Edit', 'Glob', 'Grep'];
      if (allowed.includes(tool)) return { behavior: 'allow', updatedInput: input };
      return { behavior: 'deny', message: 'Tool not allowed' };
    },
  },
});
```

Note: this auto-fix sub-agent is a second `query()` call, but it runs sequentially within the same job. The single-worker queue ensures no other job starts until both the inquisitor and its auto-fix complete.

**System prompt** — Copy `INQUISITOR_SYSTEM_PROMPT` verbatim from `agents/inquisitor.ts` lines 53-121. The full prompt:

```
You are an Inquisitor agent researching a single knowledge entry.

## Your Mission

Research the ONE provided knowledge entry. Verify it against the actual codebase.

## Tools Available

You have access to:
- **Read**: Read file contents
- **Glob**: Find files by pattern
- **Grep**: Search for text in files
- **Bash(git log:*)**: View git history
- **Bash(git show:*)**: View specific commits
- **Bash(git diff:*)**: Compare changes
- **Bash(git blame:*)**: See line-by-line history

## What to Investigate

1. **Does the referenced code still exist?**
   - Check file paths mentioned
   - Check function/class names mentioned
   - Check configuration values mentioned

2. **What does the code actually do now?**
   - Read the relevant files
   - Understand current implementation
   - Compare to what the documentation claims

3. **What has changed recently?**
   - Use git log to see recent changes
   - Check if changes affect this knowledge

4. **Location Context**
   - Is this knowledge specific to a single file/function? → code_comment
   - Is this knowledge specific to a directory/module? → local
   - Is this knowledge cross-cutting (affects multiple areas)? → global

## Output

Based on your investigation, report:
- Whether the knowledge is still valid, stale, conflicting, or outdated
- What you found in the codebase
- Where this knowledge best belongs (global, local, or code comment)
- Any issues that need fixing (auto-fixable or needs human review)

Be thorough but efficient. Focus on verifying the specific claims in the knowledge entry.

## CRITICAL: review_question Format

When writing review_question, follow these rules STRICTLY:

1. **NEVER list options in the question** - The options array is shown separately below the question as [1], [2], etc. If you put "Should we (1) delete (2) update (3) keep" in the question, the user sees the options TWICE.

2. **Just explain the situation** - Describe what you found, what's wrong, and what decision is needed. 2-4 sentences max.

BAD (options in question):
"The file was moved. Should we: (1) Update the path, (2) Delete the entry, or (3) Keep as-is?"

GOOD (situation only):
"The referenced file config/old.js was moved to src/config/new.js. The knowledge documents the old path which no longer exists."

The options array handles the choices. The question just sets up the decision.

## Important

- Do NOT ask questions - make your best judgment
- Focus on THIS ONE entry only
- Always set done: true when complete
```

**Output schema** (Zod → JSON Schema via `getInquisitorOutputJsonSchema()`):
```typescript
{
  entry_id: string,
  status: 'valid' | 'stale' | 'conflict' | 'outdated',
  findings: {
    code_exists: boolean,
    current_behavior: string,
    recent_changes?: string,
    related_entries?: string[],
  },
  location_context: {
    scope: 'global' | 'local' | 'code_comment',
    reason: string,
    suggested_location?: string,
  },
  issue?: {
    description: string,
    severity: 'auto_fix' | 'needs_review',
    suggested_fix?: string,
    review_question?: string,
    review_options?: string[],
    review_agent_notes?: string,
  },
  done: boolean,
}
```

**Pending review output format** (written to `.claude/knowledge/pending-review/{id}.json`):
```json
{
  "id": "architecture-mim-agent-orchestration-1",
  "subject": "Overall Architecture Pattern - stale",
  "type": "stale",
  "question": "The referenced file no longer exists at the documented path...",
  "context": "Category: architecture\nFile: mim-agent-orchestration.md\n\nFindings: ...",
  "options": ["Update to match code", "Remove this entry", "Keep as-is"],
  "knowledge_file": "architecture/mim-agent-orchestration.md",
  "agent_notes": "Technical details for Wellspring agent...",
  "created_at": "2026-02-01T...",
  "created_at_commit": "6ca2b57..."
}
```

**Entry manifest update** (`.claude/knowledge/.entry-status.json`):
```json
{
  "architecture-mim-agent-orchestration-1": {
    "status": "ok",
    "checkedAt": "2026-02-01T...",
    "commitHash": "6ca2b57..."
  }
}
```

### Curator Job

**Purpose:** Review ALL pending reviews holistically. Deduplicate, merge redundant reviews, auto-resolve obvious ones, delete stale ones. Context-aware — more aggressive when knowledge is near budget.

**Model:** Opus

**Input:** All unanswered review JSON files from `.claude/knowledge/pending-review/`

**When to run:** When the set of unanswered pending review IDs has changed since the last curator run (tracked in `curator-state.json`).

**`query()` configuration:**
```typescript
const pendingReviews = loadUnansweredReviews(pendingDir);
const contextUsage = readContextUsage(knowledgeDir);

query({
  prompt: `You are the Knowledge Curator for Mím, the persistent memory system.

## Pending Reviews

There are ${pendingReviews.length} pending reviews awaiting human decision:

${JSON.stringify(pendingReviews, null, 2)}

## Context Budget

${contextUsage
  ? `Current knowledge context usage: ${contextUsage.memory_files_tokens.toLocaleString()} / ${contextUsage.budget_tokens.toLocaleString()} tokens (${contextUsage.memory_files_percent.toFixed(1)}% of context, budget cap is ${contextUsage.budget_percent}%).`
  : 'Context usage data not available.'}

## Your Tasks

Review ALL pending reviews and take action:

1. **Redundant/duplicate reviews**: If two or more reviews ask about the same issue or the same knowledge entry, merge them into one. Delete the redundant review files, keeping the most informative one.

2. **Obvious auto-resolves**: If a review has an obvious correct answer that doesn't require human judgment (e.g., a file path simply moved, a function was renamed, a version number changed), resolve it directly:
   - Apply the fix to the knowledge file
   - Update both knowledge maps if needed (KNOWLEDGE_MAP.md and KNOWLEDGE_MAP_CLAUDE.md)
   - Delete the review file

3. **Stale reviews**: If a review references code/files that have since been updated (check created_at_commit vs current HEAD), and the issue is already resolved, delete the review file.

4. **Context budget pressure**: If context usage is above 80% of budget, look for low-value knowledge entries that could be removed. Create reviews recommending removal, OR if entries are clearly obsolete, remove them directly and update both knowledge maps.

5. **Leave genuinely ambiguous reviews alone**: If a review requires real human judgment (architectural decisions, policy choices, trade-offs), leave it untouched.

After processing, output a summary of what you did.`,
  options: {
    model: 'opus',
    pathToClaudeCodeExecutable: findClaudeExecutable(),
    settingSources: ['project'],
    systemPrompt: CURATOR_SYSTEM_PROMPT,  // full text below
    canUseTool: async (toolName: string, input: unknown) => {
      if (toolName === 'AskUserQuestion') {
        return { behavior: 'deny', message: 'Not available. Make your best judgment.' };
      }
      return { behavior: 'allow', updatedInput: input };
    },
    outputFormat: {
      type: 'json_schema',
      schema: CURATOR_OUTPUT_SCHEMA,  // full schema below
    },
  },
});
```

**Curator system prompt:**
```
You are the Knowledge Curator for Mím, a persistent memory system for Claude Code.

Your role is to maintain the quality and relevance of the pending review queue. You have full access to the codebase and knowledge files.

## Knowledge Structure

The knowledge base is in .claude/knowledge/:
- Category directories: architecture/, patterns/, dependencies/, workflows/, gotchas/
- KNOWLEDGE_MAP.md - User-facing index with markdown links [Topic](category/file.md)
- KNOWLEDGE_MAP_CLAUDE.md - Claude-facing index with @ references @category/file.md
- pending-review/ - Review JSON files awaiting human decision

Both knowledge maps must stay in sync with actual content.

## Tools Available

You have access to: Read, Write, Edit, Glob, Grep, Bash
You do NOT have access to: AskUserQuestion

## Review File Format

Each review file in pending-review/ is JSON:
{
  "id": "entry-id",
  "subject": "Brief description",
  "type": "stale" | "conflict" | "outdated",
  "question": "What needs deciding (2-4 sentences, do NOT list options here)",
  "options": ["Option 1", "Option 2", ...],
  "knowledge_file": "category/file.md",
  "agent_notes": "Technical details for applying the decision",
  "created_at": "ISO timestamp",
  "created_at_commit": "git commit hash"
}

## Decision Criteria

Auto-resolve (no human needed):
- File paths that simply moved
- Function/class renames
- Version number updates
- Entries referencing deleted features that are clearly gone
- Duplicate reviews about the same issue

Needs human judgment (leave alone):
- Architectural direction changes
- Trade-off decisions
- Policy choices
- Cases where multiple valid approaches exist

## When Modifying Knowledge Files

- Make precise, minimal edits
- ALWAYS update BOTH knowledge maps when content changes
- Use Edit tool, not Write, for modifications to existing files

## Important

- Be conservative. When in doubt, leave a review for the human.
- Never auto-resolve reviews about architectural or design decisions.
- Log what you did clearly in your output message.
```

**Curator output schema:**
```json
{
  "type": "object",
  "properties": {
    "actions_taken": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "review_id": { "type": "string" },
          "action": { "type": "string", "enum": ["auto_resolved", "merged", "deleted_stale", "kept"] },
          "reason": { "type": "string" }
        },
        "required": ["review_id", "action", "reason"]
      }
    },
    "summary": { "type": "string" },
    "reviews_remaining": { "type": "number" }
  },
  "required": ["actions_taken", "summary", "reviews_remaining"],
  "additionalProperties": false
}
```

**Tracking state** (`.claude/knowledge/curator-state.json`):
```json
{
  "last_run": "2026-02-01T12:00:00.000Z",
  "review_ids_at_last_run": ["arch-mim-1", "patterns-api-0"],
  "context_usage_at_last_run": {
    "tokens": 3000,
    "percent": 1.5
  }
}
```

Skip enqueuing curator if: `currentReviewIds` (sorted) matches `review_ids_at_last_run` (sorted).

### Context Check Job

**Purpose:** Measure how much of the context window knowledge files consume. Write result for other agents to read.

**Model:** Any (just needs to run `/context` command)

**How it works:** The `/context` slash command is the only reliable way to get token counts. It requires spawning a `query()` call because the token counting is internal to Claude Code.

**`query()` configuration:**
```typescript
query({
  prompt: '/context',
  options: {
    cwd: repoPath,
    settingSources: ['project'],  // Required to load knowledge files
    permissionMode: 'bypassPermissions',
    pathToClaudeCodeExecutable: findClaudeExecutable(),
  },
});
```

**Parsing the output:**

The `/context` output contains a markdown table. Extract the "Memory files" row. Use `parseContextOutput()` adapted from the reference code at https://github.com/lucianHymer/arbiter/blob/main/src/context-analyzer.ts.

Key parsing logic:
```typescript
function parseTokenCount(str: string): number {
  if (!str) return 0;
  const cleaned = str.replace(/,/g, '').trim();
  if (cleaned.endsWith('k')) {
    return Math.round(parseFloat(cleaned.slice(0, -1)) * 1000);
  }
  return parseInt(cleaned, 10) || 0;
}

// Parse from output text — look for "Memory files:" line with token count
// Format example: "Memory files: 3.0k tokens (1.5%)"
const memoryMatch = output.match(/Memory files[:\s]+([0-9,.]+k?)\s*tokens?\s*\(([0-9.]+)%\)/i);
```

**Output file** (`.claude/knowledge/context-usage.json`):
```json
{
  "checked_at": "2026-02-01T12:00:00.000Z",
  "memory_files_tokens": 3000,
  "memory_files_percent": 1.5,
  "budget_tokens": 30000,
  "budget_percent": 15.0,
  "over_budget": false
}
```

Budget is hardcoded: 15% of 200k = 30k tokens. `over_budget` is true when `memory_files_tokens > budget_tokens`.

**Frequency:** At most once every 6 hours. The scheduler checks `checked_at` before enqueuing.

---

## Refactored Components

### MCP Server (`src/servers/mim-server.ts`)

**Remove entirely:**
- `QueueProcessor` class (lines 441-736)
- `QUEUE_PROCESSOR_SYSTEM_PROMPT` (lines 286-407)
- `QUEUE_PROCESSOR_OUTPUT_SCHEMA` (lines 412-436)
- All Agent SDK imports (`query`, `QueryOptions`, `CanUseToolResult`, `AgentMessage`, etc.)
- `recoverStaleQueueEntries()` function (lines 221-247)
- `findClaudeExecutable()` function (lines 249-277) — daemon has its own
- The `notifications/initialized` handler's queue processing logic (lines 935-962)

**Keep:**
- JSON-RPC 2.0 server scaffolding (`handleRequest`, `createResponse`, `createError`, readline loop)
- `remember()` tool definition and handler
- `handleRemember()` function (queue file writing + category normalization)
- `normalizeCategory()` function
- All MCP protocol handling (initialize, tools/list, tools/call)
- `checkMimActivation()` usage (still needed to gate daemon ping)

**Add:**
- `readDaemonPort()` utility function
- `hashRepoPath()` utility function
- Fire-and-forget `fetch()` to daemon in `handleRemember()` after writing queue file
- Remove the `setImmediate(() => queueProcessor.processQueue())` call — replace with daemon ping

The `notifications/initialized` handler becomes:
```typescript
case 'notifications/initialized':
  // No-op. Daemon is started by SessionStart hook, not the MCP server.
  return null;
```

### SessionStart Hook (`src/hooks/session-start.ts`)

**Remove:**
- `spawnBackgroundAnalysis()` function (lines 45-60) — daemon replaces this

**Replace with:**
```typescript
function ensureDaemonRunning(repoPath: string): void {
  const repoHash = hashRepoPath(repoPath);
  const portFile = path.join(homedir(), '.mim', 'daemon', `${repoHash}.port`);
  const pidFile = path.join(homedir(), '.mim', 'daemon', `${repoHash}.pid`);

  // Check if daemon is already running
  if (fs.existsSync(pidFile)) {
    try {
      const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
      process.kill(pid, 0); // Check if process exists
      // Daemon is alive — ping it
      if (fs.existsSync(portFile)) {
        const port = parseInt(fs.readFileSync(portFile, 'utf-8').trim(), 10);
        // Fire-and-forget ping
        fetch(`http://127.0.0.1:${port}/ping`).catch(() => {});
      }
      return;
    } catch {
      // PID exists but process is dead — clean up stale files
      try { fs.unlinkSync(pidFile); } catch {}
      try { fs.unlinkSync(portFile); } catch {}
    }
  }

  // Ensure ~/.mim/daemon/ directory exists
  const daemonDir = path.join(homedir(), '.mim', 'daemon');
  fs.mkdirSync(daemonDir, { recursive: true });

  // Start daemon
  const daemonScript = path.join(__dirname, 'daemon.bundled.mjs');
  const child = spawn('node', [daemonScript, repoPath], {
    detached: true,
    stdio: 'ignore',
    cwd: repoPath,
  });
  child.unref();
}
```

The hook's `main()` flow becomes:
1. `runMimInit()` (unchanged)
2. `checkMimActivation()` → if activated, `ensureDaemonRunning()`
3. Count pending reviews, output system message (unchanged)

### Delete: `src/hooks/run-analysis.ts`

This file is entirely replaced by the daemon's scheduler + inquisitor jobs. Delete it.

Also delete the bundled output: `hooks/run-analysis.bundled.mjs`

### CLI (`bin/mim.js`)

Add daemon subcommands:
```
mim daemon start   → start daemon for current repo (if not running)
mim daemon stop    → stop daemon for current repo (kill PID)
mim daemon status  → show daemon status (ping and display response)
```

These are debugging aids. Normal users don't need them.

### Build Script (`scripts/build-server.js`)

Add daemon bundle:
```javascript
// Daemon (ESM - required for Agent SDK import.meta.url)
await esbuild.build({
  entryPoints: ['dist/daemon/server.js'],
  outfile: 'hooks/daemon.bundled.mjs',
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  external: [...nodeBuiltins],
});
```

Remove run-analysis bundle (no longer needed).

---

## State Files Summary

| File | Owner | Purpose |
|------|-------|---------|
| `~/.mim/daemon/{hash}.port` | Daemon | Port number for HTTP server |
| `~/.mim/daemon/{hash}.pid` | Daemon | Process ID for liveness check |
| `.claude/knowledge/remember-queue/*.json` | MCP server writes, daemon reads/deletes | Queued remember entries |
| `.claude/knowledge/pending-review/*.json` | Inquisitor/curator writes, TUI reads | Reviews awaiting user decision |
| `.claude/knowledge/.entry-status.json` | Daemon (inquisitor jobs) | Per-entry validation manifest |
| `.claude/knowledge/.last-analysis` | Daemon | Timestamp of last analysis run |
| `.claude/knowledge/context-usage.json` | Daemon (context-check job) | Memory files token count |
| `.claude/knowledge/curator-state.json` | Daemon (curator job) | Last curator run state |
| `.claude/knowledge/mim.log` | All components | Shared log file |

---

## Testing & Development Strategy

### Design for Testability

The daemon should be built with dependency injection so each layer can be tested independently:

```typescript
// The query() function is injected, not imported at module level
interface DaemonDeps {
  query: typeof import('@anthropic-ai/claude-agent-sdk').query;
  findClaudeExecutable: () => string;
  repoPath: string;
  knowledgeDir: string;
}

// Each job executor takes deps
async function executeRememberJob(job: Job, deps: DaemonDeps): Promise<void> { ... }
async function executeInquisitorJob(job: Job, deps: DaemonDeps): Promise<void> { ... }
async function executeCuratorJob(job: Job, deps: DaemonDeps): Promise<void> { ... }
async function executeContextCheckJob(job: Job, deps: DaemonDeps): Promise<void> { ... }
```

This allows swapping `query` with a mock during tests and during iterative development.

### Mock Mode

The daemon should support a `--mock` flag that replaces `query()` with a stub:

```bash
node daemon.bundled.mjs /path/to/repo --mock
```

In mock mode, `query()` returns canned structured output for each job type:

```typescript
function createMockQuery(): typeof query {
  return ({ prompt, options }) => {
    // Return an async iterable that yields a mock result
    const jobType = detectJobType(options.systemPrompt, prompt);

    const mockResults: Record<string, unknown> = {
      remember: {
        status: 'processed', action: 'added',
        file_modified: 'architecture/mock.md', ready_for_next: true,
      },
      inquisitor: {
        entry_id: 'mock-entry-0', status: 'valid',
        findings: { code_exists: true, current_behavior: 'Mock: code exists' },
        location_context: { scope: 'global', reason: 'Mock' },
        done: true,
      },
      curator: {
        actions_taken: [], summary: 'Mock: no actions taken', reviews_remaining: 0,
      },
    };

    return (async function* () {
      yield { type: 'system', subtype: 'init', session_id: 'mock-session' };
      yield {
        type: 'result', subtype: 'success',
        structured_output: mockResults[jobType] ?? {},
      };
    })();
  };
}
```

Mock mode lets you:
- Verify the daemon starts, listens, receives pings
- Verify the scheduler correctly reads disk state and enqueues jobs
- Verify the queue processes jobs in priority order
- Verify state files get written/updated correctly
- Verify the idle timeout works
- All without spending any API tokens or spawning Claude Code subprocesses

### Dry Run Mode

The daemon should also support `--dry-run` which runs the scheduler but never executes jobs:

```bash
node daemon.bundled.mjs /path/to/repo --dry-run
```

Output to log:
```
[DAEMON] Dry run — scheduler would enqueue:
[DAEMON]   remember:a1b2c3 (priority 0) — queue entry: architecture/Redis Caching Strategy
[DAEMON]   curator (priority 1) — 3 unanswered reviews changed since last run
[DAEMON]   context-check (priority 2) — last checked 8 hours ago
[DAEMON]   inquisitor:arch-mim-0 (priority 3) — not checked since commit abc123
[DAEMON]   inquisitor:arch-mim-1 (priority 3) — not checked since commit abc123
[DAEMON] Total: 5 jobs would be enqueued
```

This lets you verify the scheduling logic is correct without executing anything.

### Implementation Order

Build and test in this order. Each step should be independently verifiable before moving to the next:

**Step 1: Daemon skeleton + HTTP server + queue**
- `src/daemon/server.ts` — HTTP server, port/PID files, idle timeout
- `src/daemon/queue.ts` — WorkerQueue class
- Test: `node daemon.bundled.mjs /path/to/repo --mock`, then `curl http://127.0.0.1:{port}/ping`
- Verify: responds with JSON status, creates port/PID files, shuts down after timeout

**Step 2: Scheduler**
- `src/daemon/scheduler.ts` — disk scanning, job creation
- Test: create some queue files manually, run with `--dry-run`, check log output
- Verify: correct jobs enqueued with correct priorities, deduplication works, throttling works

**Step 3: Remember job (first real agent)**
- `src/daemon/jobs/remember.ts`
- Test: manually drop a queue entry JSON into `remember-queue/`, start daemon, ping it
- Verify: entry processed, knowledge file created/updated, queue file deleted, both knowledge maps updated
- Also test with `--mock` to verify file lifecycle without API calls

**Step 4: Inquisitor job**
- `src/daemon/jobs/inquisitor.ts`
- Test: ensure knowledge files exist, start daemon, ping it
- Verify: entries validated, manifest updated, pending reviews created for issues
- Test auto-fix flow: create a knowledge entry with an obvious stale path, verify it gets auto-fixed

**Step 5: Curator job**
- `src/daemon/jobs/curator.ts`
- Test: create several pending review files (some duplicate/overlapping), start daemon, ping it
- Verify: duplicates merged, obvious ones auto-resolved, stale ones deleted, `curator-state.json` written

**Step 6: Context check job**
- `src/daemon/jobs/context-check.ts`
- Test: start daemon, ping it, wait for context-check to run
- Verify: `context-usage.json` written with accurate token counts matching `/context` output

**Step 7: MCP server refactor**
- Strip agent code from `mim-server.ts`, add daemon ping
- Test: start a Claude Code session, call `remember()`, verify queue file written AND daemon picks it up
- Verify: no Agent SDK imports in bundled output

**Step 8: SessionStart hook refactor**
- Replace background analysis spawn with daemon start
- Test: start a Claude Code session, verify daemon starts automatically
- Verify: second session doesn't start a second daemon

**Step 9: End-to-end**
- Full flow: session start → daemon starts → `remember()` calls → queue processing → inquisitors run → curator runs → `mim review` works
- Memory check: verify bounded process count and memory

### Test Fixtures

Create test fixtures for manual testing (can be checked into `mim-ai/test/fixtures/`):

```
test/fixtures/
├── remember-queue/
│   └── 1706745600000-test01.json    # Sample queue entry
├── pending-review/
│   ├── test-review-1.json           # Obvious auto-resolve (path moved)
│   ├── test-review-2.json           # Duplicate of review-1
│   └── test-review-3.json           # Genuine ambiguous review (should be kept)
└── knowledge/
    └── architecture/
        └── test-stale-entry.md      # References files that don't exist (for inquisitor testing)
```

### Log-Based Observability

The daemon should log enough to diagnose issues without attaching a debugger:

```
[2026-02-01T12:00:00] [DAEMON] [INFO] Started on port 52847 (repo: /Users/foo/myproject)
[2026-02-01T12:00:00] [DAEMON] [INFO] Scheduler: 2 remember, 1 curator, 0 context-check, 5 inquisitor jobs enqueued
[2026-02-01T12:00:01] [DAEMON] [INFO] Processing job: remember:a1b2c3 (queue depth: 7)
[2026-02-01T12:00:15] [DAEMON] [INFO] Job complete: remember:a1b2c3 → added to architecture/api.md
[2026-02-01T12:00:15] [DAEMON] [INFO] Processing job: curator (queue depth: 6)
[2026-02-01T12:00:30] [DAEMON] [INFO] Job complete: curator → 2 auto-resolved, 1 merged, 1 kept
[2026-02-01T12:00:30] [DAEMON] [INFO] Processing job: inquisitor:arch-mim-0 (queue depth: 4)
...
[2026-02-01T12:30:00] [DAEMON] [INFO] Idle timeout reached, shutting down
```

All logs go to `.claude/knowledge/mim.log` via the existing logger utility. The `mim daemon status` CLI command could also tail this log.

---

## Constraints

1. **All `query()` calls must include `settingSources: ['project']`** so agents see CLAUDE.md and knowledge files in context
2. **All `query()` calls must include `pathToClaudeCodeExecutable`** because bundling breaks the SDK's auto-detection via `import.meta.url`
3. **The daemon must work when spawned as a detached child process** with `stdio: 'ignore'` — no stdin/stdout dependency for normal operation
4. **The MCP server must remain a CommonJS bundle** (`mim-server.bundled.cjs`) per current plugin.json config
5. **Hooks and daemon must be ESM bundles** (`.mjs`) for `import.meta.url` compatibility with the Agent SDK
6. **The daemon must be cross-platform** — use `http.createServer` on `127.0.0.1`, no Unix sockets or platform-specific IPC
7. **The `mim` CLI (`bin/mim.js`) is plain JavaScript**, not TypeScript — keep additions in plain JS
8. **Node.js 18+ minimum** — can use built-in `fetch` (available in Node 18+)
9. **Reuse existing schemas and prompts.** The system prompts in this doc are copied verbatim from the current codebase and have been refined through iteration. Do not simplify or rewrite them — they contain important details about knowledge map management, review question formatting, tool restrictions, etc. Import the Zod schemas from `agents/inquisitor.ts` and `agents/changes-reviewer.ts` rather than recreating them.
10. **Logging:** Use `logInfo`, `logWarn`, `logError` from `utils/logger.ts` with a new `AGENTS.DAEMON` constant

---

## Known Bugs to Fix During Implementation

### 1. Queue entry `content` field is undefined

In the current `mim-server.ts` line 620, the queue processor prompt references `entry.entry.content`, but the `QueueEntryContent` interface has `topic` + `details`, not `content`. The field is always `undefined` at runtime (line 89 even has a comment about it). The daemon's remember job prompt should use:

```typescript
Category: ${entry.entry.category}
Topic: ${entry.entry.topic}
Details: ${entry.entry.details}
${entry.entry.files ? `Related files: ${entry.entry.files}` : ''}
```

This is already corrected in the remember job spec above.

---

## Acceptance Criteria

### Functional

1. `remember()` MCP tool works exactly as before from the user's perspective
2. Queue entries are processed within seconds of daemon receiving a ping
3. Inquisitor validation runs on session start (daemon wake)
4. Curator reviews pending reviews and auto-resolves obvious ones, deduplicates redundant ones
5. Context usage is checked every 6 hours and written to `context-usage.json`
6. Only one `query()` call runs at any time across the entire daemon
7. `mim review` TUI works unchanged (Wellspring agent is untouched)
8. `mim status` shows pending review count (unchanged behavior)
9. Inquisitors factor context budget into auto_fix vs needs_review decisions

### Non-Functional

1. No recursive process spawning — the MCP server never calls `query()`
2. Memory usage stays bounded (single daemon process + at most one `query()` subprocess at a time)
3. Daemon auto-starts on session start, auto-stops after 30 min idle
4. Multiple Claude Code sessions in the same repo share one daemon instance
5. Daemon handles crashes gracefully — queue entries and state files survive on disk, scheduler rebuilds queue on restart

### Verification

1. Start a Claude Code session in a repo with Mim installed → daemon starts automatically
2. Call `remember()` multiple times → queue entries processed sequentially, knowledge files updated
3. Check Activity Monitor / `ps aux | grep -E 'mim|claude'` → at most 3 relevant processes (Claude Code, daemon, one query subprocess), not 15-20+
4. Memory stays reasonable (< 2GB total for Mim-related processes)
5. Start a second Claude Code session in the same repo → shares existing daemon (no second daemon spawned)
6. Wait 30+ minutes with no activity → daemon shuts itself down, port/PID files deleted
7. Start a new session after daemon stopped → daemon restarts automatically
8. Run `mim review` → TUI works, Wellspring agent applies decisions as before
9. Check `.claude/knowledge/context-usage.json` → populated with accurate token counts
10. Check `.claude/knowledge/curator-state.json` → curator ran and recorded its actions
11. Verify no Agent SDK imports in `mim-server.ts` build output: `grep -c 'claude-agent-sdk' servers/mim-server.bundled.cjs` → 0
