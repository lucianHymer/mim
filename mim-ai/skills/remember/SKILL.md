---
name: remember
description: Captures knowledge to persistent memory. Use when discovering project-specific patterns, architecture, conventions, or gotchas. Triggers on "I learned that", "turns out", "for future reference", "good to know".
---

# Remember

Use the `remember` MCP tool to capture discoveries about this codebase. Knowledge persists across sessions.

## Be TERSE. Every token costs permanent context.

- ONE fact per entry. No filler. No preamble.
- Max 2-3 sentences per `details` field.
- Include file paths when relevant.
- Categories: architecture, patterns, dependencies, workflows, gotchas (or any descriptive category).
- Repeated calls with similar topics append to the same file (the slug is the grouping key).

## Good vs Bad

BAD: "I discovered that the authentication system uses JWT tokens stored in HTTP-only cookies with a 30-minute expiration time, which is configured in the auth middleware."

GOOD: "Auth uses JWT in HTTP-only cookies, 30min TTL. Configured in `src/middleware/auth.ts`."
