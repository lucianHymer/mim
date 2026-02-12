---
name: validate
description: Validates all knowledge entries against the current codebase. Auto-fixes aggressively and writes unresolved.md for ambiguous items. Use when asked to "validate knowledge", "check knowledge entries", or "clean up stale knowledge".
disable-model-invocation: true
allowed-tools: Read, Write, Edit, Glob, Grep, Task
---

# Validate Knowledge

Validate all knowledge entries against the current codebase. Auto-fix what you can, delete what is stale, and write genuinely ambiguous items to `unresolved.md` for human review.

## Steps

1. **Discover entries.** Use Glob to find all `.claude/knowledge/{category}/*.md` files. Exclude `INSTRUCTIONS.md`, `KNOWLEDGE_MAP.md`, `KNOWLEDGE_MAP_CLAUDE.md`, and `unresolved.md`.

2. **Validate by category.** For each category directory, use the Task tool with `subagent_type: "knowledge-researcher"` to validate entries. Pass the full file contents of every knowledge file in that category. The subagent checks file references, patterns, and conventions against the current codebase and returns findings as JSON.

3. **Extract JSON from subagent response.** Strip any markdown code fences (```json ... ``` or ``` ... ```) from the subagent's text response, then parse the JSON array. If JSON parsing fails, log a warning and skip that category.

4. **Process findings.** For each finding in the parsed array:
   - **valid**: No action needed. Count it.
   - **stale** (referenced files deleted, pattern no longer exists, feature removed): Auto-delete the knowledge file. Remove its entry from the knowledge map.
   - **contradicted** (code now does the opposite): Auto-fix the knowledge entry using the subagent's `suggestion` field as guidance. Rewrite the entry for quality and terseness.
   - **unclear** (genuinely ambiguous, cannot determine correctness): Append to `.claude/knowledge/unresolved.md` using the format below.

5. **Write unresolved.md.** Use plain prose under H2 headers naming the knowledge file:

   ```
   ## gotchas/redis-pooling.md
   The referenced file no longer exists. Delete, update, or keep as-is?
   ```

   No structured metadata blocks. No `**File:**` or `**Options:**` fields. Just natural language describing the issue. Claude will derive appropriate actions during `/mim:review`.

6. **Consolidate.** After processing all findings, consolidate knowledge files that have grown unwieldy from repeated `remember()` appends:
   - File has redundant sections (same fact stated multiple times) -> Rewrite as single terse summary
   - File has contradictory sections (earlier says X, later says Y) -> Keep latest, rewrite as single entry
   - File exceeds ~20 lines -> Consolidate to keep it lean for context loading
   - Multiple files in same category cover overlapping topics -> Merge into one file, update map
   - Goal: fewer, longer files with clean content -- not many tiny files, not sprawling append logs

7. **Regenerate knowledge map.** Scan all `{category}/*.md` files on disk and rebuild `KNOWLEDGE_MAP_CLAUDE.md` from scratch. This handles drift from partial failures, manual edits, or file merges.

8. **Report summary.** Output: X validated, Y auto-fixed, Z deleted, W unresolved, V consolidated.

## Deletion Criteria (Aggressive)

- Referenced file no longer exists AND no similar file found -> DELETE
- Described API/function signature completely changed -> AUTO-FIX
- Pattern describes something that no longer applies -> DELETE
- Two entries contradict each other -> keep newer, delete older
- Entry is about a deleted feature -> DELETE

## Consolidation Criteria

- Redundant sections from repeated appends -> consolidate into single terse summary
- Contradictory sections -> keep latest, rewrite as single entry
- File exceeds ~20 lines -> consolidate
- Overlapping files in same category -> merge into one file
