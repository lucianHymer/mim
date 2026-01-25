---
description: Capture knowledge and insights to Mím's Wellspring
---

# Remember

Use the `remember` MCP tool to capture important discoveries, patterns, and insights about this codebase. Knowledge is preserved in the Wellspring and loaded into future sessions.

## Categories

Choose the most appropriate category:

- **architecture** - System design decisions, data flow, component relationships
- **patterns** - Recurring code patterns, conventions, best practices
- **dependencies** - Package relationships, version constraints, compatibility notes
- **workflows** - Development processes, build steps, deployment procedures
- **gotchas** - Edge cases, pitfalls, non-obvious behaviors, lessons learned

## Guidelines

- Be specific and actionable
- Include file paths or function names when relevant
- Focus on insights that would help future development
- Avoid duplicating obvious information from code comments

## Example Usage

When you discover something important about the codebase, call the remember tool:

```
remember({
  category: "gotchas",
  content: "The auth middleware must be applied before rate limiting or tokens won't be validated"
})
```

```
remember({
  category: "architecture",
  content: "All API routes follow the pattern: /api/v{version}/{resource}/{action}"
})
```
