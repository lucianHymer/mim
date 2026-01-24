/**
 * Type declarations for terminal-kit
 *
 * This provides minimal type definitions needed for Mim's usage.
 * For full type coverage, consider using @types/terminal-kit if available.
 */

declare module 'terminal-kit' {
  interface Terminal {
    clear(): Terminal;
    grabInput(enabled: boolean): Terminal;
    fullscreen(enabled: boolean): Terminal;
    styleReset(): Terminal;
    moveTo(x: number, y: number): Terminal;
    on(event: string, handler: (...args: unknown[]) => void): Terminal;
    off(event: string, handler: (...args: unknown[]) => void): Terminal;
    processExit(code: number): void;
    hideCursor(): Terminal;
    bold: Terminal;
    cyan: Terminal;
    brightCyan: Terminal;
    white: Terminal;
    green: Terminal;
    red: Terminal;
    yellow: Terminal;
    gray: Terminal;
    dim: Terminal;
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
