/**
 * Type declarations for terminal-kit
 *
 * This provides minimal type definitions needed for Mim's usage.
 * For full type coverage, consider using @types/terminal-kit if available.
 */

declare module 'terminal-kit' {
  interface GrabInputOptions {
    mouse?: 'button' | 'motion' | 'drag' | boolean;
    focus?: boolean;
  }

  interface Terminal {
    clear(): Terminal;
    grabInput(options: boolean | GrabInputOptions): Terminal;
    fullscreen(enabled: boolean): Terminal;
    styleReset(): Terminal;
    moveTo(x: number, y: number): Terminal;
    on(event: 'key', handler: (key: string, matches: string[], data: unknown) => void): Terminal;
    on(event: 'resize', handler: (width: number, height: number) => void): Terminal;
    on(event: string, handler: (...args: unknown[]) => void): Terminal;
    off(event: string, handler: (...args: unknown[]) => void): Terminal;
    removeAllListeners(event?: string): Terminal;
    processExit(code: number): void;
    hideCursor(): Terminal;
    showCursor(): Terminal;
    bold: Terminal;
    cyan: Terminal;
    brightCyan: Terminal;
    white: Terminal;
    green: Terminal;
    red: Terminal;
    yellow: Terminal;
    gray: Terminal;
    dim: Terminal;
    blue: Terminal;
    bgWhite: Terminal;
    black: Terminal;
    (text: string): Terminal;
    width: number;
    height: number;
  }

  interface TermKit {
    terminal: Terminal;
  }

  const termKit: TermKit;
  export default termKit;
}
