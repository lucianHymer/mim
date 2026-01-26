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
import { Sprite } from './sprite.js';
/**
 * Game screens representing the state machine states
 */
export type GameScreen = 'TITLE' | 'CHARACTER_SELECT' | 'BRIDGE_APPROACH' | 'BRIDGE_GUARDIAN' | 'WELLSPRING';
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
     * Generate the audio status string showing music and SFX mode
     */
    private getAudioStatusString;
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
    /**
     * Animate the guardian hopping between questions
     */
    private animateGuardianHopBetweenQuestions;
    private setupBridgeApproachScene;
    private setupBridgeGuardianScene;
    /**
     * Animate the Bridge Guardian entrance sequence
     */
    private animateBridgeGuardianEntrance;
    /**
     * Helper to create a delay promise
     */
    private delay;
    /**
     * Lightweight update of just the text input line in the modal
     * Calculates the exact position based on content layout
     */
    private updateTextInputLine;
    private setupWellspringScene;
    /**
     * Shared canUseTool callback for Wellspring agent queries.
     * Denies AskUserQuestion (agent should ask in message instead),
     * tracks tool usage for UI indicator.
     */
    private wellspringCanUseTool;
    /**
     * Process events from a Wellspring agent session.
     * Handles init, assistant, and result events.
     * Returns when a result event is received (success or error).
     * On success with done=false, sets agentProcessing=false so user can respond.
     * On success with done=true, sets agentDone=true and cleans up review files.
     */
    private processWellspringEvents;
    /**
     * Run Agent 3 (Wellspring) to apply user decisions.
     * Starts the initial query with all reviews; if the agent returns done=false,
     * it will wait for user input via sendWellspringMessage().
     */
    private runWellspringAgent;
    /**
     * Send a user message to the Wellspring agent, resuming the existing session.
     * Called when the user submits text in INSERT mode.
     */
    sendWellspringMessage(text: string): Promise<void>;
    private handleTitleInput;
    private handleCharacterSelectInput;
    private handleBridgeApproachInput;
    private handleBridgeGuardianInput;
    private handleWellspringInput;
    private handleTextInput;
    private crossBridge;
    /**
     * Full redraw of all components (debounced to prevent signal storms)
     */
    private fullDraw;
    private draw;
    private drawTitleScreen;
    private drawCharacterSelect;
    /**
     * Draw the Bridge Approach scene
     *
     * Handles three phases: walking, dead, and retreat
     */
    private drawBridgeApproachScene;
    /**
     * Draw the signpost dialogue overlay
     */
    private drawSignpostDialogue;
    /**
     * Create middle fill row for dialogue box (copies texture from left tile edge)
     */
    private createMiddleFill;
    /**
     * Wrap text with consistent background color
     */
    private wrapTextWithBg;
    /**
     * Strip ANSI escape codes from a string to get visible length
     */
    private stripAnsi;
    /**
     * Draw the death screen when player falls into chasm
     */
    private drawBridgeApproachDeathScreen;
    /**
     * Draw the retreat screen when player turns back
     */
    private drawBridgeApproachRetreatScreen;
    /**
     * Draw the Bridge Guardian scene with modal overlay
     *
     * Renders the scene (guardian, human, bridge) and overlays a question modal
     * when in the 'modal' phase. During 'hopping' phase, no modal is shown.
     */
    private drawBridgeGuardianScene;
    /**
     * Build question modal buffer for double-buffered rendering
     *
     * Returns a string with escape codes that can be appended to the frame buffer.
     */
    private buildQuestionModalBuffer;
    /**
     * Create middle row borders for panels taller than 2 tiles
     */
    private createMiddleRowBorders;
    private drawScene;
    private drawInfoPanel;
    /**
     * Wrap text to fit within a given width
     */
    private wrapText;
    /**
     * Get all rendered chat lines for the wellspring panel
     * Returns array of { text, color } for each line
     */
    private getWellspringChatLines;
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