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

import type { Sprite, SpriteAnimation } from './sprite.js';
import {
  CHAR_HEIGHT,
  compositeQuarterTile,
  compositeTiles,
  extractQuarterTile,
  extractTile,
  mirrorTile,
  type RGB,
  renderTile,
  TILE,
  type Tileset,
} from './tileset.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Tile specification - either a simple tile index or an object with mirroring
 */
export type TileSpec = number | { tile: number; mirrored: boolean };

/**
 * Scene type for selecting different layouts
 */
export type SceneType = 'bridge-approach' | 'bridge-guardian' | 'wellspring' | 'default';

// ============================================================================
// Constants
// ============================================================================

export const SCENE_WIDTH = 7;
export const SCENE_HEIGHT = 6;

/**
 * Get a varied grass tile based on position for visual variety
 * Returns ~30% sparse grass, ~70% regular grass using a deterministic pattern
 */
function getGrassTile(row: number, col: number): number {
  // Use a simple pattern based on position for variety
  // This creates a natural-looking distribution of grass types
  const pattern = (row * 3 + col * 7) % 10;
  if (pattern < 3) return TILE.GRASS_SPARSE;
  return TILE.GRASS;
}

/**
 * Get a varied tree tile based on position for natural look
 * Returns mix of pine and bare trees
 */
function getTreeTile(row: number, col: number): number {
  const pattern = (row * 5 + col * 3) % 10;
  if (pattern < 3) return TILE.BARE_TREE;
  return TILE.PINE_TREE;
}

// ============================================================================
// Tile Render Cache
// ============================================================================

const tileCache: Map<string, string[]> = new Map();

/**
 * Generate cache key for a tile render
 */
function getCacheKey(tileIndex: number, mirrored: boolean): string {
  return `${tileIndex}:${mirrored ? 'M' : 'N'}`;
}

/**
 * Create a pure black tile (for chasm/void rendering)
 */
function createBlackTile(): RGB[][] {
  const pixels: RGB[][] = [];
  for (let y = 0; y < 16; y++) {
    const row: RGB[] = [];
    for (let x = 0; x < 16; x++) {
      row.push({ r: 0, g: 0, b: 0, a: 255 });
    }
    pixels.push(row);
  }
  return pixels;
}

// Cache for the black tile
let blackTileCache: string[] | null = null;

/**
 * Get the cached black tile render
 */
function getBlackTileRender(): string[] {
  if (!blackTileCache) {
    blackTileCache = renderTile(createBlackTile());
  }
  return blackTileCache;
}

/**
 * Get or create a cached tile render
 */
function getTileRender(
  tileset: Tileset,
  grassPixels: RGB[][],
  tileIndex: number,
  mirrored: boolean = false,
): string[] {
  // Special case: CHASM (tile 0) should render as pure black
  if (tileIndex === TILE.CHASM) {
    return getBlackTileRender();
  }

  const key = getCacheKey(tileIndex, mirrored);
  const cached = tileCache.get(key);
  if (cached) {
    return cached;
  }

  let pixels = extractTile(tileset, tileIndex);

  // Composite tiles >= 80 on grass (characters, objects, etc.)
  if (tileIndex >= 80) {
    pixels = compositeTiles(pixels, grassPixels, 1);
  }

  if (mirrored) {
    pixels = mirrorTile(pixels);
  }

  const rendered = renderTile(pixels);
  tileCache.set(key, rendered);
  return rendered;
}

// ============================================================================
// Scene Creation
// ============================================================================

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
export function createBridgeApproachScene(): TileSpec[][] {
  const scene: TileSpec[][] = [];

  for (let row = 0; row < SCENE_HEIGHT; row++) {
    const sceneRow: TileSpec[] = [];
    for (let col = 0; col < SCENE_WIDTH; col++) {
      // Left edge (col 0): Always land/trees
      if (col === 0) {
        if (row === 2) {
          // Grass at bridge level
          sceneRow.push(getGrassTile(row, col));
        } else {
          sceneRow.push(getTreeTile(row, col));
        }
      }
      // Right edge (col 6): Signpost at row 1, grass at row 2, trees elsewhere
      else if (col === 6) {
        if (row === 1) {
          // Signpost tile (using index 63 like Arbiter's ForestIntro)
          sceneRow.push(63);
        } else if (row === 2) {
          // Grass at bridge level
          sceneRow.push(getGrassTile(row, col));
        } else {
          sceneRow.push(getTreeTile(row, col));
        }
      }
      // Row 2: Bridge row (player walks here)
      else if (row === 2) {
        // Bridge tiles across the middle
        sceneRow.push(TILE.BRIDGE_H);
      }
      // Everything else in the middle: Chasm
      else {
        sceneRow.push(TILE.CHASM);
      }
    }
    scene.push(sceneRow);
  }

  return scene;
}

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
export function createBridgeGuardianScene(): TileSpec[][] {
  const scene: TileSpec[][] = [];

  for (let row = 0; row < SCENE_HEIGHT; row++) {
    const sceneRow: TileSpec[] = [];
    for (let col = 0; col < SCENE_WIDTH; col++) {
      // Row 0: All chasm
      if (row === 0) {
        sceneRow.push(TILE.CHASM);
      }
      // Row 1: Bridge extension at col 2 for guardian, rest is chasm
      else if (row === 1) {
        if (col === 2) {
          // Bridge tile extension for guardian to step onto
          sceneRow.push(TILE.BRIDGE_H);
        } else {
          sceneRow.push(TILE.CHASM);
        }
      }
      // Row 2: Bridge row (player walks here)
      else if (row === 2) {
        if (col === 0 || col === 6) {
          // Grass at the ends of the bridge
          sceneRow.push(getGrassTile(row, col));
        } else {
          // Bridge tiles across the middle
          sceneRow.push(TILE.BRIDGE_H);
        }
      }
      // Rows 3-5: All chasm
      else {
        sceneRow.push(TILE.CHASM);
      }
    }
    scene.push(sceneRow);
  }

  return scene;
}

/**
 * Create the Wellspring scene (7x6)
 *
 * Layout:
 * Row 0: TREE   TREE   TREE   TREE   TREE   TREE   TREE
 * Row 1: TREE   GRASS  GRASS  GRASS  GRASS  GRASS  (odin)
 * Row 2: (enter) GRASS  WATER  WATER  WATER  GRASS  TREE
 * Row 3: TREE   GRASS  WATER  (mim)  WATER  GRASS  TREE
 * Row 4: TREE   GRASS  GRASS  (dest) GRASS  GRASS  TREE
 * Row 5: TREE   TREE   TREE   TREE   TREE   TREE   TREE
 *
 * Note: Positions for sprites (odin at 1,6, enter at 2,0, mim at 3,3, dest at 4,3)
 * use base tiles; sprites are overlaid during rendering.
 */
export function createWellspringScene(): TileSpec[][] {
  const scene: TileSpec[][] = [];

  for (let row = 0; row < SCENE_HEIGHT; row++) {
    const sceneRow: TileSpec[] = [];
    for (let col = 0; col < SCENE_WIDTH; col++) {
      // Row 0: All trees
      if (row === 0) {
        sceneRow.push(getTreeTile(row, col));
      }
      // Row 1: Tree, Grass path, Odin position (grass base for Odin at col 6)
      else if (row === 1) {
        if (col === 0) {
          sceneRow.push(getTreeTile(row, col));
        } else {
          // Grass path, including Odin's position at col 6
          sceneRow.push(getGrassTile(row, col));
        }
      }
      // Row 2: Enter position, Grass, Water, Water, Water, Grass, Tree
      else if (row === 2) {
        if (col === 0) {
          // Enter position - use grass as base for player entry
          sceneRow.push(getGrassTile(row, col));
        } else if (col === 1 || col === 5) {
          sceneRow.push(getGrassTile(row, col));
        } else if (col >= 2 && col <= 4) {
          sceneRow.push(TILE.WAVY_WATER);
        } else {
          sceneRow.push(getTreeTile(row, col));
        }
      }
      // Row 3: Tree, Grass, Water, Mim position (water), Water, Grass, Tree
      else if (row === 3) {
        if (col === 0 || col === 6) {
          sceneRow.push(getTreeTile(row, col));
        } else if (col === 1 || col === 5) {
          sceneRow.push(getGrassTile(row, col));
        } else {
          // Water tiles (cols 2-4), including Mim's position at col 3
          sceneRow.push(TILE.WAVY_WATER);
        }
      }
      // Row 4: Tree, Grass path with dest position at col 3, Tree
      else if (row === 4) {
        if (col === 0 || col === 6) {
          sceneRow.push(getTreeTile(row, col));
        } else {
          // Grass path, including destination at col 3
          sceneRow.push(getGrassTile(row, col));
        }
      }
      // Row 5: All trees
      else {
        sceneRow.push(getTreeTile(row, col));
      }
    }
    scene.push(sceneRow);
  }

  return scene;
}

/**
 * Create a simple 7x6 grid of grass tiles (default scene)
 *
 * @param _sprites - Array of Sprites (unused in minimal version)
 */
function createDefaultScene(): TileSpec[][] {
  const scene: TileSpec[][] = [];

  for (let row = 0; row < SCENE_HEIGHT; row++) {
    const sceneRow: TileSpec[] = [];
    for (let col = 0; col < SCENE_WIDTH; col++) {
      // Default to grass tiles with variety
      sceneRow.push(getGrassTile(row, col));
    }
    scene.push(sceneRow);
  }

  return scene;
}

/**
 * Create a scene based on the specified type
 *
 * @param _sprites - Array of Sprites (unused, kept for API compatibility)
 * @param sceneType - The type of scene to create (defaults to 'default')
 */
export function createScene(_sprites: Sprite[], sceneType?: SceneType): TileSpec[][] {
  switch (sceneType) {
    case 'bridge-approach':
      return createBridgeApproachScene();
    case 'bridge-guardian':
      return createBridgeGuardianScene();
    case 'wellspring':
      return createWellspringScene();
    case 'default':
    default:
      return createDefaultScene();
  }
}

// ============================================================================
// Scene Rendering
// ============================================================================

// Cache for the chat bubble quarter tile (extracted once, reused)
let chatBubbleQuarterCache: RGB[][] | null = null;

/**
 * Get or create the cached chat bubble quarter tile
 */
function getChatBubbleQuarter(tileset: Tileset): RGB[][] {
  if (!chatBubbleQuarterCache) {
    const quartersTile = extractTile(tileset, TILE.CHAT_BUBBLE_QUARTERS);
    chatBubbleQuarterCache = extractQuarterTile(quartersTile, 'top-right');
  }
  return chatBubbleQuarterCache;
}

// Cache for the alert/exclamation quarter tile (extracted once, reused)
let alertQuarterCache: RGB[][] | null = null;

/**
 * Get or create the cached alert/exclamation quarter tile
 */
function getAlertQuarter(tileset: Tileset): RGB[][] {
  if (!alertQuarterCache) {
    const quartersTile = extractTile(tileset, TILE.ALERT_QUARTERS);
    alertQuarterCache = extractQuarterTile(quartersTile, 'top-left');
  }
  return alertQuarterCache;
}

/**
 * Render the scene to an ANSI string
 *
 * @param tileset - The loaded tileset
 * @param background - The tile grid from createScene
 * @param sprites - Array of Sprites to render on top of the background
 */
export function renderScene(tileset: Tileset, background: TileSpec[][], sprites: Sprite[]): string {
  // Get grass pixels for compositing
  const grassPixels = extractTile(tileset, TILE.GRASS);

  // Build a map of sprite positions for quick lookup
  // Only include visible sprites
  const spriteMap = new Map<string, Sprite>();

  for (const sprite of sprites) {
    if (sprite.visible) {
      const key = `${sprite.position.row},${sprite.position.col}`;
      spriteMap.set(key, sprite);
    }
  }

  const renderedTiles: string[][][] = [];

  for (let row = 0; row < background.length; row++) {
    const renderedRow: string[][] = [];
    for (let col = 0; col < background[row].length; col++) {
      const tileSpec = background[row][col];
      let tileIndex: number;
      let mirrored = false;

      if (typeof tileSpec === 'number') {
        tileIndex = tileSpec;
      } else {
        tileIndex = tileSpec.tile;
        mirrored = tileSpec.mirrored;
      }

      // Check if there's a sprite at this position
      const posKey = `${row},${col}`;
      const sprite = spriteMap.get(posKey);

      if (sprite) {
        // Determine which tile to render for the sprite
        let spriteTile = sprite.tile;
        const anim = sprite.animation;

        // Handle magic animations - show smoke tile instead
        if (
          anim &&
          (anim.type === 'magicSpawn' ||
            anim.type === 'magicDespawn' ||
            anim.type === 'magicTransform')
        ) {
          spriteTile = TILE.SMOKE;
        }

        // Render sprite tile with potential indicator overlays
        let pixels = extractTile(tileset, spriteTile);

        // Apply mirroring for flipping animation
        if (sprite.mirrored) {
          pixels = mirrorTile(pixels);
        }

        // Composite sprite on the actual background tile at this position
        if (spriteTile >= 80) {
          const backgroundPixels = extractTile(tileset, tileIndex);
          pixels = compositeTiles(pixels, backgroundPixels, 1);
        }

        // Add chat bubble to top-right corner
        if (sprite.indicator === 'chat') {
          const bubbleQuarter = getChatBubbleQuarter(tileset);
          pixels = compositeQuarterTile(pixels, bubbleQuarter, 'top-right', 1);
        }

        // Add alert/exclamation to top-left corner
        if (sprite.indicator === 'alert') {
          const alertQuarter = getAlertQuarter(tileset);
          pixels = compositeQuarterTile(pixels, alertQuarter, 'top-left', 1);
        }

        renderedRow.push(renderTile(pixels));
      } else {
        // Use cached render for background tiles
        renderedRow.push(getTileRender(tileset, grassPixels, tileIndex, mirrored));
      }
    }
    renderedTiles.push(renderedRow);
  }

  // Build output string with hopping animation support
  // When a sprite is hopping (frame 0), shift its render up by 1 row
  const lines: string[] = [];
  for (let tileRow = 0; tileRow < background.length; tileRow++) {
    for (let charRow = 0; charRow < CHAR_HEIGHT; charRow++) {
      let line = '';
      for (let tileCol = 0; tileCol < background[tileRow].length; tileCol++) {
        // Check if there's a hopping sprite at this position
        const posKey = `${tileRow},${tileCol}`;
        const sprite = spriteMap.get(posKey);
        const isHoppingUp =
          sprite?.animation?.type === 'hopping' &&
          (sprite.animation as Extract<SpriteAnimation, { type: 'hopping' }>).frame === 0;

        // Check if tile below has a hopping sprite (for overflow effect)
        const posKeyBelow = `${tileRow + 1},${tileCol}`;
        const spriteBelow = spriteMap.get(posKeyBelow);
        const isTileBelowHopping =
          spriteBelow?.animation?.type === 'hopping' &&
          (spriteBelow.animation as Extract<SpriteAnimation, { type: 'hopping' }>).frame === 0;

        if (isHoppingUp) {
          // For the hopping tile, show the row below (shifted up)
          if (charRow === 0) {
            // First char row of hopping tile shows second row of the tile
            line += renderedTiles[tileRow][tileCol][1];
          } else if (charRow === CHAR_HEIGHT - 1) {
            // Last char row shows grass (the tile has moved up)
            line += renderedTiles[tileRow][tileCol][charRow];
          } else {
            // Show the next row down (shifted up by 1)
            line += renderedTiles[tileRow][tileCol][charRow + 1];
          }
        } else if (isTileBelowHopping) {
          // For the tile above the hopping tile, the last row shows the first row of the hopping tile
          if (charRow === CHAR_HEIGHT - 1) {
            line += renderedTiles[tileRow + 1][tileCol][0];
          } else {
            line += renderedTiles[tileRow][tileCol][charRow];
          }
        } else {
          line += renderedTiles[tileRow][tileCol][charRow];
        }
      }
      lines.push(line);
    }
  }

  // Join with newlines (no trailing newline to prevent extra line causing flicker)
  return lines.join('\n');
}
