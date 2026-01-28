/**
 * Utilities for checking Mím installation status
 * Used to gate expensive background processing (Opus agents)
 */
import { execSync } from 'child_process';
/**
 * Check if mim-ai CLI is installed globally via npm
 * This indicates the user has "bought in" to the full Mím experience
 */
export function isMimCliInstalled() {
    try {
        // Check if 'mim' command exists in PATH
        execSync('which mim', { stdio: 'ignore' });
        return true;
    }
    catch {
        return false;
    }
}
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
export function checkMimActivation(_projectRoot) {
    const cliInstalled = isMimCliInstalled();
    const activated = cliInstalled;
    let message;
    if (activated) {
        message = 'Mím activated - background processing enabled';
    }
    else {
        message = 'Mím CLI not installed. Run "npm install -g mim-ai" to enable background processing (contributes to some Opus usage)';
    }
    return { activated, cliInstalled, message };
}
//# sourceMappingURL=mim-check.js.map