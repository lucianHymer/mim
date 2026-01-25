/**
 * Sound effects module for the Mím TUI
 *
 * Provides simple fire-and-forget sound effect playback.
 * Uses play-sound package for cross-platform support (Linux, Mac, Windows).
 */
/**
 * Music mode type
 */
export type MusicMode = 'on' | 'quiet' | 'off';
/**
 * Sound effect filename mappings
 */
export declare const SFX: {
    readonly footstep: "footstep.wav";
    readonly jump: "jump.wav";
    readonly magic: "magic.wav";
    readonly death: "death.wav";
    readonly menuLeft: "menu-left.wav";
    readonly menuRight: "menu-right.wav";
    readonly menuSelect: "menu-select.wav";
    readonly quickNotice: "quick-notice.wav";
    readonly hmm: "hmm.wav";
};
/**
 * Type for valid sound effect names
 */
export type SfxName = keyof typeof SFX;
/**
 * Play a sound effect by name
 *
 * Fire-and-forget: does not await, catches errors silently
 *
 * @param name - The name of the sound effect to play
 */
export declare function playSfx(name: SfxName): void;
/**
 * Set music mode - THE single function for all music control
 * Stops current playback and starts new track if mode != 'off'
 */
export declare function setMusicMode(mode: MusicMode): void;
/**
 * Get current music mode
 */
export declare function getMusicMode(): MusicMode;
/**
 * Cycle music mode: on → quiet → off → on
 */
export declare function cycleMusicMode(): MusicMode;
/**
 * Start music if mode says we should be playing (for app init)
 */
export declare function startMusic(): void;
/**
 * Stop music (for app exit) - doesn't change mode
 */
export declare function stopMusic(): void;
/**
 * Toggle sound effects on/off
 */
export declare function toggleSfx(): boolean;
/**
 * Get current sfx enabled state
 */
export declare function isSfxEnabled(): boolean;
/**
 * Disable all sound (music and sfx)
 * Used for --sound-off CLI flag
 */
export declare function disableAllSound(): void;
//# sourceMappingURL=sound.d.ts.map