/**
 * Sprite class for animated tile-based characters in the TUI
 *
 * Sprites represent entities in the scene with position, animation state,
 * and indicator overlays. They support both controlled (user input) and
 * scripted (animated) movement patterns.
 */

import { playSfx } from '../sound.js';

/**
 * Animation state union type representing all possible sprite animations
 */
export type SpriteAnimation =
  | {
      type: 'walking';
      target: { row: number; col: number };
      elapsed: number;
      onComplete: () => void;
    }
  | {
      type: 'hopping';
      hopsRemaining: number;
      frame: 0 | 1 | 2;
      elapsed: number;
      onComplete: () => void;
    }
  | { type: 'magicSpawn'; elapsed: number; onComplete: () => void }
  | { type: 'magicDespawn'; elapsed: number; onComplete: () => void }
  | { type: 'magicTransform'; toTile: number; elapsed: number; onComplete: () => void }
  | { type: 'bubbling'; showing: boolean; elapsed: number; phaseDuration: number };

/**
 * Configuration options for creating a new Sprite
 */
interface SpriteConfig {
  /** Unique identifier for the sprite */
  id: string;
  /** Tile index from tileset */
  tile: number;
  /** Initial grid position */
  position: { row: number; col: number };
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
export class Sprite {
  /** Unique identifier for this sprite */
  readonly id: string;

  /** Whether the sprite should be rendered */
  visible: boolean;

  /** If true, uses step() for instant movement; if false, uses walk() for animated movement */
  controlled: boolean;

  /** Tile index from tileset */
  private _tile: number;

  /** Grid position */
  private _position: { row: number; col: number };

  /** Current animation state, or null if not animating */
  private _animation: SpriteAnimation | null;

  /** Overlay indicator type */
  private _indicator: 'alert' | 'chat' | null;

  /**
   * Creates a new Sprite instance
   *
   * @param config - Configuration options for the sprite
   */
  constructor(config: SpriteConfig) {
    this.id = config.id;
    this._tile = config.tile;
    this._position = { row: config.position.row, col: config.position.col };
    this.visible = config.visible ?? true;
    this.controlled = config.controlled ?? false;
    this._animation = null;
    this._indicator = null;
  }

  /**
   * Gets a copy of the current position (prevents external mutation)
   */
  get position(): { row: number; col: number } {
    return { row: this._position.row, col: this._position.col };
  }

  /**
   * Gets the current tile index
   */
  get tile(): number {
    return this._tile;
  }

  /**
   * Gets the current indicator type
   */
  get indicator(): 'alert' | 'chat' | null {
    return this._indicator;
  }

  /**
   * Gets the current animation state (for renderer to read)
   */
  get animation(): SpriteAnimation | null {
    return this._animation;
  }

  /**
   * Instantly moves the sprite one step in the given direction
   *
   * Only works if `controlled === true`.
   *
   * @param direction - The direction to step
   */
  step(direction: 'up' | 'down' | 'left' | 'right'): void {
    if (!this.controlled) {
      return;
    }

    switch (direction) {
      case 'up':
        this._position.row -= 1;
        break;
      case 'down':
        this._position.row += 1;
        break;
      case 'left':
        this._position.col -= 1;
        break;
      case 'right':
        this._position.col += 1;
        break;
    }
    playSfx('footstep');
  }

  /**
   * Animates the sprite walking to the target position
   *
   * Only works if `controlled === false`. Each step takes 1000ms.
   *
   * @param target - The target grid position to walk to
   * @returns Promise that resolves when the sprite reaches the target
   */
  async walk(target: { row: number; col: number }): Promise<void> {
    if (this.controlled) {
      return;
    }

    return new Promise<void>((resolve) => {
      this._animation = {
        type: 'walking',
        target: { row: target.row, col: target.col },
        elapsed: 0,
        onComplete: resolve,
      };
    });
  }

  /**
   * Animates the sprite hopping in place
   *
   * Only works if `controlled === false`. Each hop takes 500ms (250ms up, 250ms down),
   * with a 150ms rest between consecutive hops.
   *
   * @param count - Number of hops to perform
   * @returns Promise that resolves when all hops are complete
   */
  async hop(count: number): Promise<void> {
    if (this.controlled) {
      return;
    }

    if (count <= 0) {
      return;
    }

    return new Promise<void>((resolve) => {
      this._animation = {
        type: 'hopping',
        hopsRemaining: count,
        frame: 0,
        elapsed: 0,
        onComplete: resolve,
      };
    });
  }

  /**
   * Animates the sprite magically spawning into existence
   *
   * After ~400ms, sets visible=true and resolves.
   *
   * @returns Promise that resolves when the spawn animation completes
   */
  async magicSpawn(): Promise<void> {
    playSfx('magic');
    return new Promise<void>((resolve) => {
      this._animation = {
        type: 'magicSpawn',
        elapsed: 0,
        onComplete: () => {
          this.visible = true;
          resolve();
        },
      };
    });
  }

  /**
   * Animates the sprite magically despawning
   *
   * After ~400ms, sets visible=false and resolves.
   *
   * @returns Promise that resolves when the despawn animation completes
   */
  async magicDespawn(): Promise<void> {
    playSfx('magic');
    return new Promise<void>((resolve) => {
      this._animation = {
        type: 'magicDespawn',
        elapsed: 0,
        onComplete: () => {
          this.visible = false;
          resolve();
        },
      };
    });
  }

  /**
   * Animates the sprite magically transforming to a different tile
   *
   * After ~400ms, changes the tile and resolves.
   *
   * @param toTile - The tile index to transform into
   * @returns Promise that resolves when the transform animation completes
   */
  async magicTransform(toTile: number): Promise<void> {
    playSfx('magic');
    return new Promise<void>((resolve) => {
      this._animation = {
        type: 'magicTransform',
        toTile,
        elapsed: 0,
        onComplete: () => {
          this._tile = toTile;
          resolve();
        },
      };
    });
  }

  /**
   * Physically spawns the sprite (non-magical instant appearance)
   *
   * Immediately sets visible=true.
   *
   * @returns Promise that resolves immediately after setting visible
   */
  async physicalSpawn(): Promise<void> {
    this.visible = true;
  }

  /**
   * Starts the bubbling animation loop
   *
   * The bubbling animation toggles visibility with random intervals
   * (400-1200ms on, 600-2000ms off). Loops indefinitely until stopped.
   */
  startBubbling(): void {
    this.visible = true;
    const phaseDuration = this.getRandomBubbleDuration(true);
    this._animation = {
      type: 'bubbling',
      showing: true,
      elapsed: 0,
      phaseDuration,
    };
  }

  /**
   * Stops the bubbling animation
   *
   * Clears the animation if currently bubbling and sets visible=false.
   */
  stopBubbling(): void {
    if (this._animation?.type === 'bubbling') {
      this._animation = null;
    }
    this.visible = false;
  }

  /**
   * Shows an alert indicator for the specified duration
   *
   * @param durationMs - How long to show the alert indicator
   * @returns Promise that resolves when the indicator is cleared
   */
  async intrigued(durationMs: number): Promise<void> {
    this._indicator = 'alert';
    await this.delay(durationMs);
    this._indicator = null;
  }

  /**
   * Shows a chat indicator for the specified duration
   *
   * @param durationMs - How long to show the chat indicator
   * @returns Promise that resolves when the indicator is cleared
   */
  async chatting(durationMs: number): Promise<void> {
    this._indicator = 'chat';
    await this.delay(durationMs);
    this._indicator = null;
  }

  /**
   * Stops the current animation
   *
   * If the animation has an onComplete callback, it will be called.
   */
  stopAnimation(): void {
    if (this._animation) {
      if ('onComplete' in this._animation && typeof this._animation.onComplete === 'function') {
        this._animation.onComplete();
      }
      this._animation = null;
    }
  }

  /**
   * Updates the animation state based on elapsed time
   *
   * Should be called regularly (e.g., every frame) to advance animations.
   *
   * @param deltaMs - Time elapsed since last tick in milliseconds
   */
  tick(deltaMs: number): void {
    if (!this._animation) {
      return;
    }

    this._animation.elapsed += deltaMs;

    switch (this._animation.type) {
      case 'walking':
        this.tickWalking(this._animation);
        break;
      case 'hopping':
        this.tickHopping(this._animation);
        break;
      case 'magicSpawn':
      case 'magicDespawn':
      case 'magicTransform':
        this.tickMagic(this._animation);
        break;
      case 'bubbling':
        this.tickBubbling(this._animation);
        break;
    }
  }

  /**
   * Checks if the sprite is at the given position
   *
   * @param pos - The position to check
   * @returns true if the sprite's position matches
   */
  isAt(pos: { row: number; col: number }): boolean {
    return this._position.row === pos.row && this._position.col === pos.col;
  }

  /**
   * Updates walking animation - moves one step every 1000ms toward target
   */
  private tickWalking(anim: Extract<SpriteAnimation, { type: 'walking' }>): void {
    const stepDuration = 1000;

    if (anim.elapsed >= stepDuration) {
      anim.elapsed -= stepDuration;

      // Calculate direction to target
      const dRow = anim.target.row - this._position.row;
      const dCol = anim.target.col - this._position.col;

      if (dRow === 0 && dCol === 0) {
        // Reached target
        const onComplete = anim.onComplete;
        this._animation = null;
        onComplete();
        return;
      }

      // Move one step toward target (prioritize row, then col)
      if (dRow !== 0) {
        this._position.row += dRow > 0 ? 1 : -1;
        playSfx('footstep');
      } else if (dCol !== 0) {
        this._position.col += dCol > 0 ? 1 : -1;
        playSfx('footstep');
      }

      // Check if we've reached the target after this step
      if (this._position.row === anim.target.row && this._position.col === anim.target.col) {
        const onComplete = anim.onComplete;
        this._animation = null;
        onComplete();
      }
    }
  }

  /**
   * Updates hopping animation
   * - Frame 0 (up): 250ms
   * - Frame 1 (down): 250ms
   * - Frame 2 (resting between hops): 150ms
   */
  private tickHopping(anim: Extract<SpriteAnimation, { type: 'hopping' }>): void {
    const hopFrameDuration = 250;
    const restDuration = 150;

    if (anim.frame === 0 && anim.elapsed >= hopFrameDuration) {
      // Up phase complete, switch to down
      anim.elapsed -= hopFrameDuration;
      anim.frame = 1;
      playSfx('jump');
    } else if (anim.frame === 1 && anim.elapsed >= hopFrameDuration) {
      // Down phase complete (landed)
      anim.elapsed -= hopFrameDuration;
      anim.hopsRemaining -= 1;

      if (anim.hopsRemaining <= 0) {
        // All hops complete
        const onComplete = anim.onComplete;
        this._animation = null;
        onComplete();
      } else {
        // Rest briefly before next hop
        anim.frame = 2;
      }
    } else if (anim.frame === 2 && anim.elapsed >= restDuration) {
      // Resting complete, start next hop
      anim.elapsed -= restDuration;
      anim.frame = 0;
    }
  }

  /**
   * Updates magic animations - completes after 400ms
   */
  private tickMagic(
    anim: Extract<SpriteAnimation, { type: 'magicSpawn' | 'magicDespawn' | 'magicTransform' }>,
  ): void {
    const magicDuration = 400;

    if (anim.elapsed >= magicDuration) {
      const onComplete = anim.onComplete;
      this._animation = null;
      onComplete();
    }
  }

  /**
   * Updates bubbling animation - toggles showing based on random intervals
   */
  private tickBubbling(anim: Extract<SpriteAnimation, { type: 'bubbling' }>): void {
    if (anim.elapsed >= anim.phaseDuration) {
      anim.elapsed = 0;
      anim.showing = !anim.showing;
      anim.phaseDuration = this.getRandomBubbleDuration(anim.showing);
    }
  }

  /**
   * Gets a random duration for bubbling animation phase
   *
   * @param isShowing - Whether the bubble is currently showing
   * @returns Duration in milliseconds (400-1200ms for showing, 600-2000ms for hiding)
   */
  private getRandomBubbleDuration(isShowing: boolean): number {
    if (isShowing) {
      // On phase: 400-1200ms
      return 400 + Math.random() * 800;
    } else {
      // Off phase: 600-2000ms
      return 600 + Math.random() * 1400;
    }
  }

  /**
   * Helper to create a delay promise
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
