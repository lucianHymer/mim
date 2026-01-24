/**
 * Scene composition and rendering module for the Mim TUI
 *
 * Manages scene creation and rendering with sprite-based characters.
 * This is a minimal version that renders grass tiles - to be customized
 * later for Bridge Guardian and Wellspring scenes.
 */
import type { Sprite } from './sprite.js';
import { type Tileset } from './tileset.js';
/**
 * Tile specification - either a simple tile index or an object with mirroring
 */
export type TileSpec = number | {
    tile: number;
    mirrored: boolean;
};
export declare const SCENE_WIDTH = 7;
export declare const SCENE_HEIGHT = 6;
/**
 * Create a simple 7x6 grid of grass tiles
 *
 * This is a minimal scene for initial setup. It will be customized
 * later for the Bridge Guardian and Wellspring scenes.
 *
 * @param _sprites - Array of Sprites (unused in minimal version)
 */
export declare function createScene(_sprites: Sprite[]): TileSpec[][];
/**
 * Render the scene to an ANSI string
 *
 * @param tileset - The loaded tileset
 * @param background - The tile grid from createScene
 * @param sprites - Array of Sprites to render on top of the background
 */
export declare function renderScene(tileset: Tileset, background: TileSpec[][], sprites: Sprite[]): string;
//# sourceMappingURL=scene.d.ts.map