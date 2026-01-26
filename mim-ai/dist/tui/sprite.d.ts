/**
 * Sprite class for animated tile-based characters in the TUI
 *
 * Sprites represent entities in the scene with position, animation state,
 * and indicator overlays. They support both controlled (user input) and
 * scripted (animated) movement patterns.
 */
/**
 * Animation state union type representing all possible sprite animations
 */
export type SpriteAnimation = {
    type: 'walking';
    target: {
        row: number;
        col: number;
    };
    elapsed: number;
    onComplete: () => void;
} | {
    type: 'hopping';
    hopsRemaining: number;
    frame: 0 | 1 | 2;
    elapsed: number;
    onComplete: () => void;
} | {
    type: 'magicSpawn';
    elapsed: number;
    onComplete: () => void;
} | {
    type: 'magicDespawn';
    elapsed: number;
    onComplete: () => void;
} | {
    type: 'magicTransform';
    toTile: number;
    elapsed: number;
    onComplete: () => void;
} | {
    type: 'bubbling';
    showing: boolean;
    elapsed: number;
    phaseDuration: number;
} | {
    type: 'flipping';
    mirrored: boolean;
    elapsed: number;
    phaseDuration: number;
};
/**
 * Configuration options for creating a new Sprite
 */
interface SpriteConfig {
    /** Unique identifier for the sprite */
    id: string;
    /** Tile index from tileset */
    tile: number;
    /** Initial grid position */
    position: {
        row: number;
        col: number;
    };
    /** Whether the sprite is visible (default: true) */
    visible?: boolean;
    /** If true, uses step() for instant movement; if false, uses walk() for animated movement (default: false) */
    controlled?: boolean;
}
/**
 * Sprite class for animated tile-based characters
 *
 * Supports walking, hopping, magic spawn/despawn/transform animations,
 * bubbling effects, and alert/chat indicator overlays.
 */
export declare class Sprite {
    /** Unique identifier for this sprite */
    readonly id: string;
    /** Whether the sprite should be rendered */
    visible: boolean;
    /** If true, uses step() for instant movement; if false, uses walk() for animated movement */
    controlled: boolean;
    /** Tile index from tileset */
    private _tile;
    /** Grid position */
    private _position;
    /** Current animation state, or null if not animating */
    private _animation;
    /** Overlay indicator type */
    private _indicator;
    /**
     * Creates a new Sprite instance
     *
     * @param config - Configuration options for the sprite
     */
    constructor(config: SpriteConfig);
    /**
     * Gets a copy of the current position (prevents external mutation)
     */
    get position(): {
        row: number;
        col: number;
    };
    /**
     * Gets the current tile index
     */
    get tile(): number;
    /**
     * Gets the current indicator type
     */
    get indicator(): 'alert' | 'chat' | null;
    /**
     * Gets the current animation state (for renderer to read)
     */
    get animation(): SpriteAnimation | null;
    /**
     * Instantly moves the sprite one step in the given direction
     *
     * Only works if `controlled === true`.
     *
     * @param direction - The direction to step
     */
    step(direction: 'up' | 'down' | 'left' | 'right'): void;
    /**
     * Animates the sprite walking to the target position
     *
     * Only works if `controlled === false`. Each step takes 1000ms.
     *
     * @param target - The target grid position to walk to
     * @returns Promise that resolves when the sprite reaches the target
     */
    walk(target: {
        row: number;
        col: number;
    }): Promise<void>;
    /**
     * Animates the sprite hopping in place
     *
     * Only works if `controlled === false`. Each hop takes 500ms (250ms up, 250ms down),
     * with a 150ms rest between consecutive hops.
     *
     * @param count - Number of hops to perform
     * @returns Promise that resolves when all hops are complete
     */
    hop(count: number): Promise<void>;
    /**
     * Animates the sprite magically spawning into existence
     *
     * After ~400ms, sets visible=true and resolves.
     *
     * @returns Promise that resolves when the spawn animation completes
     */
    magicSpawn(): Promise<void>;
    /**
     * Animates the sprite magically despawning
     *
     * After ~400ms, sets visible=false and resolves.
     *
     * @returns Promise that resolves when the despawn animation completes
     */
    magicDespawn(): Promise<void>;
    /**
     * Animates the sprite magically transforming to a different tile
     *
     * After ~400ms, changes the tile and resolves.
     *
     * @param toTile - The tile index to transform into
     * @returns Promise that resolves when the transform animation completes
     */
    magicTransform(toTile: number): Promise<void>;
    /**
     * Physically spawns the sprite (non-magical instant appearance)
     *
     * Immediately sets visible=true.
     *
     * @returns Promise that resolves immediately after setting visible
     */
    physicalSpawn(): Promise<void>;
    /**
     * Starts the bubbling animation loop
     *
     * The bubbling animation toggles visibility with random intervals
     * (400-1200ms on, 600-2000ms off). Loops indefinitely until stopped.
     */
    startBubbling(): void;
    /**
     * Stops the bubbling animation
     *
     * Clears the animation if currently bubbling and sets visible=false.
     */
    stopBubbling(): void;
    /**
     * Starts the flipping animation loop (like water ripples)
     *
     * The flipping animation toggles the mirrored state with random intervals
     * (800-2000ms). Loops indefinitely until stopped.
     */
    startFlipping(): void;
    /**
     * Stops the flipping animation
     *
     * Clears the animation if currently flipping.
     */
    stopFlipping(): void;
    /**
     * Gets whether the sprite is currently mirrored (for flipping animation)
     */
    get mirrored(): boolean;
    /**
     * Shows an alert indicator for the specified duration
     *
     * @param durationMs - How long to show the alert indicator
     * @returns Promise that resolves when the indicator is cleared
     */
    intrigued(durationMs: number): Promise<void>;
    /**
     * Shows a chat indicator for the specified duration
     *
     * @param durationMs - How long to show the chat indicator
     * @returns Promise that resolves when the indicator is cleared
     */
    chatting(durationMs: number): Promise<void>;
    /**
     * Stops the current animation
     *
     * If the animation has an onComplete callback, it will be called.
     */
    stopAnimation(): void;
    /**
     * Updates the animation state based on elapsed time
     *
     * Should be called regularly (e.g., every frame) to advance animations.
     *
     * @param deltaMs - Time elapsed since last tick in milliseconds
     */
    tick(deltaMs: number): void;
    /**
     * Checks if the sprite is at the given position
     *
     * @param pos - The position to check
     * @returns true if the sprite's position matches
     */
    isAt(pos: {
        row: number;
        col: number;
    }): boolean;
    /**
     * Updates walking animation - moves one step every 1000ms toward target
     */
    private tickWalking;
    /**
     * Updates hopping animation
     * - Frame 0 (up): 250ms
     * - Frame 1 (down): 250ms
     * - Frame 2 (resting between hops): 150ms
     */
    private tickHopping;
    /**
     * Updates magic animations - completes after 400ms
     */
    private tickMagic;
    /**
     * Updates bubbling animation - toggles showing based on random intervals
     */
    private tickBubbling;
    /**
     * Updates flipping animation - toggles mirrored state based on random intervals
     */
    private tickFlipping;
    /**
     * Gets a random duration for bubbling animation phase
     *
     * @param isShowing - Whether the bubble is currently showing
     * @returns Duration in milliseconds (400-1200ms for showing, 600-2000ms for hiding)
     */
    private getRandomBubbleDuration;
    /**
     * Gets a random duration for flipping animation phase
     *
     * @returns Duration in milliseconds (800-2000ms)
     */
    private getRandomFlipDuration;
    /**
     * Helper to create a delay promise
     */
    private delay;
}
export {};
//# sourceMappingURL=sprite.d.ts.map