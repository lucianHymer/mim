# Review Flow Agent Orchestration Pattern

MIM v2 implements a sophisticated sequential agent pipeline with hybrid execution patterns.

## Overall Architecture Pattern

Four components coordinate through a file-based queue system:
1. **Queue Processor Agent** (MCP Server) - Processes remember() entries
2. **Changes Detection Orchestrator** (SessionStart hook) - Normal code that spawns Inquisitor swarm
3. **Inquisitor Swarm** (Sequential Haiku subagents) - Research individual knowledge entries
4. **Mímir Agent** (Wellspring screen in TUI) - Applies user decisions to knowledge base (see dedicated docs)

Note: The Changes Detection stage is **not an agent** - it's regular TypeScript code (run-analysis.ts) that orchestrates a swarm of sequential Inquisitor agents (with 5s delays to reduce API load).

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
- Triggered by SessionStart hook in Claude Code (run-analysis.ts)
- Debounce logic checks `.claude/knowledge/.last-analysis` to avoid re-running on same commit
- Reads all knowledge files and compares against current codebase state
- Identifies stale (referenced items deleted), conflicting (docs contradict code), or outdated entries
- Spawns Inquisitor subagents (Haiku) to research individual knowledge entries sequentially
  - 5-second delays between inquisitors to reduce API load
- Creates pending-review JSON files for issues requiring human judgment
- Auto-fixes are applied inline immediately during analysis (not written to review files)

### Stage 3: User Review (Interactive Game)
- User runs `mim review` command which launches TUI game
- Game UI (Bridge Guardian) loads all pending-review JSON files from disk
- User answers questions interactively
- Answers saved back to the review JSON files
- Game transitions to Wellspring scene when all reviews answered

### Stage 4: Applying Decisions (Mímir Agent)
- See dedicated Mímir Agent documentation for details

## Agent Execution Patterns

### Queue Processor (Agent 1)
- **Lifetime**: Session-based singleton in MCP server
- **Execution**: Sequential (one remember() entry at a time)
- **Scaling**: Context exhaustion handled via session reset logic
- **Pattern**: Single long-lived session that processes multiple entries

### Changes Detection Orchestrator (Stage 2)
- **Lifetime**: Per-invocation (triggered on SessionStart hook)
- **Execution**: Regular code (not an agent) that spawns Inquisitor subagents sequentially
  - Each Inquisitor researches one knowledge entry
  - 5-second delays between inquisitors to reduce API load
  - Results aggregated into reviews array
- **Pattern**: Orchestrator code -> Sequential Haiku subagents with throttling

## No Direct Agent-to-Agent Communication
- Agents never call other agents directly
- All coordination happens through filesystem (JSON files)
- Enables loose coupling and independent testing
- Allows different execution environments (MCP server vs CLI game vs hooks)

## Schema Unification Pattern

All agents use consistent schema structures:
- ReviewEntry: Defines pending questions (id, subject, type, question, options, knowledge_file, agent_notes)
- Each agent understands and produces compatible JSON structures
- Human doesn't see agent_notes (technical implementation details for applying decisions)

**Related files:** mim-ai/src/servers/mim-server.ts, mim-ai/src/agents/changes-reviewer.ts, mim-ai/src/agents/inquisitor.ts, mim-ai/src/agents/wellspring-agent.ts, mim-ai/src/tui/main.ts, mim-ai/bin/mim.js, mim-ai/src/hooks/run-analysis.ts
