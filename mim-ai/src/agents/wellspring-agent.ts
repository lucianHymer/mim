import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import fs from 'node:fs';
import path from 'node:path';

export const WellspringOutputSchema = z.object({
  message: z.string().describe('Status message to display'),
  done: z.boolean().describe('True when all processing is complete'),
});

export type WellspringOutput = z.infer<typeof WellspringOutputSchema>;

const PENDING_DIR = '.claude/knowledge/pending-review';

export interface AnsweredReview {
  id: string;
  subject: string;
  type: 'stale' | 'conflict' | 'outdated';
  question: string;
  context: string;
  options: string[];
  knowledge_file: string;
  answer: string;  // The user's answer
}

export function loadAnsweredReviews(): AnsweredReview[] {
  const reviews: AnsweredReview[] = [];
  const dir = path.join(process.cwd(), PENDING_DIR);

  if (!fs.existsSync(dir)) return reviews;

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(dir, file), 'utf-8');
      const review = JSON.parse(content);
      if (review.answer) {  // Only load answered reviews
        reviews.push(review as AnsweredReview);
      }
    } catch {
      // Skip invalid files
    }
  }

  return reviews;
}

export function deleteReviewFile(review: AnsweredReview): void {
  const filename = `${review.id}-${review.subject.replace(/[^a-z0-9]/gi, '-').slice(0, 30)}.json`;
  const filepath = path.join(process.cwd(), PENDING_DIR, filename);

  if (fs.existsSync(filepath)) {
    fs.unlinkSync(filepath);
  }
}

export const WELLSPRING_SYSTEM_PROMPT = `You are the Wellspring Agent for Mim, a persistent memory system.

Your job is to apply the user's decisions from the review process.

## Input

You will receive answered review entries. Each has:
- question: What was asked
- answer: The user's chosen response
- knowledge_file: The file that needs updating
- type: 'stale', 'conflict', or 'outdated'

## Actions

For each answered review:
1. Read the current knowledge file
2. Apply the user's decision:
   - If answer indicates deletion: Remove the problematic section
   - If answer indicates update: Modify the content accordingly
   - If answer indicates keeping current: Leave as-is
3. Report what you did

## Style

Speak as the ancient Wellspring - calm, wise, slightly mystical:
- "The waters reflect your choice..."
- "This knowledge returns to the depths..."
- "The flow adjusts accordingly..."

When done with all reviews, output done: true.

## Important

- Make precise, minimal edits
- Don't rewrite entire files
- Delete review files after processing each one successfully
- If a knowledge file doesn't exist, skip that review`;

// Helper to strip $schema from JSON schemas for compatibility
function stripSchemaField(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema, ...rest } = schema;
  return rest;
}

export function getWellspringOutputJsonSchema(): Record<string, unknown> {
  return stripSchemaField(zodToJsonSchema(WellspringOutputSchema) as Record<string, unknown>);
}
