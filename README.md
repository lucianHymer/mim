# Mím - Persistent Memory for Claude Code

Norse mythology tells of Mímir, guardian of the Wellspring beneath Yggdrasil
where all knowledge pools and swirls. The Vanir claimed his head. Odin
claimed it back. Now preserved in herbs and rune-magic, the severed head
whispers secrets from the cosmic deep - deathless, sleepless, all-remembering.

Mím captures what Claude Code discovers in its wanderings, preserving each
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

## Features

- **Knowledge Capture**: Uses the `remember` MCP tool to document discoveries
- **Session Memory**: Maintains session-specific knowledge in `.knowledge/session.md`
- **Manual Processing**: Run `./mim-coalesce` to organize remembered knowledge into documentation
- **Claude Native**: A simple reference to the knowledge map from CLAUD.md loads the docs into claude's memory system

## Components

### MCP Server (`claude/servers/mim.js`)
Provides the `remember` tool for capturing project insights during Claude sessions.

### Manual Script (`scripts/mim-coalesce`)
Processes raw remembered knowledge and updates organized documentation. Must be run manually after commits.

### Configuration
- `claude/append-to-CLAUDE.md` - Needed to enable memory usage
- `claude/append-to-settings.local.json` - Settings to enable the mim MCP server
- `claude/knowledge/append-to-gitattributes` - Git merge strategy to prevent conflicts in session.md files

## Why Manual Execution?

Mim was initially attempted as:
1. **Agent (mim-coalesce)**: Failed due to Unicode/emoji encoding issues in JSON-RPC when using MultiEdit on CLAUDE.md sections with emojis
2. **Git hook (post-commit)**: Failed due to 120+ second timeout when processing complex documentation

Both approaches would crash Claude, making automated execution unreliable. The manual script approach allows mim to run in a stable environment.

## Installation

Run the install script:
```bash
./incantations/mim/install.sh
```

This will:
- Copy the `mim-coalesce` script to your project root
- Set up the MCP server configuration
- Add documentation sections to CLAUDE.md

## Usage

1. **During Claude sessions**: Claude will automatically use `remember` to capture discoveries
2. **After commits**: Run `./mim-coalesce` manually to process the remembered knowledge

## Important Notes

- Claude will remind you to run `./mim-coalesce` when appropriate
- Mim may take several minutes for complex documentation updates
- All remembered knowledge is preserved in `.knowledge/session.md` until processed

## Merge Conflict Prevention

Mim includes a gitattributes configuration that prevents merge conflicts in session.md files.
When multiple team members remember knowledge simultaneously, git will automatically merge their 
iscoveries using the `union` merge strategy instead of creating conflicts.
This ensures all remembered knowledge is preserved and combined during merges.

This is mostly to avoid annoying false conflicts when rebasing.

