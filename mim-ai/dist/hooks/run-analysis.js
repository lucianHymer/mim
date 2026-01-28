#!/usr/bin/env node
/**
 * Run Analysis Hook for Mim
 *
 * Uses the Inquisitor pattern:
 * 1. Read all knowledge entries
 * 2. Process entries sequentially with Haiku inquisitors (one at a time, 5s delay)
 * 3. Each inquisitor investigates ONE entry against the codebase
 * 4. Auto-fixes applied inline; conflicts written as pending reviews
 * 5. Per-entry manifest tracks when each entry was last checked
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import { logInfo, logWarn, logError, AGENTS } from "../utils/logger.js";
import { writePendingReview, writeLastAnalysis, readEntryManifest, updateEntryStatus, } from "../agents/changes-reviewer.js";
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
// Delay between sequential inquisitor agents (ms)
const DELAY_BETWEEN_INQUISITORS_MS = 5000;
// Manifest throttle: skip entries checked within this window (ms)
const MANIFEST_THROTTLE_MS = 60 * 60 * 1000; // 1 hour
// Re-check entries after this long even if same commit (ms)
const MANIFEST_RECHECK_MS = 24 * 60 * 60 * 1000; // 24 hours
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
 * Apply an auto-fix inline by spawning a Haiku agent with edit tools
 * Returns true if the fix was applied successfully
 */
async function applyAutoFix(entry, suggestedFix, knowledgeFile) {
    const prompt = `Apply this fix to the knowledge file:

**Knowledge File:** .claude/knowledge/${knowledgeFile}
**Entry:** ${entry.topic} (${entry.id})

**Fix to apply:**
${suggestedFix}

Read the knowledge file, apply the fix described above, and save the file.
Be precise and minimal - only change what the fix describes.`;
    try {
        const session = query({
            prompt,
            options: {
                model: "haiku",
                pathToClaudeCodeExecutable: CLAUDE_EXECUTABLE,
                systemPrompt: "You are applying a small fix to a knowledge file. Be precise and minimal. Only change what is described in the fix.",
                canUseTool: async (tool, input) => {
                    const allowedTools = ["Read", "Edit", "Glob", "Grep"];
                    if (allowedTools.includes(tool)) {
                        return { behavior: "allow", updatedInput: input };
                    }
                    return { behavior: "deny", message: "Tool not allowed" };
                },
            },
        });
        for await (const event of session) {
            if (event.type === "result" && event.subtype === "success") {
                return true;
            }
            else if (event.type === "result") {
                logWarn(AGENT, `Auto-fix agent failed for ${entry.id}: ${event.subtype}`);
                return false;
            }
        }
        return false;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logWarn(AGENT, `Auto-fix agent error for ${entry.id}: ${message}`);
        return false;
    }
}
/**
 * Process a single inquisitor result - apply auto-fixes inline or write review
 * Returns stats about what was done
 */
async function processInquisitorResult(result, currentHead) {
    if (!result.success) {
        logWarn(AGENT, `Inquisitor failed for ${result.entry.id}: ${result.error}`);
        return { autoFixed: false, review: null };
    }
    const output = result.output;
    if (!output)
        return { autoFixed: false, review: null };
    // Skip valid entries
    if (output.status === "valid") {
        logInfo(AGENT, `Entry ${output.entry_id} is valid`);
        updateEntryStatus(result.entry.id, "ok", currentHead);
        return { autoFixed: false, review: null };
    }
    // Process issues
    if (output.issue) {
        if (output.issue.severity === "auto_fix" && output.issue.suggested_fix) {
            // Apply auto-fix inline via Haiku agent
            const knowledgeFile = `${result.entry.category}/${result.entry.file}`;
            logInfo(AGENT, `Applying auto-fix for ${result.entry.id}...`);
            const success = await applyAutoFix(result.entry, output.issue.suggested_fix, knowledgeFile);
            if (success) {
                updateEntryStatus(result.entry.id, "auto_fixed", currentHead);
                logInfo(AGENT, `Auto-fix applied: ${result.entry.id}`);
                return { autoFixed: true, review: null };
            }
            // Auto-fix failed - fall back to human review
            logWarn(AGENT, `Auto-fix failed for ${result.entry.id}, creating review instead`);
            const review = {
                id: result.entry.id,
                subject: `${result.entry.topic} - ${output.status}`,
                type: output.status,
                question: output.issue.description,
                context: `Category: ${result.entry.category}\nFile: ${result.entry.file}\n\nFindings: ${output.findings.current_behavior}\n\nAuto-fix was attempted but failed. Suggested fix: ${output.issue.suggested_fix}`,
                options: [
                    "Apply the suggested fix manually",
                    "Update to match code",
                    "Remove this entry",
                ],
                knowledge_file: knowledgeFile,
                agent_notes: output.issue.suggested_fix,
                created_at: new Date().toISOString(),
                created_at_commit: currentHead,
            };
            writePendingReview(review);
            updateEntryStatus(result.entry.id, "review_pending", currentHead);
            return { autoFixed: false, review };
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
                agent_notes: output.issue.review_agent_notes || '',
                created_at: new Date().toISOString(),
                created_at_commit: currentHead,
            };
            writePendingReview(review);
            updateEntryStatus(result.entry.id, "review_pending", currentHead);
            logInfo(AGENT, `Created pending review: ${review.id} - ${review.subject}`);
            return { autoFixed: false, review };
        }
    }
    return { autoFixed: false, review: null };
}
/**
 * Check if an entry should be skipped based on manifest throttling
 */
function shouldSkipEntry(entryId, manifest, currentHead) {
    const entry = manifest[entryId];
    if (!entry)
        return false; // Never checked - process it
    const checkedAt = new Date(entry.checkedAt).getTime();
    const now = Date.now();
    const age = now - checkedAt;
    // Same commit: skip unless older than 24h
    if (entry.commitHash === currentHead) {
        return age < MANIFEST_RECHECK_MS;
    }
    // Different commit: skip if checked within last hour
    return age < MANIFEST_THROTTLE_MS;
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * Run inquisitors sequentially with delay between each
 * Writes reviews immediately as each completes
 */
async function runInquisitorSwarm(entries, currentHead) {
    const manifest = readEntryManifest();
    // Filter out entries that already have pending reviews or are throttled by manifest
    const entriesToProcess = entries.filter((entry) => {
        if (pendingReviewExists(entry.id)) {
            logInfo(AGENT, `Skipping ${entry.id} - pending review already exists`);
            return false;
        }
        if (shouldSkipEntry(entry.id, manifest, currentHead)) {
            logInfo(AGENT, `Skipping ${entry.id} - recently checked (manifest throttle)`);
            return false;
        }
        return true;
    });
    if (entriesToProcess.length < entries.length) {
        logInfo(AGENT, `Filtered ${entries.length - entriesToProcess.length} entries (pending reviews or manifest throttle)`);
    }
    const stats = { successful: 0, failed: 0, autoFixes: 0, reviews: 0 };
    for (let i = 0; i < entriesToProcess.length; i++) {
        const entry = entriesToProcess[i];
        logInfo(AGENT, `Processing entry ${i + 1}/${entriesToProcess.length}: ${entry.id}`);
        const result = await runInquisitor(entry);
        const { autoFixed, review } = await processInquisitorResult(result, currentHead);
        if (result.success)
            stats.successful++;
        else
            stats.failed++;
        if (autoFixed)
            stats.autoFixes++;
        if (review)
            stats.reviews++;
        // Delay between entries (skip delay after the last one)
        if (i < entriesToProcess.length - 1) {
            logInfo(AGENT, `Waiting ${DELAY_BETWEEN_INQUISITORS_MS / 1000}s before next entry...`);
            await sleep(DELAY_BETWEEN_INQUISITORS_MS);
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
            // Investigate knowledge entries
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
            const stats = await runInquisitorSwarm(entries, currentHead);
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