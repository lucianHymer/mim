---
title: "Mim v3: The Simplification"
type: refactor
date: 2026-02-11
deepened: 2026-02-11
---

# Mim v3: The Simplification

## Enhancement Summary

**Deepened on:** 2026-02-11
**Research agents used:** 14 (architecture-strategist, code-simplicity-reviewer, security-sentinel, performance-oracle, agent-native-reviewer, pattern-recognition-specialist, spec-flow-analyzer, best-practices-researcher, framework-docs-researcher, agent-native-architecture skill, create-agent-skills skill, plugin-validator, skill-reviewer, Context7 MCP SDK)

### Key Improvements Discovered

1. **CRITICAL: Path traversal vulnerability** in category parameter -- must sanitize category the same way as topic slug
2. **CRITICAL: writeFileSync is NOT atomic** -- use temp-file-then-rename pattern for all file writes
3. **CRITICAL: Hook config missing `matcher` field** -- required by Claude Code hook schema
4. **HIGH VALUE: Eliminate dual knowledge maps** -- keep only KNOWLEDGE_MAP_CLAUDE.md, delete KNOWLEDGE_MAP.md (removes entire class of sync bugs, ~20 fewer lines)
5. **HIGH VALUE: Simplify unresolved.md to plain prose** -- Claude reads natural language better than structured markdown contracts
6. **HIGH VALUE: Consider removing knowledge-researcher subagent** -- main thread can validate directly; add Haiku subagent back later if cost is a concern
7. **Security: Empty/oversized slug handling** -- add fallback for empty slugs, cap at 100 chars
8. ~~Agent-native: AskUserQuestion blocks automated contexts~~ -- resolved: works via `canUseTool` redirect in target environment
9. **Skills: All descriptions need third-person format** with trigger phrases per Claude Code conventions
10. **Docs: Hook output field** should use `systemMessage` (not `additionalContext`) per Claude Code hook spec

### New Considerations Discovered

- Category synonym map is over-engineered for an LLM caller -- reduce to plural/singular normalization only
- `.gitattributes` management is YAGNI -- drop from SessionStart hook
- V2 archive files should be deleted outright (git history preserves them)
- 3 orphaned v2 queue entries exist that will be silently lost -- consider one-time migration
- Concurrent Claude Code sessions create TOCTOU race on map files (self-healing via validate, but document)
- The validate skill needs explicit JSON extraction strategy for parsing Haiku subagent text responses
- The "edit" action in `/mim:review` is underspecified -- define the UX
- Consider `"type": "module"` in package.json to match `.mjs` hook convention

---

## Overview

Radical simplification of Mim from ~6000 lines of TypeScript (TUI game, agent swarms, daemon architecture, Agent SDK in MCP server) down to ~300 lines of JS and a collection of markdown files. Leverages Claude Code's native plugin subagent system instead of custom orchestration.

**From:** 4 TypeScript agents, 4000-line TUI game, queue-based MCP server with embedded Agent SDK, background analysis daemon, CLI tool, 8+ npm dependencies

**To:** ~150-line MCP server (direct file writes), 3 markdown skill files, 1 markdown agent definition, 1 small Node.js hook script (~60 lines)

### Research Insights: Architecture

**Architecture Strategist Assessment:** The core architectural thesis is sound. V2 reimplements capabilities that Claude Code's plugin system already provides natively. The recursion fix is structural (makes failure mode unrepresentable) rather than procedural (makes it merely unlikely). Component boundaries are clean and respect single responsibility. Dependency inversion is properly applied -- the MCP server is pure infrastructure, all intelligence lives in plugin primitives.

**Agent-Native Architecture Assessment:** The plan scores 7/8 on agent-native parity. Agents are first-class citizens. The `remember()` tool is a clean primitive (stores data, doesn't make decisions). New features can be added by writing new SKILL.md files without code changes. The only gap is `/mim:review` requiring human interaction via AskUserQuestion.

**Performance Assessment:** The v3 plan represents an exceptional performance improvement across every dimension. Synchronous file I/O is the correct choice for this MCP server (event loop concern is irrelevant because MCP stdio servers are inherently single-threaded). The ~20MB memory claim is realistic (15-25MB expected). The <2ms per `remember()` call claim is accurate.

**Simplicity Assessment:** The plan already achieves dramatic simplification (8,379 lines -> ~300). However, it carries forward some v2 habits that could be further simplified. With all recommended simplifications applied, the target could drop to ~200-220 lines.

---

## Problem Statement

**V2 has a recursive memory leak.** The MCP server hosts an Opus agent via `query()`, which spawns Claude Code, which loads the MCP server, which spawns another agent. 15-20 `remember()` calls = 15-20+ simultaneous processes = 40GB+ RAM.

Beyond the leak, V2 is over-engineered: the TUI game alone is 4000 lines for what amounts to presenting multiple-choice questions. The agent swarm (inquisitor, wellspring, changes-reviewer, queue-processor) is 1400+ lines of TypeScript replicating what Claude Code's native subagent system already provides.

---

## Proposed Solution

Replace all custom orchestration with Claude Code's native plugin primitives:

| V2 Component | V3 Replacement |
|---|---|
| Queue Processor Agent (Opus, Agent SDK) | Direct file writes in MCP server |
| Inquisitor Swarm (Haiku, Agent SDK) | `knowledge-researcher` subagent (markdown) |
| Wellspring Agent (Opus, Agent SDK) | Main thread + `/mim:review` skill |
| Changes Reviewer Agent | `/mim:validate` skill |
| TUI Game (4000 lines) | AskUserQuestion (native) |
| CLI (`mim` command) | Skills + SessionStart hook |
| Background analysis runner | `/mim:validate` (triggered externally) |

**Key architectural constraint:** Subagents cannot spawn other subagents. MCP tools CAN be called from foreground subagents. This means `remember()` as an MCP tool works everywhere, and the recursion problem is structurally impossible.

### Research Insights: Subagent Constraints (Verified)

Per Claude Code documentation research:
- **Confirmed:** Subagents cannot spawn other subagents. The Task tool is not available to subagents.
- **Confirmed:** Foreground subagents CAN call MCP tools. MCP tools appear as regular tools via `mcp__<server>__<tool>` naming.
- **Caveat:** Background subagents CANNOT use MCP tools. Ensure knowledge-researcher is spawned as foreground.
- **Caveat:** When a skill specifies `allowed-tools`, verify that MCP tools are still accessible. If `/mim:validate` needs to call `remember()` (e.g., to re-write a fixed entry), it may be blocked by the allowlist. **Action: Test this specific interaction during Phase 4.**

---

## Technical Approach

### Target Plugin Structure

```
mim-ai/                           (THE PLUGIN)
├── .claude-plugin/
│   └── plugin.json               ← name, version, mcpServers, hooks
├── agents/
│   └── knowledge-researcher.md   ← Haiku read-only research subagent
├── skills/
│   ├── validate/
│   │   └── SKILL.md              ← /mim:validate
│   ├── review/
│   │   └── SKILL.md              ← /mim:review
│   └── remember/
│       └── SKILL.md              ← /mim:remember (updated for terseness)
├── hooks/
│   └── mim-hooks.json            ← SessionStart hook config
├── servers/
│   └── mim-server.cjs            ← minimal remember() MCP tool (~150 lines)
└── scripts/
    └── session-start.mjs         ← check unresolved.md, ensure git config, ensure dirs
```

Everything else gets deleted: `src/`, `bin/`, `assets/`, `dist/`, `node_modules/`, heavy `package.json` dependencies, `tsconfig.json`, `scripts/build-server.js`.

### Research Insights: Plugin Structure (Verified)

Per Claude Code plugin documentation:
- **Confirmed:** `.claude-plugin/plugin.json` is the only file that goes inside `.claude-plugin/`. All component directories (`agents/`, `skills/`, `hooks/`) must be at the plugin root.
- **Confirmed:** Skills, agents, and hooks are auto-discovered from default locations. The manifest's component fields supplement (not replace) default directories.
- **Confirmed:** `${CLAUDE_PLUGIN_ROOT}` is the correct variable for portable paths in hook commands and MCP server configs.
- **Confirmed:** Inline `mcpServers` in plugin.json is a supported pattern (alongside `.mcp.json` at plugin root).

### Design Decisions (from brainstorm + gap analysis + deepening research)

**D1: `remember()` appends to files, not overwrites.**
Each topic gets one file keyed by category+slug. Calling `remember()` with a topic that maps to an existing slug **appends** the new content to the existing file. Claude may learn multiple facts about a topic over time, or incrementally refine understanding. Appending preserves the incremental nature of discovery. The **validator** is responsible for consolidating, deduplicating, and cleaning up files that have grown unwieldy.

This also favors **fewer, longer files** over many tiny ones -- better for Haiku subagent context during validation (one file with 5 related facts beats 5 files with 1 fact each).

> **Research note (Patterns):** "Redis - Caching" and "Redis: Caching" and "redis caching" all produce slug `redis-caching`. This is intentional -- the slug is the deduplication/grouping key. Document in the remember skill so Claude understands repeated calls with similar topics append to the same file.

> **Validator responsibility:** The validate skill should consolidate append-heavy files. If a file has redundant or contradictory sections (from multiple appends over time), the validator rewrites it into a clean, terse summary. This keeps the knowledge base lean without losing incremental discoveries.

**D2: `remember()` updates ~~both knowledge maps~~ the knowledge map on every write.**
Essential for closing the knowledge loop. CLAUDE.md references KNOWLEDGE_MAP_CLAUDE.md which uses @ references. If the map is stale, new knowledge is never loaded.

> **CHANGED (Simplicity Review):** Eliminate KNOWLEDGE_MAP.md entirely. Keep only KNOWLEDGE_MAP_CLAUDE.md (rename to just `KNOWLEDGE_MAP.md` since it is the only map). The human-readable KNOWLEDGE_MAP.md with markdown links serves no functional purpose -- humans can browse the directory, Claude uses @ references. Maintaining two maps doubles the update code surface, doubles failure modes, and creates sync drift. This removes ~15-20 lines from the server and eliminates an entire category of bugs.

**D3: SessionStart hook stays Node.js (`.mjs`), not shell.**
Shell scripts cannot safely construct JSON output without `jq`. The hook must output JSON. A ~60-line `.mjs` file with `JSON.stringify` is safer and cross-platform. Matches v2's approach.

> **Research note (Plugin Docs):** The Claude Code hook documentation confirms the output format. For SessionStart hooks, the output should be: `{ "hookSpecificOutput": { "hookEventName": "SessionStart", "additionalContext": "..." } }`. Plain text stdout is also added as context for SessionStart hooks. **The plan originally said `additionalContext` as a top-level field, but it is nested under `hookSpecificOutput`.** Also, `{ "continue": true, "systemMessage": "..." }` is valid for showing messages to the user.

**D4: No activation gate. Plugin install = opt-in.**
V2's `checkMimActivation()` gated features on `npm install -g mim-ai`. V3 has no CLI. The `claude plugin install` is sufficient opt-in. All features active from first install.

> **Research note (Architecture):** This is correct. V2's gate existed because v2 spawned expensive Opus agents in the background. V3's MCP server does only file writes -- there is no expensive operation to gate.

**D5: Topic slug algorithm: lowercase, hyphens, strip special chars.**
`topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')` + `.md` extension. Deterministic, filesystem-safe, human-readable.

> **SECURITY FIX REQUIRED (Security Sentinel):** Add empty-slug guard and length cap:
> ```javascript
> let slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
> if (!slug) slug = 'untitled-' + Date.now();
> if (slug.length > 100) slug = slug.substring(0, 100).replace(/-$/, '');
> ```
> An all-special-characters topic (e.g., `"..."`) produces empty string → filename `.md` (hidden file on Unix). Very long topics exceed filesystem limits (255 bytes on ext4).

> **Research note (Patterns):** CJK characters are stripped entirely, producing potentially empty or truncated slugs. This is acceptable for v3 launch but document for future internationalization consideration.

**D6: Category directories created on-the-fly.**
If `remember(category: "testing", ...)` is called and `.claude/knowledge/testing/` doesn't exist, create it with `mkdirSync({ recursive: true })`. Any category string is valid.

> **SECURITY FIX REQUIRED (Security Sentinel):** The category parameter must be sanitized for path traversal. A malicious category like `../../.git/hooks` would create directories outside `.claude/knowledge/`. Apply slug sanitization to category AND validate the resolved path:
> ```javascript
> const safeCategory = category.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
> if (!safeCategory) throw new Error('Invalid category');
> const knowledgeDir = path.resolve(projectRoot, '.claude/knowledge');
> const targetPath = path.resolve(knowledgeDir, safeCategory, slug + '.md');
> if (!targetPath.startsWith(knowledgeDir + path.sep)) {
>   throw new Error('Path traversal detected');
> }
> ```

**D7: Haiku subagent batched by category during validation.**
One subagent spawn per category directory. Balances cost (not one per entry) and context (not all entries at once). A category with 50 entries might need to be split further, but that's an optimization for later.

> **Research note (Simplicity):** Consider whether the knowledge-researcher subagent is needed at all for v3 launch. The validate skill itself (running in the main Claude thread) can do all the checking directly with Read, Glob, and Grep. Spawning subagents adds a separate markdown agent definition, batching strategy, JSON output parsing, and error handling for subagent failures. The cost savings argument (Haiku is cheaper) is valid but premature -- validation runs occasionally, not on every `remember()` call. **Decision: Keep the subagent in the plan for cost efficiency, but document as an optional component that can be removed if the validate skill works well enough without it.**

> **Research note (Performance):** 50 entries per category of ~50 tokens each = ~2,500 tokens input. Well within Haiku's context window. Scales adequately to hundreds of entries across dozens of categories.

**D8: `unresolved.md` uses ~~H2 headers per item with structured metadata~~ plain prose sections.**

> **CHANGED (Simplicity + Architecture + Pattern Reviews):** Simplify from structured metadata format to plain prose. The "machine" parsing unresolved.md is Claude, which excels at reading unstructured text. The structured format (`**File:**`, `**Issue:**`, `**Options:**` blocks) creates a fragile parsing contract between two skills interpreted by LLMs. A knowledge entry containing an H2 header in its body would break the parser.
>
> **New format:**
> ```markdown
> ## gotchas/redis-pooling.md
> The referenced file `src/cache/redis.ts` no longer exists. This entry may be stale
> or the file may have moved. Delete, update, or keep as-is?
> ```
> No `**File:**`, no `**Issue:**`, no `**Options:**` blocks. Claude will figure out what to ask the user. Both the validate skill (writer) and review skill (reader) just deal with natural language paragraphs under H2 headers that name the knowledge file.

**D9: V2 transient data is dropped on migration.**
`remember-queue/`, `pending-review/`, `.entry-status.json`, `.analysis-lock`, `.last-analysis` are already gitignored. They're ephemeral by design. Document as known breaking change in README.

> **Research note (Spec Flow):** 3 orphaned v2 queue entries currently exist at `.claude/knowledge/remember-queue/`. One contains a detailed "Mim v2 Complete Architecture Overview" entry. **Consider a one-time migration step:** the SessionStart hook could check for `remember-queue/*.json` files on first v3 run, process them as direct writes (no AI needed), then delete the queue directory. This prevents knowledge loss for upgrading users. Low effort (~10 lines), meaningful impact.

**D10: Validation does not auto-commit.**
`/mim:validate` modifies knowledge files and writes `unresolved.md`. The user reviews the diff and commits. No surprise commits.

> **Research note (Architecture):** Correct. Respects the principle of least surprise. Knowledge modification is visible in `git diff` and committed at the user's discretion.

**D11 (NEW): Use atomic writes for all file operations.**
> **ADDED (Security Sentinel + MCP Best Practices):** `writeFileSync` is NOT atomic. A crash mid-write produces a partial file. On ext4, a crash can result in a zero-length file. Use the temp-file-then-rename pattern:
> ```javascript
> const tmp = targetPath + '.tmp.' + process.pid;
> fs.writeFileSync(tmp, content);
> fs.renameSync(tmp, targetPath);  // rename() IS atomic on POSIX
> ```
> Apply to: knowledge file writes, map file updates. ~3 additional lines per write site.

**D12 (NEW): MCP tool errors as results, not JSON-RPC errors.**
> **ADDED (MCP Best Practices):** Tool-level errors (invalid category, missing params) should be returned as results with `isError: true`, not as JSON-RPC error responses. JSON-RPC errors (`-32601`, `-32602`) are reserved for protocol-level failures. The v2 server already follows this pattern correctly -- preserve it.
> ```json
> { "content": [{"type": "text", "text": "Error: Category is required"}], "isError": true }
> ```

**D13 (NEW): Never log to stdout.**
> **ADDED (MCP Best Practices):** stdout is the MCP protocol channel. Any stray text corrupts the JSON-RPC stream. Use `console.error()` (stderr) or write to `.claude/knowledge/mim.log` (already in the proposed `.gitignore`). Consider a 5-line logging helper.

### Implementation Phases

#### Phase 1: Create V3 Components (NEW)

Build all new components before deleting anything. V2 continues working during development.

##### 1.1 MCP Server (`mim-ai/servers/mim-server.cjs`)

Hand-written CommonJS (~150 lines). No TypeScript, no build step, no npm dependencies.

**Responsibilities:**
- MCP JSON-RPC 2.0 protocol (initialize, tools/list, tools/call)
- `remember()` tool handler:
  1. Validate params (category, topic, details, files)
  2. **Sanitize category** (slug-sanitize + path traversal check -- see D6)
  3. Generate slug from topic **(with empty/length guards -- see D5)**
  4. Ensure category directory exists (`mkdirSync({ recursive: true })`)
  5. **Append** to existing markdown file or create new at `.claude/knowledge/{category}/{slug}.md` **(atomic write -- see D11)**
  6. Update KNOWLEDGE_MAP_CLAUDE.md (add @ reference under category header) **(single map -- see D2)**
  7. Return confirmation
- **Logging to stderr or mim.log, never stdout (see D13)**
- **Tool errors as results with `isError: true` (see D12)**

**Markdown template for NEW knowledge entries:**
```markdown
# {topic}

{details}

**Related files:** {files || "none"}
```

**Append logic for EXISTING files:**
- If file exists, read current content
- Append a separator + new content:
  ```markdown

  ---

  {details}

  **Related files:** {files || "none"}
  ```
- The `# {topic}` header is NOT repeated -- it only appears once at the top

**Map update logic:**
- Read the map file
- Find the `## {Category}` section (case-insensitive match, create if missing)
- Check if entry already exists (by filename match)
- If exists: do nothing (file was appended to, map link is still valid)
- If new: insert link after the section header's comment line
- **Atomic write** map file back **(see D11)**

> **Research note (Patterns):** New categories are appended to the end of the map file. Consider inserting new category sections alphabetically for consistency. Also, if the comment placeholder line (`<!-- @category/*.md entries will be added here -->`) is removed or edited, the insertion logic must fall back to inserting directly after the `## {Category}` line.

> **Research note (Simplicity):** ~~Reduce the `normalizeCategory()` synonym map to plural/singular normalization only~~ Consider reducing the synonym map. The current map (25 entries) includes aggressive mappings like `system -> architecture` and `build -> workflows` that silently redirect user-chosen categories. Since the caller is an LLM with clear instructions, it will not pass `"libs"` -- it will pass `"dependencies"`. The aggressive synonyms conflict with the "any category is valid" principle (D6). **Decision point: Either reduce to plural/singular only (`pattern -> patterns`, `dependency -> dependencies`) or remove entirely and trust the LLM. Document the decision.**

**Reuse from v2:** `normalizeCategory()` synonym map (if kept), `getProjectRoot()` git root detection, JSON-RPC helpers, `REMEMBER_TOOL` inputSchema definition. Everything else in the current server is deleted (QueueProcessor, Agent SDK, queue management, checkMimActivation).

> **Research note (Performance):** Projected latency per `remember()` call: under 2ms. `mkdirSync` sub-ms (no-op if exists), `writeFileSync` for 200-500 byte markdown sub-ms, map read-modify-write on ~2KB files sub-ms. Even with 1000+ entries making maps grow to ~20KB, stays under 5ms. The synchronous approach is correct -- using async I/O would add complexity with zero benefit for this single-threaded MCP server.

> **Research note (Spec Flow):** With append behavior, consider dedup-before-append: if the file already contains the exact same `details` text, skip the append to avoid duplicate noise. Low priority but prevents redundant entries.

##### 1.2 Knowledge Researcher Agent (`mim-ai/agents/knowledge-researcher.md`)

```yaml
---
name: knowledge-researcher
description: Read-only research agent that validates knowledge entries against the current codebase. Use for checking whether documented knowledge is still accurate.
model: haiku
tools: Read, Glob, Grep
---
```

> **CHANGED (Security + Agent-Native + Skill Reviews):**
> - **Removed `Bash` from tools.** The agent is supposed to be read-only, but Bash can execute arbitrary commands. The v2 inquisitor restricted Bash to git read commands via `canUseTool`. The v3 agent markdown format doesn't support `canUseTool`, so prompt-level restriction is unreliable. Remove Bash entirely -- Read, Glob, and Grep are sufficient for validating knowledge entries.
> - **Removed `disallowedTools`.** When `tools` is specified as an allowlist, it already excludes everything not listed. The `disallowedTools` field is redundant (belt-and-suspenders is harmless but adds noise).
> - **Updated description** to third-person, more generic phrasing per Claude Code conventions.

**System prompt content:**
- You are a knowledge researcher. You receive knowledge entries and check them against the codebase.
- For each entry: verify file references still exist, check if described patterns/conventions match current code, flag anything stale or contradicted.
- Output format: JSON array of findings, one per entry. Each finding has: `file` (knowledge file path), `status` (valid/stale/contradicted/unclear), `reason` (brief explanation), `suggestion` (what to do).
- **For "contradicted" entries, the `suggestion` field MUST contain the corrected content** so the validate skill can use it directly.
- You are READ-ONLY. Never modify files. Never ask the user questions.
- Be concise. One sentence per reason. One sentence per suggestion.
- **Output ONLY the JSON array. No preamble, no markdown code fences, no explanation.**

> **Research note (Spec Flow):** The validate skill must parse JSON from the subagent's text response. If the subagent wraps JSON in markdown code fences or adds preamble, parsing fails. The system prompt must explicitly say "Output ONLY the JSON array." As a defensive measure, the validate skill should strip markdown code fences before parsing.

##### 1.3 Validate Skill (`mim-ai/skills/validate/SKILL.md`)

```yaml
---
name: validate
description: Validates all knowledge entries against the current codebase. Auto-fixes aggressively and writes unresolved.md for ambiguous items. Use when asked to "validate knowledge", "check knowledge entries", or "clean up stale knowledge".
disable-model-invocation: true
allowed-tools: Read, Write, Edit, Glob, Grep, Task
---
```

> **CHANGED (Skill Reviews + Security):**
> - **Description rewritten** to third-person with trigger phrases per Claude Code conventions.
> - **Removed `Bash`** from allowed-tools. The validate skill doesn't need shell access -- it reads files, spawns subagents, and writes results. Removing Bash reduces the attack surface.
> - **Consider `Task(knowledge-researcher)`** syntax in allowed-tools to restrict which subagent can be spawned (if supported by Claude Code -- verify during implementation).

**Skill instructions:**
1. Read all knowledge files from `.claude/knowledge/{category}/*.md`
2. For each category directory, use the Task tool with `subagent_type: "knowledge-researcher"` to send the entries for validation. The subagent receives the knowledge file contents and checks them against the codebase. Its text response contains findings as structured JSON.
3. **JSON extraction:** Strip any markdown code fences from the subagent response, then parse JSON. If parsing fails, log a warning and skip that category.
4. Collect findings from all subagent responses
5. For each finding:
   - **valid**: skip
   - **stale** (file moved/deleted, pattern no longer exists): auto-delete the knowledge entry, remove from map
   - **contradicted** (code does the opposite now): auto-fix the knowledge entry **using the subagent's `suggestion` field as guidance, rewritten by the main thread for quality**
   - **unclear** (genuinely ambiguous): append to `.claude/knowledge/unresolved.md` **(plain prose format -- see D8)**
6. **Consolidate:** For files with redundant/contradictory append sections, rewrite into clean terse summaries. Merge overlapping files within the same category into single files (update map accordingly).
7. Regenerate the knowledge map from the current files on disk (scan all `{category}/*.md` files, rebuild from scratch). This handles any drift from `remember()` partial failures, manual edits, or file merges.
8. Report summary: X entries validated, Y auto-fixed, Z deleted, W unresolved, V consolidated/merged

**Deletion criteria (aggressive):**
- Referenced file no longer exists AND no similar file found -> DELETE
- Described API/function signature completely changed -> AUTO-FIX
- Pattern describes something that no longer applies -> DELETE
- Two entries contradict each other -> keep newer, delete older
- Entry is about a deleted feature (e.g., TUI game) -> DELETE

**Consolidation criteria (from D1 append behavior):**
- File has redundant sections (same fact stated multiple times from repeated appends) -> CONSOLIDATE into single terse summary
- File has contradictory sections (earlier append says X, later append says Y) -> KEEP latest, rewrite as single entry
- File exceeds ~20 lines -> CONSOLIDATE to keep it lean for context loading
- Multiple files in same category cover overlapping topics -> MERGE into one file, update map
- Goal: fewer, longer files with clean content -- not many tiny files, not sprawling append logs

> **Research note (Architecture):** The deletion criteria are well-placed as prose, not code. The skill tells the agent *when* to delete; the agent uses judgment to determine whether conditions are met. To change behavior, edit prose not code -- this is textbook agent-native design.

> **Research note (Spec Flow):** What happens if validation finds ALL entries stale? Mass deletion is correct behavior (the codebase changed dramatically), but it could be alarming. Consider adding a confirmation message: "Validation found X/Y entries stale. Proceeding with deletion."

> **Research note (Agent-Native):** The validate skill is not programmatically invocable by subagents (skills require user invocation or main thread auto-invocation). Consider adding a `PostToolUse` hook on Bash commands containing `git pull` or `git merge` to auto-trigger validation when the codebase changes mid-session. This is noted in Future Considerations.

##### 1.4 Review Skill (`mim-ai/skills/review/SKILL.md`)

```yaml
---
name: review
description: Works through unresolved knowledge items with the user interactively. Use after /mim:validate to resolve ambiguous findings, or when asked to "review knowledge" or "resolve knowledge conflicts".
disable-model-invocation: true
allowed-tools: Read, Write, Edit, Glob, Grep, AskUserQuestion
---
```

> **CHANGED (Skill Reviews):**
> - **Description rewritten** to third-person with trigger phrases and relationship to validate.

**Skill instructions:**
1. Read `.claude/knowledge/unresolved.md`
2. If file doesn't exist or is empty: "No unresolved items. Knowledge is clean."
3. For each H2 section in the file:
   - Read the section content (plain prose describing the issue)
   - Present the issue and options via AskUserQuestion. **Derive appropriate options from the prose** (typically: delete, update, keep as-is, or edit with user-provided changes).
   - **For "edit" decisions:** Ask the user what should change, then rewrite the knowledge entry accordingly.
   - Apply the user's decision (edit knowledge file, delete entry, keep as-is)
   - Remove the resolved H2 section from `unresolved.md`
4. After all items resolved, delete `unresolved.md` if empty
5. Update the knowledge map if any entries were modified

> **Research note (Agent-Native):** ~~AskUserQuestion concern removed~~ -- the target environment uses `canUseTool` to redirect AskUserQuestion to conversational interaction, so this works fine in both interactive and agent contexts. No autonomous resolution path needed for v3.

> **Research note (Spec Flow):** If the user abandons review midway (closes session after resolving 3 of 10 items), the remaining 7 stay in unresolved.md. Next session, the SessionStart hook reports 7 unresolved items. This is correct behavior. Consider adding a "continue from where you left off" note in the hook's context message.

> **Research note (Spec Flow):** With 50+ unresolved items, sequential AskUserQuestion becomes tedious. Consider: if >20 items, present a summary first and ask the user whether to review all, review by category, or skip.

##### 1.5 Remember Skill Update (`mim-ai/skills/remember/SKILL.md`)

```yaml
---
name: remember
description: Captures knowledge to persistent memory. Use when discovering project-specific patterns, architecture, conventions, or gotchas. Triggers on "I learned that", "turns out", "for future reference", "good to know".
---
```

> **CHANGED (Skill Reviews):**
> - **Description rewritten** to third-person with trigger phrases. Moved "Be TERSE" instruction from description to skill body (descriptions describe, instructions instruct).
> - **Consider adding `allowed-tools: Read, Glob, Grep`** to enforce least privilege. The remember skill primarily provides guidance for using the `remember()` MCP tool. It doesn't need Write, Edit, or Bash.

> **Research note (Simplicity):** Consider whether this skill is needed at all. The `remember()` MCP tool already has a rich description. The skill's content (terseness guidance, good/bad examples) could be folded into `INSTRUCTIONS.md`. Having both a skill and an MCP tool for the same action creates potential confusion. **Counter-argument:** The skill provides Claude Code's auto-invocation feature -- when Claude discovers something, the skill's description triggers automatic loading of the full terseness guidance. INSTRUCTIONS.md is always in context but may be too brief. **Decision: Keep the skill for auto-invocation behavior, but ensure INSTRUCTIONS.md and the skill don't contradict each other.**

**Updated content:**
- **Be TERSE. Every token costs permanent context.**
- One fact per entry. No filler. No preamble.
- Max 2-3 sentences per `details` field
- Include file paths when relevant
- Categories: architecture, patterns, dependencies, workflows, gotchas (or any descriptive category)
- Example of good vs bad:
  - BAD: "I discovered that the authentication system uses JWT tokens stored in HTTP-only cookies with a 30-minute expiration time, which is configured in the auth middleware."
  - GOOD: "Auth uses JWT in HTTP-only cookies, 30min TTL. Configured in `src/middleware/auth.ts`."

##### 1.6 SessionStart Hook (`mim-ai/scripts/session-start.mjs`)

~60 lines Node.js. Replaces the v2 141-line TypeScript hook + 175-line init logic from CLI.

**Responsibilities:**
1. Ensure `.claude/knowledge/` directory structure exists (create category dirs)
2. Ensure CLAUDE.md has `@.claude/knowledge/INSTRUCTIONS.md` and `@.claude/knowledge/KNOWLEDGE_MAP_CLAUDE.md` references
3. Ensure `.gitignore` has v3 Mim entries (unresolved.md, mim.log)
4. ~~Ensure `.gitattributes` has merge=union for knowledge files~~ **(REMOVED -- see below)**
5. Check if `.claude/knowledge/unresolved.md` exists
6. **(NEW) Check for orphaned v2 queue entries and process them as direct writes (one-time migration)**
7. Output: JSON with context mentioning unresolved items count (if any)

> **CHANGED (Simplicity):** Removed `.gitattributes` management. The `merge=union` strategy only helps when two branches both modify the same knowledge map and then merge -- a narrow edge case. Even when it applies, `merge=union` can silently produce duplicates. If merge conflicts happen, users resolve them like any other merge conflict. Saves ~10-15 lines.

> **CHANGED (Spec Flow):** Added one-time v2 queue migration. Check for `remember-queue/*.json` files. If found, read each JSON file, extract `category`, `topic`, `details`, and `files` fields, write directly to knowledge files using the same logic as `remember()`. Delete the queue files after processing. ~10 lines, prevents knowledge loss for upgrading users.

**Init logic preserved from v2 `bin/mim.js`:**
- Directory creation (all core category subdirs)
- CLAUDE.md @ reference injection
- `.gitignore` section management (marker-based idempotency: `# Mim -`)

> **Research note (Spec Flow):** CLAUDE.md injection strategy needs explicit specification. **Algorithm:**
> 1. Read CLAUDE.md (create if missing)
> 2. Search for exact strings `@.claude/knowledge/INSTRUCTIONS.md` and `@.claude/knowledge/KNOWLEDGE_MAP_CLAUDE.md`
> 3. If both found: no-op (idempotent)
> 4. If missing: append a `## Mim Knowledge\n\n@.claude/knowledge/INSTRUCTIONS.md\n@.claude/knowledge/KNOWLEDGE_MAP_CLAUDE.md` section at the end
> This is safe, non-destructive, and handles complex CLAUDE.md structures with other plugin references.

**Hook output format:**
```json
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "Mim: 3 unresolved knowledge items. Run /mim:review to resolve."
  }
}
```

> **Research note (Plugin Docs):** The Claude Code SessionStart hook documentation supports both `systemMessage` (shown to user) and `hookSpecificOutput.additionalContext` (added to Claude's context). For Mim's use case, `additionalContext` is more appropriate -- it tells Claude about the unresolved items so Claude can proactively mention them to the user.

**V3 `.gitignore` entries (replacing v2 entries):**
```
# Mim - Transient/local state files
.claude/knowledge/unresolved.md
.claude/knowledge/mim.log
```

Note: v2 entries (`remember-queue/`, `pending-review/`, `.analysis-lock`, `.last-analysis`, `.entry-status.json`) can be left in existing `.gitignore` files harmlessly. The SessionStart hook only adds missing entries, never removes old ones.

> **Research note (Performance):** Hook overhead: under 10ms. All operations are on small files. This is far faster than the v2 hook which could spawn analysis agents taking minutes.

##### 1.7 Hook Configuration (`mim-ai/hooks/mim-hooks.json`)

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "node ${CLAUDE_PLUGIN_ROOT}/scripts/session-start.mjs",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

> **FIXED (Plugin Validator):**
> - **Added `"matcher": "*"`** -- required field per Claude Code hook schema. The original plan was missing this.
> - **Added `"timeout": 10`** -- explicit 10-second timeout. The hook should complete in under 1 second; 10 seconds is a generous safety margin. Default (60 seconds) is too long for a session-start operation.

> **Research note (Plugin Docs):** The wrapper format `{"hooks": {...}}` is correct for plugin hook files. The alternative flat format (events at root level) is for settings-based hooks. Plugin hooks use the wrapper.

##### 1.8 Plugin Manifest (`mim-ai/.claude-plugin/plugin.json`)

```json
{
  "name": "mim-ai",
  "version": "3.0.0",
  "description": "Persistent memory for Claude Code - never forget what you learn",
  "author": { "name": "Lucian Hymer" },
  "repository": "https://github.com/lucianHymer/mim",
  "license": "FSL-1.1-MIT",
  "keywords": ["memory", "knowledge", "persistence", "mcp", "claude-code", "context"],
  "mcpServers": {
    "mim": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/servers/mim-server.cjs"]
    }
  },
  "hooks": "./hooks/mim-hooks.json"
}
```

> **CHANGED (Plugin Validator):** Added `"claude-code"` and `"context"` to keywords for better marketplace discoverability (recommendation: 5-10 keywords).

> **Research note (Plugin Validator):** The `FSL-1.1-MIT` license is not a standard SPDX identifier. Marketplace validators may flag this but it's acceptable since it accurately represents the project's license.

Skills and agents auto-discovered from `skills/` and `agents/` directories per Claude Code conventions.

> **Research note (Architecture):** The manifest update changes the MCP server path from `mim-server.bundled.cjs` to `mim-server.cjs`. If this is done in Phase 1 while v2 artifacts still exist, the plugin will break because the old bundled server is at the old path. **Solution:** Create the new `mim-server.cjs` in Phase 1, but don't update the manifest until Phase 2 when the old file is deleted. Or, keep both files during Phase 1 and switch the manifest atomically when the old file is removed.

#### Phase 2: The Purge + Migration (DELETE + CONFIG)

> **CHANGED (Simplicity):** Collapsed original Phases 2 and 3 into a single phase. Deleting v2 and updating configuration happen together in the same commit. Phase 4 (testing) is a checklist, not a development phase.

Delete all v2 components and update configuration simultaneously. Everything is replaceable from git history.

##### 2.1 Delete Source Code

```
DELETE: mim-ai/src/                  (entire directory - all TypeScript source)
DELETE: mim-ai/dist/                 (compiled output)
DELETE: mim-ai/bin/                  (CLI entry point)
DELETE: mim-ai/assets/               (tileset, sounds)
DELETE: mim-ai/docs/                 (AUDIO_IMPROVEMENTS.md)
```

##### 2.2 Delete Build Tooling

```
DELETE: mim-ai/tsconfig.json
DELETE: mim-ai/scripts/build-server.js
```

##### 2.3 Delete Bundled V2 Artifacts

```
DELETE: mim-ai/servers/mim-server.bundled.cjs     (replaced by mim-server.cjs)
DELETE: mim-ai/hooks/session-start.bundled.mjs     (replaced by scripts/session-start.mjs)
DELETE: mim-ai/hooks/run-analysis.bundled.mjs      (deleted, no replacement)
```

##### 2.4 Delete V2 Skills

```
DELETE: mim-ai/skills/mim-status/    (replaced by hook + /mim:review)
```

##### 2.5 Strip `package.json`

Strip to minimal metadata. Keep the file (marketplace may reference it) but remove all operational fields:

```json
{
  "name": "mim-ai",
  "version": "3.0.0",
  "description": "Persistent memory for Claude Code",
  "license": "FSL-1.1-MIT",
  "type": "module",
  "private": true
}
```

> **CHANGED (Architecture):** Keep `"type": "module"` in package.json. The hook script uses `.mjs` and ESM conventions. The server uses `.cjs` explicitly. Both extensions are self-declaring -- Node.js resolves them correctly regardless of the `type` field. **The key constraint: everything must work with just `node` on the PATH. No npm install, no build step, no module resolution surprises.** Explicit `.cjs`/`.mjs` extensions guarantee this.

Remove: `dependencies`, `devDependencies`, `scripts`, `bin`. The MCP server is CJS with zero npm dependencies. The hook is standalone `.mjs` using only Node.js built-ins.

##### 2.6 Clean Up `node_modules`

```
DELETE: mim-ai/node_modules/         (no dependencies = no node_modules)
DELETE: mim-ai/package-lock.json     (no dependencies)
```

##### 2.7 Update Marketplace Version

`/.claude-plugin/marketplace.json`: Bump version to "3.0.0".

##### 2.8 Update Project Knowledge Files

Delete self-referential knowledge about deleted v2 components:

```
DELETE: .claude/knowledge/architecture/mim-tui-game.md
DELETE: .claude/knowledge/architecture/mim-agent-orchestration.md
```

Update KNOWLEDGE_MAP_CLAUDE.md to remove references to deleted files. Add new entries for v3 architecture if desired.

> **CHANGED (D2):** Only one map to update now.

##### 2.9 Update INSTRUCTIONS.md

Rewrite to emphasize extreme terseness. Updated template:

```markdown
# Knowledge Protocol

Use `remember()` immediately on discovery. Every token costs permanent context.

## Rules
- ONE fact per entry. No filler.
- 2-3 sentences max in `details`.
- Include file paths.
- Categories: architecture, patterns, dependencies, workflows, gotchas (or any)

## Trigger Phrases
"I learned that", "turns out", "actually it's", "for future reference" -> REMEMBER IT

## Good vs Bad
BAD: "The system uses Redis for session caching with a TTL of 30 minutes configured in the cache middleware."
GOOD: "Session cache: Redis, 30min TTL. Config: `src/middleware/cache.ts`."
```

##### 2.10 Update README.md

Complete rewrite for v3:
- Remove TUI game references, demo.gif, audio credits
- Update installation to plugin-only (no `npm install -g`)
- Update "How It Works" for capture/validate/review flow
- Update commands section for skills
- Simplify description

##### 2.11 Update Root CLAUDE.md

Remove references to deleted knowledge files. Keep `@.claude/knowledge/INSTRUCTIONS.md` and `@.claude/knowledge/KNOWLEDGE_MAP_CLAUDE.md`.

##### 2.12 Delete V2 Documentation

> **CHANGED (Simplicity):** Delete outright instead of archiving. Git history preserves them if anyone ever needs them (they will not). Moving files to `docs/archive/` keeps them in file listings and requires readers to understand they're irrelevant.

```
DELETE: MIM_V2_HANDOFF.md
DELETE: docs/daemon-handoff.md
```

#### Phase 3: Validation & Testing

##### 3.1 Manual Testing Checklist

- [ ] Fresh install: `claude plugin install mim-ai@mim-marketplace --scope project` works
- [ ] SessionStart hook creates directory structure on first run
- [ ] SessionStart hook updates CLAUDE.md with @ references
- [ ] SessionStart hook sets up .gitignore
- [ ] SessionStart hook detects and migrates orphaned v2 queue entries
- [ ] `remember()` writes to correct file path
- [ ] `remember()` creates category directory if missing
- [ ] `remember()` updates the knowledge map
- [ ] `remember()` with same topic appends to existing file (separator + new content)
- [ ] `remember()` with different topic creates new file
- [ ] `remember()` with custom category (e.g., "testing") works
- [ ] `remember()` rejects path traversal in category (e.g., `../../etc`)
- [ ] `remember()` handles empty slug (all-special-character topic)
- [ ] `remember()` handles very long topic (>100 char slug truncation)
- [ ] **`remember()` under rapid successive calls** (5+ calls within 1 second) -- verify map updates correctly
- [ ] `/mim:validate` spawns Haiku researchers and processes findings
- [ ] `/mim:validate` correctly parses JSON from subagent text responses
- [ ] `/mim:validate` auto-deletes stale entries
- [ ] `/mim:validate` writes ambiguous items to unresolved.md
- [ ] `/mim:validate` regenerates the knowledge map
- [ ] `/mim:review` reads unresolved.md and presents items via AskUserQuestion
- [ ] `/mim:review` handles "edit" decisions (user provides updated content)
- [ ] `/mim:review` removes resolved items from unresolved.md
- [ ] `/mim:review` handles partial completion (user abandons mid-review)
- [ ] No recursive agent spawning possible (structural guarantee)
- [ ] MCP server starts and responds to JSON-RPC correctly
- [ ] MCP server logs to stderr/file, never stdout
- [ ] **Verify MCP tools accessible from within skills with allowed-tools whitelists**

##### 3.2 Migration Testing

- [ ] Existing v2 repo with knowledge files: v3 SessionStart hook doesn't break anything
- [ ] Existing .gitignore with v2 entries: v3 entries added alongside (no removal)
- [ ] Existing CLAUDE.md with @ references: hook detects and skips
- [ ] Orphaned v2 remember-queue entries are migrated and queue directory cleaned

##### 3.3 Security Testing

> **ADDED (Security Sentinel):**
- [ ] Category parameter with `../` is rejected
- [ ] Category parameter with `/` is rejected
- [ ] Category parameter with `\` is rejected
- [ ] Topic consisting of only special characters produces a valid slug (not empty)
- [ ] Very long topic (200+ chars) produces a truncated but valid filename
- [ ] Knowledge file content with embedded H2 headers doesn't break unresolved.md parsing
- [ ] Multiple concurrent Claude sessions don't corrupt knowledge files (verify last-write-wins behavior)

---

## Alternative Approaches Considered

Six alternatives were evaluated and rejected. Full rationale in the brainstorm: `docs/brainstorms/2026-02-11-mim-v3-simplification-brainstorm.md` (lines 28-36). Key rejection: daemon architecture solves the memory leak but adds complexity that native subagents already handle.

---

## Acceptance Criteria

### Functional Requirements

- [ ] `remember()` MCP tool captures knowledge instantly (no queue, no AI processing)
- [ ] Knowledge is organized in `.claude/knowledge/{category}/{topic-slug}.md`
- [ ] Knowledge map is kept in sync with knowledge files
- [ ] `/mim:validate` validates knowledge against codebase using Haiku researcher
- [ ] `/mim:validate` auto-fixes or deletes stale entries aggressively
- [ ] `/mim:validate` writes genuinely ambiguous items to `unresolved.md`
- [ ] `/mim:review` works through unresolved items conversationally
- [ ] SessionStart hook ensures directory structure, git config, and CLAUDE.md
- [ ] SessionStart hook notifies user of unresolved items
- [ ] No recursive agent spawning is possible (no Agent SDK in MCP server)

### Non-Functional Requirements

- [ ] MCP server has zero npm dependencies (Node.js built-ins only)
- [ ] Total new code < 400 lines (server ~150, hook ~60, templates ~50, the rest is markdown)
- [ ] Plugin install works without `npm install -g`
- [ ] No build step required (no TypeScript compilation, no esbuild bundling)
- [ ] Memory usage: single MCP server process, no background spawning

### Quality Gates

- [ ] All v2 TypeScript source, build tooling, and heavy dependencies deleted
- [ ] `mim-ai/node_modules/` does not exist
- [ ] No `@anthropic-ai/claude-agent-sdk` import anywhere
- [ ] No `terminal-kit`, `sharp`, or `play-sound` references
- [ ] README updated for v3
- [ ] Marketplace version bumped to 3.0.0

### Security Gates (NEW)

> **ADDED (Security Sentinel):**
- [ ] Category parameter sanitized against path traversal
- [ ] Slug algorithm handles empty and oversized inputs
- [ ] All file writes use atomic temp+rename pattern
- [ ] No logging to stdout (MCP protocol corruption prevention)
- [ ] Tool errors returned as results with `isError: true`, not JSON-RPC errors

---

## Success Metrics

- **Lines of code:** ~6000 TypeScript -> ~300 JS + markdown (potentially ~200-220 with simplifications)
- **npm dependencies:** 6 production deps -> 0
- **Memory usage:** 40GB+ under load -> single MCP process (~20MB)
- **`remember()` latency:** queue + agent processing (seconds) -> direct write (<2 milliseconds)
- **Maintenance burden:** TypeScript build pipeline + agent debugging -> plain JS + markdown editing

---

## Dependencies & Prerequisites

- **Claude Code plugin system** must support: skills auto-discovery, agents auto-discovery, MCP servers in plugins, SessionStart hooks, AskUserQuestion from main thread
- **Haiku model** must be available as a subagent model option
- **No external dependencies.** Everything uses Node.js built-ins and Claude Code native features.

### Research Insights: Prerequisites Verification

> **Confirmed (Plugin Docs Research):**
> - Skills auto-discovery from `skills/` directory: **Supported**
> - Agents auto-discovery from `agents/` directory: **Supported**
> - MCP servers in plugins (inline in plugin.json): **Supported**
> - SessionStart hooks with command type: **Supported**
> - AskUserQuestion from main thread/skills: **Supported**
> - Haiku model for subagents (`model: haiku`): **Supported** (valid alias)
> - `${CLAUDE_PLUGIN_ROOT}` variable: **Supported** in hooks and MCP server configs
> - `disable-model-invocation: true` for skills: **Supported**
> - `allowed-tools` for skills: **Supported**
> - `matcher` field required in hook entries: **Confirmed required**

---

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Haiku subagent can't effectively validate knowledge | Medium | High | Provide clear structured instructions in agent.md. Haiku is good at pattern matching and file searching. Main thread handles all judgment calls. Fallback: remove subagent and validate in main thread. |
| `remember()` concurrent writes to same file | Low | Medium | MCP protocol processes requests sequentially within a single stdio connection. ~~Node.js `writeFileSync` is atomic within a process.~~ **Corrected: Use atomic write pattern (temp+rename). Inter-process writes (multiple sessions) are last-write-wins; map self-heals via validate.** |
| Knowledge map update fails mid-write | Low | Low | Map can be regenerated from files by `/mim:validate`. Partial failure is self-healing. **Atomic writes reduce this risk further.** |
| Users lose v2 pending reviews on upgrade | Medium | Low | Pending reviews are gitignored ephemeral data. Document as known breaking change. Most users have 0-3 pending reviews. |
| Slug collisions from different topics | Low | Low | Deterministic algorithm. Same slug = same topic = overwrite is correct behavior. **Document slug behavior in remember skill.** |
| SessionStart hook breaks on non-Unix OS | Low | Medium | Using Node.js (.mjs) not shell. `path.join` and `fs` APIs are cross-platform. |
| **Path traversal via category parameter** | Low | **Critical** | **Category slug-sanitized + path.resolve validation. Defense in depth.** |
| **Haiku subagent returns non-JSON response** | Medium | Medium | **System prompt says "Output ONLY JSON." Validate skill strips code fences before parsing. Skip category on parse failure.** |
| **Concurrent validate + remember() race** | Low | Low | **Different processes may write maps simultaneously. Self-healing: validate regenerates maps from disk. Documented behavior.** |
| **unresolved.md grows very large (50+ items)** | Low | Low | **Review skill handles all items sequentially. Future: add summary/batch review for large sets.** |

---

## Future Considerations

- **Incremental validation:** Track last-validated commit per entry to skip unchanged files. Not needed at launch (Haiku is cheap) but useful at scale.
- **Auto-validate on git pull:** PostToolUse hook on `Bash` commands containing `git pull` to trigger validation when codebase changes.
- **`forget()` MCP tool:** Delete a knowledge entry and update the map. Currently requires manual file deletion + validate to regenerate the map. Low priority since the gap is small.
- **`list_knowledge()` MCP tool:** Return categories and entry counts. Anchors the vocabulary for "what do you know about this project?" requests. Currently achievable via native Glob/Read.
- **Knowledge search vocabulary:** A `/mim:search` skill or documentation for searching knowledge via Grep across `.claude/knowledge/`.

---

## References & Research

### Internal References

- Brainstorm: `docs/brainstorms/2026-02-11-mim-v3-simplification-brainstorm.md`
- ~~V2 handoff: `MIM_V2_HANDOFF.md` (-> `docs/archive/`)~~ (DELETE)
- ~~Daemon architecture (rejected): `docs/daemon-handoff.md` (-> `docs/archive/`)~~ (DELETE)
- Current MCP server: `mim-ai/src/servers/mim-server.ts`
- Current init logic: `mim-ai/bin/mim.js:227-402`
- Current plugin manifest: `mim-ai/.claude-plugin/plugin.json`
- Current hooks: `mim-ai/hooks/mim-hooks.json`

### External References

- Claude Code plugin docs: https://code.claude.com/docs/en/plugins-reference
- Claude Code skills docs: https://code.claude.com/docs/en/skills
- Claude Code subagents docs: https://code.claude.com/docs/en/sub-agents
- Claude Code hooks docs: https://code.claude.com/docs/en/hooks
- Claude Code plugin marketplaces: https://code.claude.com/docs/en/plugin-marketplaces
- MCP Specification: https://github.com/modelcontextprotocol/specification
- MCP TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk
- MCP Security Best Practices: https://www.mcpevals.io/blog/mcp-security-best-practices
- Path Traversal in MCP: https://snyk.io/articles/preventing-path-traversal-vulnerabilities-in-mcp-server-function-handlers/
- Atomic File Writes (npm): https://github.com/npm/write-file-atomic
- MCP Implementation Tips: https://nearform.com/digital-community/implementing-model-context-protocol-mcp-tips-tricks-and-pitfalls/
- How to Test MCP Servers: https://codely.com/en/blog/how-to-test-mcp-servers
- CommonJS vs ESM: https://betterstack.com/community/guides/scaling-nodejs/commonjs-vs-esm/

### SpecFlow Analysis

Gap analysis was performed and all findings are incorporated into Design Decisions D1-D13 above. The deepening research identified 27 flow gaps, 15 critical questions, and security findings that are now addressed in the plan.

### Deepening Research Agents

| Agent | Key Findings |
|---|---|
| Architecture Strategist | Sound architecture. Unresolved.md contract fragility. Atomic writes needed. Manifest timing concern. |
| Code Simplicity Reviewer | Eliminate dual maps. Consider removing subagent. Drop remember skill. Simplify unresolved.md. Reduce synonym map. Drop .gitattributes. |
| Security Sentinel | PATH TRAVERSAL in category (HIGH). Empty/long slugs (MEDIUM). writeFileSync not atomic (MEDIUM). CLAUDE.md injection (MEDIUM). |
| Performance Oracle | All performance claims validated. Sync I/O is correct. <2ms latency confirmed. ~20MB memory confirmed. No changes needed. |
| Agent-Native Reviewer | 7/8 parity. AskUserQuestion blocks automated contexts. Bash access too broad on researcher. Verify MCP tool access from skills. |
| Pattern Recognition Specialist | File-based coordination sound. Slug pattern standard. Dual maps = Shotgun Surgery. Synonym map overreach. Marker idempotency is standard. |
| Spec Flow Analyzer | 27 gaps identified. JSON extraction strategy needed. "Edit" action undefined. CLAUDE.md injection needs spec. 3 orphaned queue entries. Concurrent session TOCTOU. |
| MCP Best Practices Research | Tool errors as results. Atomic writes via temp+rename. Never log to stdout. Path traversal prevention. Testing via MCP client. |
| Claude Code Plugin Docs | All prerequisites confirmed supported. Hook output format clarified. Matcher field required. Skills/agents frontmatter validated. |
| Agent-Native Architecture Skill | Strong parity. Excellent granularity. Excellent composability. Consider forget()/list_knowledge() tools for vocabulary anchoring. |
| Create-Agent-Skills Skill | Agent researcher: remove Bash, remove redundant disallowedTools. Skills: third-person descriptions, trigger phrases, version fields. |
| Plugin Validator | CRITICAL: missing matcher field. Hooks wrapper format correct for plugins. License non-SPDX but acceptable. Add timeout. |
| Skill Reviewer | All descriptions need third-person format + trigger phrases. Validate: restrict Bash. Remember: move instructions from description to body. Add version fields. |
