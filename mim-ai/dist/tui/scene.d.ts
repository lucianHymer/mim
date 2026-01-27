/**
 * Scene composition and rendering module for the Mim TUI
 *
 * Manages scene creation and rendering with sprite-based characters.
 *
 * ## Scene Builders
 * - `createBridgeApproachScene()`: Chasm crossing with signpost warning
 * - `createBridgeGuardianScene()`: Bridge/chasm layout with guardian blocking passage
 * - `createWellspringScene()`: Water/grass clearing with Mím's head floating in pool
 * - `createDefaultScene()`: Simple grass field (fallback)
 * - `createScene(sprites, sceneType)`: Routes to correct scene builder by SceneType
 * - `renderScene(tileset, background, sprites)`: Sprite overlay rendering with animation support
 *
 * All scenes are 7×6 tiles (SCENE_WIDTH × SCENE_HEIGHT).
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
export type SceneType = 'bridge-approach' | 'bridge-guardian' | 'wellspring' | 'default';
export declare const SCENE_WIDTH = 7;
export declare const SCENE_HEIGHT = 6;
/**
 * Create the Bridge Approach scene (7x6)
 *
 * Player walks across a narrow bridge over a chasm to reach the guardian.
 * A signpost on the right edge warns of what lies ahead.
 *
 * Layout:
 * Row 0: TREE   CHASM  CHASM  CHASM  CHASM  CHASM  TREE    (land on edges)
 * Row 1: TREE   CHASM  CHASM  CHASM  CHASM  CHASM  SIGN    (signpost on right edge)
 * Row 2: GRASS  BRIDGE BRIDGE BRIDGE BRIDGE BRIDGE GRASS   (bridge - player walks here)
 * Row 3: TREE   CHASM  CHASM  CHASM  CHASM  CHASM  TREE    (land on edges)
 * Row 4: TREE   CHASM  CHASM  CHASM  CHASM  CHASM  TREE    (land on edges)
 * Row 5: TREE   CHASM  CHASM  CHASM  CHASM  CHASM  TREE    (land on edges)
 *
 * Player starts at (2, 0), exits at (2, 6) to transition to BRIDGE_GUARDIAN.
 * Walking into chasm (cols 1-5 except bridge row) results in death.
 */
export declare function createBridgeApproachScene(): TileSpec[][];
/**
 * Create the Bridge Guardian scene (7x6)
 *
 * Layout (same style as Bridge Approach):
 * Row 0: CHASM  CHASM  CHASM  CHASM  CHASM  CHASM  CHASM   (chasm)
 * Row 1: CHASM  CHASM  BRIDGE CHASM  CHASM  CHASM  CHASM   (bridge extension for guardian to step aside)
 * Row 2: GRASS  BRIDGE BRIDGE BRIDGE BRIDGE BRIDGE GRASS   (bridge - player crosses here)
 * Row 3: CHASM  CHASM  CHASM  CHASM  CHASM  CHASM  CHASM   (chasm)
 * Row 4: CHASM  CHASM  CHASM  CHASM  CHASM  CHASM  CHASM   (chasm)
 * Row 5: CHASM  CHASM  CHASM  CHASM  CHASM  CHASM  CHASM   (chasm)
 *
 * Guardian starts on the bridge blocking passage (row 2, col 2-3).
 * Player enters from left (row 2, col 0).
 * Guardian has bridge extension at (row 1, col 2) to step onto when letting player pass.
 * Player exits right (row 2, col 6).
 */
export declare function createBridgeGuardianScene(): TileSpec[][];
/**
 * Create the Wellspring scene (7x6)
 *
 * Layout:
 * Row 0: TREE   TREE   TREE   TREE   TREE   TREE   TREE
 * Row 1: TREE   GRASS  WATER  WATER  WATER  GRASS  (odin)
 * Row 2: (enter) GRASS  WATER  WATER  WATER  GRASS  TREE
 * Row 3: TREE   GRASS  WATER  (mim)  WATER  GRASS  TREE
 * Row 4: TREE   GRASS  GRASS  (dest) GRASS  GRASS  TREE
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