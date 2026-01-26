/**
 * Title Screen for Mím
 *
 * Displays a gradient ASCII art logo with a diagonal color flow
 * from bright white through pinks and purples to deep violet.
 */

import termKit from 'terminal-kit';

// ============================================================================
// Color Palette (256-color ANSI) - White to Purple gradient
// ============================================================================

const MIM_COLORS = [
  '\x1b[1;38;5;219m', // Line 1: Light pink (bold)
  '\x1b[1;38;5;213m', // Line 2: Pink (bold)
  '\x1b[1;38;5;177m', // Line 3: Light magenta (bold)
  '\x1b[1;38;5;141m', // Line 4: Lavender (bold)
  '\x1b[1;38;5;135m', // Line 5: Medium purple (bold)
  '\x1b[1;38;5;99m',  // Line 6: Purple (bold)
  '\x1b[1;38;5;93m',  // Line 7: Deep purple (bold)
  '\x1b[1;38;5;57m',  // Line 8: Dark violet (bold)
  '\x1b[1;38;5;54m',  // Line 9: Deep violet (bold)
];

const RESET = '\x1b[0m';

// ============================================================================
// ASCII Art Logo
// ============================================================================

const TITLE_ART = [
  '                                                                                                      ',
  '        ___________          ____________         ___________          ____________ ___________       ',
  '       /           \\        /            \\       /           \\        /            \\\\          \\      ',
  '      /    _   _    \\      |\\___/\\  \\\\___/|     /    _   _    \\      |\\___/\\  \\\\___/|\\    /\\    \\     ',
  '     /    //   \\\\    \\      \\|____\\  \\___|/    /    //   \\\\    \\      \\|____\\  \\___|/ |   \\_\\    |    ',
  '    /    //     \\\\    \\           |  |        /    //     \\\\    \\           |  |      |      ___/     ',
  '   /     \\\\_____//     \\     __  /   / __    /     \\\\_____//     \\     __  /   / __   |      \\  ____  ',
  '  /       \\ ___ /       \\   /  \\/   /_/  |  /       \\ ___ /       \\   /  \\/   /_/  | /     /\\ \\/    \\ ',
  ' /________/|   |\\________\\ |____________/| /________/|   |\\________\\ |____________/|/_____/ |\\______| ',
  '|        | |   | |        ||           | /|        | |   | |        ||           | /|     | | |     | ',
  '|________|/     \\|________||___________|/ |________|/     \\|________||___________|/ |_____|/ \\|_____| ',
  '                                                                                                      ',
];

// ============================================================================
// Gradient Rendering
// ============================================================================

/**
 * Apply diagonal gradient to the ASCII art
 * Uses a weighted diagonal calculation for a ~25 degree slant effect
 */
function renderGradientArt(): string {
  const rowWeight = 4; // Weight for row contribution to diagonal
  const maxDiagonal = TITLE_ART.length * rowWeight + (TITLE_ART[0]?.length || 0);

  let output = '';

  for (let row = 0; row < TITLE_ART.length; row++) {
    const line = TITLE_ART[row];
    let renderedLine = '';
    let lastColorIdx = -1;

    for (let col = 0; col < line.length; col++) {
      const char = line[col];

      // Skip spaces - just append them
      if (char === ' ') {
        renderedLine += char;
        continue;
      }

      // Calculate diagonal position for gradient
      const diagonal = row * rowWeight + col;
      const colorIdx = Math.min(
        Math.floor((diagonal / maxDiagonal) * MIM_COLORS.length),
        MIM_COLORS.length - 1,
      );

      // Only add color code when it changes (optimization)
      if (colorIdx !== lastColorIdx) {
        renderedLine += MIM_COLORS[colorIdx];
        lastColorIdx = colorIdx;
      }

      renderedLine += char;
    }

    output += renderedLine + RESET + '\n';
  }

  return output;
}

/**
 * Get terminal dimensions safely
 */
function getTerminalSize(): { width: number; height: number } {
  const term = termKit.terminal;
  let width = 120;
  let height = 30;

  if (typeof term.width === 'number' && Number.isFinite(term.width) && term.width > 0) {
    width = term.width;
  }
  if (typeof term.height === 'number' && Number.isFinite(term.height) && term.height > 0) {
    height = term.height;
  }

  return { width, height };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Display the title screen with gradient logo
 * Used for both CLI startup and TUI game intro
 */
export function showTitleScreen(): void {
  const { width, height } = getTerminalSize();
  const artWidth = TITLE_ART[0]?.length || 0;
  const artHeight = TITLE_ART.length;

  // Calculate centering
  const startX = Math.max(0, Math.floor((width - artWidth) / 2));
  const startY = Math.max(0, Math.floor((height - artHeight - 4) / 2));

  // Build output with positioning
  const gradientArt = renderGradientArt();
  const lines = gradientArt.split('\n');

  // Move cursor and print each line centered
  for (let i = 0; i < lines.length; i++) {
    const padding = ' '.repeat(startX);
    process.stdout.write(`\x1b[${startY + i + 1};1H${padding}${lines[i]}`);
  }

  // Add tagline below
  const tagline = 'Persistent Memory for Claude Code';
  const taglineX = Math.max(0, Math.floor((width - tagline.length) / 2));
  process.stdout.write(`\x1b[${startY + artHeight + 2};1H`);
  process.stdout.write(' '.repeat(taglineX));
  process.stdout.write(`\x1b[38;5;141m${tagline}${RESET}`);
}

/**
 * Print the title screen for CLI output (simpler, no positioning)
 * Just prints the gradient art to stdout
 */
export function printTitleArt(): void {
  const gradientArt = renderGradientArt();
  process.stdout.write(gradientArt);
}

/**
 * Get the gradient-rendered title as a string
 */
export function getTitleArt(): string {
  return renderGradientArt();
}
