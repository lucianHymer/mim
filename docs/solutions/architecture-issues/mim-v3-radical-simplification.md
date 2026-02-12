---
title: "Mim v3: Radical Simplification from 6000 Lines to 460"
category: architecture-issues
tags: [mcp-server, recursive-spawning, over-engineering, claude-code-plugin, simplification]
date: 2026-02-12
severity: critical
components: [mim-ai/servers/mim-server.cjs, mim-ai/scripts/session-start.mjs, mim-ai/skills, mim-ai/agents]
related_commits: [ee52dd4, 62d95df, 4bc50cb, cd88d30]
---

# Mim v3: Radical Simplification from 6000 Lines to 460

## Problem

Mim v2 had a **recursive memory leak** that consumed 40GB+ RAM from just 15-20 `remember()` calls. The MCP server hosted an Opus agent via the Agent SDK, which spawned Claude Code, which loaded the MCP server, which spawned another Opus agent -- infinite recursion. Each call created a new process chain, and 15-20 simultaneous process trees would exhaust system memory.

Beyond the leak, v2 was over-engineered: a 4000-line TUI game for presenting multiple-choice questions, agent swarms (inquisitor, wellspring, changes-reviewer, queue-processor) totaling 1400+ lines replicating what Claude Code's native subagent system already provides, 8+ npm dependencies, TypeScript build pipeline, and a CLI tool.

**Symptoms:**
- 40GB+ RAM under moderate use (15-20 `remember()` calls per session)
- 15-20+ simultaneous Node.js processes from a single session
- `remember()` latency measured in seconds (agent initialization overhead)
- System instability and OOM kills on machines with <64GB RAM

## Root Cause

The MCP server (`mim-server.ts`) embedded the `@anthropic-ai/claude-agent-sdk` and called `query()` to process each `remember()` request. This spawned a Claude Code subprocess, which loaded the Mim plugin, which initialized the MCP server, which could spawn another agent. The recursion was procedurally guarded (rate limiting, activation checks) but not structurally prevented.

The deeper cause was building custom orchestration on top of a platform (Claude Code) that already provided native equivalents for every custom component.

## Investigation

### Alternatives Considered and Rejected

1. **Daemon architecture** -- Would solve the leak by moving agent processing to a separate HTTP server with a scheduler. Rejected: adds complexity (HTTP server, 4 job types, scheduler) when native subagents already exist.

2. **No MCP, all manual** (compound-engineering style) -- Users manage knowledge files directly. Rejected: loses automatic capture, the core feature.

3. **Inline processing at session start** -- Process everything synchronously. Rejected: blocks session start for ~30 seconds.

4. **`remember()` as subagent instead of MCP tool** -- Subagents can't spawn other subagents (good!) but also can't be called from other subagents. MCP tools CAN be called from subagents. Rejected: MCP tool is the only universal capture mechanism.

5. **Single Sonnet subagent for validation** -- Rejected: 10x more expensive than Haiku for bulk file checking.

### Research Phase

14 specialist research agents were deployed during plan deepening:

- **Architecture Strategist**: Confirmed core thesis sound; found manifest timing concern
- **Security Sentinel**: Found path traversal vulnerability in category parameter (CRITICAL), non-atomic `writeFileSync`, empty/oversized slug edge cases
- **Code Simplicity Reviewer**: Identified dual knowledge maps as unnecessary, synonym map as over-engineered, `.gitattributes` management as YAGNI
- **Performance Oracle**: Validated all latency and memory claims
- **Agent-Native Reviewer**: Scored 7/8 on agent parity; found Bash access too broad on researcher agent
- **Spec Flow Analyzer**: Identified 27 flow gaps, including JSON extraction strategy for Haiku responses and undefined "edit" action in review
- **Plugin Validator**: Found missing `matcher` field in hook config (required by Claude Code schema)

This research identified issues that would have been bugs in production, caught before implementation began.

## Solution

Replace all custom orchestration with Claude Code's native plugin primitives. The key architectural insight: **subagents cannot spawn other subagents** (enforced by Claude Code), so making `remember()` an MCP tool (callable from subagents) while removing the Agent SDK from the MCP server makes recursion structurally impossible.

### Architecture Mapping

| V2 Component (Deleted) | V3 Replacement | Lines Saved |
|---|---|---|
| Queue Processor Agent (Opus, Agent SDK) | Direct file writes in MCP server | ~300 |
| Inquisitor Swarm (Haiku, Agent SDK) | `knowledge-researcher` subagent (markdown) | ~800 |
| Wellspring Agent (Opus, Agent SDK) | Main thread + `/mim:review` skill | ~180 |
| Changes Reviewer Agent | `/mim:validate` skill | ~235 |
| TUI Game (sprites, animation, scenes) | AskUserQuestion (native) | ~4000 |
| CLI (`mim` command, commander.js) | Skills + SessionStart hook | ~428 |
| Background analysis runner | `/mim:validate` (triggered externally) | ~600 |

### Final Component Map

| File | Lines | Role |
|---|---|---|
| `servers/mim-server.cjs` | 225 | MCP server: `remember()` tool, file writes, map updates |
| `scripts/session-start.mjs` | 99 | Hook: directory setup, CLAUDE.md injection, v2 migration |
| `skills/validate/SKILL.md` | 52 | Bulk validation with Haiku subagent |
| `skills/review/SKILL.md` | 36 | Interactive unresolved item resolution |
| `skills/remember/SKILL.md` | 22 | Terseness guidance for `remember()` usage |
| `agents/knowledge-researcher.md` | 20 | Read-only Haiku agent for codebase validation |
| `.claude-plugin/plugin.json` | 16 | Plugin manifest |
| `hooks/mim-hooks.json` | 16 | Hook configuration |
| `package.json` | 8 | Minimal metadata (zero dependencies) |

### Key Security Patterns Implemented

**Path traversal prevention** (defense in depth):
```javascript
const safeCategory = normalizeCategory(category.trim());  // strips non-alphanumeric
const targetPath = path.resolve(categoryDir, slug + '.md');
if (!targetPath.startsWith(KNOWLEDGE_DIR + path.sep))      // secondary guard
  return toolResult('Error: path traversal detected', true);
```

**Atomic writes** (crash safety):
```javascript
function atomicWrite(filePath, content) {
  const tmp = filePath + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, filePath);  // atomic on POSIX
}
```

**Protocol channel separation** (MCP compliance):
```javascript
function log(msg) { console.error('[mim] ' + msg); }  // stderr only
// stdout reserved exclusively for JSON-RPC responses
```

**Error handling separation** (correct error codes):
```javascript
let req;
try { req = JSON.parse(line); }
catch (_) { /* -32700 Parse error */ return; }
try { handleRequest(req); }
catch (err) { /* -32603 Internal error */ }
```

### Review Phase

6 specialist review agents ran against the implementation:

- **Security Sentinel**: Found v2 migration missing path traversal guard, type validation, and `files` param type check. All fixed.
- **Architecture Strategist**: Found marketplace version not updated, v2 migration not updating knowledge map, CLAUDE.md idempotency bug. All fixed.
- **Pattern Recognition**: Found duplicated slugify logic, error misclassification (filesystem errors reported as parse errors), missing error logging. All fixed.
- **Simplicity Reviewer**: Confirmed implementation is appropriately minimal. Suggested removing PLURAL map and trimming tool description (deferred).
- **Performance Oracle**: No issues found. All performance claims validated.
- **Agent-Native Reviewer**: Found `disable-model-invocation` preventing programmatic validation, `/mim:review` human-only due to AskUserQuestion. Former fixed; latter documented as known limitation.

## Results

| Metric | V2 | V3 | Change |
|---|---|---|---|
| Lines of code | ~6000 TypeScript | ~460 JS + markdown | -92% |
| npm dependencies | 8+ (terminal-kit, sharp, play-sound, Agent SDK...) | 0 | -100% |
| Memory usage | 40GB+ under load | ~20MB (single process) | -99.95% |
| `remember()` latency | Seconds (agent init) | <2ms (direct write) | -99.8% |
| Build step required | Yes (TypeScript + esbuild) | No | Eliminated |
| Recursive spawning possible | Yes (procedurally guarded) | No (structurally impossible) | Eliminated |

## Prevention Strategies

### 1. Structural Over Procedural Safety
Make failure modes unrepresentable in the architecture rather than adding runtime guards. V2 tried to limit recursion; v3 made it impossible by removing the Agent SDK from the MCP server entirely.

### 2. Native Primitives Over Custom Orchestration
Before building custom agent swarms, queues, or TUI interfaces, check if the platform provides native equivalents. Claude Code's skills, hooks, subagents, and AskUserQuestion replaced ~5500 lines of custom code.

### 3. Over-Engineering Indicators
Watch for: code-to-problem ratio >5x, build pipeline complexity exceeding the core problem, custom orchestration duplicating platform features, documentation of exceptions exceeding documentation of rules.

### 4. MCP Server Security Checklist
- Sanitize all path parameters (slug-sanitize + `path.resolve` + `startsWith` guard)
- Use atomic writes (temp file + rename) for critical data
- Never log to stdout (reserved for JSON-RPC protocol)
- Return tool errors as results with `isError: true`, not JSON-RPC error codes
- Validate input types and ranges before processing

### 5. Multi-Agent Research Before Implementation
Deploy specialist research agents (security, architecture, performance, simplicity) against plans before writing code. The 14-agent deepening phase found the path traversal vulnerability, the non-atomic write issue, and the missing hook `matcher` field -- all before a single line of v3 was written.

## References

### Internal
- Brainstorm: `docs/brainstorms/2026-02-11-mim-v3-simplification-brainstorm.md`
- Plan: `docs/plans/2026-02-11-refactor-mim-v3-simplification-plan.md`
- Implementation commit: `ee52dd4`
- Review fixes commit: `62d95df`

### External
- [Claude Code Plugin Reference](https://code.claude.com/docs/en/plugins-reference)
- [Claude Code Subagents](https://code.claude.com/docs/en/sub-agents)
- [MCP Specification](https://github.com/modelcontextprotocol/specification)
- [Path Traversal in MCP Servers](https://snyk.io/articles/preventing-path-traversal-vulnerabilities-in-mcp-server-function-handlers/)
- [MCP Security Best Practices](https://www.mcpevals.io/blog/mcp-security-best-practices)
