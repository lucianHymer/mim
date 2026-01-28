/**
 * Utilities for checking Mím installation status
 * Used to gate expensive background processing (Opus agents)
 */
/**
 * Check if mim-ai CLI is installed globally via npm
 * This indicates the user has "bought in" to the full Mím experience
 */
export declare function isMimCliInstalled(): boolean;
/**
 * Check if Mím is activated for background processing.
 *
 * Activation is based on CLI install only - if the user has installed
 * `npm install -g mim-ai`, they've "bought in" to using Mím.
 *
 * The plugin auto-inits the repo structure via SessionStart hook,
 * so we don't require separate repo configuration.
 *
 * Returns object with status and message for logging
 */
export declare function checkMimActivation(_projectRoot: string): {
    activated: boolean;
    cliInstalled: boolean;
    message: string;
};
//# sourceMappingURL=mim-check.d.ts.map