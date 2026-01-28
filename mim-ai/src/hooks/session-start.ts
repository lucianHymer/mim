#!/usr/bin/env node

/**
 * Session Start Hook for Mim
 *
 * Ensures knowledge structure exists and checks if analysis is needed.
 */

import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { checkMimActivation } from "../utils/mim-check.js";

const KNOWLEDGE_DIR = ".claude/knowledge";
const PENDING_DIR = path.join(KNOWLEDGE_DIR, "pending-review");

interface HookResult {
  continue: boolean;
  systemMessage?: string;
}

interface ReviewFile {
  answer?: string;
}

function runMimInit(): void {
  try {
    // Run mim init silently - it's idempotent
    execSync("mim init", { stdio: "pipe", encoding: "utf-8" });
  } catch {
    // mim command might not be in PATH, try via npx or direct
    try {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const mimBin = path.join(__dirname, "..", "..", "bin", "mim.js");
      execSync(`node ${mimBin} init`, { stdio: "pipe", encoding: "utf-8" });
    } catch {
      // Silently fail - structure may already exist
    }
  }
}

function spawnBackgroundAnalysis(): void {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  // Use bundled ESM version - it includes all npm dependencies and preserves import.meta.url
  // Note: When bundled, this file will be in hooks/ not dist/hooks/, so we look for sibling file
  const analysisScript = path.join(__dirname, "run-analysis.bundled.mjs");

  // Spawn detached so it doesn't block the session
  const child = spawn("node", [analysisScript], {
    detached: true,
    stdio: "ignore",
    cwd: process.cwd(),
  });

  child.unref(); // Allow parent to exit independently
}

function getCurrentHead(): string | null {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

function countPendingReviews(): number {
  try {
    const dir = path.join(process.cwd(), PENDING_DIR);
    if (!fs.existsSync(dir)) return 0;

    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    let count = 0;
    for (const file of files) {
      const content = fs.readFileSync(path.join(dir, file), "utf-8");
      const review = JSON.parse(content) as ReviewFile;
      if (!review.answer) count++;
    }
    return count;
  } catch {
    return 0;
  }
}

/**
 * Output hook result as JSON to stdout
 * Claude Code hooks communicate via structured JSON, not plain text
 */
function outputResult(message: string | null): void {
  const result: HookResult = {
    continue: true,
  };
  if (message) {
    result.systemMessage = message;
  }
  console.log(JSON.stringify(result));
}

async function main(): Promise<void> {
  const currentHead = getCurrentHead();
  if (!currentHead) {
    // Not a git repo, skip silently
    outputResult(null);
    return;
  }

  // Ensure knowledge structure exists (idempotent)
  runMimInit();

  const pendingCount = countPendingReviews();
  const messages: string[] = [];

  // Check if Mím CLI is installed before spawning background analysis
  const activation = checkMimActivation(process.cwd());

  if (activation.activated) {
    // Spawn background analysis - the lock in run-analysis.ts prevents concurrent runs,
    // and the per-entry manifest handles throttling individual entries
    messages.push("📜 Mím is analyzing in the background...");
    spawnBackgroundAnalysis();
  }

  if (pendingCount > 0) {
    messages.push("");
    messages.push(
      `🗣️ ${pendingCount} pending review${pendingCount > 1 ? "s" : ""} await your decision.`
    );
    messages.push('   Exit and run "npx mim review" to begin.');
  }

  outputResult(messages.join("\n"));
}

main().catch(() => {
  // On error, still output valid JSON so hook doesn't break
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
});
