import { z } from 'zod';
/**
 * Inquisitor Agent - Researches a single knowledge entry
 *
 * Spawned as Haiku subagents by the Changes Reviewer orchestrator.
 * Each inquisitor investigates ONE knowledge entry against the codebase.
 */
export declare const InquisitorOutputSchema: z.ZodObject<{
    entry_id: z.ZodString;
    status: z.ZodEnum<["valid", "stale", "conflict", "outdated"]>;
    findings: z.ZodObject<{
        code_exists: z.ZodBoolean;
        current_behavior: z.ZodString;
        recent_changes: z.ZodOptional<z.ZodString>;
        related_entries: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        code_exists: boolean;
        current_behavior: string;
        recent_changes?: string | undefined;
        related_entries?: string[] | undefined;
    }, {
        code_exists: boolean;
        current_behavior: string;
        recent_changes?: string | undefined;
        related_entries?: string[] | undefined;
    }>;
    location_context: z.ZodObject<{
        scope: z.ZodEnum<["global", "local", "code_comment"]>;
        reason: z.ZodString;
        suggested_location: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        scope: "global" | "local" | "code_comment";
        reason: string;
        suggested_location?: string | undefined;
    }, {
        scope: "global" | "local" | "code_comment";
        reason: string;
        suggested_location?: string | undefined;
    }>;
    issue: z.ZodOptional<z.ZodObject<{
        description: z.ZodString;
        severity: z.ZodEnum<["auto_fix", "needs_review"]>;
        suggested_fix: z.ZodOptional<z.ZodString>;
        review_question: z.ZodOptional<z.ZodString>;
        review_options: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        review_agent_notes: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        description: string;
        severity: "auto_fix" | "needs_review";
        suggested_fix?: string | undefined;
        review_question?: string | undefined;
        review_options?: string[] | undefined;
        review_agent_notes?: string | undefined;
    }, {
        description: string;
        severity: "auto_fix" | "needs_review";
        suggested_fix?: string | undefined;
        review_question?: string | undefined;
        review_options?: string[] | undefined;
        review_agent_notes?: string | undefined;
    }>>;
    done: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    done: boolean;
    status: "valid" | "stale" | "conflict" | "outdated";
    entry_id: string;
    findings: {
        code_exists: boolean;
        current_behavior: string;
        recent_changes?: string | undefined;
        related_entries?: string[] | undefined;
    };
    location_context: {
        scope: "global" | "local" | "code_comment";
        reason: string;
        suggested_location?: string | undefined;
    };
    issue?: {
        description: string;
        severity: "auto_fix" | "needs_review";
        suggested_fix?: string | undefined;
        review_question?: string | undefined;
        review_options?: string[] | undefined;
        review_agent_notes?: string | undefined;
    } | undefined;
}, {
    done: boolean;
    status: "valid" | "stale" | "conflict" | "outdated";
    entry_id: string;
    findings: {
        code_exists: boolean;
        current_behavior: string;
        recent_changes?: string | undefined;
        related_entries?: string[] | undefined;
    };
    location_context: {
        scope: "global" | "local" | "code_comment";
        reason: string;
        suggested_location?: string | undefined;
    };
    issue?: {
        description: string;
        severity: "auto_fix" | "needs_review";
        suggested_fix?: string | undefined;
        review_question?: string | undefined;
        review_options?: string[] | undefined;
        review_agent_notes?: string | undefined;
    } | undefined;
}>;
export type InquisitorOutput = z.infer<typeof InquisitorOutputSchema>;
export interface KnowledgeEntry {
    id: string;
    category: string;
    file: string;
    topic: string;
    content: string;
}
export declare const INQUISITOR_SYSTEM_PROMPT = "You are an Inquisitor agent researching a single knowledge entry.\n\n## Your Mission\n\nResearch the ONE provided knowledge entry. Verify it against the actual codebase.\n\n## Tools Available\n\nYou have access to:\n- **Read**: Read file contents\n- **Glob**: Find files by pattern\n- **Grep**: Search for text in files\n- **Bash(git log:*)**: View git history\n- **Bash(git show:*)**: View specific commits\n- **Bash(git diff:*)**: Compare changes\n- **Bash(git blame:*)**: See line-by-line history\n\n## What to Investigate\n\n1. **Does the referenced code still exist?**\n   - Check file paths mentioned\n   - Check function/class names mentioned\n   - Check configuration values mentioned\n\n2. **What does the code actually do now?**\n   - Read the relevant files\n   - Understand current implementation\n   - Compare to what the documentation claims\n\n3. **What has changed recently?**\n   - Use git log to see recent changes\n   - Check if changes affect this knowledge\n\n4. **Location Context**\n   - Is this knowledge specific to a single file/function? \u2192 code_comment\n   - Is this knowledge specific to a directory/module? \u2192 local\n   - Is this knowledge cross-cutting (affects multiple areas)? \u2192 global\n\n## Output\n\nBased on your investigation, report:\n- Whether the knowledge is still valid, stale, conflicting, or outdated\n- What you found in the codebase\n- Where this knowledge best belongs (global, local, or code comment)\n- Any issues that need fixing (auto-fixable or needs human review)\n\nBe thorough but efficient. Focus on verifying the specific claims in the knowledge entry.\n\n## Important\n\n- Do NOT ask questions - make your best judgment\n- Focus on THIS ONE entry only\n- Always set done: true when complete";
export declare function getInquisitorOutputJsonSchema(): Record<string, unknown>;
/**
 * Parse knowledge files into individual entries for investigation
 */
export declare function parseKnowledgeEntries(category: string, filename: string, content: string): KnowledgeEntry[];
//# sourceMappingURL=inquisitor.d.ts.map