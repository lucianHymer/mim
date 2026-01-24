import { z } from 'zod';
export declare const ReviewEntrySchema: z.ZodObject<{
    id: z.ZodString;
    subject: z.ZodString;
    type: z.ZodEnum<["stale", "conflict", "outdated"]>;
    question: z.ZodString;
    context: z.ZodString;
    options: z.ZodArray<z.ZodString, "many">;
    knowledge_file: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    subject: string;
    type: "stale" | "conflict" | "outdated";
    options: string[];
    question: string;
    context: string;
    knowledge_file: string;
}, {
    id: string;
    subject: string;
    type: "stale" | "conflict" | "outdated";
    options: string[];
    question: string;
    context: string;
    knowledge_file: string;
}>;
export declare const ChangesReviewerOutputSchema: z.ZodObject<{
    reviews: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        subject: z.ZodString;
        type: z.ZodEnum<["stale", "conflict", "outdated"]>;
        question: z.ZodString;
        context: z.ZodString;
        options: z.ZodArray<z.ZodString, "many">;
        knowledge_file: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        id: string;
        subject: string;
        type: "stale" | "conflict" | "outdated";
        options: string[];
        question: string;
        context: string;
        knowledge_file: string;
    }, {
        id: string;
        subject: string;
        type: "stale" | "conflict" | "outdated";
        options: string[];
        question: string;
        context: string;
        knowledge_file: string;
    }>, "many">;
    auto_fixed: z.ZodArray<z.ZodString, "many">;
    done: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    reviews: {
        id: string;
        subject: string;
        type: "stale" | "conflict" | "outdated";
        options: string[];
        question: string;
        context: string;
        knowledge_file: string;
    }[];
    auto_fixed: string[];
    done: boolean;
}, {
    reviews: {
        id: string;
        subject: string;
        type: "stale" | "conflict" | "outdated";
        options: string[];
        question: string;
        context: string;
        knowledge_file: string;
    }[];
    auto_fixed: string[];
    done: boolean;
}>;
export type ReviewEntry = z.infer<typeof ReviewEntrySchema>;
export type ChangesReviewerOutput = z.infer<typeof ChangesReviewerOutputSchema>;
export interface AnalysisState {
    timestamp: string;
    commit_hash: string;
}
export declare function readLastAnalysis(): AnalysisState | null;
export declare function writeLastAnalysis(state: AnalysisState): void;
export declare function shouldRunAnalysis(currentHash: string): boolean;
export declare const CHANGES_REVIEWER_SYSTEM_PROMPT = "You are the On-Changes Reviewer for Mim, a persistent memory system.\n\nYour job is to review knowledge files against the current state of the codebase and identify issues.\n\n## What You Check\n\nFor each knowledge file in .claude/knowledge/{category}/:\n1. Read the knowledge documentation\n2. Use Grep/Glob/Read to verify claims against actual codebase\n3. Identify:\n   - STALE: Referenced files/functions no longer exist\n   - CONFLICT: Documentation contradicts actual code\n   - OUTDATED: Information is partially correct but needs updating\n\n## Auto-Fix vs Review\n\n**Auto-Fix These** (no human review needed):\n- File paths that changed but content is the same\n- Function names that were renamed\n- Minor version number updates\n- Typos or formatting issues\n- Removing references to deleted features\n\n**Create Review For** (needs human judgment):\n- Conflicting architectural approaches\n- Unclear which of multiple implementations is correct\n- Policy decisions (keep old pattern vs adopt new)\n- Major refactoring considerations\n\n## Output Format\n\nFor each auto-fix, describe what you fixed.\nFor each review, provide:\n- Clear question about the conflict\n- Context explaining the issue\n- 2-4 options for resolution\n\nBe thorough but efficient. Don't flag minor issues that don't affect usefulness.";
export declare function generateShortId(): string;
export declare function writePendingReview(review: ReviewEntry): void;
export declare function getChangesReviewerOutputJsonSchema(): Record<string, unknown>;
//# sourceMappingURL=changes-reviewer.d.ts.map