/**
 * Scene composition and rendering module for the Mim TUI
 *
 * Manages scene creation and rendering with sprite-based characters.
 * This is a minimal version that renders grass tiles - to be customized
 * later for Bridge Guardian and Wellspring scenes.
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
 * Get or create a cached tile render
 */
function getTileRender(
  tileset: Tileset,
  grassPixels: RGB[][],
  tileIndex: number,
  mirrored: boolean = false,
): string[] {
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
 * Create a simple 7x6 grid of grass tiles
 *
 * This is a minimal scene for initial setup. It will be customized
 * later for the Bridge Guardian and Wellspring scenes.
 *
 * @param _sprites - Array of Sprites (unused in minimal version)
 */
export function createScene(_sprites: Sprite[]): TileSpec[][] {
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

        // Composite on grass if needed
        if (spriteTile >= 80) {
          pixels = compositeTiles(pixels, grassPixels, 1);
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
