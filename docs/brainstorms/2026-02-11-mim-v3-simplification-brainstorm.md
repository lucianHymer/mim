# Mim v3: The Simplification

**Date:** 2026-02-11
**Status:** Ready for planning
**Author:** Lucian + Claude

## What We're Building

A radical simplification of Mim - from ~6000 lines of TypeScript (TUI game, agent swarms, daemon architecture, Agent SDK in the MCP server) down to a handful of markdown files and one small MCP server script. The system leverages Claude Code's native plugin subagent system instead of custom orchestration.

### The Problem

**V2** is over-engineered with a recursive memory leak. The MCP server hosts an Opus agent that calls `query()`, which spawns Claude Code, which loads the MCP server, which spawns another agent. 15-20 `remember()` calls = 15-20+ simultaneous processes = 40GB+ RAM.

**V1** was magic - automatic capture, knowledge accumulates, Claude gets smarter over time. But it needed manual `coalesce`/`distill` commands and accumulated unboundedly without self-trimming.

### Core Insight

Claude Code's native plugin subagent system solves every problem the daemon/v2 architecture was designed to solve:

- Subagents **cannot spawn other subagents** - recursion impossible by design
- MCP tools **are available** to foreground subagents - `remember()` works everywhere
- Subagents run in **isolated context** - don't pollute main conversation
- **AskUserQuestion** works from the main thread for interactive review (NOT from subagents - SDK limitation)

## Why This Approach

**Chosen:** Lean plugin with MCP tool + Haiku subagent + skills + minimal hook

**Considered and rejected:**
- **Daemon architecture** (docs/daemon-handoff.md) - solves the memory leak but adds complexity (HTTP server, scheduler, 4 job types). We don't need a daemon when native subagents exist.
- **Compound-engineering style** (no MCP, all manual) - too loose. Loses automatic capture, which was v1's magic. MCP `remember()` is what makes knowledge capture effortless.
- **No subagent, process inline** - would block session start for coalescing. Nobody wants to wait 30 seconds at session start.
- **remember() as subagent instead of MCP tool** - subagents can't call other subagents. MCP tools can be called from subagents. MCP is the universal capture mechanism.
- **Haiku for both research AND decisions** - Haiku doesn't have judgment to decide "this is fine, just fix it" vs "this needs human input." It flags everything and creates noise. Haiku researches, main thread (Sonnet/Opus) decides.
- **Single Sonnet subagent for everything** - too expensive at scale. Hundreds of knowledge entries means Sonnet doing bulk file reads. Haiku is 10x cheaper for the research grunt work.

## Key Decisions

### 1. MCP `remember()` writes directly to knowledge files

No inbox, no queue, no staging file, no processing step. The `remember()` tool already receives `category`, `topic`, `details`, and `files` - that's enough to write directly to `.claude/knowledge/{category}/{topic-slug}.md`. Instant. No AI needed.

### 2. Validation is decoupled from session start

Session start does ZERO processing. The `/mim:validate` skill is triggered externally - by cron, by a Telegram heartbeat, by the user manually. No blocking. Ever.

### 3. Aggressive deletion over asking

The validator's default is to fix or delete, not to ask. Assume Claude over-remembers. Tokens cost permanent context. The bar for writing to `unresolved.md` (the "I genuinely cannot figure this out" file) is extremely high.

### 4. Terse everything

INSTRUCTIONS.md and the remember skill emphasize extreme terseness. Every token in knowledge costs permanent context. No filler, no preamble - just the fact.

### 5. No CLI

The `mim` CLI is dead. Everything it did is replaced by native Claude Code features:
- `mim init` -> SessionStart hook ensures directory structure + git config
- `mim review` -> `/mim:review` skill
- `mim validate` -> `/mim:validate` skill
- `mim status` -> Claude reads the knowledge directory

### 6. No TUI game

The entire 4000-line TUI game (sprites, animation, bridge guardian, wellspring screen) is replaced by conversational AskUserQuestion from the main thread. Reviews happen naturally in conversation.

### 7. Haiku researches, main thread decides

The Haiku subagent is read-only - it checks knowledge entries against the codebase and reports findings. The main thread (Sonnet/Opus, whatever model the session runs) makes all judgment calls about what to fix, delete, or flag.

## Architecture

### Components

| Component | Format | Purpose |
|---|---|---|
| MCP server | ~100 lines JS | `remember()` tool - writes directly to knowledge files |
| `knowledge-researcher` subagent | Markdown | Haiku read-only research agent for bulk validation |
| `/mim:validate` skill | Markdown | Instructions for validating + refining all knowledge |
| `/mim:review` skill | Markdown | Instructions for working through unresolved items with user |
| SessionStart hook | ~20 lines shell | Check for unresolved items, ensure git config + dirs |
| INSTRUCTIONS.md | Markdown | Updated to emphasize extreme terseness |

### Full Repo Structure (after purge)

```
/ (repo root - IS the Claude Code marketplace)
├── .claude-plugin/
│   └── marketplace.json           ← marketplace definition, points to ./mim-ai
├── .claude/
│   └── knowledge/                 ← project's own mim knowledge (keep)
│       ├── INSTRUCTIONS.md
│       ├── KNOWLEDGE_MAP.md
│       ├── KNOWLEDGE_MAP_CLAUDE.md
│       └── architecture/
├── CLAUDE.md                      ← project instructions (keep)
├── README.md                      ← update for v3
├── LICENSE
├── docs/
│   └── brainstorms/               ← this file lives here
│
└── mim-ai/                        ← THE PLUGIN (marketplace source)
    ├── .claude-plugin/
    │   └── plugin.json            ← name, version, description, mcpServers, hooks
    ├── agents/
    │   └── knowledge-researcher.md ← Haiku read-only research agent
    ├── skills/
    │   ├── validate/
    │   │   └── SKILL.md           ← /mim:validate
    │   ├── review/
    │   │   └── SKILL.md           ← /mim:review
    │   └── remember/
    │       └── SKILL.md           ← /mim:remember (update for terseness)
    ├── hooks/
    │   └── mim-hooks.json         ← SessionStart hook config
    ├── servers/
    │   └── mim-server.bundled.cjs ← minimal remember() MCP tool
    └── scripts/
        └── session-start.sh       ← check unresolved.md, ensure git config, ensure dirs
```

Everything else in `mim-ai/` gets purged: `src/`, `bin/`, `assets/`, `package.json` (or stripped to minimal), all TypeScript source, all build tooling for agents/TUI, all dependencies (terminal-kit, sharp, play-sound, Agent SDK).

Follows Claude Code plugin conventions. Agents and skills auto-discovered from directories.

### Operational Flow

**Capture** (automatic, every session): Claude discovers things -> calls `remember()` -> knowledge written instantly to the right file.

**Validate** (periodic, triggered externally): `/mim:validate` skill run on a schedule (daily/weekly). Main thread uses Haiku researcher for cheap bulk checking, makes judgment calls itself, auto-fixes aggressively, writes `unresolved.md` for rare ambiguous items.

**Review** (on-demand): SessionStart hook mentions unresolved items if they exist. User runs `/mim:review` whenever, or heartbeat triggers it. Conversational - Claude reads the file, works through items with the user via AskUserQuestion.

### Git Handling

- `.claude/knowledge/unresolved.md` -> gitignored (ephemeral, per-machine)
- `.claude/knowledge/{category}/*.md` -> tracked, `merge=union` gitattribute
- `KNOWLEDGE_MAP.md` / `KNOWLEDGE_MAP_CLAUDE.md` -> tracked, `merge=union`
- `.claude/knowledge/mim.log` -> gitignored

SessionStart hook ensures git config (gitignore + gitattributes) is set up. Idempotent.

### External Integration

Designed to work with Agent SDK sessions (e.g. Telegram bot with per-repo threads):
- Heartbeat periodically runs: "compact and run `/mim:validate`"
- Heartbeat checks: "if unresolved items exist, run `/mim:review`"
- `canUseTool` callback intercepts AskUserQuestion and routes through Telegram

## What Gets Deleted

| Component | Lines | Replaced by |
|---|---|---|
| TUI game (main.ts + sprites + animation) | ~4000 | AskUserQuestion |
| Wellspring agent | ~180 | Conversational review |
| Inquisitor agent + swarm | ~800 | Haiku subagent |
| Queue Processor class in MCP server | ~300 | Direct file writes |
| run-analysis.ts background spawner | ~600 | validate skill |
| Changes reviewer agent | ~235 | validate skill |
| Agent SDK dependency in MCP server | - | Gone entirely |
| terminal-kit, sharp, play-sound deps | - | Gone |
| bin/mim.js CLI | ~428 | Skills + hook |
| remember-queue/ directory | - | Direct writes |
| pending-review/ directory | - | Single unresolved.md |

## Open Questions

1. **Knowledge file format** - should entries within a category file be append-only markdown sections, or should each topic get its own file? (Current plan: one file per topic in the category directory)
2. **Map update atomicity** - if `remember()` writes the knowledge file AND updates both maps, what happens on partial failure? Probably fine - maps can be regenerated from files.
3. **Unresolved.md format** - freeform markdown? Structured sections? Keep it simple - freeform with clear headers per item.

## Next Steps

Run `/workflows:plan` to create the implementation plan.
