import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import fs from 'node:fs';
import path from 'node:path';

export const ReviewEntrySchema = z.object({
  id: z.string(),
  subject: z.string(),
  type: z.enum(['stale', 'conflict', 'outdated']),
  question: z.string(),
  context: z.string(),
  options: z.array(z.string()),
  knowledge_file: z.string(),
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

## What You Check

For each knowledge file in .claude/knowledge/{category}/:
1. Read the knowledge documentation
2. Use Grep/Glob/Read to verify claims against actual codebase
3. Identify:
   - STALE: Referenced files/functions no longer exist
   - CONFLICT: Documentation contradicts actual code
   - OUTDATED: Information is partially correct but needs updating

## Auto-Fix vs Review

**Auto-Fix These** (no human review needed):
- File paths that changed but content is the same
- Function names that were renamed
- Minor version number updates
- Typos or formatting issues
- Removing references to deleted features

**Create Review For** (needs human judgment):
- Conflicting architectural approaches
- Unclear which of multiple implementations is correct
- Policy decisions (keep old pattern vs adopt new)
- Major refactoring considerations

## Output Format

For each auto-fix, describe what you fixed.
For each review, provide:
- Clear question about the conflict
- Context explaining the issue
- 2-4 options for resolution

Be thorough but efficient. Don't flag minor issues that don't affect usefulness.`;

export function generateShortId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 6; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

export function writePendingReview(review: ReviewEntry): void {
  const filename = `${review.id}-${review.subject.replace(/[^a-z0-9]/gi, '-').slice(0, 30)}.json`;
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
