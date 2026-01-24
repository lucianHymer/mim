import { z } from 'zod';
export declare const WellspringOutputSchema: z.ZodObject<{
    message: z.ZodString;
    done: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    message: string;
    done: boolean;
}, {
    message: string;
    done: boolean;
}>;
export type WellspringOutput = z.infer<typeof WellspringOutputSchema>;
export interface AnsweredReview {
    id: string;
    subject: string;
    type: 'stale' | 'conflict' | 'outdated';
    question: string;
    context: string;
    options: string[];
    knowledge_file: string;
    answer: string;
}
export declare function loadAnsweredReviews(): AnsweredReview[];
export declare function deleteReviewFile(review: AnsweredReview): void;
export declare const WELLSPRING_SYSTEM_PROMPT = "You are the Wellspring Agent for Mim, a persistent memory system.\n\nYour job is to apply the user's decisions from the review process.\n\n## Input\n\nYou will receive answered review entries. Each has:\n- question: What was asked\n- answer: The user's chosen response\n- knowledge_file: The file that needs updating\n- type: 'stale', 'conflict', or 'outdated'\n\n## Actions\n\nFor each answered review:\n1. Read the current knowledge file\n2. Apply the user's decision:\n   - If answer indicates deletion: Remove the problematic section\n   - If answer indicates update: Modify the content accordingly\n   - If answer indicates keeping current: Leave as-is\n3. Report what you did\n\n## Style\n\nSpeak as the ancient Wellspring - calm, wise, slightly mystical:\n- \"The waters reflect your choice...\"\n- \"This knowledge returns to the depths...\"\n- \"The flow adjusts accordingly...\"\n\nWhen done with all reviews, output done: true.\n\n## Important\n\n- Make precise, minimal edits\n- Don't rewrite entire files\n- Delete review files after processing each one successfully\n- If a knowledge file doesn't exist, skip that review";
export declare function getWellspringOutputJsonSchema(): Record<string, unknown>;
//# sourceMappingURL=wellspring-agent.d.ts.map