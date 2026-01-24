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
/**
 * Scene type for selecting different layouts
 */
export type SceneType = 'bridge-guardian' | 'wellspring' | 'default';
export declare const SCENE_WIDTH = 7;
export declare const SCENE_HEIGHT = 6;
/**
 * Create the Bridge Guardian scene (7x6)
 *
 * Layout:
 * Row 0: TREE  TREE  CHASM CHASM CHASM COBBLE COBBLE
 * Row 1: GRASS GRASS CHASM CHASM CHASM COBBLE COBBLE
 * Row 2: TREE  (player) (guardian) BRIDGE BRIDGE COBBLE COBBLE  <-- middle row
 * Row 3: GRASS GRASS CHASM CHASM CHASM COBBLE COBBLE
 * Row 4: TREE  TREE  CHASM CHASM CHASM COBBLE COBBLE
 * Row 5: GRASS TREE  CHASM CHASM CHASM COBBLE COBBLE
 *
 * Note: Player position (2,1) and Guardian position (2,2) are set as grass/chasm,
 * the actual sprites are overlaid during rendering.
 */
export declare function createBridgeGuardianScene(): TileSpec[][];
/**
 * Create the Wellspring scene (7x6)
 *
 * Layout:
 * Row 0: TREE   TREE   TREE   TREE   TREE   TREE   TREE
 * Row 1: TREE   COBBLE COBBLE COBBLE COBBLE COBBLE (odin)
 * Row 2: (enter) COBBLE WATER  WATER  WATER  COBBLE TREE
 * Row 3: TREE   COBBLE WATER  (mim)  WATER  COBBLE TREE
 * Row 4: TREE   COBBLE COBBLE (dest) COBBLE COBBLE TREE
 * Row 5: TREE   TREE   TREE   TREE   TREE   TREE   TREE
 *
 * Note: Positions for sprites (odin at 1,6, enter at 2,0, mim at 3,3, dest at 4,3)
 * use base tiles; sprites are overlaid during rendering.
 */
export declare function createWellspringScene(): TileSpec[][];
/**
 * Create a scene based on the specified type
 *
 * @param _sprites - Array of Sprites (unused, kept for API compatibility)
 * @param sceneType - The type of scene to create (defaults to 'default')
 */
export declare function createScene(_sprites: Sprite[], sceneType?: SceneType): TileSpec[][];
/**
 * Render the scene to an ANSI string
 *
 * @param tileset - The loaded tileset
 * @param background - The tile grid from createScene
 * @param sprites - Array of Sprites to render on top of the background
 */
export declare function renderScene(tileset: Tileset, background: TileSpec[][], sprites: Sprite[]): string;
//# sourceMappingURL=scene.d.ts.map