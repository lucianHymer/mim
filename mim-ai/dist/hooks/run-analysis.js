#!/usr/bin/env node
/**
 * Run Analysis Hook for Mim
 *
 * Uses the Inquisitor Swarm pattern:
 * 1. Read all knowledge entries
 * 2. Spawn parallel Haiku inquisitors (one per entry)
 * 3. Each inquisitor investigates ONE entry against the codebase
 * 4. Collect and synthesize results into reviews
 */
// Increase max listeners to avoid warnings when running multiple concurrent agents
process.setMaxListeners(20);
import { query } from "@anthropic-ai/claude-agent-sdk";
import { logInfo, logWarn, logError, AGENTS } from "../utils/logger.js";
import { writePendingReview, writeLastAnalysis, } from "../agents/changes-reviewer.js";
import { INQUISITOR_SYSTEM_PROMPT, getInquisitorOutputJsonSchema, parseKnowledgeEntries, } from "../agents/inquisitor.js";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
const AGENT = AGENTS.CHANGES_REVIEWER;
/**
 * Find the Claude Code executable path
 * Required because bundling breaks the SDK's auto-detection via import.meta.url
 */
function findClaudeExecutable() {
    // Check env var first
    if (process.env.CLAUDE_BINARY) {
        return process.env.CLAUDE_BINARY;
    }
    // Try to find claude in PATH
    try {
        const claudePath = execSync("which claude", { encoding: "utf-8" }).trim();
        if (claudePath && fs.existsSync(claudePath)) {
            return claudePath;
        }
    }
    catch {
        // which failed, try common locations
    }
    // Common installation locations
    const commonPaths = [
        path.join(process.env.HOME || "", ".local", "bin", "claude"),
        "/usr/local/bin/claude",
        "/usr/bin/claude",
    ];
    for (const p of commonPaths) {
        if (fs.existsSync(p)) {
            return p;
        }
    }
    throw new Error("Could not find Claude Code executable. Set CLAUDE_BINARY env var or ensure claude is in PATH.");
}
const CLAUDE_EXECUTABLE = findClaudeExecutable();
const KNOWLEDGE_DIR = ".claude/knowledge";
const PENDING_DIR = `${KNOWLEDGE_DIR}/pending-review`;
const CATEGORIES = [
    "architecture",
    "patterns",
    "dependencies",
    "workflows",
    "gotchas",
];
const LOCK_FILE = path.join(KNOWLEDGE_DIR, ".analysis-lock");
// Concurrency limit for inquisitor agents
const MAX_CONCURRENT_INQUISITORS = 5;
/**
 * Check if a process with the given PID exists
 */
function processExists(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Acquire a lock for the analysis process
 * Returns true if lock was acquired, false if another process is already running
 */
function acquireLock() {
    const lockPath = path.join(process.cwd(), LOCK_FILE);
    if (fs.existsSync(lockPath)) {
        try {
            const lock = JSON.parse(fs.readFileSync(lockPath, "utf-8"));
            if (processExists(lock.pid)) {
                logInfo(AGENT, `Analysis already running (PID ${lock.pid}), skipping`);
                return false;
            }
            logInfo(AGENT, `Clearing stale lock from dead process ${lock.pid}`);
        }
        catch {
            // Corrupted lock file, clear it
        }
    }
    fs.writeFileSync(lockPath, JSON.stringify({
        pid: process.pid,
        started_at: new Date().toISOString(),
    }, null, 2));
    return true;
}
/**
 * Release the lock file
 */
function releaseLock() {
    const lockPath = path.join(process.cwd(), LOCK_FILE);
    if (fs.existsSync(lockPath)) {
        fs.unlinkSync(lockPath);
    }
}
/**
 * Check if a pending review already exists for the given entry ID
 */
function pendingReviewExists(entryId) {
    const reviewPath = path.join(process.cwd(), PENDING_DIR, `${entryId}.json`);
    return fs.existsSync(reviewPath);
}
/**
 * Read existing pending reviews
 */
function getPendingReviews() {
    const reviews = [];
    const dir = path.join(process.cwd(), PENDING_DIR);
    if (!fs.existsSync(dir))
        return reviews;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
        try {
            const content = fs.readFileSync(path.join(dir, file), "utf-8");
            const review = JSON.parse(content);
            if (!review.answer) {
                // Only unanswered reviews
                reviews.push({ ...review, _filename: file });
            }
        }
        catch {
            logWarn(AGENT, `Failed to read review file: ${file}`);
        }
    }
    return reviews;
}
/**
 * Delete a pending review file
 */
function deletePendingReview(filename) {
    const filepath = path.join(process.cwd(), PENDING_DIR, filename);
    if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
        logInfo(AGENT, `Deleted stale review: ${filename}`);
    }
}
/**
 * Get the current git HEAD commit hash
 */
function getCurrentHead() {
    try {
        return execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
    }
    catch {
        return null;
    }
}
/**
 * Read all knowledge files and parse into individual entries
 */
function getAllKnowledgeEntries() {
    const entries = [];
    const baseDir = path.join(process.cwd(), KNOWLEDGE_DIR);
    for (const category of CATEGORIES) {
        const categoryDir = path.join(baseDir, category);
        if (!fs.existsSync(categoryDir)) {
            continue;
        }
        const files = fs.readdirSync(categoryDir).filter((f) => f.endsWith(".md"));
        for (const file of files) {
            const filepath = path.join(categoryDir, file);
            try {
                const content = fs.readFileSync(filepath, "utf-8");
                const parsed = parseKnowledgeEntries(category, file, content);
                entries.push(...parsed);
            }
            catch {
                logWarn(AGENT, `Failed to read knowledge file: ${filepath}`);
            }
        }
    }
    return entries;
}
/**
 * Check if a pending review is still relevant
 * Returns true if the review should be kept, false if it's now moot
 */
async function checkReviewRelevance(review) {
    const prompt = `Check if this pending review is still relevant:

**Review ID:** ${review.id}
**Subject:** ${review.subject}
**Type:** ${review.type}
**Question:** ${review.question}
**Context:** ${review.context}
**Knowledge File:** ${review.knowledge_file}

Investigate if this issue still exists. The review was created because of a detected issue in the knowledge base. Check if:
1. The knowledge file still exists
2. The issue described is still present
3. Code changes may have resolved the conflict

Respond with:
- still_relevant: true if the issue persists and needs human review
- still_relevant: false if the issue was resolved (explain why)
- reason: explanation of your finding`;
    try {
        const session = query({
            prompt,
            options: {
                model: "haiku",
                pathToClaudeCodeExecutable: CLAUDE_EXECUTABLE,
                systemPrompt: "You are checking if a pending knowledge review is still relevant. Be brief and direct.",
                canUseTool: async (tool, input) => {
                    const allowedTools = ["Read", "Glob", "Grep"];
                    if (allowedTools.includes(tool)) {
                        return { behavior: "allow", updatedInput: input };
                    }
                    return { behavior: "deny", message: "Tool not allowed" };
                },
            },
        });
        for await (const event of session) {
            if (event.type === "result" && event.subtype === "success") {
                const text = event.text || "";
                // Simple heuristic: if response contains "still_relevant: false" or "no longer", it's moot
                const isMoot = text.toLowerCase().includes("still_relevant: false") ||
                    text.toLowerCase().includes("no longer relevant") ||
                    text.toLowerCase().includes("issue resolved") ||
                    text.toLowerCase().includes("has been fixed");
                return { review, stillRelevant: !isMoot, reason: text };
            }
        }
        return { review, stillRelevant: true, reason: "Could not determine" };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logWarn(AGENT, `Failed to check review relevance: ${message}`);
        return { review, stillRelevant: true, reason: "Error checking" };
    }
}
/**
 * Run a single inquisitor agent on one knowledge entry
 */
async function runInquisitor(entry) {
    const prompt = `Investigate this knowledge entry:

**Entry ID:** ${entry.id}
**Category:** ${entry.category}
**File:** ${entry.file}
**Topic:** ${entry.topic}

**Content:**
${entry.content}

Verify this knowledge against the actual codebase. Check if the referenced code exists, if the claims are accurate, and recommend the best location for this knowledge.`;
    try {
        const session = query({
            prompt,
            options: {
                model: "haiku",
                pathToClaudeCodeExecutable: CLAUDE_EXECUTABLE,
                systemPrompt: INQUISITOR_SYSTEM_PROMPT,
                canUseTool: async (tool, input) => {
                    // Allow read-only tools and specific git commands
                    const allowedTools = ["Read", "Glob", "Grep"];
                    const allowedBashPrefixes = [
                        "git log",
                        "git show",
                        "git diff",
                        "git blame",
                    ];
                    if (allowedTools.includes(tool)) {
                        return { behavior: "allow", updatedInput: input };
                    }
                    if (tool === "Bash") {
                        const cmd = input?.command || "";
                        if (allowedBashPrefixes.some((prefix) => cmd.startsWith(prefix))) {
                            return { behavior: "allow", updatedInput: input };
                        }
                        return {
                            behavior: "deny",
                            message: "Only git read commands allowed",
                        };
                    }
                    return {
                        behavior: "deny",
                        message: "Tool not allowed for inquisitor",
                    };
                },
                outputFormat: {
                    type: "json_schema",
                    schema: getInquisitorOutputJsonSchema(),
                },
            },
        });
        // Collect result
        for await (const event of session) {
            if (event.type === "result" && event.subtype === "success") {
                return {
                    entry,
                    output: event
                        .structured_output,
                    success: true,
                };
            }
            else if (event.type === "result" &&
                (event.subtype === "error_during_execution" ||
                    event.subtype === "error_max_turns" ||
                    event.subtype === "error_max_budget_usd" ||
                    event.subtype === "error_max_structured_output_retries")) {
                return {
                    entry,
                    error: event.error || event.subtype,
                    success: false,
                };
            }
        }
        return { entry, error: "No result received", success: false };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { entry, error: message, success: false };
    }
}
/**
 * Process a single inquisitor result - write review immediately if needed
 * Returns stats about what was done
 */
function processInquisitorResult(result) {
    if (!result.success) {
        logWarn(AGENT, `Inquisitor failed for ${result.entry.id}: ${result.error}`);
        return { autoFix: null, review: null };
    }
    const output = result.output;
    if (!output)
        return { autoFix: null, review: null };
    // Skip valid entries
    if (output.status === "valid") {
        logInfo(AGENT, `Entry ${output.entry_id} is valid`);
        return { autoFix: null, review: null };
    }
    // Process issues
    if (output.issue) {
        if (output.issue.severity === "auto_fix" && output.issue.suggested_fix) {
            // Write autofix as a review with auto_apply flag - Wellspring will apply without asking
            const review = {
                id: result.entry.id,
                subject: `${result.entry.topic} - auto-fix`,
                type: "auto_fix",
                question: output.issue.description, // Describes what's being fixed
                options: [], // No options for autofixes - one clear fix
                knowledge_file: `${result.entry.category}/${result.entry.file}`,
                agent_notes: output.issue.suggested_fix, // The fix to apply
                auto_apply: true, // Flag for Wellspring to apply without user interaction
            };
            writePendingReview(review);
            logInfo(AGENT, `Created auto-fix review: ${review.id} - ${review.subject}`);
            return { autoFix: true, review };
        }
        else if (output.issue.severity === "needs_review") {
            const review = {
                id: result.entry.id,
                subject: `${result.entry.topic} - ${output.status}`,
                type: output.status,
                question: output.issue.review_question || output.issue.description,
                context: `Category: ${result.entry.category}\nFile: ${result.entry.file}\n\nFindings: ${output.findings.current_behavior}\n\nLocation recommendation: ${output.location_context.scope} - ${output.location_context.reason}`,
                options: output.issue.review_options || [
                    "Keep current documentation",
                    "Update to match code",
                    "Remove this entry",
                ],
                knowledge_file: `${result.entry.category}/${result.entry.file}`,
            };
            // Write immediately - don't wait for other inquisitors
            writePendingReview(review);
            logInfo(AGENT, `Created pending review: ${review.id} - ${review.subject}`);
            return { autoFix: null, review };
        }
    }
    return { autoFix: null, review: null };
}
/**
 * Run inquisitors in parallel with concurrency limit
 * Writes reviews immediately as each completes (streaming, not batched)
 */
async function runInquisitorSwarm(entries) {
    // Filter out entries that already have pending reviews
    const entriesToProcess = entries.filter((entry) => {
        if (pendingReviewExists(entry.id)) {
            logInfo(AGENT, `Skipping ${entry.id} - pending review already exists`);
            return false;
        }
        return true;
    });
    if (entriesToProcess.length < entries.length) {
        logInfo(AGENT, `Filtered ${entries.length - entriesToProcess.length} entries with existing reviews`);
    }
    const stats = { successful: 0, failed: 0, autoFixes: 0, reviews: 0 };
    const pending = [...entriesToProcess];
    while (pending.length > 0) {
        // Start new inquisitors up to concurrency limit
        const batch = pending.splice(0, MAX_CONCURRENT_INQUISITORS);
        logInfo(AGENT, `Launching ${batch.length} inquisitors (${pending.length} remaining)`);
        // Run batch and process each result immediately as it completes
        const batchPromises = batch.map(async (entry) => {
            const result = await runInquisitor(entry);
            // Process and write immediately - don't wait for siblings
            const { autoFix, review } = processInquisitorResult(result);
            return { success: result.success, autoFix, review };
        });
        const batchResults = await Promise.all(batchPromises);
        // Update stats
        for (const result of batchResults) {
            if (result.success)
                stats.successful++;
            else
                stats.failed++;
            if (result.autoFix)
                stats.autoFixes++;
            if (result.review)
                stats.reviews++;
        }
    }
    return stats;
}
/**
 * Main function to run the analysis
 */
async function main() {
    // Acquire lock - exit early if another analysis is already running
    if (!acquireLock()) {
        return;
    }
    try {
        logInfo(AGENT, "Starting knowledge analysis (Inquisitor Swarm)");
        // Get current git HEAD
        const currentHead = getCurrentHead();
        if (!currentHead) {
            logError(AGENT, "Failed to get current git HEAD - not a git repository?");
            process.exit(1);
        }
        logInfo(AGENT, `Current HEAD: ${currentHead}`);
        try {
            // PHASE 1: Check existing pending reviews first
            const pendingReviews = getPendingReviews();
            if (pendingReviews.length > 0) {
                logInfo(AGENT, `Checking ${pendingReviews.length} existing pending reviews...`);
                const reviewChecks = await Promise.all(pendingReviews.map((review) => checkReviewRelevance(review)));
                let staleCount = 0;
                for (const check of reviewChecks) {
                    if (!check.stillRelevant) {
                        deletePendingReview(check.review._filename);
                        staleCount++;
                    }
                }
                if (staleCount > 0) {
                    logInfo(AGENT, `Cleaned up ${staleCount} stale reviews`);
                }
            }
            // PHASE 2: Investigate knowledge entries
            const entries = getAllKnowledgeEntries();
            if (entries.length === 0) {
                logInfo(AGENT, "No knowledge entries found to analyze");
                writeLastAnalysis({
                    timestamp: new Date().toISOString(),
                    commit_hash: currentHead,
                });
                return;
            }
            logInfo(AGENT, `Found ${entries.length} knowledge entries to investigate`);
            // Run inquisitor swarm - reviews are written immediately as each completes
            const stats = await runInquisitorSwarm(entries);
            logInfo(AGENT, `Inquisitor swarm complete: ${stats.successful}/${stats.successful + stats.failed} successful`);
            logInfo(AGENT, `Analysis complete: ${stats.autoFixes} auto-fixes, ${stats.reviews} new reviews`);
            // Update last analysis state
            writeLastAnalysis({
                timestamp: new Date().toISOString(),
                commit_hash: currentHead,
            });
            logInfo(AGENT, "Analysis state updated");
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logError(AGENT, `Analysis failed: ${message}`);
            process.exit(1);
        }
        logInfo(AGENT, "Analysis completed successfully");
    }
    finally {
        releaseLock();
    }
}
main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    logError(AGENT, `Unhandled error: ${message}`);
    process.exit(1);
});
//# sourceMappingURL=run-analysis.js.map