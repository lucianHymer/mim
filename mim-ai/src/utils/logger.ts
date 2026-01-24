/**
 * Centralized logging system for Mim
 * Logs to .claude/knowledge/mim.log
 */

import * as fs from "fs";
import * as path from "path";

/**
 * Agent name constants for consistent logging
 */
export const AGENTS = {
  QUEUE_PROCESSOR: "QUEUE_PROCESSOR",
  CHANGES_REVIEWER: "CHANGES_REVIEWER",
  WELLSPRING: "WELLSPRING",
  CLI: "CLI",
  TUI: "TUI",
  MCP_SERVER: "MCP_SERVER",
} as const;

export type AgentName = (typeof AGENTS)[keyof typeof AGENTS];

type LogLevel = "INFO" | "WARN" | "ERROR";

/**
 * Find project root by looking for .claude/knowledge/ directory
 * Walks up from current working directory
 */
function findProjectRoot(): string | null {
  let currentDir = process.cwd();
  const root = path.parse(currentDir).root;

  while (currentDir !== root) {
    const knowledgeDir = path.join(currentDir, ".claude", "knowledge");
    if (fs.existsSync(knowledgeDir)) {
      return currentDir;
    }
    currentDir = path.dirname(currentDir);
  }

  // Check root as well
  const rootKnowledgeDir = path.join(root, ".claude", "knowledge");
  if (fs.existsSync(rootKnowledgeDir)) {
    return root;
  }

  return null;
}

/**
 * Get the log file path, ensuring directory exists
 */
function getLogFilePath(): string | null {
  const projectRoot = findProjectRoot();
  if (!projectRoot) {
    return null;
  }

  const knowledgeDir = path.join(projectRoot, ".claude", "knowledge");

  // Ensure directory exists
  try {
    if (!fs.existsSync(knowledgeDir)) {
      fs.mkdirSync(knowledgeDir, { recursive: true });
    }
  } catch {
    return null;
  }

  return path.join(knowledgeDir, "mim.log");
}

/**
 * Write a log entry to the log file
 */
function writeLog(level: LogLevel, agent: string, message: string): void {
  try {
    const logFilePath = getLogFilePath();
    if (!logFilePath) {
      return;
    }

    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${agent}] [${level}] ${message}\n`;

    fs.appendFileSync(logFilePath, logEntry, "utf-8");
  } catch {
    // Fail silently - don't crash if we can't write to log
  }
}

/**
 * Log an INFO level message
 */
export function logInfo(agent: string, msg: string): void {
  writeLog("INFO", agent, msg);
}

/**
 * Log a WARN level message
 */
export function logWarn(agent: string, msg: string): void {
  writeLog("WARN", agent, msg);
}

/**
 * Log an ERROR level message
 */
export function logError(agent: string, msg: string): void {
  writeLog("ERROR", agent, msg);
}
