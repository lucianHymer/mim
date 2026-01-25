import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Inquisitor Agent - Researches a single knowledge entry
 *
 * Spawned as Haiku subagents by the Changes Reviewer orchestrator.
 * Each inquisitor investigates ONE knowledge entry against the codebase.
 */

export const InquisitorOutputSchema = z.object({
  entry_id: z.string().describe('ID of the knowledge entry being investigated'),
  status: z.enum(['valid', 'stale', 'conflict', 'outdated']).describe('Result of investigation'),

  // What was found
  findings: z.object({
    code_exists: z.boolean().describe('Whether referenced code/files still exist'),
    current_behavior: z.string().describe('What the code actually does now'),
    recent_changes: z.string().optional().describe('Recent git changes affecting this knowledge'),
    related_entries: z.array(z.string()).optional().describe('Similar entries in knowledge base'),
  }),

  // Location recommendation (from v1 inquisitor pattern)
  location_context: z.object({
    scope: z.enum(['global', 'local', 'code_comment']).describe('Recommended knowledge scope'),
    reason: z.string().describe('Why this scope is recommended'),
    suggested_location: z.string().optional().describe('Specific file/directory if local or code_comment'),
  }),

  // Issue details (if any)
  issue: z.object({
    description: z.string().describe('What is wrong or outdated'),
    severity: z.enum(['auto_fix', 'needs_review']).describe('Whether this can be auto-fixed'),
    suggested_fix: z.string().optional().describe('How to fix if auto_fix'),
    review_question: z.string().optional().describe('Self-contained question for human if needs_review. Include ALL context needed to decide - do not reference options.'),
    review_options: z.array(z.string()).optional().describe('Options for human review'),
    review_agent_notes: z.string().optional().describe('Technical details for the agent applying the decision (file paths, line numbers, what to change). Human does NOT see this.'),
  }).optional(),

  done: z.boolean().describe('Always true when investigation is complete'),
});

export type InquisitorOutput = z.infer<typeof InquisitorOutputSchema>;

export interface KnowledgeEntry {
  id: string;
  category: string;
  file: string;
  topic: string;
  content: string;
}

// Inquisitor system prompt - adapted from v1
export const INQUISITOR_SYSTEM_PROMPT = `You are an Inquisitor agent researching a single knowledge entry.

## Your Mission

Research the ONE provided knowledge entry. Verify it against the actual codebase.

## Tools Available

You have access to:
- **Read**: Read file contents
- **Glob**: Find files by pattern
- **Grep**: Search for text in files
- **Bash(git log:*)**: View git history
- **Bash(git show:*)**: View specific commits
- **Bash(git diff:*)**: Compare changes
- **Bash(git blame:*)**: See line-by-line history

## What to Investigate

1. **Does the referenced code still exist?**
   - Check file paths mentioned
   - Check function/class names mentioned
   - Check configuration values mentioned

2. **What does the code actually do now?**
   - Read the relevant files
   - Understand current implementation
   - Compare to what the documentation claims

3. **What has changed recently?**
   - Use git log to see recent changes
   - Check if changes affect this knowledge

4. **Location Context**
   - Is this knowledge specific to a single file/function? → code_comment
   - Is this knowledge specific to a directory/module? → local
   - Is this knowledge cross-cutting (affects multiple areas)? → global

## Output

Based on your investigation, report:
- Whether the knowledge is still valid, stale, conflicting, or outdated
- What you found in the codebase
- Where this knowledge best belongs (global, local, or code comment)
- Any issues that need fixing (auto-fixable or needs human review)

Be thorough but efficient. Focus on verifying the specific claims in the knowledge entry.

## Important

- Do NOT ask questions - make your best judgment
- Focus on THIS ONE entry only
- Always set done: true when complete`;

// Helper to strip $schema from JSON schemas for compatibility
function stripSchemaField(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema, ...rest } = schema;
  return rest;
}

export function getInquisitorOutputJsonSchema(): Record<string, unknown> {
  return stripSchemaField(zodToJsonSchema(InquisitorOutputSchema) as Record<string, unknown>);
}

/**
 * Parse knowledge files into individual entries for investigation
 */
export function parseKnowledgeEntries(
  category: string,
  filename: string,
  content: string
): KnowledgeEntry[] {
  const entries: KnowledgeEntry[] = [];

  // Split by H2 headers (## Topic)
  const sections = content.split(/^## /m).filter(s => s.trim());

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const lines = section.split('\n');
    const topic = lines[0]?.trim() || `Section ${i + 1}`;
    const sectionContent = lines.slice(1).join('\n').trim();

    if (sectionContent) {
      entries.push({
        id: `${category}-${filename.replace('.md', '')}-${i}`,
        category,
        file: filename,
        topic,
        content: sectionContent,
      });
    }
  }

  // If no H2 sections, treat whole file as one entry
  if (entries.length === 0 && content.trim()) {
    entries.push({
      id: `${category}-${filename.replace('.md', '')}-0`,
      category,
      file: filename,
      topic: filename.replace('.md', '').replace(/-/g, ' '),
      content: content.trim(),
    });
  }

  return entries;
}
