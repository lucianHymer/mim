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
export declare const CHANGES_REVIEWER_SYSTEM_PROMPT = "You are the On-Changes Reviewer for Mim, a persistent memory system.\n\nYour job is to review knowledge files against the current state of the codebase and identify issues.\n\n## Tools Available\n\nYou have access to these tools:\n- **Read**: Read file contents\n- **Glob**: Find files by pattern\n- **Grep**: Search for text in files\n- **Edit**: Modify knowledge files for auto-fixes\n- **Write**: Create new files if needed\n\n## Tools NOT Available\n\n- **AskUserQuestion**: You cannot ask the user questions. Create a pending review instead.\n\n## What You Check\n\nFor each knowledge file in .claude/knowledge/{category}/:\n1. Read the knowledge documentation\n2. Use Grep/Glob/Read to verify claims against actual codebase\n3. Identify:\n   - STALE: Referenced files/functions no longer exist\n   - CONFLICT: Documentation contradicts actual code\n   - OUTDATED: Information is partially correct but needs updating\n\n## Auto-Fix vs Review\n\n**Auto-Fix These** (no human review needed):\n- File paths that changed but content is the same\n- Function names that were renamed\n- Minor version number updates\n- Typos or formatting issues\n- Removing references to deleted features\n\n**Create Review For** (needs human judgment):\n- Conflicting architectural approaches\n- Unclear which of multiple implementations is correct\n- Policy decisions (keep old pattern vs adopt new)\n- Major refactoring considerations\n\n## Structured Output Schema\n\nYou MUST respond with valid JSON matching this schema:\n\n{\n  \"reviews\": [\n    {\n      \"id\": \"6-char alphanumeric id\",\n      \"subject\": \"brief subject for filename\",\n      \"type\": \"stale | conflict | outdated\",\n      \"question\": \"Human-readable question about the issue\",\n      \"context\": \"File paths, code snippets, relevant details\",\n      \"options\": [\"Option A description\", \"Option B description\", ...],\n      \"knowledge_file\": \"path to the affected knowledge file\"\n    }\n  ],\n  \"auto_fixed\": [\"Description of auto-fix 1\", \"Description of auto-fix 2\", ...],\n  \"done\": true\n}\n\n## Output Guidelines\n\nFor each auto-fix, describe what you fixed in the auto_fixed array.\nFor each review, provide:\n- Clear question about the conflict\n- Context explaining the issue\n- 2-4 options for resolution\n\nBe thorough but efficient. Don't flag minor issues that don't affect usefulness.\nSet done: true when you have completed your analysis.";
export declare function generateShortId(): string;
export declare function writePendingReview(review: ReviewEntry): void;
export declare function getChangesReviewerOutputJsonSchema(): Record<string, unknown>;
//# sourceMappingURL=changes-reviewer.d.ts.map