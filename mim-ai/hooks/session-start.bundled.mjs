#!/usr/bin/env node
// Bundled Session Start Hook for Mim
// Built with esbuild - all dependencies included


// dist/hooks/session-start.js
import { execSync as execSync2, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

// dist/utils/mim-check.js
import { execSync } from "child_process";
function isMimCliInstalled() {
  try {
    execSync("which mim", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
function checkMimActivation(_projectRoot) {
  const cliInstalled = isMimCliInstalled();
  const activated = cliInstalled;
  let message;
  if (activated) {
    message = "M\xEDm activated - background processing enabled";
  } else {
    message = 'M\xEDm CLI not installed. Run "npm install -g mim-ai" to enable background processing (contributes to some Opus usage)';
  }
  return { activated, cliInstalled, message };
}

// dist/hooks/session-start.js
var KNOWLEDGE_DIR = ".claude/knowledge";
var PENDING_DIR = path.join(KNOWLEDGE_DIR, "pending-review");
function runMimInit() {
  try {
    execSync2("mim init", { stdio: "pipe", encoding: "utf-8" });
  } catch {
    try {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const mimBin = path.join(__dirname, "..", "..", "bin", "mim.js");
      execSync2(`node ${mimBin} init`, { stdio: "pipe", encoding: "utf-8" });
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
    return execSync2("git rev-parse HEAD", { encoding: "utf-8" }).trim();
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
  const activation = checkMimActivation(process.cwd());
  if (activation.activated) {
    messages.push("\u{1F4DC} M\xEDm is analyzing in the background...");
    spawnBackgroundAnalysis();
  }
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
