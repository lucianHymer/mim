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

## Installation

### Quick Install

Run this command from the root of your git repository:

```bash
curl -sSL https://raw.githubusercontent.com/lucianHymer/mim/main/install.sh | sh
```

This will:
- Create `.claude/` directory structure
- Download and install the Mim MCP server
- Configure CLAUDE.md with Mim knowledge references
- Set up `.gitattributes` with merge strategies for session files
- Configure `.mcp.json` to enable the Mim server
- Create initial knowledge session file

After installation:
1. Review the changes: `git status`
2. Commit: `git add . && git commit -m 'Add Mim knowledge system'`
3. Start using Mim in your Claude sessions!

## Usage

1. **During Claude sessions**: Claude will automatically use `remember` to capture discoveries
2. **After commits**: Run `./mim-coalesce` manually to process the remembered knowledge

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

## Important Notes

- Claude will remind you to run `./mim-coalesce` when appropriate
- Mim may take several minutes for complex documentation updates
- All remembered knowledge is preserved in `.knowledge/session.md` until processed
