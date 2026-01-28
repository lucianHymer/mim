# Mím - Persistent Memory for Claude Code

![Mim Demo](assets/demo.gif)

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

Once per machine:

```bash
npm install -g mim-ai
claude plugin marketplace add lucianHymer/mim
```

and once per repo:

```bash
claude plugin install mim-ai@mim-marketplace --scope project
```

That's it. Mím will guide you through the rest.

## How It Works

Once installed, everything happens in the background:

1. **Automatic capture**: As you work, Claude uses `remember()` to capture discoveries about your codebase
2. **Background processing**: New knowledge is deduplicated, categorized, and written to organized files
3. **Background validation**: On session start, existing knowledge is checked against your current codebase
4. **Review when needed**: When conflicts or decisions arise, you'll be prompted to run `mim review`

The knowledge is loaded into Claude's memory through your project's `CLAUDE.md` file. Use `/memory` or `/context` in Claude Code to verify it's working.

### Commands

- `mim` or `mim status` - Check for pending reviews (plugin runs this automatically)
- `mim review` - Launch the interactive review TUI (plugin prompts you to run this when needed)
- `mim init` - Initialize the `.claude/knowledge/` directory (plugin runs this automatically on first `claude` run in a repo)

### Note on Resume Sessions

Background validation runs via the Claude Agent SDK, which creates entries in your resume session list. This is an unavoidable side effect of the current SDK architecture.

## Credits

- Music: [DOOM](https://opengameart.org/content/triple-kill-multiple-tracks)
- Tileset: [16x16 Fantasy Tileset](https://opengameart.org/content/16x16-fantasy-tileset)
- Sound Effects: [512 Sound Effects (8-bit style)](https://opengameart.org/content/512-sound-effects-8-bit-style)
- Built on [Claude Code](https://docs.anthropic.com/en/docs/claude-code)

## License

[FSL-1.1-MIT](LICENSE) — Free to use, modify, and share. Just don't use it to compete with Mim.

---

Norse mythology tells of Mímir, guardian of the Wellspring beneath Yggdrasil
where all knowledge pools and swirls. The Vanir claimed his head. Odin
claimed it back. Now preserved in herbs and rune-magic, the severed head
whispers secrets from the cosmic deep - deathless, sleepless, all-remembering.

Mim captures what Claude Code discovers in its wanderings, preserving each
insight in an ever-growing Wellspring of Knowledge.
Nothing learned is lost.
Every discovery feeds the depths.

What dies in context lives eternal in the Wellspring.

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
