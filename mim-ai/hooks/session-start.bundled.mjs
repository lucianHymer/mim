#!/usr/bin/env node
// Bundled Session Start Hook for Mim
// Built with esbuild - all dependencies included


// dist/hooks/session-start.js
import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
var KNOWLEDGE_DIR = ".claude/knowledge";
var PENDING_DIR = path.join(KNOWLEDGE_DIR, "pending-review");
function runMimInit() {
  try {
    execSync("mim init", { stdio: "pipe", encoding: "utf-8" });
  } catch {
    try {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const mimBin = path.join(__dirname, "..", "..", "bin", "mim.js");
      execSync(`node ${mimBin} init`, { stdio: "pipe", encoding: "utf-8" });
    } catch {
    }
  }
}
function spawnBackgroundAnalysis() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const analysisScript = path.join(__dirname, "run-analysis.bundled.mjs");
  const child = spawn("node", [analysisScript], {
    detached: true,
    stdio: "ignore",
    cwd: process.cwd()
  });
  child.unref();
}
function getCurrentHead() {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}
function countPendingReviews() {
  try {
    const dir = path.join(process.cwd(), PENDING_DIR);
    if (!fs.existsSync(dir))
      return 0;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    let count = 0;
    for (const file of files) {
      const content = fs.readFileSync(path.join(dir, file), "utf-8");
      const review = JSON.parse(content);
      if (!review.answer)
        count++;
    }
    return count;
  } catch {
    return 0;
  }
}
function outputResult(message) {
  const result = {
    continue: true
  };
  if (message) {
    result.systemMessage = message;
  }
  console.log(JSON.stringify(result));
}
async function main() {
  const currentHead = getCurrentHead();
  if (!currentHead) {
    outputResult(null);
    return;
  }
  runMimInit();
  const pendingCount = countPendingReviews();
  const messages = [];
  messages.push("\u{1F4DC} M\xEDm is analyzing in the background...");
  spawnBackgroundAnalysis();
  if (pendingCount > 0) {
    messages.push("");
    messages.push(`\u{1F5E3}\uFE0F ${pendingCount} pending review${pendingCount > 1 ? "s" : ""} await your decision.`);
    messages.push('   Exit and run "npx mim review" to begin.');
  }
  outputResult(messages.join("\n"));
}
main().catch(() => {
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
});
