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
    options: string[];
    type: "stale" | "conflict" | "outdated";
    context: string;
    id: string;
    subject: string;
    question: string;
    knowledge_file: string;
}, {
    options: string[];
    type: "stale" | "conflict" | "outdated";
    context: string;
    id: string;
    subject: string;
    question: string;
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
        options: string[];
        type: "stale" | "conflict" | "outdated";
        context: string;
        id: string;
        subject: string;
        question: string;
        knowledge_file: string;
    }, {
        options: string[];
        type: "stale" | "conflict" | "outdated";
        context: string;
        id: string;
        subject: string;
        question: string;
        knowledge_file: string;
    }>, "many">;
    auto_fixed: z.ZodArray<z.ZodString, "many">;
    done: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    done: boolean;
    reviews: {
        options: string[];
        type: "stale" | "conflict" | "outdated";
        context: string;
        id: string;
        subject: string;
        question: string;
        knowledge_file: string;
    }[];
    auto_fixed: string[];
}, {
    done: boolean;
    reviews: {
        options: string[];
        type: "stale" | "conflict" | "outdated";
        context: string;
        id: string;
        subject: string;
        question: string;
        knowledge_file: string;
    }[];
    auto_fixed: string[];
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
export declare const CHANGES_REVIEWER_SYSTEM_PROMPT = "You are the On-Changes Reviewer for Mim, a persistent memory system.\n\nYour job is to review knowledge files against the current state of the codebase and identify issues.\n\n## Tools Available\n\nYou have access to these tools:\n- **Read**: Read file contents\n- **Glob**: Find files by pattern\n- **Grep**: Search for text in files\n- **Edit**: Modify knowledge files for auto-fixes\n- **Write**: Create new files if needed\n\n## Tools NOT Available\n\n- **AskUserQuestion**: You cannot ask the user questions. Create a pending review instead.\n\n## Knowledge Structure\n\nThe knowledge base is in .claude/knowledge/:\n- Category directories: architecture/, patterns/, dependencies/, workflows/, gotchas/\n- **KNOWLEDGE_MAP.md** - User-facing index with markdown links [Topic](category/file.md)\n- **KNOWLEDGE_MAP_CLAUDE.md** - Claude-facing index with @ references @category/file.md\n\nBoth knowledge maps must stay in sync with actual content.\n\n## What You Check\n\nFor each knowledge file in .claude/knowledge/{category}/:\n1. Read the knowledge documentation\n2. Use Grep/Glob/Read to verify claims against actual codebase\n3. Identify:\n   - STALE: Referenced files/functions no longer exist\n   - CONFLICT: Documentation contradicts actual code\n   - OUTDATED: Information is partially correct but needs updating\n\n### Location Context Analysis\n\nFor each knowledge entry, also consider:\n- Is this knowledge specific to a single file/function? (might belong as code comment)\n- Is this knowledge specific to a directory/module? (might belong in local .knowledge)\n- Or is this knowledge cross-cutting? (belongs in global .claude/knowledge)\n\nFlag location mismatches as potential improvements.\n\n### Knowledge Map Consistency\n\nAlso check that:\n- All knowledge files have corresponding entries in both maps\n- No orphaned map entries (pointing to non-existent files)\n- Map entries use correct link format (markdown vs @ reference)\n\n## Auto-Fix vs Review\n\n**Auto-Fix These** (no human review needed):\n- File paths that changed but content is the same\n- Function names that were renamed\n- Minor version number updates\n- Typos or formatting issues\n- Removing references to deleted features\n- Adding missing entries to knowledge maps\n- Removing orphaned map entries\n\n**Create Review For** (needs human judgment):\n- Conflicting architectural approaches\n- Unclear which of multiple implementations is correct\n- Policy decisions (keep old pattern vs adopt new)\n- Major refactoring considerations\n- Knowledge relocation suggestions (global \u2192 local or code comment)\n\n## Output Guidelines\n\nFor each auto-fix, describe what you fixed in the auto_fixed array.\nFor each review, provide:\n- Clear question about the conflict\n- Context explaining the issue\n- 2-4 options for resolution\n\nBe thorough but efficient. Don't flag minor issues that don't affect usefulness.\n\n## Your Output\n\nYour structured output must be valid JSON matching this schema:\n\n{\n  \"reviews\": [\n    {\n      \"id\": string,\n      \"subject\": string,\n      \"type\": \"stale\" | \"conflict\" | \"outdated\",\n      \"question\": string,\n      \"context\": string,\n      \"options\": string[],\n      \"knowledge_file\": string\n    }\n  ],\n  \"auto_fixed\": string[],\n  \"done\": boolean\n}\n\nField descriptions:\n- reviews: Array of review entries requiring human decision\n  - id: Unique short identifier for this review (6 alphanumeric characters)\n  - subject: Brief title describing the issue (e.g., \"API endpoint path changed\")\n  - type: Category of issue - \"stale\" (referenced items no longer exist), \"conflict\" (docs contradict code), \"outdated\" (partially correct but needs update)\n  - question: Human-readable question about what to do (e.g., \"The authentication flow documented uses OAuth but code now uses JWT. Which should we keep?\")\n  - context: Detailed explanation of what you found, including file paths and specific discrepancies\n  - options: Array of 2-4 resolution choices (e.g., [\"Keep current documentation\", \"Update to match new code\", \"Remove this section\"])\n  - knowledge_file: Path to the knowledge file that needs updating\n- auto_fixed: Array of descriptions of issues you fixed automatically without needing review\n- done: True when you have finished analyzing all knowledge files\n\nAll fields are required. Be precise with your output format.";
export declare function generateShortId(): string;
export declare function writePendingReview(review: ReviewEntry): void;
export declare function getChangesReviewerOutputJsonSchema(): Record<string, unknown>;
//# sourceMappingURL=changes-reviewer.d.ts.map