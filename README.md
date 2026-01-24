# Mím - Persistent Memory for Claude Code

Norse mythology tells of Mímir, guardian of the Wellspring beneath Yggdrasil
where all knowledge pools and swirls. The Vanir claimed his head. Odin
claimed it back. Now preserved in herbs and rune-magic, the severed head
whispers secrets from the cosmic deep - deathless, sleepless, all-remembering.

Mim captures what Claude Code discovers in its wanderings, preserving each
insight in an ever-growing Wellspring of Knowledge.
Nothing learned is lost.
Every discovery feeds the depths.

What dies in context lives eternal in the Wellspring.

---

<p align="center">
    <i>
        A knowledge accumulation system for Claude Code that
        never forgets what it learns.
    </i>
    <br><br>
    <img
        src="https://raw.githubusercontent.com/lucianHymer/mim/refs/heads/main/assets/mim.jpg"
        width="320px"
        alt="Odin and Mimir's Head"
        title="Odin and Mimir's Head, 2006 Sam Flegal, https://www.germanicmythology.com/works/TMMimirsHead.html"
    >
    <br>
    <b>Odin with Mímir's Head</b>
</p>

## Description

Mim is an AI-powered knowledge management system for Claude Code with three core components:

- **Knowledge Capture**: The MCP `remember()` tool allows Claude Code to automatically capture insights and discoveries during sessions
- **Knowledge Review**: An interactive TUI game for reviewing, organizing, and refining captured knowledge
- **AI-Powered Processing**: Uses the Claude Agent SDK for intelligent knowledge categorization and conflict resolution

Knowledge is organized into categories:
- **Architecture** - System design decisions and structural patterns
- **Patterns** - Recurring code patterns and best practices
- **Dependencies** - Package relationships and version constraints
- **Workflows** - Development processes and automation
- **Gotchas** - Edge cases, pitfalls, and lessons learned

## Requirements

- Node.js 18+

## Installation

```bash
npm install -g mim-ai
```

Then initialize Mim in your project:

```bash
mim init
```

This creates the `.claude/knowledge/` directory structure and configures the MCP server.

## Usage

1. **During Claude sessions**: Claude automatically uses `remember()` to capture discoveries
2. **Check status**: Run `mim status` to see pending knowledge awaiting review
3. **Review knowledge**: Run `mim review` to launch the interactive TUI for organizing insights

### Commands

- `mim` or `mim status` - Check the status of the Wellspring (shows pending reviews)
- `mim review` - Launch the interactive review TUI game
- `mim init` - Initialize the `.claude/knowledge/` directory structure

## How It Works

The knowledge is loaded into Claude's memory through your project's `CLAUDE.md` file. You can use `/memory` and `/context` in Claude Code to verify it's working as expected.

When Claude calls `remember()`, knowledge entries are queued for intelligent processing. The Queue Processor agent automatically:
- Deduplicates entries against existing knowledge
- Detects conflicts with current documentation
- Writes new knowledge directly to organized category files (architecture, patterns, dependencies, workflows, gotchas)
- Creates pending reviews for conflicts that need human decision

Run `mim review` to resolve any pending reviews through the Bridge Guardian game.
