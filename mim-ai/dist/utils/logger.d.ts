/**
 * Centralized logging system for Mim
 * Logs to .claude/knowledge/mim.log
 */
/**
 * Agent name constants for consistent logging
 */
export declare const AGENTS: {
    readonly QUEUE_PROCESSOR: "QUEUE_PROCESSOR";
    readonly CHANGES_REVIEWER: "CHANGES_REVIEWER";
    readonly WELLSPRING: "WELLSPRING";
    readonly CLI: "CLI";
    readonly TUI: "TUI";
    readonly MCP_SERVER: "MCP_SERVER";
};
export type AgentName = (typeof AGENTS)[keyof typeof AGENTS];
/**
 * Log an INFO level message
 */
export declare function logInfo(agent: string, msg: string): void;
/**
 * Log a WARN level message
 */
export declare function logWarn(agent: string, msg: string): void;
/**
 * Log an ERROR level message
 */
export declare function logError(agent: string, msg: string): void;
//# sourceMappingURL=logger.d.ts.map