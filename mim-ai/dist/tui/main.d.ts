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
import { Sprite } from './sprite.js';
/**
 * Game screens representing the state machine states
 */
export type GameScreen = 'CHARACTER_SELECT' | 'BRIDGE_GUARDIAN' | 'WELLSPRING';
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
/**
 * Main game controller managing the TUI and game flow
 */
declare class MimGame {
    private state;
    private tracker;
    private callbacks;
    private animationInterval;
    private isRunning;
    private lastFullDrawTime;
    private humanSprite;
    private guardianSprite;
    private mimSprite;
    private odinSprite;
    private pendingReviews;
    private currentReviewIndex;
    constructor(callbacks?: GameCallbacks);
    /**
     * Start the game
     */
    start(): Promise<void>;
    /**
     * Stop the game and cleanup
     */
    stop(): void;
    /**
     * Transition to a new screen
     */
    transitionTo(screen: GameScreen): Promise<void>;
    /**
     * Get the selected character tile index
     */
    getSelectedCharacter(): number;
    private setupInput;
    private suspendProcess;
    private startAnimation;
    private stopAnimation;
    private cleanupSprites;
    private loadPendingReviews;
    private saveReviewAnswer;
    private getCurrentReview;
    private answerCurrentReview;
    private setupBridgeGuardianScene;
    private setupWellspringScene;
    private handleCharacterSelectInput;
    private handleBridgeGuardianInput;
    private handleWellspringInput;
    private crossBridge;
    /**
     * Full redraw of all components (debounced to prevent signal storms)
     */
    private fullDraw;
    private draw;
    private drawCharacterSelect;
    private drawScene;
    private drawInfoPanel;
    private drawBridgeGuardianPanel;
    /**
     * Wrap text to fit within a given width
     */
    private wrapText;
    private drawWellspringPanel;
    private drawExitConfirmation;
    /**
     * Add a message to the chat panel
     */
    addMessage(speaker: string, text: string): void;
    /**
     * Clear all messages
     */
    clearMessages(): void;
    /**
     * Get current screen
     */
    getCurrentScreen(): GameScreen;
    /**
     * Mark guardian as answered (allows passage)
     */
    setGuardianAnswered(answered: boolean): void;
    /**
     * Get the human sprite for animations
     */
    getHumanSprite(): Sprite | null;
    /**
     * Get the guardian sprite for animations
     */
    getGuardianSprite(): Sprite | null;
}
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
export declare function startGame(callbacks?: GameCallbacks): Promise<StartGameResult>;
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
//# sourceMappingURL=main.d.ts.map