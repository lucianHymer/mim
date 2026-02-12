# Mim - Persistent Memory for Claude Code

## Description

Mim is an AI-powered knowledge management system for Claude Code. It automatically captures, organizes, and validates project-specific knowledge so nothing learned is ever lost.

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
claude plugin marketplace add lucianHymer/mim
```

Once per repo:

```bash
claude plugin install mim-ai@mim-marketplace --scope project
```

That's it. Mim will guide you through the rest.

## How It Works

Once installed, everything happens in the background:

1. **Automatic capture**: As you work, Claude uses `remember()` to capture discoveries about your codebase
2. **Background processing**: Direct file writes, no queue, instant
3. **Validation**: `/mim:validate` checks knowledge against current codebase
4. **Review**: `/mim:review` resolves ambiguous items interactively

The knowledge is loaded into Claude's memory through your project's `CLAUDE.md` file. Use `/memory` or `/context` in Claude Code to verify it's working.

### Commands

- `/mim:validate` - Check all knowledge entries against current codebase
- `/mim:review` - Resolve unresolved knowledge items interactively
- `/mim:remember` - Learn about the remember workflow

## Credits

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
