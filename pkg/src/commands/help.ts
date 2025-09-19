/**
 * Display help message
 */
export function showHelp(): void {
  console.log(`Mím - Persistent Memory for Claude Code

Usage: mim <command> [options]

Commands:
  coalesce    Process session.md into organized documentation
  distill     Clean duplicates, conflicts, and outdated information
              Options:
                --no-interactive, -n   Manual two-step process (no auto-editor)
                --editor <cmd>         Override $EDITOR for this session
                --refine-only         Skip to applying existing distill report
  help        Show this help message

Examples:
  mim coalesce              # Process remembered knowledge
  mim distill               # Interactive cleanup (auto-opens editor)
  mim distill -n            # Non-interactive (manual review)
  mim distill --refine-only # Apply existing distill-report.md

Learn more: https://github.com/lucianHymer/mim`);
}