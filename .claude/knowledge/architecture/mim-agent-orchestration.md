# Review Flow Agent Orchestration Pattern

MIM v2 implements a sophisticated sequential agent pipeline with hybrid execution patterns.

## Overall Architecture Pattern

Four components coordinate through a file-based queue system:
1. **Queue Processor Agent** (MCP Server) - Processes remember() entries
2. **Changes Detection Orchestrator** (SessionStart hook) - Normal code that spawns Inquisitor swarm
3. **Inquisitor Swarm** (Parallel Sonnet subagents) - Research individual knowledge entries
4. **Wellspring Agent** (TUI Game) - Applies user decisions to knowledge base

Note: The Changes Detection stage is **not an agent** - it's regular JavaScript code (run-analysis.js) that orchestrates a swarm of parallel Inquisitor agents.

## Key Coordination Pattern

The system uses **file-based asynchronous coordination** rather than agent-to-agent direct communication. Each agent reads from disk, processes independently, and writes results to disk for the next stage.

## Detailed Data Flow

### Stage 1: Queue Processing (Agent 1)
- MCP server provides `remember()` tool that queues entries to `.claude/knowledge/remember-queue/*.json`
- Queue Processor Agent runs in MCP server session (lives in memory, persistent across multiple `remember()` calls)
- Agent processes entries sequentially from queue
- For each entry:
  - Checks for duplicates (searches existing knowledge files with Grep)
  - Checks for conflicts (may create pending-review JSON if conflict detected)
  - Otherwise writes to appropriate organized file (architecture/, patterns/, etc.)
  - Updates both KNOWLEDGE_MAP.md and KNOWLEDGE_MAP_CLAUDE.md
  - Deletes processed queue file
  - Signals ready_for_next: true when done
- Non-blocking: triggered via setImmediate() after remember() returns immediately to user

### Stage 2: Changes Detection (Orchestrator)
- Triggered by SessionStart hook in Claude Code (run-analysis.js)
- Debounce logic checks `.claude/knowledge/.last-analysis` to avoid re-running on same commit
- Reads all knowledge files and compares against current codebase state
- Identifies stale (referenced items deleted), conflicting (docs contradict code), or outdated entries
- Spawns Inquisitor subagents (Sonnet) to research individual knowledge entries in parallel
  - MAX_CONCURRENT_INQUISITORS = 5 for parallel execution
- Creates pending-review JSON files for issues requiring human judgment
- Auto-fixes minor issues (file path changes, typo corrections, etc.)

### Stage 3: User Review (Interactive Game)
- User runs `mim review` command which launches TUI game
- Game UI (Bridge Guardian) loads all pending-review JSON files from disk
- User answers questions interactively
- Answers saved back to the review JSON files
- Game transitions to Wellspring scene when all reviews answered

### Stage 4: Applying Decisions (Agent 3)
- Wellspring Agent loads all answered review JSON files from disk
- Iterates through each answered review
- For each decision:
  - Reads the knowledge file mentioned in the review
  - Applies the user's chosen action (delete section, update content, keep as-is)
  - Updates knowledge maps if content was deleted or topics changed
  - Deletes the processed review JSON file
  - Signals ready_for_next: true
- When all reviews processed, signals done: true

## Agent Execution Patterns

### Queue Processor (Agent 1)
- **Lifetime**: Session-based singleton in MCP server
- **Execution**: Sequential (one remember() entry at a time)
- **Scaling**: Context exhaustion handled via session reset logic
- **Pattern**: Single long-lived session that processes multiple entries

### Changes Detection Orchestrator (Stage 2)
- **Lifetime**: Per-invocation (triggered on SessionStart hook)
- **Execution**: Regular code (not an agent) that spawns multiple Inquisitor subagents in parallel
  - Each Inquisitor researches one knowledge entry
  - Results aggregated into reviews array
  - Parallel execution (MAX_CONCURRENT_INQUISITORS = 5) reduces analysis time
- **Pattern**: Orchestrator code -> Multiple parallel Sonnet subagents

### Wellspring Agent (Agent 3)
- **Lifetime**: Per-game session (runs until all reviews processed)
- **Execution**: Sequential (one answered review at a time)
- **Pattern**: Single session processing multiple items with ready_for_next signals
- **Streaming**: Outputs text messages to TUI chat in real-time as work progresses

## No Direct Agent-to-Agent Communication
- Agents never call other agents directly
- All coordination happens through filesystem (JSON files)
- Enables loose coupling and independent testing
- Allows different execution environments (MCP server vs CLI game vs hooks)

## Auto-Fix Review Flow

Auto-fixable issues from Inquisitors are written to pending-review JSON files with `auto_apply: true` flag instead of being discarded.

### Flow
1. Inquisitor identifies issue with `severity: 'auto_fix'`
2. run-analysis.js writes review JSON with `auto_apply: true`, `type: 'auto_fix'`
3. TUI's loadPendingReviews() skips auto_apply reviews (no user interaction needed)
4. Wellspring's loadAnsweredReviews() includes auto_apply reviews
5. Wellspring applies the fix from agent_notes without asking user

### Review Structure for Autofixes

```json
{
  "id": "...",
  "type": "auto_fix",
  "question": "Describes what's being fixed",
  "options": [],
  "agent_notes": "The specific fix to apply",
  "auto_apply": true
}
```

This gives Wellspring "second set of eyes" on autofixes while keeping them automatic.

## Schema Unification Pattern

All agents use consistent schema structures:
- ReviewEntry: Defines pending questions (id, subject, type, question, options, knowledge_file, agent_notes, auto_apply)
- Each agent understands and produces compatible JSON structures
- Human doesn't see agent_notes (technical implementation details for applying decisions)
- The `auto_apply` field (boolean) marks reviews that don't need user interaction

**Known Bug:** In run-analysis.js, when creating reviews for `needs_review` cases (line ~346), the `agent_notes` field is not included, but it IS included for `auto_fix` cases (line ~332). This means user-facing reviews may lack the technical details needed by Wellspring to apply changes.

**Related files:** mim-ai/src/servers/mim-server.ts, mim-ai/src/agents/changes-reviewer.ts, mim-ai/src/agents/inquisitor.ts, mim-ai/src/agents/wellspring-agent.ts, mim-ai/src/tui/main.ts, mim-ai/bin/mim.js, mim-ai/hooks/run-analysis.js
