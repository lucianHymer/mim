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

## Description

There are two components:
- **Knowledge Capture**:
        An MCP tool called `remember` allows
        Claude Code to automatically capture its learnings
- **Documentation Processing**:
        A command line tool processes the
        captured knowledge into documentation

The knowledge is loaded into Claude's memory (you can use /memory and /context to it's ensure working as expected).

## Installation

### Quick Install

Run this command from the root of your git repository:

```bash
curl -sSL https://raw.githubusercontent.com/lucianHymer/mim/main/install.sh | sh
```

## Usage

1. **During Claude sessions**: Claude will automatically use `remember` to capture discoveries
2. **After commits**: Run `./mim coalesce` to process the remembered knowledge
3. **Clean documentation**: Run `./mim distill` to interactively clean duplicates and conflicts
   - Opens editor automatically if issues need review
   - Use `--no-interactive` flag for the old two-step behavior

### Commands

- `./mim coalesce` - Process session.md into organized documentation
- `./mim distill` - Interactive cleanup (auto-opens editor for review items)
  - `--no-interactive` or `-n` - Skip editor, manual two-step process
  - `--editor <cmd>` - Override $EDITOR for this session
  - `--refine-only` - Jump straight to applying existing distill report
- `./mim help` - Show available commands

## Appendix

### Components

#### MCP Server (`claude/servers/mim.js`)
Provides the `remember` tool for capturing project insights during Claude sessions.

#### Main Script (`mim`)
The main entry point providing subcommands:
- `mim coalesce` - Processes raw remembered knowledge and updates organized documentation  
- `mim distill` - Interactively cleans duplicates and conflicts (opens editor for review)
  - Interactive by default: opens editor when review needed, auto-commits when done
  - Non-interactive mode (`--no-interactive`): preserves old two-step behavior

#### Configuration
- `claude/append-to-CLAUDE.md` - Needed to enable memory usage
- `claude/append-to-settings.local.json` - Settings to enable the mim MCP server
- `claude/knowledge/append-to-gitattributes` - Git merge strategy to prevent conflicts in session.md files

### Why Manual Execution?

Mim was initially attempted as:
1. **Agent (mim-coalesce)**: Failed due to Unicode/emoji encoding issues in JSON-RPC when using MultiEdit on CLAUDE.md sections with emojis
2. **Git hook (post-commit)**: Failed due to 120+ second timeout when processing complex documentation

Both approaches would crash Claude, making automated execution unreliable. The manual script approach allows mim to run in a stable environment.

### Important Notes

- Claude will remind you to run `./mim coalesce` when appropriate  
- Both coalesce and distill may take several minutes for complex documentation
- All remembered knowledge is preserved in `.claude/knowledge/session.md` until processed
- Distill operations create backups in `.claude/knowledge/distill/backup_*` directories
- Review reports are saved in `distill-report.md` in the repository root for immediate processing
