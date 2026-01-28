# Review Flow Agent Orchestration Pattern

MIM v2 implements a sequential agent pipeline coordinated through file-based communication.

## Overall Architecture Pattern

Four components coordinate through a file-based queue system:
1. **Queue Processor Agent** (MCP Server) - Processes remember() entries
2. **Changes Detection Orchestrator** (SessionStart hook) - Spawns Inquisitor swarm
3. **Inquisitor Swarm** (Subagents) - Research individual knowledge entries
4. **Mímir Agent** (Wellspring screen in TUI) - Applies user decisions to knowledge base

## Key Coordination Pattern

The system uses **file-based asynchronous coordination** rather than agent-to-agent direct communication. Each agent reads from disk, processes independently, and writes results to disk for the next stage.

## High-Level Data Flow

### Stage 1: Queue Processing
- MCP server provides `remember()` tool that queues entries to `.claude/knowledge/remember-queue/*.json`
- Queue Processor Agent processes entries, checking for duplicates and conflicts
- Writes to appropriate knowledge files or creates pending-review entries
- Updates both knowledge maps

### Stage 2: Changes Detection
- Triggered by SessionStart hook in Claude Code
- Reads knowledge files and compares against current codebase state
- Identifies stale, conflicting, or outdated entries
- Spawns Inquisitor subagents to research individual knowledge entries
- Creates pending-review JSON files for issues requiring human judgment

### Stage 3: User Review
- User runs `mim review` command which launches TUI game
- Game UI loads pending-review JSON files
- User answers questions interactively
- Answers saved back to review JSON files

### Stage 4: Applying Decisions
- See dedicated Mímir Agent documentation for details

## No Direct Agent-to-Agent Communication

- Agents never call other agents directly
- All coordination happens through filesystem (JSON files)
- Enables loose coupling and independent testing
- Allows different execution environments (MCP server vs CLI game vs hooks)

## Schema Unification Pattern

All agents use consistent schema structures:
- ReviewEntry: Defines pending questions (id, subject, type, question, options, knowledge_file, agent_notes)
- Each agent understands and produces compatible JSON structures

**Related files:** mim-ai/src/servers/mim-server.ts, mim-ai/src/agents/inquisitor.ts, mim-ai/src/agents/wellspring-agent.ts, mim-ai/src/tui/main.ts, mim-ai/src/hooks/run-analysis.ts
