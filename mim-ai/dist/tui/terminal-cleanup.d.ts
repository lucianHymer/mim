/**
 * Shared terminal cleanup utilities
 *
 * Provides consistent cleanup functions for all terminal-kit based screens
 * to properly restore terminal state.
 */
/**
 * Reset terminal state for screen transitions.
 *
 * Use this when transitioning between screens.
 */
export declare function cleanupTerminal(): void;
/**
 * Full cleanup for app exit.
 *
 * Use this when actually exiting the application.
 * Resets terminal state.
 */
export declare function exitTerminal(): void;
//# sourceMappingURL=terminal-cleanup.d.ts.map