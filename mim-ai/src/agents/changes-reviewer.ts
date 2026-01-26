import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import fs from 'node:fs';
import path from 'node:path';

export const ReviewEntrySchema = z.object({
  id: z.string(),
  subject: z.string(),
  type: z.enum(['stale', 'conflict', 'outdated', 'auto_fix']),
  question: z.string(),
  options: z.array(z.string()),
  knowledge_file: z.string(),
  agent_notes: z.string(),
  auto_apply: z.boolean().optional(),  // If true, Wellspring applies without user interaction
});

export const ChangesReviewerOutputSchema = z.object({
  reviews: z.array(ReviewEntrySchema),
  auto_fixed: z.array(z.string()),
  done: z.boolean(),
});

export type ReviewEntry = z.infer<typeof ReviewEntrySchema>;
export type ChangesReviewerOutput = z.infer<typeof ChangesReviewerOutputSchema>;

const KNOWLEDGE_DIR = '.claude/knowledge';
const PENDING_DIR = `${KNOWLEDGE_DIR}/pending-review`;
const LAST_ANALYSIS_FILE = `${KNOWLEDGE_DIR}/.last-analysis`;

export interface AnalysisState {
  timestamp: string;
  commit_hash: string;
}

export function readLastAnalysis(): AnalysisState | null {
  try {
    const content = fs.readFileSync(path.join(process.cwd(), LAST_ANALYSIS_FILE), 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export function writeLastAnalysis(state: AnalysisState): void {
  fs.writeFileSync(
    path.join(process.cwd(), LAST_ANALYSIS_FILE),
    JSON.stringify(state, null, 2)
  );
}

export function shouldRunAnalysis(currentHash: string): boolean {
  const last = readLastAnalysis();
  if (!last) return true;
  return last.commit_hash !== currentHash;
}

// Agent system prompt
export const CHANGES_REVIEWER_SYSTEM_PROMPT = `You are the On-Changes Reviewer for Mim, a persistent memory system.

Your job is to review knowledge files against the current state of the codebase and identify issues.

## Tools Available

You have access to these tools:
- **Read**: Read file contents
- **Glob**: Find files by pattern
- **Grep**: Search for text in files
- **Edit**: Modify knowledge files for auto-fixes
- **Write**: Create new files if needed

## Tools NOT Available

- **AskUserQuestion**: You cannot ask the user questions. Create a pending review instead.

## Knowledge Structure

The knowledge base is in .claude/knowledge/:
- Category directories: architecture/, patterns/, dependencies/, workflows/, gotchas/
- **KNOWLEDGE_MAP.md** - User-facing index with markdown links [Topic](category/file.md)
- **KNOWLEDGE_MAP_CLAUDE.md** - Claude-facing index with @ references @category/file.md

Both knowledge maps must stay in sync with actual content.

## What You Check

For each knowledge file in .claude/knowledge/{category}/:
1. Read the knowledge documentation
2. Use Grep/Glob/Read to verify claims against actual codebase
3. Identify:
   - STALE: Referenced files/functions no longer exist
   - CONFLICT: Documentation contradicts actual code
   - OUTDATED: Information is partially correct but needs updating

### Location Context Analysis

For each knowledge entry, also consider:
- Is this knowledge specific to a single file/function? (might belong as code comment)
- Is this knowledge specific to a directory/module? (might belong in local .knowledge)
- Or is this knowledge cross-cutting? (belongs in global .claude/knowledge)

Flag location mismatches as potential improvements.

### Knowledge Map Consistency

Also check that:
- All knowledge files have corresponding entries in both maps
- No orphaned map entries (pointing to non-existent files)
- Map entries use correct link format (markdown vs @ reference)

## Auto-Fix vs Review

**Auto-Fix These** (no human review needed):
- File paths that changed but content is the same
- Function names that were renamed
- Minor version number updates
- Typos or formatting issues
- Removing references to deleted features
- Adding missing entries to knowledge maps
- Removing orphaned map entries

**Create Review For** (needs human judgment):
- Conflicting architectural approaches
- Unclear which of multiple implementations is correct
- Policy decisions (keep old pattern vs adopt new)
- Major refactoring considerations
- Knowledge relocation suggestions (global → local or code comment)

## Output Guidelines

For each auto-fix, describe what you fixed in the auto_fixed array.
For each review, provide:
- Clear question about the conflict
- Context explaining the issue
- 2-4 options for resolution

Be thorough but efficient. Don't flag minor issues that don't affect usefulness.

## Your Output

Your structured output must be valid JSON matching this schema:

{
  "reviews": [
    {
      "id": string,
      "subject": string,
      "type": "stale" | "conflict" | "outdated",
      "question": string,
      "options": string[],
      "knowledge_file": string,
      "agent_notes": string
    }
  ],
  "auto_fixed": string[],
  "done": boolean
}

Field descriptions:
- reviews: Array of review entries requiring human decision
  - id: Unique short identifier for this review (6 alphanumeric characters)
  - subject: Brief title describing the issue (e.g., "API endpoint path changed")
  - type: Category of issue - "stale" (referenced items no longer exist), "conflict" (docs contradict code), "outdated" (partially correct but needs update)
  - question: A COMPLETE, SELF-CONTAINED explanation for the human reviewer. Explain what the issue is, what the current state is, and what needs to be decided. Write 2-4 sentences. IMPORTANT: The user sees BOTH the question AND the options list below it. Do NOT repeat or summarize the options in the question - they are displayed separately as [1], [2], etc. Just explain the situation, not the choices.
  - options: Array of 2-4 resolution choices. These are shown to the user as numbered choices [1], [2], etc. directly below the question. Do NOT duplicate these in the question text.
  - knowledge_file: Path to the knowledge file that needs updating
  - agent_notes: Technical details for the agent that will apply the decision (file paths, line numbers, specific code references, what to change). The human does NOT see this - it's for the Wellspring agent to know HOW to implement the chosen option.
- auto_fixed: Array of descriptions of issues you fixed automatically without needing review
- done: True when you have finished analyzing all knowledge files

All fields are required. Be precise with your output format.`;

export function generateShortId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 6; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

export function writePendingReview(review: ReviewEntry): void {
  const filename = `${review.id}.json`;
  const filepath = path.join(process.cwd(), PENDING_DIR, filename);

  // Ensure directory exists
  const dir = path.dirname(filepath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(filepath, JSON.stringify(review, null, 2));
}

// Helper to strip $schema from JSON schemas for compatibility
function stripSchemaField(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema, ...rest } = schema;
  return rest;
}

export function getChangesReviewerOutputJsonSchema(): Record<string, unknown> {
  return stripSchemaField(zodToJsonSchema(ChangesReviewerOutputSchema) as Record<string, unknown>);
}
