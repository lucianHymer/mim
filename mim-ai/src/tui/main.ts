/**
 * Main TUI game loop for Mim-AI
 *
 * Implements a state machine with three screens:
 * 1. CHARACTER_SELECT - Player chooses their avatar
 * 2. BRIDGE_GUARDIAN - Questions are answered to pass the bridge
 * 3. WELLSPRING - Watch the Wellspring agent apply decisions
 *
 * Uses terminal-kit with Strategy 5 (minimal redraws) for flicker-free rendering.
 */

import termKit from 'terminal-kit';
import fs from 'node:fs';
import path from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { logInfo, logWarn, logError, AGENTS } from '../utils/logger.js';
import {
  WELLSPRING_SYSTEM_PROMPT,
  getWellspringOutputJsonSchema,
  loadAnsweredReviews,
  deleteReviewFile,
  type AnsweredReview
} from '../agents/wellspring-agent.js';
import {
  getAllSprites,
  hasActiveAnimations,
  registerSprite,
  startAnimationLoop,
  stopAnimationLoop,
  unregisterSprite,
} from './animation-loop.js';
import {
  createBridgeGuardianScene,
  createScene,
  createWellspringScene,
  renderScene,
  SCENE_HEIGHT,
  SCENE_WIDTH,
  type SceneType,
} from './scene.js';
import { Sprite } from './sprite.js';
import { cleanupTerminal, exitTerminal } from './terminal-cleanup.js';
import {
  CHAR_HEIGHT,
  compositeTiles,
  compositeWithFocus,
  extractTile,
  loadTileset,
  RESET,
  renderTile,
  TILE,
  TILE_SIZE,
  type Tileset,
} from './tileset.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Pending review item for the Bridge Guardian to ask about
 */
interface PendingReview {
  id: string;
  subject: string;
  type: 'stale' | 'conflict' | 'outdated';
  question: string;
  context: string;
  options: string[];
  knowledge_file: string;
  answer?: string;
}

const PENDING_REVIEW_DIR = '.claude/knowledge/pending-review';

/**
 * Game screens representing the state machine states
 */
export type GameScreen = 'CHARACTER_SELECT' | 'BRIDGE_GUARDIAN' | 'WELLSPRING';

/**
 * Game state containing all relevant data
 */
interface GameState {
  /** Current screen in the game flow */
  currentScreen: GameScreen;

  /** Loaded tileset data */
  tileset: Tileset | null;

  /** Selected character tile index */
  selectedCharacter: number;

  /** Character selection index (0-7) */
  characterIndex: number;

  /** Animation frame counter */
  animationFrame: number;

  /** Blink cycle counter for slower animations */
  blinkCycle: number;

  /** Whether exit is pending confirmation */
  pendingExit: boolean;

  /** Whether drawing is enabled */
  drawingEnabled: boolean;

  /** Last selection index for change detection */
  lastSelectionIndex: number;

  /** Messages to display in chat panel */
  messages: Array<{ speaker: string; text: string }>;

  /** Whether the guardian has been answered */
  guardianAnswered: boolean;

  /** Agent 3 session state */
  wellspringSessionId: string | null;
  /** Whether agent is processing */
  agentProcessing: boolean;
  /** Whether agent is done */
  agentDone: boolean;

  /** Whether in text input mode for "Other" answer */
  textInputMode: boolean;
  /** Current text input value */
  textInputValue: string;
}

/**
 * Redraw tracker for minimal redraws (Strategy 5)
 */
interface RedrawTracker {
  lastTileFrame: number;
  lastMessageCount: number;
  lastScreen: GameScreen;
}

/**
 * Callbacks for game events
 */
interface GameCallbacks {
  /** Called when game completes successfully */
  onComplete?: () => void;

  /** Called when game is exited early */
  onExit?: () => void;

  /** Called when a question needs to be answered in Bridge Guardian */
  onQuestion?: (questionId: string) => void;

  /** Called when Bridge Guardian is complete */
  onBridgeCrossed?: () => void;

  /** Called when Wellspring agent should start */
  onWellspringStart?: () => void;

  /** Called when character is selected */
  onCharacterSelected?: (characterTile: number) => void;
}

// ============================================================================
// Constants
// ============================================================================

const term = termKit.terminal;

// Character selection constants
const CHARACTER_TILES = [
  TILE.HUMAN_1,
  TILE.HUMAN_2,
  TILE.HUMAN_3,
  TILE.HUMAN_4,
  TILE.HUMAN_5,
  TILE.HUMAN_6,
  TILE.HUMAN_7,
  TILE.HUMAN_8,
];

const CHARACTER_NAMES = [
  'Adventurer',
  'Rogue',
  'Ranger',
  'Swordsman',
  'Dwarf',
  'Knight',
  'Shadow',
  'Wizard',
];

// Layout constants
const TILE_SPACING = 2;
const TILE_DISPLAY_WIDTH = TILE_SIZE;
const TILE_AREA_WIDTH = SCENE_WIDTH * TILE_SIZE;
const TILE_AREA_HEIGHT = SCENE_HEIGHT * CHAR_HEIGHT;

// Animation interval in milliseconds
const ANIMATION_INTERVAL = 250;

// Full draw debounce (prevents signal storm on resume/resize)
const FULL_DRAW_DEBOUNCE_MS = 50;

// Colors
const COLORS = {
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  italic: '\x1b[3m',
  reset: '\x1b[0m',
};

// Filler row cache for grass/trees above and below the scene
const fillerRowCache: Map<string, string[]> = new Map();

// ============================================================================
// Character Selection Rendering
// ============================================================================

/**
 * Render all character tiles as an array of ANSI strings
 */
function renderCharacterRow(tileset: Tileset, selectedIndex: number): string[] {
  const focusTile = extractTile(tileset, TILE.FOCUS);
  const grassTile = extractTile(tileset, TILE.GRASS);

  const renderedTiles: string[][] = [];
  for (let i = 0; i < CHARACTER_TILES.length; i++) {
    let charPixels = extractTile(tileset, CHARACTER_TILES[i]);
    charPixels = compositeTiles(charPixels, grassTile, 1);

    if (i === selectedIndex) {
      charPixels = compositeWithFocus(charPixels, focusTile);
    }

    renderedTiles.push(renderTile(charPixels));
  }

  const spacing = ' '.repeat(TILE_SPACING);
  const lines: string[] = [];

  for (let row = 0; row < CHAR_HEIGHT; row++) {
    let line = '';
    for (let charIdx = 0; charIdx < renderedTiles.length; charIdx++) {
      line += renderedTiles[charIdx][row];
      if (charIdx < renderedTiles.length - 1) {
        line += spacing;
      }
    }
    lines.push(line);
  }

  return lines;
}

/**
 * Calculate total width of the character row
 */
function getCharacterRowWidth(): number {
  return CHARACTER_TILES.length * TILE_DISPLAY_WIDTH + (CHARACTER_TILES.length - 1) * TILE_SPACING;
}

/**
 * Get or create a cached filler row (grass with occasional trees)
 * Creates a natural-looking forest edge above/below the main scene
 */
function getFillerRow(tileset: Tileset, rowIndex: number): string[] {
  const cacheKey = `filler-${rowIndex}`;
  const cached = fillerRowCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const grassPixels = extractTile(tileset, TILE.GRASS);
  const rowLines: string[] = [];

  // Build one row of tiles (SCENE_WIDTH tiles wide)
  for (let charRow = 0; charRow < CHAR_HEIGHT; charRow++) {
    let line = '';
    for (let col = 0; col < SCENE_WIDTH; col++) {
      // Deterministic pattern for variety: mostly grass, some trees
      const pattern = (rowIndex * 7 + col * 13) % 20;
      let tileIndex: number;
      if (pattern < 2) {
        tileIndex = TILE.PINE_TREE;
      } else if (pattern < 4) {
        tileIndex = TILE.BARE_TREE;
      } else if (pattern < 7) {
        tileIndex = TILE.GRASS_SPARSE;
      } else {
        tileIndex = TILE.GRASS;
      }

      // Extract and render tile
      let pixels = extractTile(tileset, tileIndex);
      if (tileIndex >= 80) {
        pixels = compositeTiles(pixels, grassPixels, 1);
      }
      const rendered = renderTile(pixels);
      line += rendered[charRow];
    }
    rowLines.push(line);
  }

  fillerRowCache.set(cacheKey, rowLines);
  return rowLines;
}

// ============================================================================
// Layout Calculations
// ============================================================================

/**
 * Get terminal layout information
 */
function getLayout() {
  let width = 180;
  let height = 50;

  if (typeof term.width === 'number' && Number.isFinite(term.width) && term.width > 0) {
    width = term.width;
  }
  if (typeof term.height === 'number' && Number.isFinite(term.height) && term.height > 0) {
    height = term.height;
  }

  // Tile scene - vertically centered
  const tileAreaX = 1;
  const tileAreaY = Math.max(1, Math.floor((height - TILE_AREA_HEIGHT) / 2));

  // Chat/info area to the right
  const chatAreaX = TILE_AREA_WIDTH + 3;
  const chatAreaWidth = Math.max(40, width - chatAreaX - 1);

  return {
    width,
    height,
    tileArea: {
      x: tileAreaX,
      y: tileAreaY,
      width: TILE_AREA_WIDTH,
      height: TILE_AREA_HEIGHT,
    },
    chatArea: {
      x: chatAreaX,
      y: 1,
      width: chatAreaWidth,
      height: height - 2,
    },
  };
}

// ============================================================================
// Main Game Class
// ============================================================================

/**
 * Main game controller managing the TUI and game flow
 */
class MimGame {
  private state: GameState;
  private tracker: RedrawTracker;
  private callbacks: GameCallbacks;
  private animationInterval: NodeJS.Timeout | null = null;
  private isRunning = false;
  private lastFullDrawTime = 0;

  // Sprites for Bridge Guardian and Wellspring scenes
  private humanSprite: Sprite | null = null;
  private guardianSprite: Sprite | null = null;
  private mimSprite: Sprite | null = null;
  private odinSprite: Sprite | null = null;

  // Pending review state
  private pendingReviews: PendingReview[] = [];
  private currentReviewIndex: number = 0;

  constructor(callbacks: GameCallbacks = {}) {
    this.callbacks = callbacks;
    this.state = {
      currentScreen: 'CHARACTER_SELECT',
      tileset: null,
      selectedCharacter: TILE.HUMAN_1,
      characterIndex: 0,
      animationFrame: 0,
      blinkCycle: 0,
      pendingExit: false,
      drawingEnabled: true,
      lastSelectionIndex: -1,
      messages: [],
      guardianAnswered: false,
      wellspringSessionId: null,
      agentProcessing: false,
      agentDone: false,
      textInputMode: false,
      textInputValue: '',
    };
    this.tracker = {
      lastTileFrame: -1,
      lastMessageCount: -1,
      lastScreen: 'CHARACTER_SELECT',
    };
  }

  /**
   * Start the game
   */
  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    // Remove existing signal handlers
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGCONT');
    process.removeAllListeners('SIGWINCH');
    process.removeAllListeners('SIGHUP');

    // Set up SIGINT handler (Ctrl+C)
    process.on('SIGINT', () => {
      if (!this.state.pendingExit) {
        this.state.pendingExit = true;
        this.fullDraw();
      }
    });

    // Handle SIGCONT (resume after suspend or dtach reattach)
    process.on('SIGCONT', () => {
      // Toggle raw mode off/on to reset termios
      if (process.stdin.isTTY && process.stdin.setRawMode) {
        process.stdin.setRawMode(false);
        process.stdin.setRawMode(true);
      }
      term.grabInput(true);
      term.fullscreen(true);
      term.hideCursor();
      this.state.drawingEnabled = true;
      this.fullDraw();
    });

    // Handle terminal resize (SIGWINCH)
    process.on('SIGWINCH', () => {
      if (process.stdin.isTTY && process.stdin.setRawMode) {
        process.stdin.setRawMode(false);
        process.stdin.setRawMode(true);
      }
      term.grabInput(true);
      this.fullDraw();
    });

    // Handle SIGHUP (dtach reattach may send this)
    process.on('SIGHUP', () => {
      if (process.stdin.isTTY && process.stdin.setRawMode) {
        process.stdin.setRawMode(false);
        process.stdin.setRawMode(true);
      }
      term.grabInput(true);
      this.fullDraw();
    });

    // Load tileset
    try {
      this.state.tileset = await loadTileset();
    } catch (err) {
      console.error('Failed to load tileset:', err);
      throw err;
    }

    // Enter fullscreen mode
    term.fullscreen(true);
    term.hideCursor();
    term.grabInput(true);

    // Initial draw
    this.fullDraw();

    // Start animation loops
    startAnimationLoop();
    this.startAnimation();

    // Set up input handling
    this.setupInput();

    // Handle terminal resize via terminal-kit
    term.on('resize', () => {
      this.fullDraw();
    });
  }

  /**
   * Stop the game and cleanup
   */
  stop(): void {
    if (!this.isRunning) return;

    this.stopAnimation();
    stopAnimationLoop();
    this.cleanupSprites();
    exitTerminal();

    this.isRunning = false;
  }

  /**
   * Transition to a new screen
   */
  async transitionTo(screen: GameScreen): Promise<void> {
    // Cleanup current screen
    this.cleanupSprites();

    // Set new screen
    this.state.currentScreen = screen;

    // Initialize new screen
    switch (screen) {
      case 'CHARACTER_SELECT':
        // No special setup needed
        break;

      case 'BRIDGE_GUARDIAN':
        await this.setupBridgeGuardianScene();
        break;

      case 'WELLSPRING':
        await this.setupWellspringScene();
        break;
    }

    // Redraw
    term.clear();
    this.draw();
  }

  /**
   * Get the selected character tile index
   */
  getSelectedCharacter(): number {
    return this.state.selectedCharacter;
  }

  // ============================================================================
  // Private Methods - Setup
  // ============================================================================

  private setupInput(): void {
    term.on('key', (key: string, _matches: string[], _data: unknown) => {
      // Handle exit confirmation
      if (this.state.pendingExit) {
        if (key === 'y' || key === 'Y') {
          if (this.callbacks.onExit) {
            this.callbacks.onExit();
          }
          this.stop();
          process.exit(0);
        } else {
          this.state.pendingExit = false;
          this.draw();
        }
        return;
      }

      // Global keys
      if (key === 'CTRL_C') {
        this.state.pendingExit = true;
        this.draw();
        return;
      }

      if (key === 'CTRL_Z') {
        this.suspendProcess();
        return;
      }

      // Screen-specific input handling
      switch (this.state.currentScreen) {
        case 'CHARACTER_SELECT':
          this.handleCharacterSelectInput(key);
          break;

        case 'BRIDGE_GUARDIAN':
          if (this.state.textInputMode) {
            this.handleTextInput(key);
          } else {
            this.handleBridgeGuardianInput(key);
          }
          break;

        case 'WELLSPRING':
          this.handleWellspringInput(key);
          break;
      }
    });
  }

  private suspendProcess(): void {
    this.state.drawingEnabled = false;
    if (process.stdin.isTTY && process.stdin.setRawMode) {
      process.stdin.setRawMode(false);
    }
    process.removeAllListeners('SIGTSTP');
    process.kill(0, 'SIGTSTP');
  }

  private startAnimation(): void {
    this.animationInterval = setInterval(() => {
      // State updates always run even when drawing disabled
      this.state.animationFrame = (this.state.animationFrame + 1) % 8;

      // Increment blink cycle every full animation cycle
      if (this.state.animationFrame === 0) {
        this.state.blinkCycle = (this.state.blinkCycle + 1) % 8;
      }

      // Skip drawing when disabled or no TTY
      if (!this.state.drawingEnabled || !process.stdout.isTTY) return;

      // Redraw scenes that need animation
      if (
        this.state.currentScreen === 'BRIDGE_GUARDIAN' ||
        this.state.currentScreen === 'WELLSPRING'
      ) {
        if (hasActiveAnimations()) {
          this.drawScene();
        }
      }
    }, ANIMATION_INTERVAL);
  }

  private stopAnimation(): void {
    if (this.animationInterval) {
      clearInterval(this.animationInterval);
      this.animationInterval = null;
    }
  }

  private cleanupSprites(): void {
    if (this.humanSprite) {
      unregisterSprite(this.humanSprite.id);
      this.humanSprite = null;
    }
    if (this.guardianSprite) {
      unregisterSprite(this.guardianSprite.id);
      this.guardianSprite = null;
    }
    if (this.mimSprite) {
      unregisterSprite(this.mimSprite.id);
      this.mimSprite = null;
    }
    if (this.odinSprite) {
      unregisterSprite(this.odinSprite.id);
      this.odinSprite = null;
    }
  }

  // ============================================================================
  // Private Methods - Pending Review Handling
  // ============================================================================

  private async loadPendingReviews(): Promise<void> {
    this.pendingReviews = [];
    try {
      const dir = path.join(process.cwd(), PENDING_REVIEW_DIR);
      if (!fs.existsSync(dir)) return;

      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
      for (const file of files) {
        const content = fs.readFileSync(path.join(dir, file), 'utf-8');
        const review = JSON.parse(content) as PendingReview;
        // Only load unanswered reviews
        if (!review.answer) {
          this.pendingReviews.push(review);
        }
      }
    } catch (err) {
      // Ignore errors - no pending reviews
    }
  }

  private saveReviewAnswer(review: PendingReview, answer: string): void {
    review.answer = answer;
    const filename = `${review.id}-${review.subject.replace(/[^a-z0-9]/gi, '-')}.json`;
    const filepath = path.join(process.cwd(), PENDING_REVIEW_DIR, filename);
    fs.writeFileSync(filepath, JSON.stringify(review, null, 2));
  }

  private getCurrentReview(): PendingReview | null {
    if (this.currentReviewIndex >= this.pendingReviews.length) return null;
    return this.pendingReviews[this.currentReviewIndex];
  }

  private answerCurrentReview(answer: string): void {
    const review = this.getCurrentReview();
    if (!review) return;

    this.saveReviewAnswer(review, answer);
    this.currentReviewIndex++;

    // Check if all reviews answered
    if (this.currentReviewIndex >= this.pendingReviews.length) {
      this.state.guardianAnswered = true;
    }

    this.draw();
  }

  // ============================================================================
  // Private Methods - Scene Setup
  // ============================================================================

  private async setupBridgeGuardianScene(): Promise<void> {
    // Load pending reviews
    await this.loadPendingReviews();

    // If no pending reviews, mark as answered immediately
    if (this.pendingReviews.length === 0) {
      this.state.guardianAnswered = true;
    }

    // Create human sprite at starting position
    this.humanSprite = new Sprite({
      id: 'human',
      tile: this.state.selectedCharacter,
      position: { row: 2, col: 1 },
      visible: true,
      controlled: false,
    });
    registerSprite(this.humanSprite);

    // Create guardian sprite blocking the bridge
    this.guardianSprite = new Sprite({
      id: 'guardian',
      tile: TILE.GUARDIAN, // Use TILE.GUARDIAN instead of TILE.ARBITER
      position: { row: 2, col: 2 },
      visible: true,
      controlled: false,
    });
    registerSprite(this.guardianSprite);
  }

  private async setupWellspringScene(): Promise<void> {
    // Create human sprite at entry position
    this.humanSprite = new Sprite({
      id: 'human',
      tile: this.state.selectedCharacter,
      position: { row: 2, col: 0 },
      visible: true,
      controlled: false,
    });
    registerSprite(this.humanSprite);

    // Create Odin sprite (watching from corner)
    this.odinSprite = new Sprite({
      id: 'odin',
      tile: TILE.ODIN,
      position: { row: 1, col: 6 },
      visible: true,
      controlled: false,
    });
    registerSprite(this.odinSprite);

    // Create Mim sprite (in the water, bubbling)
    this.mimSprite = new Sprite({
      id: 'mim',
      tile: TILE.MIM,
      position: { row: 3, col: 3 },
      visible: true,
      controlled: false,
    });
    registerSprite(this.mimSprite);
    // Start bubbling animation
    this.mimSprite.startBubbling();

    // Auto-walk to destination position (4, 3)
    await this.humanSprite.walk({ row: 4, col: 3 });
    this.drawScene();

    // Start Agent 3 to process answered reviews
    this.runWellspringAgent();

    // Also notify via callback if provided
    if (this.callbacks.onWellspringStart) {
      this.callbacks.onWellspringStart();
    }
  }

  /**
   * Run Agent 3 (Wellspring) to apply user decisions
   */
  private async runWellspringAgent(): Promise<void> {
    const AGENT = AGENTS.WELLSPRING;
    logInfo(AGENT, 'Starting Wellspring agent');

    // Load answered reviews
    const reviews = loadAnsweredReviews();
    if (reviews.length === 0) {
      logInfo(AGENT, 'No answered reviews to process');
      this.addMessage('wellspring', 'The waters are still. No decisions await.');
      this.state.agentDone = true;
      this.draw();
      return;
    }

    logInfo(AGENT, `Processing ${reviews.length} answered reviews`);
    this.state.agentProcessing = true;
    this.draw();

    // Build prompt with all answered reviews
    const reviewsText = reviews.map(r =>
      `Review ${r.id}:
      Question: ${r.question}
      Answer: ${r.answer}
      Knowledge file: ${r.knowledge_file}
      Type: ${r.type}`
    ).join('\n\n');

    const prompt = `Apply these user decisions to the knowledge base:\n\n${reviewsText}`;

    try {
      const session = query({
        prompt,
        options: {
          model: 'opus',
          systemPrompt: WELLSPRING_SYSTEM_PROMPT,
          canUseTool: async (tool, input) => {
            if (tool === 'AskUserQuestion') {
              return { behavior: 'deny', message: 'Apply the user decision directly' };
            }
            // Log tool usage
            logInfo(AGENT, `Using tool: ${tool}`);
            this.addMessage('wellspring', `[Using ${tool}...]`);
            return { behavior: 'allow', updatedInput: input };
          },
          outputFormat: {
            type: 'json_schema',
            schema: getWellspringOutputJsonSchema()
          }
        }
      });

      for await (const event of session) {
        if (event.type === 'system' && event.subtype === 'init') {
          this.state.wellspringSessionId = event.session_id;
          logInfo(AGENT, `Session started: ${event.session_id}`);
        }

        if (event.type === 'assistant') {
          // Stream assistant text to chat
          // The content is nested inside event.message.content
          const message = event.message;
          if (message && message.content) {
            for (const block of message.content) {
              if (block.type === 'text' && block.text) {
                this.addMessage('wellspring', block.text);
              }
            }
          }
        }

        if (event.type === 'result') {
          if (event.subtype === 'success') {
            const output = event.structured_output as { message?: string; done?: boolean } | undefined;
            if (output) {
              if (output.message) {
                this.addMessage('wellspring', output.message);
              }
              if (output.done) {
                logInfo(AGENT, 'Agent signaled done');
                this.state.agentDone = true;

                // Clean up processed review files
                for (const review of reviews) {
                  try {
                    deleteReviewFile(review);
                    logInfo(AGENT, `Deleted review file: ${review.id}`);
                  } catch (err) {
                    logWarn(AGENT, `Failed to delete review file ${review.id}: ${err}`);
                  }
                }

                this.addMessage('wellspring', 'The Wellspring rests. Press ESC to depart.');
              }
            }
          } else {
            // Error subtypes: error_during_execution, error_max_turns, error_max_budget_usd, error_max_structured_output_retries
            const errors = event.errors || [];
            logError(AGENT, `Agent error: ${event.subtype} - ${errors.join(', ')}`);
            this.addMessage('wellspring', 'The waters grow turbulent... An error occurred.');
          }
        }
      }
    } catch (err) {
      const error = err as Error;
      logError(AGENT, `Wellspring agent failed: ${error.message}`);
      this.addMessage('wellspring', `Error: ${error.message}`);
    } finally {
      this.state.agentProcessing = false;
      this.draw();
    }

    logInfo(AGENT, 'Wellspring agent completed');
  }

  // ============================================================================
  // Private Methods - Input Handling
  // ============================================================================

  private handleCharacterSelectInput(key: string): void {
    switch (key) {
      case 'LEFT':
      case 'h':
        this.state.characterIndex =
          (this.state.characterIndex - 1 + CHARACTER_TILES.length) % CHARACTER_TILES.length;
        this.state.selectedCharacter = CHARACTER_TILES[this.state.characterIndex];
        this.draw();
        break;

      case 'RIGHT':
      case 'l':
        this.state.characterIndex = (this.state.characterIndex + 1) % CHARACTER_TILES.length;
        this.state.selectedCharacter = CHARACTER_TILES[this.state.characterIndex];
        this.draw();
        break;

      case 'UP':
      case 'k':
        this.state.characterIndex =
          (this.state.characterIndex - 4 + CHARACTER_TILES.length) % CHARACTER_TILES.length;
        this.state.selectedCharacter = CHARACTER_TILES[this.state.characterIndex];
        this.draw();
        break;

      case 'DOWN':
      case 'j':
        this.state.characterIndex = (this.state.characterIndex + 4) % CHARACTER_TILES.length;
        this.state.selectedCharacter = CHARACTER_TILES[this.state.characterIndex];
        this.draw();
        break;

      case 'ENTER':
        // Confirm selection, transition to Bridge Guardian
        if (this.callbacks.onCharacterSelected) {
          this.callbacks.onCharacterSelected(this.state.selectedCharacter);
        }
        this.transitionTo('BRIDGE_GUARDIAN').catch((err) => {
          logError(AGENTS.TUI, `Transition error: ${err.message}`);
        });
        break;

      case ' ': // Space bar - skip intro, go directly to Wellspring
        if (this.callbacks.onCharacterSelected) {
          this.callbacks.onCharacterSelected(this.state.selectedCharacter);
        }
        this.transitionTo('WELLSPRING').catch((err) => {
          logError(AGENTS.TUI, `Transition error: ${err.message}`);
        });
        break;

      case 'q':
        this.state.pendingExit = true;
        this.fullDraw();
        break;
    }
  }

  private handleBridgeGuardianInput(key: string): void {
    const review = this.getCurrentReview();

    // Handle text input mode for "Other" option
    if (this.state.otherInputActive) {
      if (key === 'ENTER') {
        // Submit the custom answer
        if (this.state.otherInputText.trim().length > 0) {
          this.answerCurrentReview(`Other: ${this.state.otherInputText.trim()}`);
        }
        this.state.otherInputActive = false;
        this.state.otherInputText = '';
        this.fullDraw();
        return;
      } else if (key === 'ESCAPE') {
        // Cancel text input
        this.state.otherInputActive = false;
        this.state.otherInputText = '';
        this.fullDraw();
        return;
      } else if (key === 'BACKSPACE' || key === 'DELETE') {
        // Delete last character
        this.state.otherInputText = this.state.otherInputText.slice(0, -1);
        this.fullDraw();
        return;
      } else if (key.length === 1 && key.charCodeAt(0) >= 32) {
        // Add printable character (limit to reasonable length)
        if (this.state.otherInputText.length < 200) {
          this.state.otherInputText += key;
          this.fullDraw();
        }
        return;
      }
      return; // Ignore other keys in input mode
    }

    switch (key) {
      case 'ENTER':
        if (this.state.guardianAnswered) {
          this.crossBridge();
        }
        break;

      case 'a':
      case 'A':
        if (review && review.options.length > 0) {
          this.answerCurrentReview(review.options[0]);
        }
        break;

      case 'b':
      case 'B':
        if (review && review.options.length > 1) {
          this.answerCurrentReview(review.options[1]);
        }
        break;

      case 'c':
      case 'C':
        if (review && review.options.length > 2) {
          this.answerCurrentReview(review.options[2]);
        }
        break;

      case 'd':
      case 'D':
        if (review && review.options.length > 3) {
          this.answerCurrentReview(review.options[3]);
        }
        break;

      case 'o':
      case 'O':
        // Activate text input mode
        if (review) {
          this.state.otherInputActive = true;
          this.state.otherInputText = '';
          this.fullDraw(); // Redraw to show input field
        }
        break;

      case 'ESCAPE':
        this.transitionTo('CHARACTER_SELECT').catch((err) => {
          logError(AGENTS.TUI, `Transition error: ${err.message}`);
        });
        break;
    }
  }

  private handleWellspringInput(key: string): void {
    switch (key) {
      case 'ESCAPE':
        // Only allow exit when agent is done
        if (this.state.agentDone) {
          if (this.callbacks.onComplete) {
            this.callbacks.onComplete();
          }
          this.stop();
        }
        break;
    }
  }

  private async crossBridge(): Promise<void> {
    if (!this.humanSprite || !this.guardianSprite) return;

    // Guardian steps aside (move down)
    await this.guardianSprite.walk({ row: 3, col: 2 });
    this.drawScene();

    // Player walks across bridge
    await this.humanSprite.walk({ row: 2, col: 6 });
    this.drawScene();

    // Notify bridge crossed
    if (this.callbacks.onBridgeCrossed) {
      this.callbacks.onBridgeCrossed();
    }

    // Transition to Wellspring
    await this.transitionTo('WELLSPRING');
  }

  // ============================================================================
  // Private Methods - Drawing
  // ============================================================================

  /**
   * Full redraw of all components (debounced to prevent signal storms)
   */
  private fullDraw(): void {
    // Skip all drawing when disabled
    if (!this.state.drawingEnabled) return;

    // Skip drawing if no TTY
    if (!process.stdout.isTTY) return;

    // Debounce rapid fullDraw calls
    const now = Date.now();
    if (now - this.lastFullDrawTime < FULL_DRAW_DEBOUNCE_MS) return;
    this.lastFullDrawTime = now;

    // Reset trackers to force redraw
    this.tracker.lastTileFrame = -1;
    this.tracker.lastMessageCount = -1;
    this.state.lastSelectionIndex = -1;

    term.clear();
    this.draw();
  }

  private draw(): void {
    if (!this.state.drawingEnabled || !process.stdout.isTTY) return;

    switch (this.state.currentScreen) {
      case 'CHARACTER_SELECT':
        this.drawCharacterSelect();
        break;

      case 'BRIDGE_GUARDIAN':
      case 'WELLSPRING':
        this.drawScene();
        this.drawInfoPanel();
        break;
    }

    // Draw exit confirmation if pending
    if (this.state.pendingExit) {
      this.drawExitConfirmation();
    }
  }

  private drawCharacterSelect(): void {
    // Only redraw if selection changed (Strategy 5 minimal redraws)
    if (this.state.characterIndex === this.state.lastSelectionIndex) return;
    this.state.lastSelectionIndex = this.state.characterIndex;

    if (!this.state.tileset) return;

    const layout = getLayout();

    // Calculate centering
    const rowWidth = getCharacterRowWidth();
    const contentHeight = CHAR_HEIGHT + 8;
    const startX = Math.max(1, Math.floor((layout.width - rowWidth) / 2));
    const startY = Math.max(1, Math.floor((layout.height - contentHeight) / 2));

    // Title
    const title1 = 'Your journey to the Wellspring begins.';
    const title2 = 'Choose wisely. The forest does not forgive the undiscerning.';

    term.moveTo(Math.max(1, Math.floor((layout.width - title1.length) / 2)), startY);
    process.stdout.write(`${COLORS.bold}${COLORS.yellow}${title1}${COLORS.reset}`);

    term.moveTo(Math.max(1, Math.floor((layout.width - title2.length) / 2)), startY + 1);
    process.stdout.write(`${COLORS.bold}${COLORS.yellow}${title2}${COLORS.reset}`);

    // Character tiles
    const characterLines = renderCharacterRow(this.state.tileset, this.state.characterIndex);
    const tilesStartY = startY + 3;

    for (let i = 0; i < characterLines.length; i++) {
      term.moveTo(startX, tilesStartY + i);
      process.stdout.write(characterLines[i] + RESET);
    }

    // Character name
    const nameY = tilesStartY + CHAR_HEIGHT + 2;
    const characterName = CHARACTER_NAMES[this.state.characterIndex];
    // Clear the line first to remove previous name
    term.moveTo(1, nameY);
    process.stdout.write(' '.repeat(layout.width));
    term.moveTo(Math.max(1, Math.floor((layout.width - characterName.length) / 2)), nameY);
    process.stdout.write(`${COLORS.bold}${COLORS.cyan}${characterName}${COLORS.reset}`);

    // Instructions
    const instructionY = nameY + 2;
    const instructions1 = '[Arrow keys/HJKL] Navigate   [ENTER] Select   [SPACE] Skip intro   [Q] Exit';
    term.moveTo(Math.max(1, Math.floor((layout.width - instructions1.length) / 2)), instructionY);
    process.stdout.write(`${COLORS.dim}${instructions1}${COLORS.reset}`);

    // Controls hint
    const instructions2 = '[Ctrl+C] Quit   [Ctrl+Z] Suspend';
    term.moveTo(Math.max(1, Math.floor((layout.width - instructions2.length) / 2)), instructionY + 1);
    process.stdout.write(`${COLORS.dim}${instructions2}${COLORS.reset}`);
  }

  private drawScene(force: boolean = false): void {
    if (!force && this.state.animationFrame === this.tracker.lastTileFrame) return;
    this.tracker.lastTileFrame = this.state.animationFrame;

    if (!this.state.tileset) return;

    const layout = getLayout();

    // Calculate filler rows above and below the scene
    const fillerRowsAbove = layout.tileArea.y - 1;
    const fillerRowsBelow = Math.max(0, layout.height - (layout.tileArea.y + TILE_AREA_HEIGHT));

    // Draw filler rows above the scene (build from scene upward)
    if (fillerRowsAbove > 0) {
      const fillerTileRowsAbove = Math.ceil(fillerRowsAbove / CHAR_HEIGHT);
      for (let tileRow = 0; tileRow < fillerTileRowsAbove; tileRow++) {
        const fillerLines = getFillerRow(this.state.tileset, tileRow);
        for (let charRow = CHAR_HEIGHT - 1; charRow >= 0; charRow--) {
          const screenY = layout.tileArea.y - 1 - tileRow * CHAR_HEIGHT - (CHAR_HEIGHT - 1 - charRow);
          if (screenY >= 1) {
            term.moveTo(layout.tileArea.x, screenY);
            process.stdout.write(fillerLines[charRow] + RESET);
          }
        }
      }
    }

    // Get all sprites and create scene based on current screen
    const allSprites = getAllSprites();
    let sceneType: SceneType = 'default';
    if (this.state.currentScreen === 'BRIDGE_GUARDIAN') {
      sceneType = 'bridge-guardian';
    } else if (this.state.currentScreen === 'WELLSPRING') {
      sceneType = 'wellspring';
    }
    const background = createScene(allSprites, sceneType);

    // Render scene
    const sceneStr = renderScene(this.state.tileset, background, allSprites);
    const lines = sceneStr.split('\n');

    for (let i = 0; i < lines.length; i++) {
      term.moveTo(layout.tileArea.x, layout.tileArea.y + i);
      process.stdout.write(lines[i] + RESET);
    }

    // Draw filler rows below the scene
    if (fillerRowsBelow > 0) {
      const fillerTileRowsBelow = Math.ceil(fillerRowsBelow / CHAR_HEIGHT);
      for (let tileRow = 0; tileRow < fillerTileRowsBelow; tileRow++) {
        const fillerLines = getFillerRow(this.state.tileset, tileRow + 100); // Offset for different pattern
        for (let charRow = 0; charRow < CHAR_HEIGHT; charRow++) {
          const screenY = layout.tileArea.y + TILE_AREA_HEIGHT + tileRow * CHAR_HEIGHT + charRow;
          if (screenY <= layout.height) {
            term.moveTo(layout.tileArea.x, screenY);
            process.stdout.write(fillerLines[charRow] + RESET);
          }
        }
      }
    }
  }

  private drawInfoPanel(): void {
    const layout = getLayout();

    switch (this.state.currentScreen) {
      case 'BRIDGE_GUARDIAN':
        this.drawBridgeGuardianPanel(layout);
        break;

      case 'WELLSPRING':
        this.drawWellspringPanel(layout);
        break;
    }
  }

  private drawBridgeGuardianPanel(layout: ReturnType<typeof getLayout>): void {
    const x = layout.chatArea.x;
    let y = layout.chatArea.y;
    const width = layout.chatArea.width;

    // Clear chat area
    for (let i = 0; i < layout.chatArea.height; i++) {
      term.moveTo(x, y + i);
      process.stdout.write(' '.repeat(width));
    }

    // Title
    term.moveTo(x, y);
    process.stdout.write(`${COLORS.bold}${COLORS.yellow}The Bridge Guardian${COLORS.reset}`);
    y += 2;

    // Get current review
    const review = this.getCurrentReview();

    if (review) {
      // Show progress
      term.moveTo(x, y);
      process.stdout.write(
        `${COLORS.dim}Question ${this.currentReviewIndex + 1} of ${this.pendingReviews.length}${COLORS.reset}`,
      );
      y += 2;

      // Show question
      const questionLines = this.wrapText(review.question, width);
      for (const line of questionLines) {
        term.moveTo(x, y);
        process.stdout.write(`${COLORS.yellow}${line}${COLORS.reset}`);
        y += 1;
      }
      y += 1;

      // Show context
      if (review.context) {
        const contextLines = this.wrapText(review.context, width - 2);
        for (const line of contextLines) {
          term.moveTo(x, y);
          process.stdout.write(`${COLORS.dim}  ${line}${COLORS.reset}`);
          y += 1;
        }
        y += 1;
      }

      // Show text input or options
      if (this.state.otherInputActive) {
        // Show text input UI
        term.moveTo(x, y);
        process.stdout.write(`${COLORS.cyan}Type your answer (ENTER to submit, ESC to cancel):${COLORS.reset}`);
        y += 1;
        term.moveTo(x, y);
        // Show input with cursor
        const displayText = this.state.otherInputText.length > width - 3
          ? this.state.otherInputText.slice(-(width - 4))
          : this.state.otherInputText;
        process.stdout.write(`> ${displayText}\u2588`);
      } else {
        // Show options
        for (let i = 0; i < review.options.length; i++) {
          const letter = String.fromCharCode(65 + i); // A, B, C, D
          const optionLines = this.wrapText(`[${letter}] ${review.options[i]}`, width);
          for (const line of optionLines) {
            term.moveTo(x, y);
            process.stdout.write(`${COLORS.cyan}${line}${COLORS.reset}`);
            y += 1;
          }
        }

        y += 1;
        term.moveTo(x, y);
        process.stdout.write(`${COLORS.dim}[O] Other (provide custom answer)${COLORS.reset}`);
      }
    } else if (this.state.guardianAnswered) {
      term.moveTo(x, y);
      process.stdout.write(`${COLORS.yellow}"The Wellspring is pure. You may pass."${COLORS.reset}`);
      y += 2;
      term.moveTo(x, y);
      process.stdout.write(`${COLORS.dim}Press ENTER to continue...${COLORS.reset}`);
    } else {
      term.moveTo(x, y);
      process.stdout.write(`${COLORS.dim}Loading questions...${COLORS.reset}`);
    }

    // Instructions at bottom
    const instructionY = layout.chatArea.y + layout.chatArea.height - 2;
    term.moveTo(x, instructionY);
    if (this.state.otherInputActive) {
      process.stdout.write(
        `${COLORS.dim}[ENTER] Submit  [ESC] Cancel  [Backspace] Delete${COLORS.reset}`,
      );
    } else {
      process.stdout.write(
        `${COLORS.dim}[A-D] Answer  [O] Other  [ESC] Back  [Ctrl+C] Quit${COLORS.reset}`,
      );
    }
  }

  /**
   * Wrap text to fit within a given width
   */
  private wrapText(text: string, width: number): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      if (word.length > width) {
        // Break long words
        if (currentLine) {
          lines.push(currentLine);
          currentLine = '';
        }
        for (let i = 0; i < word.length; i += width) {
          lines.push(word.substring(i, i + width));
        }
        continue;
      }

      if (currentLine.length + word.length + 1 <= width) {
        currentLine += (currentLine ? ' ' : '') + word;
      } else {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine) lines.push(currentLine);
    return lines.length > 0 ? lines : [''];
  }

  private drawWellspringPanel(layout: ReturnType<typeof getLayout>): void {
    const x = layout.chatArea.x;
    let y = layout.chatArea.y;
    const width = layout.chatArea.width;

    // Clear chat area
    for (let i = 0; i < layout.chatArea.height; i++) {
      term.moveTo(x, y + i);
      process.stdout.write(' '.repeat(width));
    }

    // Title
    term.moveTo(x, y);
    process.stdout.write(`${COLORS.bold}${COLORS.cyan}The Wellspring${COLORS.reset}`);
    y += 2;

    // Narrator text
    term.moveTo(x, y);
    process.stdout.write(`${COLORS.dim}${COLORS.italic}The pool shimmers with accumulated knowledge.${COLORS.reset}`);
    y += 1;
    term.moveTo(x, y);
    process.stdout.write(`${COLORS.dim}${COLORS.italic}Your decisions ripple through the depths.${COLORS.reset}`);
    y += 2;

    // Status based on agent state
    term.moveTo(x, y);
    if (this.state.agentDone) {
      process.stdout.write(`${COLORS.green}All decisions have been applied.${COLORS.reset}`);
    } else if (this.state.agentProcessing) {
      const dots = '.'.repeat((this.state.blinkCycle % 4) + 1);
      process.stdout.write(`${COLORS.cyan}Applying decisions${dots}${COLORS.reset}`);
    } else {
      process.stdout.write('Preparing to apply decisions...');
    }
    y += 2;

    // Display messages
    if (this.state.messages.length > 0) {
      for (const msg of this.state.messages) {
        const color = msg.speaker === 'wellspring' ? COLORS.cyan : COLORS.green;
        const prefix = msg.speaker === 'wellspring' ? 'Wellspring: ' : 'You: ';
        const lines = this.wrapText(prefix + msg.text, width);
        for (const line of lines) {
          term.moveTo(x, y);
          process.stdout.write(`${color}${line}${COLORS.reset}`);
          y += 1;
        }
        y += 1;
      }
    } else if (!this.state.agentDone && !this.state.agentProcessing) {
      // Animated processing indicator when waiting to start
      const dots = '.'.repeat((this.state.blinkCycle % 4) + 1);
      term.moveTo(x, y);
      process.stdout.write(`${COLORS.dim}Processing${dots}${COLORS.reset}`);
      y += 2;
    }

    // Instructions at bottom
    const instructionY = layout.chatArea.y + layout.chatArea.height - 2;
    term.moveTo(x, instructionY);
    if (this.state.agentDone) {
      process.stdout.write(`${COLORS.green}[ESC] Depart the Wellspring${COLORS.reset}`);
    } else {
      process.stdout.write(`${COLORS.dim}Watching the Wellspring work...  [Ctrl+C] Quit${COLORS.reset}`);
    }
  }

  private drawExitConfirmation(): void {
    const layout = getLayout();
    const message = 'Exit? Press Y to confirm, any other key to cancel';
    const x = Math.max(1, Math.floor((layout.width - message.length) / 2));
    const y = layout.height - 1;

    term.moveTo(x, y);
    process.stdout.write(`\x1b[41;97m ${message} ${COLORS.reset}`);
  }

  // ============================================================================
  // Public API Methods
  // ============================================================================

  /**
   * Add a message to the chat panel
   */
  addMessage(speaker: string, text: string): void {
    this.state.messages.push({ speaker, text });
    this.tracker.lastMessageCount = -1; // Force redraw
    this.draw();
  }

  /**
   * Clear all messages
   */
  clearMessages(): void {
    this.state.messages = [];
    this.tracker.lastMessageCount = -1;
    this.draw();
  }

  /**
   * Get current screen
   */
  getCurrentScreen(): GameScreen {
    return this.state.currentScreen;
  }

  /**
   * Mark guardian as answered (allows passage)
   */
  setGuardianAnswered(answered: boolean): void {
    this.state.guardianAnswered = answered;
    this.draw();
  }

  /**
   * Get the human sprite for animations
   */
  getHumanSprite(): Sprite | null {
    return this.humanSprite;
  }

  /**
   * Get the guardian sprite for animations
   */
  getGuardianSprite(): Sprite | null {
    return this.guardianSprite;
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Result from startGame - contains the game instance for further control
 */
export interface StartGameResult {
  /** The game instance */
  game: MimGame;
  /** Promise that resolves when the game completes */
  completion: Promise<void>;
}

/**
 * Start the Mim game
 *
 * This is the main entry point for the TUI game.
 *
 * Game flow:
 * 1. Start on CHARACTER_SELECT screen
 * 2. After selection (ENTER), transition to BRIDGE_GUARDIAN
 *    - Or skip intro (SPACE) to go directly to WELLSPRING
 * 3. After guardian passes, transition to WELLSPRING
 * 4. After Wellspring agent completes, exit game
 *
 * @param callbacks - Optional callbacks for game events
 * @returns StartGameResult with game instance and completion promise
 */
export async function startGame(callbacks: GameCallbacks = {}): Promise<StartGameResult> {
  const game = new MimGame(callbacks);

  const completion = new Promise<void>((resolve, reject) => {
    const wrappedCallbacks: GameCallbacks = {
      ...callbacks,
      onComplete: () => {
        if (callbacks.onComplete) {
          callbacks.onComplete();
        }
        resolve();
      },
      onExit: () => {
        if (callbacks.onExit) {
          callbacks.onExit();
        }
        resolve();
      },
    };

    // Update callbacks
    Object.assign(game['callbacks'], wrappedCallbacks);

    game.start().catch(reject);
  });

  return { game, completion };
}

/**
 * Export the game class for direct usage
 */
export { MimGame };

/**
 * Re-export types that were already exported at definition
 * GameScreen is already exported as a type at line ~42
 * GameCallbacks is defined as interface but not exported, so export it here
 */
export type { GameCallbacks };
