/**
 * Main TUI game loop for Mim-AI
 *
 * Implements a state machine with five screens:
 * 1. TITLE - Shows the MIM ASCII art title screen
 * 2. CHARACTER_SELECT - Player chooses their avatar
 * 3. BRIDGE_APPROACH - Player walks across bridge with chasm, signpost warns of guardian
 * 4. BRIDGE_GUARDIAN - Questions are answered to pass the bridge
 * 5. WELLSPRING - Watch the Wellspring agent apply decisions
 *
 * Uses terminal-kit with Strategy 5 (minimal redraws) for flicker-free rendering.
 */
import termKit from 'terminal-kit';
import fs from 'node:fs';
import path from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { logInfo, logWarn, logError, AGENTS } from '../utils/logger.js';
import { WELLSPRING_SYSTEM_PROMPT, getWellspringOutputJsonSchema, loadAnsweredReviews, deleteReviewFile } from '../agents/wellspring-agent.js';
import { getAllSprites, hasActiveAnimations, registerSprite, startAnimationLoop, stopAnimationLoop, unregisterSprite, } from './animation-loop.js';
import { createBridgeApproachScene, createBridgeGuardianScene, createScene, renderScene, SCENE_HEIGHT, SCENE_WIDTH, } from './scene.js';
import { Sprite } from './sprite.js';
import { exitTerminal } from './terminal-cleanup.js';
import { CHAR_HEIGHT, compositeTiles, compositeWithFocus, extractTile, loadTileset, RESET, renderTile, TILE, TILE_SIZE, } from './tileset.js';
import { getTitleArt } from './title-screen.js';
import { cycleMusicMode, toggleSfx, getMusicMode, isSfxEnabled, startMusic, stopMusic, playSfx } from '../sound.js';
const PENDING_REVIEW_DIR = '.claude/knowledge/pending-review';
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
    red: '\x1b[31m',
    blue: '\x1b[34m',
    brightWhite: '\x1b[97m',
};
// Filler row cache for grass/trees above and below the scene
const fillerRowCache = new Map();
// ============================================================================
// Bridge Approach Constants
// ============================================================================
// Bridge Approach scene dimensions (matches SCENE_WIDTH/HEIGHT)
const BA_SCENE_WIDTH = 7;
const BA_SCENE_HEIGHT = 6;
// Bridge Approach starting position
const BA_START_X = 0;
const BA_START_Y = 2; // Bridge row
// Bridge Approach signpost position (on right edge, above bridge end)
const BA_SIGN_X = 6;
const BA_SIGN_Y = 1;
// Bridge Approach tile types for collision
const BA_TILE_TYPE = {
    WALKABLE: 0, // Can walk here
    BLOCKED: 1, // Cannot walk here (trees, etc.)
    SIGN: 2, // Signpost - walkable but triggers dialogue
    DEATH: 3, // Chasm - instant death
    EXIT_RIGHT: 4, // Exit to Bridge Guardian
    EXIT_LEFT: 5, // Retreat back
};
// Dialogue box tile indices (2x2 tile message window)
const BA_DIALOGUE_TILES = {
    TOP_LEFT: 38,
    TOP_RIGHT: 39,
    BOTTOM_LEFT: 48,
    BOTTOM_RIGHT: 49,
};
// Death screen tile indices
const BA_DEATH_TILES = {
    GRAVESTONE: 60,
    SKELETON: 61,
};
/**
 * Create collision map for Bridge Approach scene
 *
 * Layout (land on left/right edges, signpost on right edge above bridge):
 * Row 0: BLOCK  DEATH  DEATH  DEATH  DEATH  DEATH  BLOCK
 * Row 1: BLOCK  DEATH  DEATH  DEATH  DEATH  DEATH  BLOCK  (signpost at col 6, not walkable)
 * Row 2: WALK   WALK   WALK   WALK   WALK   WALK   WALK
 * Row 3: BLOCK  DEATH  DEATH  DEATH  DEATH  DEATH  BLOCK
 * Row 4: BLOCK  DEATH  DEATH  DEATH  DEATH  DEATH  BLOCK
 * Row 5: BLOCK  DEATH  DEATH  DEATH  DEATH  DEATH  BLOCK
 */
function createBridgeApproachCollisionMap() {
    const map = [];
    for (let row = 0; row < BA_SCENE_HEIGHT; row++) {
        const mapRow = [];
        for (let col = 0; col < BA_SCENE_WIDTH; col++) {
            // Default to death (chasm)
            let tileType = BA_TILE_TYPE.DEATH;
            // Left edge (col 0): Trees block movement (except bridge row)
            if (col === 0) {
                if (row === 2) {
                    tileType = BA_TILE_TYPE.WALKABLE; // Grass at bridge level
                }
                else {
                    tileType = BA_TILE_TYPE.BLOCKED; // Trees
                }
            }
            // Right edge (col 6): Signpost/trees block movement (except bridge row)
            else if (col === 6) {
                if (row === 2) {
                    tileType = BA_TILE_TYPE.WALKABLE; // Grass at bridge level
                }
                else {
                    tileType = BA_TILE_TYPE.BLOCKED; // Trees or signpost
                }
            }
            // Row 2: Bridge row - all walkable
            else if (row === 2) {
                tileType = BA_TILE_TYPE.WALKABLE;
            }
            // Everything else in the middle: Death (chasm)
            mapRow.push(tileType);
        }
        map.push(mapRow);
    }
    return map;
}
// Pre-compute the collision map
const BA_COLLISION_MAP = createBridgeApproachCollisionMap();
/**
 * Check if a position in Bridge Approach is walkable
 */
function baIsWalkable(x, y) {
    if (x < 0 || y < 0 || x >= BA_SCENE_WIDTH || y >= BA_SCENE_HEIGHT) {
        return false;
    }
    const tileType = BA_COLLISION_MAP[y][x];
    return tileType === BA_TILE_TYPE.WALKABLE || tileType === BA_TILE_TYPE.SIGN;
}
/**
 * Check if a position in Bridge Approach is a death zone (chasm)
 */
function baIsDeathZone(x, y) {
    // Walking off screen (except bridge row) is death
    if (x < 0 || x >= BA_SCENE_WIDTH) {
        // Only allow exit on bridge row
        if (y !== BA_START_Y) {
            return true;
        }
        return false;
    }
    if (y < 0 || y >= BA_SCENE_HEIGHT) {
        return true;
    }
    const tileType = BA_COLLISION_MAP[y][x];
    return tileType === BA_TILE_TYPE.DEATH;
}
/**
 * Check if player can read the signpost (last bridge tile or directly under sign)
 */
function baIsNextToSign(x, y) {
    // Sign is at (row 1, col 6). Player can read it when:
    // - At col 5, row 2 (last bridge tile)
    // - At col 6, row 2 (on grass, directly under sign)
    if (y !== BA_SIGN_Y + 1)
        return false; // Must be on bridge row
    return x === BA_SIGN_X || x === BA_SIGN_X - 1;
}
// ============================================================================
// Character Selection Rendering
// ============================================================================
/**
 * Render all character tiles as an array of ANSI strings
 */
function renderCharacterRow(tileset, selectedIndex) {
    const focusTile = extractTile(tileset, TILE.FOCUS);
    const grassTile = extractTile(tileset, TILE.GRASS);
    const renderedTiles = [];
    for (let i = 0; i < CHARACTER_TILES.length; i++) {
        let charPixels = extractTile(tileset, CHARACTER_TILES[i]);
        charPixels = compositeTiles(charPixels, grassTile, 1);
        if (i === selectedIndex) {
            charPixels = compositeWithFocus(charPixels, focusTile);
        }
        renderedTiles.push(renderTile(charPixels));
    }
    const spacing = ' '.repeat(TILE_SPACING);
    const lines = [];
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
function getCharacterRowWidth() {
    return CHARACTER_TILES.length * TILE_DISPLAY_WIDTH + (CHARACTER_TILES.length - 1) * TILE_SPACING;
}
/**
 * Get or create a cached filler row (grass with occasional trees)
 * Creates a natural-looking forest edge above/below the main scene
 */
function getFillerRow(tileset, rowIndex) {
    const cacheKey = `filler-${rowIndex}`;
    const cached = fillerRowCache.get(cacheKey);
    if (cached) {
        return cached;
    }
    const grassPixels = extractTile(tileset, TILE.GRASS);
    const rowLines = [];
    // Build one row of tiles (SCENE_WIDTH tiles wide)
    for (let charRow = 0; charRow < CHAR_HEIGHT; charRow++) {
        let line = '';
        for (let col = 0; col < SCENE_WIDTH; col++) {
            // Deterministic pattern for variety: mostly grass, some trees
            const pattern = (rowIndex * 7 + col * 13) % 20;
            let tileIndex;
            if (pattern < 2) {
                tileIndex = TILE.PINE_TREE;
            }
            else if (pattern < 4) {
                tileIndex = TILE.BARE_TREE;
            }
            else if (pattern < 7) {
                tileIndex = TILE.GRASS_SPARSE;
            }
            else {
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
    state;
    tracker;
    callbacks;
    animationInterval = null;
    isRunning = false;
    lastFullDrawTime = 0;
    // Sprites for Bridge Guardian and Wellspring scenes
    humanSprite = null;
    guardianSprite = null;
    mimSprite = null;
    odinSprite = null;
    // Pending review state
    pendingReviews = [];
    currentReviewIndex = 0;
    constructor(callbacks = {}) {
        this.callbacks = callbacks;
        this.state = {
            currentScreen: 'TITLE',
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
            otherInputActive: false,
            otherInputText: '',
            bridgeApproachPhase: 'walking',
            hasSeenSign: false,
            showSignpostDialogue: false,
            bridgeGuardianPhase: 'modal',
            showQuestionModal: true,
        };
        this.tracker = {
            lastTileFrame: -1,
            lastMessageCount: -1,
            lastScreen: 'TITLE',
            // Title screen
            titleDrawn: false,
            // Bridge Approach
            baLastPlayerCol: -1,
            baLastPlayerRow: -1,
            baLastPhase: '',
            baLastShowDialogue: false,
            // Bridge Guardian
            bgLastHumanCol: -1,
            bgLastHumanRow: -1,
            bgLastGuardianCol: -1,
            bgLastGuardianRow: -1,
            bgLastShowModal: false,
            bgLastPhase: '',
            bgLastReviewIndex: -1,
            bgLastOtherInputActive: false,
            bgLastOtherInputText: '',
            bgLastGuardianAnswered: false,
        };
    }
    /**
     * Generate the audio status string showing music and SFX mode
     */
    getAudioStatusString() {
        const musicMode = getMusicMode();
        const sfxOn = isSfxEnabled();
        const cGreen = '\x1b[1;92m'; // bold bright green
        const cYellow = '\x1b[1;93m'; // bold bright yellow
        const cRed = '\x1b[1;91m'; // bold bright red
        const DIM = '\x1b[38;2;140;140;140m';
        const musicLabel = musicMode === 'on'
            ? `${DIM}m:music(${cGreen}ON${RESET}${DIM}/quiet/off)${RESET}`
            : musicMode === 'quiet'
                ? `${DIM}m:music(on/${cYellow}QUIET${RESET}${DIM}/off)${RESET}`
                : `${DIM}m:music(on/quiet/${cRed}OFF${RESET}${DIM})${RESET}`;
        const sfxLabel = sfxOn
            ? `${DIM}s:sfx(${cGreen}ON${RESET}${DIM}/off)${RESET}`
            : `${DIM}s:sfx(on/${cRed}OFF${RESET}${DIM})${RESET}`;
        return `${musicLabel}  ${sfxLabel}`;
    }
    /**
     * Start the game
     */
    async start() {
        if (this.isRunning)
            return;
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
        }
        catch (err) {
            console.error('Failed to load tileset:', err);
            throw err;
        }
        // Enter fullscreen mode
        term.fullscreen(true);
        term.hideCursor();
        term.grabInput(true);
        // Initial draw
        this.fullDraw();
        // Start music (game starts on TITLE without transitionTo(), so we need to start it here)
        startMusic();
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
    stop() {
        if (!this.isRunning)
            return;
        stopMusic();
        this.stopAnimation();
        stopAnimationLoop();
        this.cleanupSprites();
        exitTerminal();
        this.isRunning = false;
    }
    /**
     * Transition to a new screen
     */
    async transitionTo(screen) {
        // Cleanup current screen
        this.cleanupSprites();
        // Set new screen
        this.state.currentScreen = screen;
        // Initialize new screen
        // Some screens handle their own clearing/drawing during setup animations
        switch (screen) {
            case 'TITLE':
                term.clear();
                startMusic();
                this.draw();
                break;
            case 'CHARACTER_SELECT':
                term.clear();
                this.draw();
                break;
            case 'BRIDGE_APPROACH':
                await this.setupBridgeApproachScene();
                term.clear();
                this.draw();
                break;
            case 'BRIDGE_GUARDIAN':
                // This screen handles its own clear/draw during entrance animation
                await this.setupBridgeGuardianScene();
                break;
            case 'WELLSPRING':
                // This screen handles its own clear/draw during entrance animation
                await this.setupWellspringScene();
                break;
        }
    }
    /**
     * Get the selected character tile index
     */
    getSelectedCharacter() {
        return this.state.selectedCharacter;
    }
    // ============================================================================
    // Private Methods - Setup
    // ============================================================================
    setupInput() {
        term.on('key', (key, _matches, _data) => {
            // Handle exit confirmation
            if (this.state.pendingExit) {
                if (key === 'y' || key === 'Y') {
                    if (this.callbacks.onExit) {
                        this.callbacks.onExit();
                    }
                    this.stop();
                    process.exit(0);
                }
                else {
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
            // Global audio controls
            if (key === 'm' || key === 'M') {
                cycleMusicMode();
                this.fullDraw();
                return;
            }
            if (key === 's' || key === 'S') {
                toggleSfx();
                this.fullDraw();
                return;
            }
            // Screen-specific input handling
            switch (this.state.currentScreen) {
                case 'TITLE':
                    this.handleTitleInput(key);
                    break;
                case 'CHARACTER_SELECT':
                    this.handleCharacterSelectInput(key);
                    break;
                case 'BRIDGE_APPROACH':
                    this.handleBridgeApproachInput(key);
                    break;
                case 'BRIDGE_GUARDIAN':
                    if (this.state.textInputMode) {
                        this.handleTextInput(key);
                    }
                    else {
                        this.handleBridgeGuardianInput(key);
                    }
                    break;
                case 'WELLSPRING':
                    this.handleWellspringInput(key);
                    break;
            }
        });
    }
    suspendProcess() {
        this.state.drawingEnabled = false;
        if (process.stdin.isTTY && process.stdin.setRawMode) {
            process.stdin.setRawMode(false);
        }
        process.removeAllListeners('SIGTSTP');
        process.kill(0, 'SIGTSTP');
    }
    startAnimation() {
        this.animationInterval = setInterval(() => {
            // State updates always run even when drawing disabled
            this.state.animationFrame = (this.state.animationFrame + 1) % 8;
            // Increment blink cycle every full animation cycle
            if (this.state.animationFrame === 0) {
                this.state.blinkCycle = (this.state.blinkCycle + 1) % 8;
            }
            // Skip drawing when disabled or no TTY
            if (!this.state.drawingEnabled || !process.stdout.isTTY)
                return;
            // Redraw scenes that need animation
            if (this.state.currentScreen === 'BRIDGE_GUARDIAN') {
                if (hasActiveAnimations()) {
                    this.drawBridgeGuardianScene();
                }
            }
            else if (this.state.currentScreen === 'WELLSPRING') {
                if (hasActiveAnimations()) {
                    this.drawScene();
                }
            }
        }, ANIMATION_INTERVAL);
    }
    stopAnimation() {
        if (this.animationInterval) {
            clearInterval(this.animationInterval);
            this.animationInterval = null;
        }
    }
    cleanupSprites() {
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
    async loadPendingReviews() {
        this.pendingReviews = [];
        try {
            const dir = path.join(process.cwd(), PENDING_REVIEW_DIR);
            if (!fs.existsSync(dir))
                return;
            const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
            for (const file of files) {
                const content = fs.readFileSync(path.join(dir, file), 'utf-8');
                const review = JSON.parse(content);
                // Only load unanswered reviews
                if (!review.answer) {
                    this.pendingReviews.push(review);
                }
            }
        }
        catch (err) {
            // Ignore errors - no pending reviews
        }
    }
    saveReviewAnswer(review, answer) {
        review.answer = answer;
        const filename = `${review.id}-${review.subject.replace(/[^a-z0-9]/gi, '-')}.json`;
        const filepath = path.join(process.cwd(), PENDING_REVIEW_DIR, filename);
        fs.writeFileSync(filepath, JSON.stringify(review, null, 2));
    }
    getCurrentReview() {
        if (this.currentReviewIndex >= this.pendingReviews.length)
            return null;
        return this.pendingReviews[this.currentReviewIndex];
    }
    answerCurrentReview(answer) {
        const review = this.getCurrentReview();
        if (!review)
            return;
        this.saveReviewAnswer(review, answer);
        this.currentReviewIndex++;
        // Check if all reviews answered
        if (this.currentReviewIndex >= this.pendingReviews.length) {
            this.state.guardianAnswered = true;
            // Show final modal with passage message
            this.state.bridgeGuardianPhase = 'modal';
            this.state.showQuestionModal = true;
            this.draw();
            return;
        }
        // Hide modal, start guardian hop animation
        this.state.showQuestionModal = false;
        this.state.bridgeGuardianPhase = 'hopping';
        this.draw();
        // Trigger guardian hop animation with proper timing
        this.animateGuardianHopBetweenQuestions();
    }
    /**
     * Animate the guardian hopping between questions
     */
    async animateGuardianHopBetweenQuestions() {
        if (!this.guardianSprite || this.guardianSprite.controlled) {
            // Fallback if no guardian sprite - just show next question
            this.state.bridgeGuardianPhase = 'modal';
            this.state.showQuestionModal = true;
            this.draw();
            return;
        }
        // Small pause before hop
        await this.delay(200);
        // Guardian hops once
        await this.guardianSprite.hop(1);
        this.drawBridgeGuardianScene();
        // Pause after hop before showing next question
        await this.delay(400);
        // Show next question modal
        this.state.bridgeGuardianPhase = 'modal';
        this.state.showQuestionModal = true;
        this.draw();
    }
    // ============================================================================
    // Private Methods - Scene Setup
    // ============================================================================
    async setupBridgeApproachScene() {
        // Reset Bridge Approach state
        this.state.bridgeApproachPhase = 'walking';
        this.state.hasSeenSign = false;
        this.state.showSignpostDialogue = false;
        // Create human sprite at starting position (left side of bridge)
        this.humanSprite = new Sprite({
            id: 'human',
            tile: this.state.selectedCharacter,
            position: { row: BA_START_Y, col: BA_START_X },
            visible: true,
            controlled: true, // Player-controlled movement
        });
        registerSprite(this.humanSprite);
    }
    async setupBridgeGuardianScene() {
        // Load pending reviews
        await this.loadPendingReviews();
        // Start with modal hidden for entrance animation
        this.state.bridgeGuardianPhase = 'walking';
        this.state.showQuestionModal = false;
        // If no pending reviews, mark as answered immediately
        if (this.pendingReviews.length === 0) {
            this.state.guardianAnswered = true;
        }
        // Create human sprite at starting position (left edge, off-screen feel)
        this.humanSprite = new Sprite({
            id: 'human',
            tile: this.state.selectedCharacter,
            position: { row: 2, col: 0 },
            visible: true,
            controlled: false,
        });
        registerSprite(this.humanSprite);
        // Create guardian sprite on side platform (will walk down to bridge)
        this.guardianSprite = new Sprite({
            id: 'guardian',
            tile: TILE.GUARDIAN,
            position: { row: 1, col: 2 },
            visible: true,
            controlled: false,
        });
        registerSprite(this.guardianSprite);
        // Animate entrance sequence
        await this.animateBridgeGuardianEntrance();
    }
    /**
     * Animate the Bridge Guardian entrance sequence
     */
    async animateBridgeGuardianEntrance() {
        if (!this.humanSprite || !this.guardianSprite)
            return;
        // Clear screen and draw initial scene FIRST
        term.clear();
        this.fullDraw();
        // Small pause to see initial positions
        await this.delay(500);
        // Human walks onto bridge (from col 0 to col 1)
        await this.humanSprite.walk({ row: 2, col: 1 });
        this.drawBridgeGuardianScene();
        // Small pause
        await this.delay(300);
        // Guardian walks down from platform to bridge
        await this.guardianSprite.walk({ row: 2, col: 2 });
        this.drawBridgeGuardianScene();
        // Guardian walks right to blocking position
        await this.guardianSprite.walk({ row: 2, col: 3 });
        this.drawBridgeGuardianScene();
        // Small pause before hop
        await this.delay(200);
        // Guardian hops once to announce presence
        await this.guardianSprite.hop(1);
        this.drawBridgeGuardianScene();
        // Pause after hop before showing question
        await this.delay(400);
        // Now show the question modal
        this.state.bridgeGuardianPhase = 'modal';
        this.state.showQuestionModal = true;
        this.fullDraw();
    }
    /**
     * Helper to create a delay promise
     */
    delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
    /**
     * Lightweight update of just the text input line in the modal
     * Calculates the exact position based on content layout
     */
    updateTextInputLine() {
        if (!this.state.tileset)
            return;
        const review = this.getCurrentReview();
        if (!review)
            return;
        const layout = getLayout();
        // Calculate modal dimensions and position (same as buildQuestionModalBuffer)
        const dialogueWidthTiles = 6;
        const dialogueHeightTiles = 3;
        const dialogueWidthChars = dialogueWidthTiles * TILE_SIZE;
        const sceneHeightChars = SCENE_HEIGHT * CHAR_HEIGHT;
        const dialogueHeightChars = dialogueHeightTiles * CHAR_HEIGHT;
        const dialogueOffsetX = layout.tileArea.x + Math.floor((TILE_AREA_WIDTH - dialogueWidthChars) / 2);
        const dialogueOffsetY = layout.tileArea.y + Math.floor((sceneHeightChars - dialogueHeightChars) / 2);
        const middleTiles = Math.max(0, dialogueWidthTiles - 2);
        const interiorWidth = middleTiles * TILE_SIZE;
        // Rebuild the text content to find the input line position
        const textLines = [];
        textLines.push(`${COLORS.dim}Question ${this.currentReviewIndex + 1} of ${this.pendingReviews.length}${RESET}`);
        textLines.push('');
        const questionLines = this.wrapText(review.question, interiorWidth - 4);
        for (const line of questionLines) {
            textLines.push(`${COLORS.yellow}${line}${RESET}`);
        }
        if (review.context) {
            textLines.push('');
            const contextLines = this.wrapText(review.context, interiorWidth - 6);
            for (const line of contextLines) {
                textLines.push(`${COLORS.dim}${line}${RESET}`);
            }
        }
        textLines.push('');
        textLines.push(`${COLORS.cyan}Type your answer:${RESET}`);
        // This is the input line we need to update
        const displayText = this.state.otherInputText.length > interiorWidth - 6
            ? this.state.otherInputText.slice(-(interiorWidth - 7))
            : this.state.otherInputText;
        const inputLineText = `> ${displayText}\u2588`;
        textLines.push(inputLineText);
        // Calculate where this line appears in the box
        const boxHeight = CHAR_HEIGHT * dialogueHeightTiles;
        const interiorStartRow = 2;
        const interiorEndRow = boxHeight - 3;
        const interiorHeight = interiorEndRow - interiorStartRow + 1;
        const textStartOffset = interiorStartRow + Math.max(0, Math.floor((interiorHeight - textLines.length) / 2));
        // The input line is the last line in textLines
        const inputLineIndex = textLines.length - 1;
        const boxLineIndex = textStartOffset + inputLineIndex;
        // Calculate screen position
        const screenY = dialogueOffsetY + boxLineIndex;
        // Sample background color from dialogue tile
        const topLeft = extractTile(this.state.tileset, BA_DIALOGUE_TILES.TOP_LEFT);
        const topRight = extractTile(this.state.tileset, BA_DIALOGUE_TILES.TOP_RIGHT);
        const bgSamplePixel = topLeft[8][8];
        const textBgColor = `\x1b[48;2;${bgSamplePixel.r};${bgSamplePixel.g};${bgSamplePixel.b}m`;
        // Build the padded line
        const visibleLength = this.stripAnsi(inputLineText).length;
        const padding = Math.max(0, Math.floor((interiorWidth - visibleLength) / 2));
        const rightPadding = Math.max(0, interiorWidth - padding - visibleLength);
        const textContent = ' '.repeat(padding) + inputLineText + ' '.repeat(rightPadding);
        const textWithBg = this.wrapTextWithBg(textContent, textBgColor);
        // Get borders for this row
        const tileRowIdx = Math.floor(boxLineIndex / CHAR_HEIGHT);
        const charRow = boxLineIndex % CHAR_HEIGHT;
        let leftBorder;
        let rightBorder;
        if (tileRowIdx === 0) {
            leftBorder = renderTile(topLeft)[charRow];
            rightBorder = renderTile(topRight)[charRow];
        }
        else if (tileRowIdx === dialogueHeightTiles - 1) {
            const bottomLeft = extractTile(this.state.tileset, BA_DIALOGUE_TILES.BOTTOM_LEFT);
            const bottomRight = extractTile(this.state.tileset, BA_DIALOGUE_TILES.BOTTOM_RIGHT);
            leftBorder = renderTile(bottomLeft)[charRow];
            rightBorder = renderTile(bottomRight)[charRow];
        }
        else {
            const borders = this.createMiddleRowBorders(topLeft, topRight, charRow);
            leftBorder = borders.left;
            rightBorder = borders.right;
        }
        // Output just this one line
        const lineContent = leftBorder + textWithBg + rightBorder + RESET;
        process.stdout.write(`\x1b[${screenY};${dialogueOffsetX}H${lineContent}`);
    }
    async setupWellspringScene() {
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
        // Clear screen and draw initial scene FIRST
        term.clear();
        this.fullDraw();
        // Auto-walk to destination position (4, 3) via waypoints to avoid trees
        // Path: right 1, down 2, right 2
        await this.humanSprite.walk({ row: 2, col: 1 }); // right 1
        this.drawScene();
        await this.humanSprite.walk({ row: 4, col: 1 }); // down 2
        this.drawScene();
        await this.humanSprite.walk({ row: 4, col: 3 }); // right 2
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
    async runWellspringAgent() {
        const AGENT = AGENTS.WELLSPRING;
        logInfo(AGENT, 'Starting Wellspring agent');
        // Load answered reviews
        const reviews = loadAnsweredReviews();
        if (reviews.length === 0) {
            logInfo(AGENT, 'No answered reviews to process');
            this.addMessage('mimir', 'The waters are still. No decisions await.');
            this.state.agentDone = true;
            this.draw();
            return;
        }
        logInfo(AGENT, `Processing ${reviews.length} answered reviews`);
        this.state.agentProcessing = true;
        this.draw();
        // Build prompt with all answered reviews
        const reviewsText = reviews.map(r => `Review ${r.id}:
      Question: ${r.question}
      Answer: ${r.answer}
      Knowledge file: ${r.knowledge_file}
      Type: ${r.type}`).join('\n\n');
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
                        this.addMessage('mimir', `[Using ${tool}...]`);
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
                                this.addMessage('mimir', block.text);
                            }
                        }
                    }
                }
                if (event.type === 'result') {
                    if (event.subtype === 'success') {
                        const output = event.structured_output;
                        if (output) {
                            if (output.message) {
                                this.addMessage('mimir', output.message);
                            }
                            if (output.done) {
                                logInfo(AGENT, 'Agent signaled done');
                                this.state.agentDone = true;
                                // Clean up processed review files
                                for (const review of reviews) {
                                    try {
                                        deleteReviewFile(review);
                                        logInfo(AGENT, `Deleted review file: ${review.id}`);
                                    }
                                    catch (err) {
                                        logWarn(AGENT, `Failed to delete review file ${review.id}: ${err}`);
                                    }
                                }
                                this.addMessage('mimir', 'It is done. The Wellspring rests. Press ESC to depart.');
                            }
                        }
                    }
                    else {
                        // Error subtypes: error_during_execution, error_max_turns, error_max_budget_usd, error_max_structured_output_retries
                        const errors = event.errors || [];
                        logError(AGENT, `Agent error: ${event.subtype} - ${errors.join(', ')}`);
                        this.addMessage('mimir', 'The waters grow turbulent... Something has gone wrong.');
                    }
                }
            }
        }
        catch (err) {
            const error = err;
            logError(AGENT, `Wellspring agent failed: ${error.message}`);
            this.addMessage('mimir', `Error: ${error.message}`);
        }
        finally {
            this.state.agentProcessing = false;
            this.draw();
        }
        logInfo(AGENT, 'Wellspring agent completed');
    }
    // ============================================================================
    // Private Methods - Input Handling
    // ============================================================================
    handleTitleInput(key) {
        // Any key (except CTRL keys which are handled globally) continues to character select
        this.transitionTo('CHARACTER_SELECT').catch((err) => {
            logError(AGENTS.TUI, `Transition error: ${err.message}`);
        });
    }
    handleCharacterSelectInput(key) {
        switch (key) {
            case 'LEFT':
            case 'h':
                this.state.characterIndex =
                    (this.state.characterIndex - 1 + CHARACTER_TILES.length) % CHARACTER_TILES.length;
                this.state.selectedCharacter = CHARACTER_TILES[this.state.characterIndex];
                this.draw();
                playSfx('menuLeft');
                break;
            case 'RIGHT':
            case 'l':
                this.state.characterIndex = (this.state.characterIndex + 1) % CHARACTER_TILES.length;
                this.state.selectedCharacter = CHARACTER_TILES[this.state.characterIndex];
                this.draw();
                playSfx('menuRight');
                break;
            case 'UP':
            case 'k':
                this.state.characterIndex =
                    (this.state.characterIndex - 4 + CHARACTER_TILES.length) % CHARACTER_TILES.length;
                this.state.selectedCharacter = CHARACTER_TILES[this.state.characterIndex];
                this.draw();
                playSfx('menuLeft');
                break;
            case 'DOWN':
            case 'j':
                this.state.characterIndex = (this.state.characterIndex + 4) % CHARACTER_TILES.length;
                this.state.selectedCharacter = CHARACTER_TILES[this.state.characterIndex];
                this.draw();
                playSfx('menuRight');
                break;
            case 'ENTER':
                playSfx('menuSelect');
                // Confirm selection, transition to Bridge Approach
                if (this.callbacks.onCharacterSelected) {
                    this.callbacks.onCharacterSelected(this.state.selectedCharacter);
                }
                this.transitionTo('BRIDGE_APPROACH').catch((err) => {
                    logError(AGENTS.TUI, `Transition error: ${err.message}`);
                });
                break;
            case ' ': // Space bar - skip intro, go directly to Wellspring
                playSfx('menuSelect');
                if (this.callbacks.onCharacterSelected) {
                    this.callbacks.onCharacterSelected(this.state.selectedCharacter);
                }
                this.transitionTo('WELLSPRING').catch((err) => {
                    logError(AGENTS.TUI, `Transition error: ${err.message}`);
                });
                break;
        }
    }
    handleBridgeApproachInput(key) {
        // Death screen - only 'y' to retry (goes back to character select)
        if (this.state.bridgeApproachPhase === 'dead') {
            if (key === 'y' || key === 'Y') {
                // Go back to character select screen
                this.cleanupSprites();
                this.state.bridgeApproachPhase = 'walking';
                this.state.currentScreen = 'CHARACTER_SELECT';
                // Use fullDraw to reset all trackers and force redraw
                this.fullDraw();
            }
            return;
        }
        // Retreat screen - 'y' to restart, ESCAPE to go back to character select
        if (this.state.bridgeApproachPhase === 'retreat') {
            if (key === 'y' || key === 'Y') {
                // Restart Bridge Approach
                this.cleanupSprites();
                this.setupBridgeApproachScene();
                term.clear();
                this.draw();
            }
            else if (key === 'ESCAPE') {
                // Go back to character select
                this.transitionTo('CHARACTER_SELECT').catch((err) => {
                    logError(AGENTS.TUI, `Transition error: ${err.message}`);
                });
            }
            return;
        }
        // Walking phase - handle arrow key movement
        if (this.state.bridgeApproachPhase === 'walking') {
            // Determine direction from key press
            let direction = null;
            if (key === 'UP' || key === 'k')
                direction = 'up';
            else if (key === 'DOWN' || key === 'j')
                direction = 'down';
            else if (key === 'LEFT' || key === 'h')
                direction = 'left';
            else if (key === 'RIGHT' || key === 'l')
                direction = 'right';
            // ESC to go back to character select
            if (key === 'ESCAPE') {
                this.transitionTo('CHARACTER_SELECT').catch((err) => {
                    logError(AGENTS.TUI, `Transition error: ${err.message}`);
                });
                return;
            }
            // No movement key pressed
            if (direction === null) {
                return;
            }
            if (!this.humanSprite)
                return;
            const currentPos = this.humanSprite.position;
            let newX = currentPos.col;
            let newY = currentPos.row;
            if (direction === 'up')
                newY--;
            else if (direction === 'down')
                newY++;
            else if (direction === 'left')
                newX--;
            else if (direction === 'right')
                newX++;
            // Check if trying to exit off screen to the right on bridge row
            if (newX >= BA_SCENE_WIDTH && newY === BA_START_Y) {
                // Successfully crossed the bridge - transition to Bridge Guardian
                this.transitionTo('BRIDGE_GUARDIAN').catch((err) => {
                    logError(AGENTS.TUI, `Transition error: ${err.message}`);
                });
                return;
            }
            // Check if retreating off the left edge on bridge row
            if (newX < 0 && newY === BA_START_Y) {
                // Turned back - retreat screen
                this.state.bridgeApproachPhase = 'retreat';
                this.draw();
                return;
            }
            // Check if moving into death zone (chasm)
            if (baIsDeathZone(newX, newY)) {
                // Death by falling into chasm
                playSfx('death');
                this.state.bridgeApproachPhase = 'dead';
                this.draw();
                return;
            }
            // Check if walkable
            if (!baIsWalkable(newX, newY)) {
                // Can't walk there
                return;
            }
            // Valid move - use sprite's step() method
            this.humanSprite.step(direction);
            // Check if now adjacent to signpost
            const playerPos = this.humanSprite.position;
            const nearSign = baIsNextToSign(playerPos.col, playerPos.row);
            if (nearSign) {
                this.state.hasSeenSign = true;
                this.state.showSignpostDialogue = true;
            }
            else {
                this.state.showSignpostDialogue = false;
            }
            this.draw();
        }
    }
    handleBridgeGuardianInput(key) {
        // Ignore input during hopping phase
        if (this.state.bridgeGuardianPhase === 'hopping') {
            return;
        }
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
                this.draw();
                return;
            }
            else if (key === 'ESCAPE') {
                // Cancel text input
                this.state.otherInputActive = false;
                this.state.otherInputText = '';
                this.draw();
                return;
            }
            else if (key === 'BACKSPACE' || key === 'DELETE') {
                // Delete last character
                this.state.otherInputText = this.state.otherInputText.slice(0, -1);
                this.updateTextInputLine();
                return;
            }
            else if (key.length === 1 && key.charCodeAt(0) >= 32) {
                // Add printable character (limit to reasonable length)
                if (this.state.otherInputText.length < 200) {
                    this.state.otherInputText += key;
                    this.updateTextInputLine();
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
    handleWellspringInput(key) {
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
    handleTextInput(key) {
        if (key === 'ENTER') {
            // Submit the text input
            if (this.state.textInputValue.trim().length > 0) {
                this.answerCurrentReview(`Other: ${this.state.textInputValue.trim()}`);
            }
            this.state.textInputMode = false;
            this.state.textInputValue = '';
            this.fullDraw();
        }
        else if (key === 'ESCAPE') {
            // Cancel text input
            this.state.textInputMode = false;
            this.state.textInputValue = '';
            this.fullDraw();
        }
        else if (key === 'BACKSPACE' || key === 'DELETE') {
            // Delete last character
            this.state.textInputValue = this.state.textInputValue.slice(0, -1);
            this.fullDraw();
        }
        else if (key.length === 1 && key.charCodeAt(0) >= 32) {
            // Add printable character (limit to reasonable length)
            if (this.state.textInputValue.length < 200) {
                this.state.textInputValue += key;
                this.fullDraw();
            }
        }
    }
    async crossBridge() {
        if (!this.humanSprite || !this.guardianSprite)
            return;
        // Hide the modal so we can see the crossing animation
        this.state.showQuestionModal = false;
        this.state.bridgeGuardianPhase = 'hopping';
        term.clear();
        this.draw();
        // Guardian steps aside onto the platform - walk left first, then up
        await this.guardianSprite.walk({ row: 2, col: 2 }); // left
        this.drawScene();
        await this.guardianSprite.walk({ row: 1, col: 2 }); // up
        this.drawScene();
        // Player walks across bridge to the right side
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
    fullDraw() {
        // Skip all drawing when disabled
        if (!this.state.drawingEnabled)
            return;
        // Skip drawing if no TTY
        if (!process.stdout.isTTY)
            return;
        // Debounce rapid fullDraw calls
        const now = Date.now();
        if (now - this.lastFullDrawTime < FULL_DRAW_DEBOUNCE_MS)
            return;
        this.lastFullDrawTime = now;
        // Reset trackers to force redraw
        this.tracker.lastTileFrame = -1;
        this.tracker.lastMessageCount = -1;
        this.state.lastSelectionIndex = -1;
        // Reset title screen tracker
        this.tracker.titleDrawn = false;
        // Reset Bridge Approach trackers
        this.tracker.baLastPlayerCol = -1;
        this.tracker.baLastPlayerRow = -1;
        this.tracker.baLastPhase = '';
        this.tracker.baLastShowDialogue = false;
        // Reset Bridge Guardian trackers
        this.tracker.bgLastHumanCol = -1;
        this.tracker.bgLastHumanRow = -1;
        this.tracker.bgLastGuardianCol = -1;
        this.tracker.bgLastGuardianRow = -1;
        this.tracker.bgLastShowModal = false;
        this.tracker.bgLastPhase = '';
        this.tracker.bgLastReviewIndex = -1;
        this.tracker.bgLastOtherInputActive = false;
        this.tracker.bgLastOtherInputText = '';
        this.tracker.bgLastGuardianAnswered = false;
        term.clear();
        this.draw();
    }
    draw() {
        if (!this.state.drawingEnabled || !process.stdout.isTTY)
            return;
        // Reset title drawn flag when transitioning away from TITLE screen
        if (this.tracker.lastScreen === 'TITLE' && this.state.currentScreen !== 'TITLE') {
            this.tracker.titleDrawn = false;
        }
        this.tracker.lastScreen = this.state.currentScreen;
        switch (this.state.currentScreen) {
            case 'TITLE':
                this.drawTitleScreen();
                break;
            case 'CHARACTER_SELECT':
                this.drawCharacterSelect();
                break;
            case 'BRIDGE_APPROACH':
                this.drawBridgeApproachScene();
                break;
            case 'BRIDGE_GUARDIAN':
                this.drawBridgeGuardianScene();
                break;
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
    drawTitleScreen() {
        // Change detection: Title screen is static, only draw once
        if (this.tracker.titleDrawn) {
            return; // Early return if already drawn
        }
        this.tracker.titleDrawn = true;
        const layout = getLayout();
        // Get the gradient title art
        const gradientArt = getTitleArt();
        const lines = gradientArt.split('\n').filter(line => line.length > 0);
        const artHeight = lines.length;
        const artWidth = lines[0]?.replace(/\x1b\[[0-9;]*m/g, '').length || 0;
        // Calculate centering
        const contentHeight = artHeight + 6; // art + spacing + tagline + prompt
        const startX = Math.max(1, Math.floor((layout.width - artWidth) / 2));
        const startY = Math.max(1, Math.floor((layout.height - contentHeight) / 2));
        // Draw title art centered
        for (let i = 0; i < lines.length; i++) {
            term.moveTo(startX, startY + i);
            process.stdout.write(lines[i] + RESET);
        }
        // Draw tagline below art
        const tagline = 'Persistent Memory for Claude Code';
        const taglineX = Math.max(1, Math.floor((layout.width - tagline.length) / 2));
        const taglineY = startY + artHeight + 2;
        term.moveTo(taglineX, taglineY);
        process.stdout.write(`\x1b[38;5;141m${tagline}${RESET}`);
        // Draw prompt below tagline
        const prompt = 'Press any key to continue...';
        const promptX = Math.max(1, Math.floor((layout.width - prompt.length) / 2));
        const promptY = taglineY + 2;
        term.moveTo(promptX, promptY);
        process.stdout.write(`${COLORS.dim}${prompt}${RESET}`);
        // Controls hint at bottom with audio status
        const audioStatus = this.getAudioStatusString();
        const controls = `[Ctrl+C] Quit   [Ctrl+Z] Suspend  ${COLORS.dim}·${RESET}  ${audioStatus}`;
        // Estimate visible length (controls text + separator + ~40 chars for audio status)
        const visibleLength = 36 + 3 + 40;
        const controlsX = Math.max(1, Math.floor((layout.width - visibleLength) / 2));
        const controlsY = promptY + 2;
        term.moveTo(controlsX, controlsY);
        process.stdout.write(`${COLORS.dim}[Ctrl+C] Quit   [Ctrl+Z] Suspend${RESET}  ${COLORS.dim}·${RESET}  ${audioStatus}`);
    }
    drawCharacterSelect() {
        // Only redraw if selection changed (Strategy 5 minimal redraws)
        if (this.state.characterIndex === this.state.lastSelectionIndex)
            return;
        this.state.lastSelectionIndex = this.state.characterIndex;
        if (!this.state.tileset)
            return;
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
        const instructions1 = '[Arrow keys/HJKL] Navigate   [ENTER] Select   [SPACE] Skip intro';
        term.moveTo(Math.max(1, Math.floor((layout.width - instructions1.length) / 2)), instructionY);
        process.stdout.write(`${COLORS.dim}${instructions1}${COLORS.reset}`);
        // Controls hint with integrated audio status
        const audioStatus = this.getAudioStatusString();
        const instructions2 = `[Ctrl+C] Quit   [Ctrl+Z] Suspend  ${COLORS.reset}·  ${audioStatus}`;
        term.moveTo(Math.max(1, Math.floor((layout.width - 60) / 2)), instructionY + 1);
        process.stdout.write(`${COLORS.dim}${instructions2}${COLORS.reset}`);
    }
    /**
     * Draw the Bridge Approach scene
     *
     * Handles three phases: walking, dead, and retreat
     */
    drawBridgeApproachScene() {
        if (!this.state.tileset)
            return;
        // Get current sprite position for change detection
        const playerCol = this.humanSprite?.position.col ?? -1;
        const playerRow = this.humanSprite?.position.row ?? -1;
        const phase = this.state.bridgeApproachPhase;
        const showDialogue = this.state.showSignpostDialogue;
        // Change detection: early return if nothing changed
        if (playerCol === this.tracker.baLastPlayerCol &&
            playerRow === this.tracker.baLastPlayerRow &&
            phase === this.tracker.baLastPhase &&
            showDialogue === this.tracker.baLastShowDialogue) {
            return; // Nothing changed, skip redraw
        }
        // Update tracker after detecting change
        this.tracker.baLastPlayerCol = playerCol;
        this.tracker.baLastPlayerRow = playerRow;
        this.tracker.baLastPhase = phase;
        this.tracker.baLastShowDialogue = showDialogue;
        const layout = getLayout();
        // Handle death screen
        if (this.state.bridgeApproachPhase === 'dead') {
            this.drawBridgeApproachDeathScreen(layout);
            return;
        }
        // Handle retreat screen
        if (this.state.bridgeApproachPhase === 'retreat') {
            this.drawBridgeApproachRetreatScreen(layout);
            return;
        }
        // Walking phase - render the scene
        const sceneWidthChars = BA_SCENE_WIDTH * TILE_SIZE;
        const sceneHeightChars = BA_SCENE_HEIGHT * CHAR_HEIGHT;
        const sceneOffsetX = Math.max(1, Math.floor((layout.width - sceneWidthChars) / 2));
        const sceneOffsetY = Math.max(1, Math.floor((layout.height - sceneHeightChars - 4) / 2));
        // Render the scene
        const allSprites = getAllSprites();
        const background = createBridgeApproachScene();
        const sceneStr = renderScene(this.state.tileset, background, allSprites);
        const lines = sceneStr.split('\n');
        for (let i = 0; i < lines.length; i++) {
            term.moveTo(sceneOffsetX, sceneOffsetY + i);
            process.stdout.write(lines[i] + RESET);
        }
        // Draw signpost dialogue if showing
        if (this.state.showSignpostDialogue) {
            this.drawSignpostDialogue(sceneOffsetX, sceneOffsetY, sceneWidthChars);
        }
        else {
            // Draw hint text at bottom
            const hintY = sceneOffsetY + sceneHeightChars + 1;
            term.moveTo(sceneOffsetX, hintY);
            process.stdout.write(' '.repeat(sceneWidthChars));
            term.moveTo(sceneOffsetX, hintY);
            let hintText = `${COLORS.dim}Use arrow keys or HJKL to move. Reach the other side of the bridge.${RESET}`;
            if (this.state.hasSeenSign) {
                hintText = `${COLORS.dim}Continue across the bridge to meet the Guardian.${RESET}`;
            }
            process.stdout.write(hintText);
        }
        // Instructions at bottom (with audio status)
        const audioStatus = this.getAudioStatusString();
        const instructionY = sceneOffsetY + sceneHeightChars + 2;
        term.moveTo(sceneOffsetX, instructionY);
        process.stdout.write(`${COLORS.dim}[ESC] Back to character select   [Ctrl+C] Quit${RESET}  ·  ${audioStatus}`);
    }
    /**
     * Draw the signpost dialogue overlay
     */
    drawSignpostDialogue(sceneOffsetX, sceneOffsetY, sceneWidthChars) {
        if (!this.state.tileset)
            return;
        // Dialogue box is 5 tiles wide x 2 tiles tall
        const dialogueWidthTiles = 5;
        const dialogueWidthChars = dialogueWidthTiles * TILE_SIZE;
        // Extract dialogue tiles
        const topLeft = extractTile(this.state.tileset, BA_DIALOGUE_TILES.TOP_LEFT);
        const topRight = extractTile(this.state.tileset, BA_DIALOGUE_TILES.TOP_RIGHT);
        const bottomLeft = extractTile(this.state.tileset, BA_DIALOGUE_TILES.BOTTOM_LEFT);
        const bottomRight = extractTile(this.state.tileset, BA_DIALOGUE_TILES.BOTTOM_RIGHT);
        const tlRendered = renderTile(topLeft);
        const trRendered = renderTile(topRight);
        const blRendered = renderTile(bottomLeft);
        const brRendered = renderTile(bottomRight);
        // Create middle fill rows
        const middleTopRendered = [];
        const middleBottomRendered = [];
        for (let row = 0; row < CHAR_HEIGHT; row++) {
            middleTopRendered.push(this.createMiddleFill(topLeft, row));
            middleBottomRendered.push(this.createMiddleFill(bottomLeft, row));
        }
        const middleTiles = Math.max(0, dialogueWidthTiles - 2);
        const interiorWidth = middleTiles * TILE_SIZE; // 3 tiles * 16 = 48 chars
        // Build dialogue box lines
        const boxLines = [];
        // Top row of dialogue box tiles
        for (let charRow = 0; charRow < CHAR_HEIGHT; charRow++) {
            let line = tlRendered[charRow];
            for (let m = 0; m < middleTiles; m++) {
                line += middleTopRendered[charRow];
            }
            line += trRendered[charRow];
            boxLines.push(line);
        }
        // Bottom row of dialogue box tiles
        for (let charRow = 0; charRow < CHAR_HEIGHT; charRow++) {
            let line = blRendered[charRow];
            for (let m = 0; m < middleTiles; m++) {
                line += middleBottomRendered[charRow];
            }
            line += brRendered[charRow];
            boxLines.push(line);
        }
        // Sample background color from dialogue tile center
        const bgSamplePixel = topLeft[8][8];
        const textBgColor = `\x1b[48;2;${bgSamplePixel.r};${bgSamplePixel.g};${bgSamplePixel.b}m`;
        // Mím signpost text
        const textLines = [
            `${COLORS.brightWhite}You approach the Wellspring`,
            `${COLORS.brightWhite}of Knowledge, guarded by`,
            ``,
            `${COLORS.bold}${COLORS.cyan}MIMIR THE ALL-SEEING${RESET}`,
            ``,
            `${COLORS.dim}Tread carefully, seeker.${RESET}`,
        ];
        // Center text in the dialogue box
        const boxHeight = CHAR_HEIGHT * 2;
        const textStartOffset = Math.floor((boxHeight - textLines.length) / 2);
        // Overlay text onto the box
        for (let i = 0; i < textLines.length; i++) {
            const boxLineIndex = textStartOffset + i;
            if (boxLineIndex >= 0 && boxLineIndex < boxLines.length) {
                const line = textLines[i];
                const visibleLength = this.stripAnsi(line).length;
                const padding = Math.max(0, Math.floor((interiorWidth - visibleLength) / 2));
                const rightPadding = Math.max(0, interiorWidth - padding - visibleLength);
                const textContent = ' '.repeat(padding) + line + ' '.repeat(rightPadding);
                const textWithBg = this.wrapTextWithBg(textContent, textBgColor);
                const isTopHalf = boxLineIndex < CHAR_HEIGHT;
                const charRow = isTopHalf ? boxLineIndex : boxLineIndex - CHAR_HEIGHT;
                const leftBorder = isTopHalf ? tlRendered[charRow] : blRendered[charRow];
                const rightBorder = isTopHalf ? trRendered[charRow] : brRendered[charRow];
                boxLines[boxLineIndex] = leftBorder + textWithBg + rightBorder;
            }
        }
        // Position dialogue box at bottom of scene
        const dialogueOffsetX = sceneOffsetX + Math.floor((sceneWidthChars - dialogueWidthChars) / 2);
        const sceneHeightChars = BA_SCENE_HEIGHT * CHAR_HEIGHT;
        const dialogueOffsetY = sceneOffsetY + (sceneHeightChars - CHAR_HEIGHT * 2);
        for (let i = 0; i < boxLines.length; i++) {
            term.moveTo(dialogueOffsetX, dialogueOffsetY + i);
            process.stdout.write(boxLines[i] + RESET);
        }
    }
    /**
     * Create middle fill row for dialogue box (copies texture from left tile edge)
     */
    createMiddleFill(leftTile, charRow) {
        const pixelRowTop = charRow * 2;
        const pixelRowBot = pixelRowTop + 1;
        let result = '';
        const sampleX = 8; // Middle column
        for (let x = 0; x < TILE_SIZE; x++) {
            const topPixel = leftTile[pixelRowTop][sampleX];
            const botPixel = leftTile[pixelRowBot]?.[sampleX] || topPixel;
            result += `\x1b[48;2;${topPixel.r};${topPixel.g};${topPixel.b}m`;
            result += `\x1b[38;2;${botPixel.r};${botPixel.g};${botPixel.b}m`;
            result += '\u2584'; // Lower half block
        }
        result += RESET;
        return result;
    }
    /**
     * Wrap text with consistent background color
     */
    wrapTextWithBg(text, bgColor) {
        const bgMaintained = text.replace(/\x1b\[0m/g, `\x1b[0m${bgColor}`);
        return bgColor + bgMaintained + RESET;
    }
    /**
     * Strip ANSI escape codes from a string to get visible length
     */
    stripAnsi(str) {
        // eslint-disable-next-line no-control-regex
        return str.replace(/\x1b\[[0-9;]*m/g, '');
    }
    /**
     * Draw the death screen when player falls into chasm
     */
    drawBridgeApproachDeathScreen(layout) {
        if (!this.state.tileset)
            return;
        // Clear screen to black first (like Arbiter's death screen)
        term.clear();
        // Render gravestone and skeleton on grass
        const grassTile = extractTile(this.state.tileset, TILE.GRASS_SPARSE);
        const gravestoneTile = extractTile(this.state.tileset, BA_DEATH_TILES.GRAVESTONE);
        const skeletonTile = extractTile(this.state.tileset, BA_DEATH_TILES.SKELETON);
        const gravestoneComposite = compositeTiles(gravestoneTile, grassTile, 1);
        const skeletonComposite = compositeTiles(skeletonTile, grassTile, 1);
        // Build 3x2 death scene
        const deathWidth = 3;
        const deathHeight = 2;
        const renderedTiles = [];
        // Row 0: grass, gravestone, grass
        const row0 = [];
        row0.push(renderTile(grassTile));
        row0.push(renderTile(gravestoneComposite));
        row0.push(renderTile(grassTile));
        renderedTiles.push(row0);
        // Row 1: grass, skeleton, grass
        const row1 = [];
        row1.push(renderTile(grassTile));
        row1.push(renderTile(skeletonComposite));
        row1.push(renderTile(grassTile));
        renderedTiles.push(row1);
        // Build output lines
        const lines = [];
        for (let tileRow = 0; tileRow < deathHeight; tileRow++) {
            for (let charRow = 0; charRow < CHAR_HEIGHT; charRow++) {
                let line = '';
                for (let tileCol = 0; tileCol < deathWidth; tileCol++) {
                    line += renderedTiles[tileRow][tileCol][charRow];
                }
                lines.push(line);
            }
        }
        // Center the death scene
        const deathWidthChars = deathWidth * TILE_SIZE;
        const deathHeightChars = lines.length;
        const deathOffsetX = Math.max(1, Math.floor((layout.width - deathWidthChars) / 2));
        const deathOffsetY = Math.max(1, Math.floor((layout.height - deathHeightChars - 6) / 2));
        // Draw death scene tiles
        for (let i = 0; i < lines.length; i++) {
            term.moveTo(deathOffsetX, deathOffsetY + i);
            process.stdout.write(lines[i] + RESET);
        }
        // Death messages
        const msgY = deathOffsetY + deathHeightChars + 2;
        const msg1 = `${COLORS.red}${COLORS.bold}You fell into the chasm.${RESET}`;
        const msg2 = `${COLORS.red}The abyss claims another soul.${RESET}`;
        const msg3 = `${COLORS.dim}Press Y to try again...${RESET}`;
        term.moveTo(Math.max(1, Math.floor((layout.width - 24) / 2)), msgY);
        process.stdout.write(msg1);
        term.moveTo(Math.max(1, Math.floor((layout.width - 30) / 2)), msgY + 1);
        process.stdout.write(msg2);
        term.moveTo(Math.max(1, Math.floor((layout.width - 22) / 2)), msgY + 3);
        process.stdout.write(msg3);
    }
    /**
     * Draw the retreat screen when player turns back
     */
    drawBridgeApproachRetreatScreen(layout) {
        if (!this.state.tileset)
            return;
        // Render the player character on grass
        const grassTile = extractTile(this.state.tileset, TILE.GRASS_SPARSE);
        const characterTile = extractTile(this.state.tileset, this.state.selectedCharacter);
        const characterComposite = compositeTiles(characterTile, grassTile, 1);
        // Build 3x1 retreat scene
        const renderedTiles = [];
        renderedTiles.push(renderTile(grassTile));
        renderedTiles.push(renderTile(characterComposite));
        renderedTiles.push(renderTile(grassTile));
        // Build output lines
        const lines = [];
        for (let charRow = 0; charRow < CHAR_HEIGHT; charRow++) {
            let line = '';
            for (let col = 0; col < 3; col++) {
                line += renderedTiles[col][charRow];
            }
            lines.push(line);
        }
        // Center the retreat scene
        const retreatWidthChars = 3 * TILE_SIZE;
        const retreatHeightChars = lines.length;
        const retreatOffsetX = Math.max(1, Math.floor((layout.width - retreatWidthChars) / 2));
        const retreatOffsetY = Math.max(1, Math.floor((layout.height - retreatHeightChars - 6) / 2));
        // Draw retreat scene tiles
        for (let i = 0; i < lines.length; i++) {
            term.moveTo(retreatOffsetX, retreatOffsetY + i);
            process.stdout.write(lines[i] + RESET);
        }
        // Retreat messages
        const msgY = retreatOffsetY + retreatHeightChars + 2;
        const msg1 = `${COLORS.blue}${COLORS.bold}You turned back.${RESET}`;
        const msg2 = `${COLORS.blue}Perhaps another time.${RESET}`;
        const msg3 = `${COLORS.dim}Press Y to try again, or ESC/Q to return${RESET}`;
        term.moveTo(Math.max(1, Math.floor((layout.width - 16) / 2)), msgY);
        process.stdout.write(msg1);
        term.moveTo(Math.max(1, Math.floor((layout.width - 21) / 2)), msgY + 1);
        process.stdout.write(msg2);
        term.moveTo(Math.max(1, Math.floor((layout.width - 41) / 2)), msgY + 3);
        process.stdout.write(msg3);
    }
    /**
     * Draw the Bridge Guardian scene with modal overlay
     *
     * Renders the scene (guardian, human, bridge) and overlays a question modal
     * when in the 'modal' phase. During 'hopping' phase, no modal is shown.
     */
    drawBridgeGuardianScene() {
        if (!this.state.tileset)
            return;
        // Get current state for change detection
        const humanCol = this.humanSprite?.position.col ?? -1;
        const humanRow = this.humanSprite?.position.row ?? -1;
        const guardianCol = this.guardianSprite?.position.col ?? -1;
        const guardianRow = this.guardianSprite?.position.row ?? -1;
        const showModal = this.state.showQuestionModal;
        const phase = this.state.bridgeGuardianPhase;
        const reviewIndex = this.currentReviewIndex;
        const otherInputActive = this.state.otherInputActive;
        const otherInputText = this.state.otherInputText;
        const guardianAnswered = this.state.guardianAnswered;
        // Get animation frame for hop detection (changes during hop even if position doesn't)
        const guardianAnimFrame = this.guardianSprite?.animation?.type === 'hopping'
            ? this.guardianSprite.animation.frame
            : -1;
        const hasAnimation = hasActiveAnimations();
        // Skip change detection if there are active animations (hop frame changes need redraws)
        const skipChangeDetection = hasAnimation;
        // Change detection: early return if nothing changed (unless animating)
        if (!skipChangeDetection &&
            humanCol === this.tracker.bgLastHumanCol &&
            humanRow === this.tracker.bgLastHumanRow &&
            guardianCol === this.tracker.bgLastGuardianCol &&
            guardianRow === this.tracker.bgLastGuardianRow &&
            showModal === this.tracker.bgLastShowModal &&
            phase === this.tracker.bgLastPhase &&
            reviewIndex === this.tracker.bgLastReviewIndex &&
            otherInputActive === this.tracker.bgLastOtherInputActive &&
            otherInputText === this.tracker.bgLastOtherInputText &&
            guardianAnswered === this.tracker.bgLastGuardianAnswered) {
            return; // Nothing changed, skip redraw
        }
        // Update tracker after detecting change
        this.tracker.bgLastHumanCol = humanCol;
        this.tracker.bgLastHumanRow = humanRow;
        this.tracker.bgLastGuardianCol = guardianCol;
        this.tracker.bgLastGuardianRow = guardianRow;
        this.tracker.bgLastShowModal = showModal;
        this.tracker.bgLastPhase = phase;
        this.tracker.bgLastReviewIndex = reviewIndex;
        this.tracker.bgLastOtherInputActive = otherInputActive;
        this.tracker.bgLastOtherInputText = otherInputText;
        this.tracker.bgLastGuardianAnswered = guardianAnswered;
        const layout = getLayout();
        // === DOUBLE BUFFERING: Build entire frame into buffer, output once ===
        let buffer = '';
        // Helper to add a line at a specific position
        const bufferLine = (x, y, content) => {
            buffer += `\x1b[${y};${x}H${content}`;
        };
        // Calculate filler rows above and below the scene
        const fillerRowsAbove = layout.tileArea.y - 1;
        const fillerRowsBelow = Math.max(0, layout.height - (layout.tileArea.y + TILE_AREA_HEIGHT));
        // Buffer filler rows above the scene (build from scene upward)
        if (fillerRowsAbove > 0) {
            const fillerTileRowsAbove = Math.ceil(fillerRowsAbove / CHAR_HEIGHT);
            for (let tileRow = 0; tileRow < fillerTileRowsAbove; tileRow++) {
                const fillerLines = getFillerRow(this.state.tileset, tileRow);
                for (let charRow = CHAR_HEIGHT - 1; charRow >= 0; charRow--) {
                    const screenY = layout.tileArea.y - 1 - tileRow * CHAR_HEIGHT - (CHAR_HEIGHT - 1 - charRow);
                    if (screenY >= 1) {
                        bufferLine(layout.tileArea.x, screenY, fillerLines[charRow] + RESET);
                    }
                }
            }
        }
        // Get all sprites and create Bridge Guardian scene
        const allSprites = getAllSprites();
        const background = createBridgeGuardianScene();
        // Render scene to buffer
        const sceneStr = renderScene(this.state.tileset, background, allSprites);
        const lines = sceneStr.split('\n');
        for (let i = 0; i < lines.length; i++) {
            bufferLine(layout.tileArea.x, layout.tileArea.y + i, lines[i] + RESET);
        }
        // Buffer filler rows below the scene
        if (fillerRowsBelow > 0) {
            const fillerTileRowsBelow = Math.ceil(fillerRowsBelow / CHAR_HEIGHT);
            for (let tileRow = 0; tileRow < fillerTileRowsBelow; tileRow++) {
                const fillerLines = getFillerRow(this.state.tileset, tileRow + 100); // Offset for different pattern
                for (let charRow = 0; charRow < CHAR_HEIGHT; charRow++) {
                    const screenY = layout.tileArea.y + TILE_AREA_HEIGHT + tileRow * CHAR_HEIGHT + charRow;
                    if (screenY <= layout.height) {
                        bufferLine(layout.tileArea.x, screenY, fillerLines[charRow] + RESET);
                    }
                }
            }
        }
        // Buffer question modal overlay if in modal phase and should be shown
        if (this.state.showQuestionModal && this.state.bridgeGuardianPhase === 'modal') {
            buffer += this.buildQuestionModalBuffer(layout.tileArea.x, layout.tileArea.y, TILE_AREA_WIDTH);
        }
        // Buffer hint text below the scene
        const hintY = layout.tileArea.y + TILE_AREA_HEIGHT + 1;
        bufferLine(layout.tileArea.x, hintY, ' '.repeat(TILE_AREA_WIDTH));
        let hintText = '';
        if (this.state.guardianAnswered) {
            // No hint needed - crossing animation handles itself
        }
        else if (this.state.bridgeGuardianPhase === 'hopping') {
            hintText = `${COLORS.dim}The guardian considers your response...${RESET}  ·  ${this.getAudioStatusString()}`;
        }
        else if (this.state.otherInputActive) {
            hintText = `${COLORS.dim}[ENTER] Submit  [ESC] Cancel  [Backspace] Delete${RESET}  ·  ${this.getAudioStatusString()}`;
        }
        else {
            hintText = `${COLORS.dim}[A-D] Answer  [O] Other  [ESC] Back  [Ctrl+C] Quit${RESET}  ·  ${this.getAudioStatusString()}`;
        }
        if (hintText) {
            bufferLine(layout.tileArea.x, hintY, hintText);
        }
        // === OUTPUT ENTIRE FRAME AT ONCE (with corking to batch at OS level) ===
        process.stdout.cork();
        process.stdout.write(buffer);
        process.stdout.uncork();
    }
    /**
     * Build question modal buffer for double-buffered rendering
     *
     * Returns a string with escape codes that can be appended to the frame buffer.
     */
    buildQuestionModalBuffer(sceneOffsetX, sceneOffsetY, sceneWidthChars) {
        if (!this.state.tileset)
            return '';
        const review = this.getCurrentReview();
        // Dialogue box is 6 tiles wide x 3 tiles tall for more content
        const dialogueWidthTiles = 6;
        const dialogueHeightTiles = 3;
        const dialogueWidthChars = dialogueWidthTiles * TILE_SIZE;
        // Extract dialogue tiles
        const topLeft = extractTile(this.state.tileset, BA_DIALOGUE_TILES.TOP_LEFT);
        const topRight = extractTile(this.state.tileset, BA_DIALOGUE_TILES.TOP_RIGHT);
        const bottomLeft = extractTile(this.state.tileset, BA_DIALOGUE_TILES.BOTTOM_LEFT);
        const bottomRight = extractTile(this.state.tileset, BA_DIALOGUE_TILES.BOTTOM_RIGHT);
        const tlRendered = renderTile(topLeft);
        const trRendered = renderTile(topRight);
        const blRendered = renderTile(bottomLeft);
        const brRendered = renderTile(bottomRight);
        // Create middle fill rows for top, middle, and bottom
        const middleTopRendered = [];
        const middleBottomRendered = [];
        for (let row = 0; row < CHAR_HEIGHT; row++) {
            middleTopRendered.push(this.createMiddleFill(topLeft, row));
            middleBottomRendered.push(this.createMiddleFill(bottomLeft, row));
        }
        // Create middle row borders for the middle tile row
        const middleRowBorders = [];
        for (let row = 0; row < CHAR_HEIGHT; row++) {
            middleRowBorders.push(this.createMiddleRowBorders(topLeft, topRight, row));
        }
        const middleTiles = Math.max(0, dialogueWidthTiles - 2);
        const interiorWidth = middleTiles * TILE_SIZE; // 4 tiles * 16 = 64 chars
        const middleRows = Math.max(0, dialogueHeightTiles - 2);
        // Build dialogue box lines
        const boxLines = [];
        // Top row of dialogue box tiles
        for (let charRow = 0; charRow < CHAR_HEIGHT; charRow++) {
            let line = tlRendered[charRow];
            for (let m = 0; m < middleTiles; m++) {
                line += middleTopRendered[charRow];
            }
            line += trRendered[charRow];
            boxLines.push(line);
        }
        // Middle rows of tiles (for height > 2)
        for (let middleRowIdx = 0; middleRowIdx < middleRows; middleRowIdx++) {
            for (let charRow = 0; charRow < CHAR_HEIGHT; charRow++) {
                const borders = middleRowBorders[charRow];
                let line = borders.left;
                for (let m = 0; m < middleTiles; m++) {
                    line += borders.fill;
                }
                line += borders.right;
                boxLines.push(line);
            }
        }
        // Bottom row of dialogue box tiles
        for (let charRow = 0; charRow < CHAR_HEIGHT; charRow++) {
            let line = blRendered[charRow];
            for (let m = 0; m < middleTiles; m++) {
                line += middleBottomRendered[charRow];
            }
            line += brRendered[charRow];
            boxLines.push(line);
        }
        // Sample background color from dialogue tile center
        const bgSamplePixel = topLeft[8][8];
        const textBgColor = `\x1b[48;2;${bgSamplePixel.r};${bgSamplePixel.g};${bgSamplePixel.b}m`;
        // Build text content based on current state
        const textLines = [];
        if (review) {
            // Progress indicator
            textLines.push(`${COLORS.dim}Question ${this.currentReviewIndex + 1} of ${this.pendingReviews.length}${RESET}`);
            textLines.push('');
            // Question text (wrapped)
            const questionLines = this.wrapText(review.question, interiorWidth - 4);
            for (const line of questionLines) {
                textLines.push(`${COLORS.yellow}${line}${RESET}`);
            }
            // Context (if any, dimmed)
            if (review.context) {
                textLines.push('');
                const contextLines = this.wrapText(review.context, interiorWidth - 6);
                for (const line of contextLines) {
                    textLines.push(`${COLORS.dim}${line}${RESET}`);
                }
            }
            textLines.push('');
            // Show text input or options
            if (this.state.otherInputActive) {
                textLines.push(`${COLORS.cyan}Type your answer:${RESET}`);
                const displayText = this.state.otherInputText.length > interiorWidth - 6
                    ? this.state.otherInputText.slice(-(interiorWidth - 7))
                    : this.state.otherInputText;
                textLines.push(`> ${displayText}\u2588`);
            }
            else {
                // Show options [A] [B] [C] [D]
                for (let i = 0; i < review.options.length && i < 4; i++) {
                    const letter = String.fromCharCode(65 + i); // A, B, C, D
                    const optionLines = this.wrapText(`[${letter}] ${review.options[i]}`, interiorWidth - 4);
                    for (const line of optionLines) {
                        textLines.push(`${COLORS.cyan}${line}${RESET}`);
                    }
                }
                textLines.push('');
                textLines.push(`${COLORS.dim}[O] Other (provide custom answer)${RESET}`);
            }
        }
        else if (this.state.guardianAnswered) {
            textLines.push('');
            textLines.push(`${COLORS.yellow}"The Wellspring is pure.${RESET}`);
            textLines.push(`${COLORS.yellow}You may pass."${RESET}`);
            textLines.push('');
            textLines.push(`${COLORS.dim}Press ENTER to continue...${RESET}`);
        }
        else {
            textLines.push('');
            textLines.push(`${COLORS.dim}Loading questions...${RESET}`);
        }
        // Center text in the dialogue box
        const boxHeight = CHAR_HEIGHT * dialogueHeightTiles;
        const interiorStartRow = 2;
        const interiorEndRow = boxHeight - 3;
        const interiorHeight = interiorEndRow - interiorStartRow + 1;
        const textStartOffset = interiorStartRow + Math.max(0, Math.floor((interiorHeight - textLines.length) / 2));
        // Overlay text onto the box
        for (let i = 0; i < textLines.length; i++) {
            const boxLineIndex = textStartOffset + i;
            if (boxLineIndex >= interiorStartRow && boxLineIndex <= interiorEndRow && boxLineIndex < boxLines.length) {
                let line = textLines[i];
                const visibleLength = this.stripAnsi(line).length;
                // Truncate if too long
                if (visibleLength > interiorWidth - 2) {
                    let truncated = '';
                    let truncatedVisible = 0;
                    const maxLen = interiorWidth - 5;
                    for (let c = 0; c < line.length && truncatedVisible < maxLen; c++) {
                        truncated += line[c];
                        const newVisibleLen = this.stripAnsi(truncated).length;
                        truncatedVisible = newVisibleLen;
                    }
                    line = `${truncated}...`;
                }
                const padding = Math.max(0, Math.floor((interiorWidth - this.stripAnsi(line).length) / 2));
                const rightPadding = Math.max(0, interiorWidth - padding - this.stripAnsi(line).length);
                const textContent = ' '.repeat(padding) + line + ' '.repeat(rightPadding);
                const textWithBg = this.wrapTextWithBg(textContent, textBgColor);
                // Determine which tile row we're in
                const tileRowIdx = Math.floor(boxLineIndex / CHAR_HEIGHT);
                const charRow = boxLineIndex % CHAR_HEIGHT;
                let leftBorder;
                let rightBorder;
                if (tileRowIdx === 0) {
                    leftBorder = tlRendered[charRow];
                    rightBorder = trRendered[charRow];
                }
                else if (tileRowIdx === dialogueHeightTiles - 1) {
                    leftBorder = blRendered[charRow];
                    rightBorder = brRendered[charRow];
                }
                else {
                    const borders = middleRowBorders[charRow];
                    leftBorder = borders.left;
                    rightBorder = borders.right;
                }
                boxLines[boxLineIndex] = leftBorder + textWithBg + rightBorder;
            }
        }
        // Position dialogue box centered on the scene
        const dialogueOffsetX = sceneOffsetX + Math.floor((sceneWidthChars - dialogueWidthChars) / 2);
        const sceneHeightChars = SCENE_HEIGHT * CHAR_HEIGHT;
        const dialogueHeightChars = dialogueHeightTiles * CHAR_HEIGHT;
        const dialogueOffsetY = sceneOffsetY + Math.floor((sceneHeightChars - dialogueHeightChars) / 2);
        // Build buffer with escape codes for positioning
        let modalBuffer = '';
        for (let i = 0; i < boxLines.length; i++) {
            modalBuffer += `\x1b[${dialogueOffsetY + i};${dialogueOffsetX}H${boxLines[i]}${RESET}`;
        }
        return modalBuffer;
    }
    /**
     * Create middle row borders for panels taller than 2 tiles
     */
    createMiddleRowBorders(topLeftTile, topRightTile, charRow) {
        const actualCharRow = charRow % 4;
        const pixelRowTop = 8 + actualCharRow * 2;
        const pixelRowBot = pixelRowTop + 1;
        let left = '';
        for (let x = 0; x < TILE_SIZE; x++) {
            const topPixel = topLeftTile[pixelRowTop][x];
            const botPixel = topLeftTile[pixelRowBot]?.[x] || topPixel;
            left += `\x1b[48;2;${topPixel.r};${topPixel.g};${topPixel.b}m`;
            left += `\x1b[38;2;${botPixel.r};${botPixel.g};${botPixel.b}m`;
            left += '\u2584';
        }
        left += RESET;
        let right = '';
        for (let x = 0; x < TILE_SIZE; x++) {
            const topPixel = topRightTile[pixelRowTop][x];
            const botPixel = topRightTile[pixelRowBot]?.[x] || topPixel;
            right += `\x1b[48;2;${topPixel.r};${topPixel.g};${topPixel.b}m`;
            right += `\x1b[38;2;${botPixel.r};${botPixel.g};${botPixel.b}m`;
            right += '\u2584';
        }
        right += RESET;
        const sampleX = 8;
        const topPixel = topLeftTile[pixelRowTop][sampleX];
        const botPixel = topLeftTile[pixelRowBot]?.[sampleX] || topPixel;
        let fill = '';
        for (let x = 0; x < TILE_SIZE; x++) {
            fill += `\x1b[48;2;${topPixel.r};${topPixel.g};${topPixel.b}m`;
            fill += `\x1b[38;2;${botPixel.r};${botPixel.g};${botPixel.b}m`;
            fill += '\u2584';
        }
        fill += RESET;
        return { left, fill, right };
    }
    drawScene(force = false) {
        if (!force && this.state.animationFrame === this.tracker.lastTileFrame)
            return;
        this.tracker.lastTileFrame = this.state.animationFrame;
        if (!this.state.tileset)
            return;
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
        let sceneType = 'default';
        if (this.state.currentScreen === 'BRIDGE_GUARDIAN') {
            sceneType = 'bridge-guardian';
        }
        else if (this.state.currentScreen === 'WELLSPRING') {
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
    drawInfoPanel() {
        const layout = getLayout();
        switch (this.state.currentScreen) {
            case 'WELLSPRING':
                this.drawWellspringPanel(layout);
                break;
        }
    }
    /**
     * Wrap text to fit within a given width
     */
    wrapText(text, width) {
        const words = text.split(' ');
        const lines = [];
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
            }
            else {
                if (currentLine)
                    lines.push(currentLine);
                currentLine = word;
            }
        }
        if (currentLine)
            lines.push(currentLine);
        return lines.length > 0 ? lines : [''];
    }
    drawWellspringPanel(layout) {
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
        process.stdout.write(`${COLORS.dim}${COLORS.italic}Mímir's head floats in the shimmering waters.${COLORS.reset}`);
        y += 1;
        term.moveTo(x, y);
        process.stdout.write(`${COLORS.dim}${COLORS.italic}Your decisions ripple through the depths of knowledge.${COLORS.reset}`);
        y += 2;
        // Status based on agent state
        term.moveTo(x, y);
        if (this.state.agentDone) {
            process.stdout.write(`${COLORS.green}All decisions have been applied.${COLORS.reset}`);
        }
        else if (this.state.agentProcessing) {
            const dots = '.'.repeat((this.state.blinkCycle % 4) + 1);
            process.stdout.write(`${COLORS.cyan}Applying decisions${dots}${COLORS.reset}`);
        }
        else {
            process.stdout.write('Preparing to apply decisions...');
        }
        y += 2;
        // Display messages
        if (this.state.messages.length > 0) {
            for (const msg of this.state.messages) {
                const color = msg.speaker === 'mimir' ? COLORS.cyan : COLORS.green;
                const prefix = msg.speaker === 'mimir' ? 'Mímir: ' : 'You: ';
                const lines = this.wrapText(prefix + msg.text, width);
                for (const line of lines) {
                    term.moveTo(x, y);
                    process.stdout.write(`${color}${line}${COLORS.reset}`);
                    y += 1;
                }
                y += 1;
            }
        }
        else if (!this.state.agentDone && !this.state.agentProcessing) {
            // Animated processing indicator when waiting to start
            const dots = '.'.repeat((this.state.blinkCycle % 4) + 1);
            term.moveTo(x, y);
            process.stdout.write(`${COLORS.dim}Processing${dots}${COLORS.reset}`);
            y += 2;
        }
        // Instructions at bottom (with integrated audio controls)
        const instructionY = layout.chatArea.y + layout.chatArea.height - 1;
        term.moveTo(x, instructionY);
        const audioStatus = this.getAudioStatusString();
        if (this.state.agentDone) {
            process.stdout.write(`${COLORS.green}[ESC] Depart the Wellspring${COLORS.reset}  ${COLORS.dim}·${COLORS.reset}  ${audioStatus}`);
        }
        else {
            process.stdout.write(`${COLORS.dim}Watching the Wellspring work...  [Ctrl+C] Quit  ·${COLORS.reset}  ${audioStatus}`);
        }
    }
    drawExitConfirmation() {
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
    addMessage(speaker, text) {
        this.state.messages.push({ speaker, text });
        this.tracker.lastMessageCount = -1; // Force redraw
        this.draw();
    }
    /**
     * Clear all messages
     */
    clearMessages() {
        this.state.messages = [];
        this.tracker.lastMessageCount = -1;
        this.draw();
    }
    /**
     * Get current screen
     */
    getCurrentScreen() {
        return this.state.currentScreen;
    }
    /**
     * Mark guardian as answered (allows passage)
     */
    setGuardianAnswered(answered) {
        this.state.guardianAnswered = answered;
        this.draw();
    }
    /**
     * Get the human sprite for animations
     */
    getHumanSprite() {
        return this.humanSprite;
    }
    /**
     * Get the guardian sprite for animations
     */
    getGuardianSprite() {
        return this.guardianSprite;
    }
}
/**
 * Start the Mim game
 *
 * This is the main entry point for the TUI game.
 *
 * Game flow:
 * 1. Start on TITLE screen with gradient ASCII art
 * 2. Any key transitions to CHARACTER_SELECT screen
 * 3. After selection (ENTER), transition to BRIDGE_APPROACH
 *    - Player walks across bridge, avoiding chasm, reads signpost
 *    - Or skip intro (SPACE) to go directly to WELLSPRING
 * 4. Exiting bridge right side transitions to BRIDGE_GUARDIAN
 * 5. After guardian passes, transition to WELLSPRING
 * 6. After Wellspring agent completes, exit game
 *
 * @param callbacks - Optional callbacks for game events
 * @returns StartGameResult with game instance and completion promise
 */
export async function startGame(callbacks = {}) {
    // Save original callbacks before wrapping to avoid circular reference
    const originalOnComplete = callbacks.onComplete;
    const originalOnExit = callbacks.onExit;
    const game = new MimGame(callbacks);
    const completion = new Promise((resolve, reject) => {
        const wrappedCallbacks = {
            ...callbacks,
            onComplete: () => {
                if (originalOnComplete) {
                    originalOnComplete();
                }
                resolve();
            },
            onExit: () => {
                if (originalOnExit) {
                    originalOnExit();
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
//# sourceMappingURL=main.js.map