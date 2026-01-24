/**
 * Animation loop module for managing sprite animations
 *
 * This module provides a centralized animation tick system that manages
 * a collection of sprites and updates them at ~60fps. It tracks actual
 * delta time between ticks for smooth animations regardless of system load.
 */
import { Sprite } from './sprite.js';
/**
 * Register a sprite with the animation loop
 *
 * Once registered, the sprite's tick() method will be called
 * on each animation frame with the elapsed time delta.
 *
 * @param sprite - The sprite to register
 */
export declare function registerSprite(sprite: Sprite): void;
/**
 * Unregister a sprite from the animation loop
 *
 * The sprite will no longer receive tick updates.
 *
 * @param id - The unique ID of the sprite to unregister
 */
export declare function unregisterSprite(id: string): void;
/**
 * Get a sprite by ID
 *
 * @param id - The unique ID of the sprite to retrieve
 * @returns The sprite if found, or undefined if not registered
 */
export declare function getSprite(id: string): Sprite | undefined;
/**
 * Get all registered sprites
 *
 * @returns An array of all currently registered sprites
 */
export declare function getAllSprites(): Sprite[];
/**
 * Start the animation loop
 *
 * Runs at ~60fps (16ms interval) but tracks actual delta time
 * for smooth animations. If the loop is already running, this
 * function has no effect.
 */
export declare function startAnimationLoop(): void;
/**
 * Stop the animation loop
 *
 * Halts the animation tick. Sprites remain registered and can
 * be resumed by calling startAnimationLoop() again.
 */
export declare function stopAnimationLoop(): void;
/**
 * Check if animation loop is running
 *
 * @returns true if the animation loop is currently active
 */
export declare function isAnimationLoopRunning(): boolean;
/**
 * Check if any registered sprite has an active animation
 *
 * @returns true if at least one sprite has a non-null animation
 */
export declare function hasActiveAnimations(): boolean;
//# sourceMappingURL=animation-loop.d.ts.map