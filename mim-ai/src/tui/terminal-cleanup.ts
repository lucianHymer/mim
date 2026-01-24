/**
 * Shared terminal cleanup utilities
 *
 * Provides consistent cleanup functions for all terminal-kit based screens
 * to properly restore terminal state.
 */

import termKit from 'terminal-kit';

const term = termKit.terminal;

/**
 * Reset terminal state for screen transitions.
 *
 * Use this when transitioning between screens.
 */
export function cleanupTerminal(): void {
  term.clear();
  term.grabInput(false);
  term.fullscreen(false);
  term.styleReset();

  if (process.stdin.isTTY && process.stdin.setRawMode) {
    process.stdin.setRawMode(false);
  }

  process.stdout.write('\x1b[?25h'); // Show cursor
  process.stdout.write('\x1b[2J'); // Clear entire screen
  process.stdout.write('\x1b[H'); // Move cursor to home position
}

/**
 * Full cleanup for app exit.
 *
 * Use this when actually exiting the application.
 * Resets terminal state.
 */
export function exitTerminal(): void {
  cleanupTerminal();
}
