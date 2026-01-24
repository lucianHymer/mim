/**
 * Animation loop module for managing sprite animations
 *
 * This module provides a centralized animation tick system that manages
 * a collection of sprites and updates them at ~60fps. It tracks actual
 * delta time between ticks for smooth animations regardless of system load.
 */
/**
 * Collection of registered sprites, keyed by their unique ID
 */
const sprites = new Map();
/**
 * Interval handle for the animation loop
 */
let animationInterval = null;
/**
 * Timestamp of the last tick in milliseconds
 */
let lastTickTime = 0;
/**
 * Target interval in milliseconds (~60fps)
 */
const TICK_INTERVAL_MS = 16;
/**
 * Processes one animation tick
 *
 * Calculates the actual elapsed time since the last tick and
 * calls tick() on all registered sprites with the delta time.
 */
function tick() {
    const now = Date.now();
    const deltaMs = lastTickTime === 0 ? TICK_INTERVAL_MS : now - lastTickTime;
    lastTickTime = now;
    for (const sprite of sprites.values()) {
        sprite.tick(deltaMs);
    }
}
/**
 * Register a sprite with the animation loop
 *
 * Once registered, the sprite's tick() method will be called
 * on each animation frame with the elapsed time delta.
 *
 * @param sprite - The sprite to register
 */
export function registerSprite(sprite) {
    sprites.set(sprite.id, sprite);
}
/**
 * Unregister a sprite from the animation loop
 *
 * The sprite will no longer receive tick updates.
 *
 * @param id - The unique ID of the sprite to unregister
 */
export function unregisterSprite(id) {
    sprites.delete(id);
}
/**
 * Get a sprite by ID
 *
 * @param id - The unique ID of the sprite to retrieve
 * @returns The sprite if found, or undefined if not registered
 */
export function getSprite(id) {
    return sprites.get(id);
}
/**
 * Get all registered sprites
 *
 * @returns An array of all currently registered sprites
 */
export function getAllSprites() {
    return Array.from(sprites.values());
}
/**
 * Start the animation loop
 *
 * Runs at ~60fps (16ms interval) but tracks actual delta time
 * for smooth animations. If the loop is already running, this
 * function has no effect.
 */
export function startAnimationLoop() {
    if (animationInterval !== null) {
        return;
    }
    lastTickTime = 0;
    animationInterval = setInterval(tick, TICK_INTERVAL_MS);
}
/**
 * Stop the animation loop
 *
 * Halts the animation tick. Sprites remain registered and can
 * be resumed by calling startAnimationLoop() again.
 */
export function stopAnimationLoop() {
    if (animationInterval !== null) {
        clearInterval(animationInterval);
        animationInterval = null;
        lastTickTime = 0;
    }
}
/**
 * Check if animation loop is running
 *
 * @returns true if the animation loop is currently active
 */
export function isAnimationLoopRunning() {
    return animationInterval !== null;
}
/**
 * Check if any registered sprite has an active animation
 *
 * @returns true if at least one sprite has a non-null animation
 */
export function hasActiveAnimations() {
    for (const sprite of sprites.values()) {
        if (sprite.animation !== null) {
            return true;
        }
    }
    return false;
}
//# sourceMappingURL=animation-loop.js.map