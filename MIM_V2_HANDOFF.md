# MIM V2 - Implementation Handoff Document

## Problem Statement

MIM (Mímir) is a persistent memory system for Claude Code that captures project knowledge. The current implementation has several limitations:

1. **Session.md staging file** - Knowledge goes to a staging file, requires manual `./mim coalesce` to organize
2. **No deduplication** - Same knowledge can be captured multiple times across sessions
3. **No conflict detection** - Conflicting information accumulates rather than being resolved
4. **Stale knowledge** - Documentation drifts out of sync with code changes
5. **Manual processes** - Coalesce and distill require user intervention

## Why This Matters

Claude Code sessions are ephemeral. Knowledge discovered in one session is lost when context resets. MIM preserves this knowledge, but the current manual workflow means:
- Knowledge often isn't processed (users forget to run coalesce)
- Duplicates and conflicts accumulate
- Documentation becomes unreliable over time

## Solution Overview

Replace the current script-based MIM with a **smart MCP server** powered by three specialized Claude agents:

1. **Queue Processor Agent** - Handles incoming `remember()` calls, deduplicates, writes organized knowledge
2. **On-Changes Reviewer Agent** - Detects stale/conflicting knowledge when code changes
3. **Wellspring Agent** - Interactive agent that applies user decisions (runs during `mim review`)

Plus a **gamified review UI** (the Bridge Guardian) for resolving conflicts, built on the Arbiter TUI framework.

---

## Success Criteria

1. `remember()` is non-blocking and intelligent (dedupes, detects conflicts)
2. No more session.md - knowledge goes directly to organized files
3. Conflicts create pending-review entries automatically
4. Code changes trigger analysis that detects stale documentation
5. `mim review` presents a game UI for resolving pending reviews
6. User watches the Wellspring agent apply their decisions
7. Clean implementation - no legacy code from v1

---

## Scope

### In Scope
- Smart MCP server with three agents
- File-backed queue for remember entries
- Pending-review JSON system
- Bridge Guardian game UI (character select → bridge scene → wellspring scene)
- SessionStart hook for change detection
- npm package (`mim-ai`) that doubles as Claude Code plugin
- Full replacement of v1 (delete old implementation)

### Out of Scope (for now)
- Extracting tile-tui as a separate library (do after v2 ships)
- Code comment suggestions
- Local `.knowledge/` subdirectories
- Multiple tileset support

---

## Technical Context

### Reference Implementation: Arbiter

The Arbiter project (`/workspace/arbiter`) provides:
- TUI framework (terminal-kit based tile rendering)
- Character select screen
- Sprite system with animations (walk, hop, magic spawn/despawn)
- Scene composition and rendering
- Vim-like input handling
- Claude Agent SDK integration patterns
- Structured output with Zod schemas

**Copy and adapt from Arbiter:**
- `src/tui/*` - Tile rendering, sprites, scenes, animations
- `assets/` - Tileset (16x16 fantasy), sounds
- Character select screen logic
- SDK query/session patterns

**Key differences from Arbiter:**
- MIM has three specialized agents (not Arbiter + Orchestrators)
- Different scenes (Bridge Guardian, Wellspring)
- Different structured output schemas
- Questions answered via game UI, not chat

### Tileset Reference

Key tile indices for MIM scenes:
- `55` - Wavy/bubbly water (Wellspring)
- `59` - Horizontal bridge
- `12` - Cobblestone
- `15` - Tile flooring
- `199` - Bridge Guardian sprite
- `209` - Odin sprite
- `216` - Mím (the head) sprite

### Claude Agent SDK

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

const session = query({
  prompt: "...",
  options: {
    model: 'opus',
    systemPrompt: "...",
    outputFormat: { type: 'json_schema', schema: zodSchema },
    canUseTool: async (tool, input) => { /* allow/deny */ },
    // Do NOT pass settingSources to avoid loading project CLAUDE.md
  }
});

for await (const message of session) {
  // Handle messages
}
```

---

## Architecture

### Installation

Users perform two steps:

1. **npm global install** (for CLI):
   ```bash
   npm install -g mim-ai
   ```

2. **Plugin install** (for Claude Code integration):
   - User-level: Add to `~/.claude/settings.json`
   - Project-level: Add to `.claude/settings.json` or `npm install --save-dev mim-ai`

### Directory Structure

```
mim-ai/                          # npm package + Claude plugin
├── .claude-plugin/
│   └── plugin.json              # Plugin manifest
├── package.json                 # npm package config, bin: { "mim": "./bin/mim.js" }
├── bin/
│   └── mim.js                   # CLI entry point (mim, mim review, mim init)
├── servers/
│   └── mim-server.cjs           # MCP server
├── hooks/
│   └── hooks.json               # SessionStart hook
├── agents/
│   ├── queue-processor.ts       # Agent 1: Remember queue handler
│   ├── changes-reviewer.ts      # Agent 2: On-changes analysis
│   └── wellspring.ts            # Agent 3: Interactive apply
├── tui/                         # Copied/adapted from Arbiter
│   ├── tileset.ts
│   ├── sprite.ts
│   ├── scene.ts
│   ├── screens/
│   │   ├── character-select.ts
│   │   ├── bridge-guardian.ts   # Question answering scene
│   │   └── wellspring.ts        # Processing scene
│   └── ...
├── assets/
│   ├── tileset.png
│   └── sounds/
└── README.md
```

### Project Knowledge Structure

```
.claude/knowledge/
├── remember-queue/              # Pending remember entries (JSON)
│   └── {timestamp}-{shortid}.json
├── pending-review/              # Questions needing user answers (JSON)
│   └── {shortuuid}-{subject}.json
├── architecture/                # Organized knowledge
├── patterns/
├── dependencies/
├── workflows/
├── gotchas/
├── KNOWLEDGE_MAP.md
├── KNOWLEDGE_MAP_CLAUDE.md
└── .last-analysis                # Timestamp + commit for debounce
```

---

## The Three Agents

### Agent 1: Queue Processor

**Purpose:** Process `remember()` queue entries

**Lifecycle:**
- Lives in MCP server memory
- Processes queue items one at a time
- Restarts fresh if context fills (re-reads all knowledge files)

**Input:** Queue entry from JSON file

**Structured Output:**
```typescript
const QueueProcessorOutput = z.object({
  status: z.enum(['processed', 'conflict_detected']),
  action: z.enum(['added', 'updated', 'duplicate_skipped', 'created_review']),
  file_modified: z.string().nullable(),
  ready_for_next: z.boolean(),
});
```

**Behavior:**
- Check if knowledge already exists → skip duplicate
- Check if knowledge conflicts with existing → create pending-review JSON
- Otherwise → write to appropriate organized file
- Be **ruthless** about deletion - if new info conflicts, delete old, keep new
- Signal `ready_for_next: true` when done with current item

**Tools:** All tools EXCEPT AskUserQuestion

### Agent 2: On-Changes Reviewer

**Purpose:** Detect stale/conflicting knowledge when code changes

**Trigger:** SessionStart hook (with debounce)

**Debounce Logic:**
1. Read `.claude/knowledge/.last-analysis` (timestamp + commit)
2. If analyzed within last N minutes, skip
3. If current HEAD === last analyzed commit, skip
4. Otherwise, run analysis and update `.last-analysis`

**Structured Output:**
```typescript
const ReviewEntry = z.object({
  id: z.string(),           // Short UUID
  subject: z.string(),      // Brief subject for filename
  type: z.enum(['stale', 'conflict', 'outdated']),
  question: z.string(),     // The question to ask user
  context: z.string(),      // File paths, code snippets
  options: z.array(z.string()), // A, B, C, D choices
  knowledge_file: z.string(),
});

const ChangesReviewerOutput = z.object({
  reviews: z.array(ReviewEntry),
  done: z.boolean(),
});
```

**Behavior:**
- Compare knowledge files against current codebase
- Look for: deleted functions/files still referenced, conflicting info, outdated patterns
- Output structured review entries
- Write each to `.claude/knowledge/pending-review/{id}-{subject}.json`

**Tools:** All tools EXCEPT AskUserQuestion

### Agent 3: Wellspring Agent

**Purpose:** Apply user's answers from the game UI

**Trigger:** User completes Bridge Guardian questions, enters Wellspring scene

**Style:** Conversational like Arbiter (user watches it work)

**Structured Output:**
```typescript
const WellspringOutput = z.object({
  message: z.string(),
  done: z.boolean(),
});
```

**Context Given:**
- All answered pending-review JSON files
- Instruction to apply the user's decisions

**Behavior:**
- Read the answered JSON files
- Apply each decision (delete entries, update files, merge content)
- Delete processed JSON files
- Can ask follow-up questions in chat if needed
- Signal `done: true` when all work complete

**Tools:** All tools EXCEPT AskUserQuestion

---

## MCP Server

### Remember Tool

```typescript
// Tool definition
{
  name: 'remember',
  description: '...existing description...',
  inputSchema: { /* existing schema */ }
}

// Handler
async function remember(args) {
  const id = generateShortId();
  const entry = {
    id,
    timestamp: Date.now(),
    status: 'pending',
    entry: args
  };

  // Write to queue file
  const filename = `${entry.timestamp}-${id}.json`;
  await writeFile(
    `.claude/knowledge/remember-queue/${filename}`,
    JSON.stringify(entry, null, 2)
  );

  // Return immediately (non-blocking)
  return `Queued for processing: [${args.category}] ${args.topic}`;
}
```

### Queue Processing Loop

```typescript
class QueueProcessor {
  private agent: AgentSession | null = null;

  async processNext() {
    // Find oldest pending queue file
    const files = await glob('.claude/knowledge/remember-queue/*.json');
    const pending = files
      .map(f => JSON.parse(readFileSync(f)))
      .filter(e => e.status === 'pending')
      .sort((a, b) => a.timestamp - b.timestamp);

    if (pending.length === 0) return;

    const item = pending[0];

    // Mark as processing
    item.status = 'processing';
    await writeFile(item.filepath, JSON.stringify(item));

    // Ensure agent is running
    if (!this.agent) {
      this.agent = await this.startAgent();
    }

    // Send to agent
    const result = await this.agent.send(`Process this entry: ${JSON.stringify(item.entry)}`);

    if (result.ready_for_next) {
      // Delete queue file
      await unlink(item.filepath);
    }

    // Process next
    setImmediate(() => this.processNext());
  }

  async startAgent() {
    // Load all knowledge files for context
    const knowledge = await this.loadAllKnowledge();

    return query({
      prompt: `You are the Knowledge Processor. Here is all current knowledge:\n\n${knowledge}\n\nProcess entries I send you.`,
      options: {
        model: 'opus',
        outputFormat: { type: 'json_schema', schema: queueProcessorSchema },
        canUseTool: denyAskUserQuestion,
      }
    });
  }

  onAgentCompact() {
    // Mark any 'processing' items back to 'pending'
    // Restart agent fresh
    this.agent = null;
  }
}
```

---

## Game UI Scenes

### Scene 1: Character Select

Reuse Arbiter's character select screen. Player picks their sprite.

### Scene 2: Bridge Guardian

**Layout (7x6 grid):**
```
     Col 0    Col 1    Col 2    Col 3    Col 4    Col 5    Col 6
   ┌────────┬────────┬────────┬────────┬────────┬────────┬────────┐
R0 │  TREE  │  TREE  │ CHASM  │ CHASM  │ CHASM  │ CHASM  │ CHASM  │
   ├────────┼────────┼────────┼────────┼────────┼────────┼────────┤
R1 │  grass │  grass │ CHASM  │ CHASM  │ CHASM  │ CHASM  │ CHASM  │
   ├────────┼────────┼────────┼────────┼────────┼────────┼────────┤
R2 │  TREE  │ PLAYER │GUARD199│BRIDGE59│BRIDGE59│cobble12│cobble12│ ← Exit
   ├────────┼────────┼────────┼────────┼────────┼────────┼────────┤
R3 │  grass │  grass │ CHASM  │ CHASM  │ CHASM  │ CHASM  │ CHASM  │
   ├────────┼────────┼────────┼────────┼────────┼────────┼────────┤
R4 │  TREE  │  TREE  │ CHASM  │ CHASM  │ CHASM  │ CHASM  │ CHASM  │
   ├────────┼────────┼────────┼────────┼────────┼────────┼────────┤
R5 │  grass │  TREE  │ CHASM  │ CHASM  │ CHASM  │ CHASM  │ CHASM  │
   └────────┴────────┴────────┴────────┴────────┴────────┴────────┘
```

**Interaction:**
- Guardian (199) blocks bridge entrance at (2,2)
- Questions displayed below scene (like Arbiter's file explorer)
- Player selects A/B/C/D or O for "Other" (switches to text input)
- Answers written to JSON files as user progresses
- When all questions answered, Guardian steps aside
- Player walks across bridge, exits right edge at (2,6)
- Triggers transition to Wellspring scene

**Question Display:**
```
┌─────────────────────────────────────────────────────────────┐
│  The Guardian speaks:                                       │
│                                                             │
│  "Two memories speak of authentication. One claims cookies, │
│   one claims JWT. Which wisdom shall endure?"               │
│                                                             │
│  Context: patterns/auth.md vs remember-queue entry          │
│                                                             │
│  > [a] Keep the elder (cookies)                             │
│    [b] Keep the younger (JWT)                               │
│    [c] Merge their wisdom                                   │
│    [d] Both speak truth                                     │
│    [o] Other (type your answer)                             │
│                                                             │
│  Question 3 of 7                                            │
└─────────────────────────────────────────────────────────────┘
```

**Zero Questions:** If no pending reviews, Guardian says "The Wellspring is pure. You may pass." and steps aside immediately.

### Scene 3: Wellspring

**Layout (7x6 grid):**
```
     Col 0    Col 1    Col 2    Col 3    Col 4    Col 5    Col 6
   ┌────────┬────────┬────────┬────────┬────────┬────────┬────────┐
R0 │  TREE  │  TREE  │  TREE  │  TREE  │  TREE  │  TREE  │ODIN 209│
   ├────────┼────────┼────────┼────────┼────────┼────────┼────────┤
R1 │  TREE  │cobble12│cobble12│cobble12│cobble12│cobble12│  TREE  │
   ├────────┼────────┼────────┼────────┼────────┼────────┼────────┤
R2 │cobble12│cobble12│WATER 55│WATER 55│WATER 55│cobble12│  TREE  │ ← Entry
   ├────────┼────────┼────────┼────────┼────────┼────────┼────────┤
R3 │  TREE  │cobble12│WATER 55│MÍM+WAT │WATER 55│cobble12│  TREE  │
   ├────────┼────────┼────────┼────────┼────────┼────────┼────────┤
R4 │  TREE  │cobble12│cobble12│ TARGET │cobble12│cobble12│  TREE  │ ← Player destination
   ├────────┼────────┼────────┼────────┼────────┼────────┼────────┤
R5 │  TREE  │  TREE  │  TREE  │  TREE  │  TREE  │  TREE  │  TREE  │
   └────────┴────────┴────────┴────────┴────────┴────────┴────────┘
```

**Rendering notes:**
- Mím (216) composited ON TOP of water (55) background
- Odin (209) watches from top-right corner
- Cobblestone extends to left edge (entry point)

**Flow:**
1. Player enters from left at (2,0)
2. Auto-walk to position (4,3) while Wellspring agent starts
3. Chat window appears below scene (like Arbiter main screen)
4. User watches agent work (read-only, Arbiter-style)
5. Water bubbles animation while processing
6. When agent outputs `done: true`, show "The Wellspring is purified. Press any key."
7. Exit game, return to terminal

---

## CLI Commands

### `mim`

```bash
$ mim
# Check for pending reviews
if (pendingReviewsExist()) {
  prompt("You have N pending reviews. Run review? (Y/n)")
  if (yes) runReview()
} else {
  print("No pending reviews. The Wellspring is pure.")
}
```

### `mim review`

```bash
$ mim review
# Launch game UI
# Character select → Bridge Guardian → Wellspring
```

### `mim init`

```bash
$ mim init
# Create .claude/knowledge/ structure
# Set up CLAUDE.md references
# Initialize .gitattributes
```

---

## SessionStart Hook

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/check-analysis.js",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

**check-analysis.js:**
```javascript
// 1. Check .claude/knowledge/.last-analysis
// 2. Debounce: skip if analyzed recently
// 3. Check if HEAD changed since last analysis
// 4. If analysis needed, spawn Agent 2 (On-Changes Reviewer)
// 5. If pending-review files exist, output system message:
//    "MIM has pending knowledge reviews. Exit and run `mim review` to resolve."
```

---

## Pending Review JSON Schema

**File:** `.claude/knowledge/pending-review/{shortuuid}-{subject}.json`

```json
{
  "id": "a1b2c3",
  "subject": "auth-conflict",
  "type": "conflict",
  "question": "Two memories speak of authentication...",
  "context": "patterns/auth.md line 42 vs remember-queue entry",
  "options": [
    "Keep the elder (cookies)",
    "Keep the younger (JWT)",
    "Merge their wisdom",
    "Both speak truth"
  ],
  "knowledge_file": "patterns/auth.md",
  "created_at": "2024-01-24T10:30:00Z",
  "answer": null  // Filled in by game UI, implies answered status
}
```

When `answer` is set, the entry is considered answered. Delete file after Wellspring agent processes it.

---

## Acceptance Criteria

1. **Clean install:**
   - `npm install -g mim-ai` works
   - Plugin installs to user or project level
   - `mim init` creates knowledge structure

2. **Remember flow:**
   - `remember()` returns immediately (non-blocking)
   - Queue files created in `remember-queue/`
   - Agent 1 processes queue, writes organized knowledge
   - Duplicates are skipped
   - Conflicts create pending-review JSON

3. **Analysis flow:**
   - SessionStart triggers analysis (with debounce)
   - Agent 2 detects stale/conflicting knowledge
   - Pending-review JSONs created
   - Claude tells user about pending reviews

4. **Review flow:**
   - `mim review` launches game UI
   - Character select works
   - Bridge Guardian presents questions
   - Answers saved to JSON
   - Walking off bridge triggers Wellspring scene
   - Wellspring agent applies decisions
   - `done: true` triggers exit prompt

5. **Clean implementation:**
   - No session.md
   - No legacy v1 code
   - Linted and type-checked

---

## Files to Reference

**Arbiter Repository:** `/workspace/arbiter/` (cloned from https://github.com/lucianHymer/arbiter)

Arbiter is a hierarchical AI orchestration system with a gamified TUI. **Everything we're building for MIM v2 already exists in Arbiter, just assembled differently for a different purpose.** Use it as your primary reference:

- `/workspace/arbiter/src/tui/*` - Complete TUI framework (tileset, sprites, scenes, animations, input handling)
- `/workspace/arbiter/src/tui/screens/` - Character select, title screen, intro sequences
- `/workspace/arbiter/src/router.ts` - Claude Agent SDK patterns, structured outputs with Zod, session management
- `/workspace/arbiter/src/state.ts` - State management patterns
- `/workspace/arbiter/src/arbiter.ts` - Agent system prompts, hooks, canUseTool patterns
- `/workspace/arbiter/src/orchestrator.ts` - Another agent example with different structured outputs
- `/workspace/arbiter/assets/` - Tileset (16x16 fantasy), sound effects, music
- `/workspace/arbiter/package.json` - npm package structure with bin entry

**MIM v1 (for reference only, will be deleted):**
- `/workspace/project/pkg/claude/servers/mim.cjs` - Current MCP server
- `/workspace/project/pkg/src/` - Current TypeScript implementation

---

## Implementation Order

1. **Setup:** Create package structure, copy TUI from Arbiter
2. **MCP Server:** Rewrite with queue-based remember
3. **Agent 1:** Queue processor with structured outputs
4. **Game UI:** Bridge Guardian scene and question flow
5. **Game UI:** Wellspring scene
6. **Agent 3:** Wellspring agent
7. **Agent 2:** On-Changes reviewer
8. **Hooks:** SessionStart analysis trigger
9. **CLI:** `mim`, `mim review`, `mim init` commands
10. **Cleanup:** Remove v1 code, lint, test

---

## Notes for Implementer

- Use `opus` model for all agents
- Disable AskUserQuestion tool for all agents
- Look at Arbiter's `canUseTool` implementation
- Arbiter's TUI handles terminal cleanup well - preserve that
- Test in VS Code integrated terminal
- Water (55) is a background tile - composite Mím (216) on top
- Player auto-walk uses existing Arbiter sprite.walk() method
- Structured outputs use Zod schemas - see Arbiter for patterns
- biome for linting (same as Arbiter)

If you upgraded to Zod 4 and your structured outputs stopped working (SDK returns plain text instead of JSON, structured_output is undefined despite subtype: "success"), it's because Zod 4's z.toJSONSchema() adds
   a "$schema" field that the Anthropic API doesn't handle.

  Fix: Strip the $schema field before passing to the SDK:

  function stripSchemaField(schema: Record<string, unknown>): Record<string, unknown> {
    const { $schema, ...rest } = schema;
    return rest;
  }

  const mySchema = stripSchemaField(z.toJSONSchema(MyZodSchema));

  // Then use it
  query({
    prompt: '...',
    options: {
      outputFormat: { type: 'json_schema', schema: mySchema }
    }
  })

  The old zod-to-json-schema library didn't include $schema, but Zod 4's native method does.
