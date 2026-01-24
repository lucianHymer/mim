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
const KNOWLEDGE_DIR = '.claude/knowledge';
const PENDING_DIR = `${KNOWLEDGE_DIR}/pending-review`;
const LAST_ANALYSIS_FILE = `${KNOWLEDGE_DIR}/.last-analysis`;
export function readLastAnalysis() {
    try {
        const content = fs.readFileSync(path.join(process.cwd(), LAST_ANALYSIS_FILE), 'utf-8');
        return JSON.parse(content);
    }
    catch {
        return null;
    }
}
export function writeLastAnalysis(state) {
    fs.writeFileSync(path.join(process.cwd(), LAST_ANALYSIS_FILE), JSON.stringify(state, null, 2));
}
export function shouldRunAnalysis(currentHash) {
    const last = readLastAnalysis();
    if (!last)
        return true;
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

## Structured Output Schema

You MUST respond with valid JSON matching this schema:

{
  "reviews": [
    {
      "id": "6-char alphanumeric id",
      "subject": "brief subject for filename",
      "type": "stale | conflict | outdated",
      "question": "Human-readable question about the issue",
      "context": "File paths, code snippets, relevant details",
      "options": ["Option A description", "Option B description", ...],
      "knowledge_file": "path to the affected knowledge file"
    }
  ],
  "auto_fixed": ["Description of auto-fix 1", "Description of auto-fix 2", ...],
  "done": true
}

## Output Guidelines

For each auto-fix, describe what you fixed in the auto_fixed array.
For each review, provide:
- Clear question about the conflict
- Context explaining the issue
- 2-4 options for resolution

Be thorough but efficient. Don't flag minor issues that don't affect usefulness.
Set done: true when you have completed your analysis.`;
export function generateShortId() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = '';
    for (let i = 0; i < 6; i++) {
        id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return id;
}
export function writePendingReview(review) {
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
function stripSchemaField(schema) {
    const { $schema, ...rest } = schema;
    return rest;
}
export function getChangesReviewerOutputJsonSchema() {
    return stripSchemaField(zodToJsonSchema(ChangesReviewerOutputSchema));
}
//# sourceMappingURL=changes-reviewer.js.map