/**
 * Sound effects module for the Mím TUI
 *
 * Provides simple fire-and-forget sound effect playback.
 * Uses play-sound package for cross-platform support (Linux, Mac, Windows).
 */

import type { ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import playSound from 'play-sound';

// Get package root directory (works when installed globally or locally)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACKAGE_ROOT = path.resolve(__dirname, '..'); // From dist/ to package root

// Create player instance
// play-sound auto-detects available audio players:
// - Mac: afplay
// - Linux: aplay, mpg123, mpg321, play, mplayer, etc.
// - Windows: powershell, cmdmp3
const player = playSound();

/**
 * Music mode type
 */
export type MusicMode = 'on' | 'quiet' | 'off';

/**
 * Sound state
 */
let sfxEnabled = true;

/**
 * Music state - single source of truth
 */
let musicMode: MusicMode = 'on';
let musicProcess: ChildProcess | null = null;
let musicGeneration = 0; // Invalidates pending callbacks on mode change

/**
 * Sound effect filename mappings
 */
export const SFX = {
  footstep: 'footstep.wav',
  jump: 'jump.wav',
  magic: 'magic.wav',
  death: 'death.wav',
  menuLeft: 'menu-left.wav',
  menuRight: 'menu-right.wav',
  menuSelect: 'menu-select.wav',
  quickNotice: 'quick-notice.wav',
  hmm: 'hmm.wav',
} as const;

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
export function playSfx(name: SfxName): void {
  if (!sfxEnabled) return;

  const filename = SFX[name];
  const filepath = path.join(PACKAGE_ROOT, 'assets', 'sounds', filename);

  player.play(filepath, (err) => {
    if (err) {
      // Silently ignore errors - sound is non-critical
      // Uncomment below for debugging:
      // console.error(`Failed to play sound "${name}":`, err);
    }
  });
}

/**
 * Music filenames by mode
 */
const MUSIC_FILES: Record<Exclude<MusicMode, 'off'>, string> = {
  on: 'mim_theme.wav',
  quiet: 'mim_theme_quiet.wav',
};

/**
 * Internal: start the loop for current mode
 */
function playLoop(): void {
  if (musicMode === 'off') return;

  const gen = musicGeneration;
  const file = MUSIC_FILES[musicMode];
  const filepath = path.join(PACKAGE_ROOT, 'assets', 'sounds', file);

  musicProcess = player.play(filepath, () => {
    // Only act if this is still the current generation
    if (gen !== musicGeneration) return;

    musicProcess = null;
    if (musicMode !== 'off') {
      // Use setImmediate to ensure async recursion - prevents stack overflow
      // if play-sound calls callback synchronously on error (no audio player found)
      setImmediate(playLoop);
    }
  }) as ChildProcess;
}

/**
 * Kill the current music process
 */
function killMusicProcess(): void {
  if (musicProcess) {
    musicProcess.kill();
    musicProcess = null;
  }
}

/**
 * Set music mode - THE single function for all music control
 * Stops current playback and starts new track if mode != 'off'
 */
export function setMusicMode(mode: MusicMode): void {
  musicGeneration++; // Invalidate any pending loop callbacks
  musicMode = mode;

  // Stop current playback
  killMusicProcess();

  // Start new if not off
  if (mode !== 'off') {
    playLoop();
  }
}

/**
 * Get current music mode
 */
export function getMusicMode(): MusicMode {
  return musicMode;
}

/**
 * Cycle music mode: on → quiet → off → on
 */
export function cycleMusicMode(): MusicMode {
  const modes: MusicMode[] = ['on', 'quiet', 'off'];
  const nextIndex = (modes.indexOf(musicMode) + 1) % modes.length;
  setMusicMode(modes[nextIndex]);
  return musicMode;
}

/**
 * Start music if mode says we should be playing (for app init)
 */
export function startMusic(): void {
  if (musicMode !== 'off' && !musicProcess) {
    playLoop();
  }
}

/**
 * Stop music (for app exit) - doesn't change mode
 */
export function stopMusic(): void {
  musicGeneration++;
  killMusicProcess();
}

/**
 * Toggle sound effects on/off
 */
export function toggleSfx(): boolean {
  sfxEnabled = !sfxEnabled;
  return sfxEnabled;
}

/**
 * Get current sfx enabled state
 */
export function isSfxEnabled(): boolean {
  return sfxEnabled;
}

/**
 * Disable all sound (music and sfx)
 * Used for --sound-off CLI flag
 */
export function disableAllSound(): void {
  setMusicMode('off');
  sfxEnabled = false;
}
