/**
 * Scene composition and rendering module for the Mim TUI
 *
 * Manages scene creation and rendering with sprite-based characters.
 * This is a minimal version that renders grass tiles - to be customized
 * later for Bridge Guardian and Wellspring scenes.
 */
import { CHAR_HEIGHT, compositeQuarterTile, compositeTiles, extractQuarterTile, extractTile, mirrorTile, renderTile, TILE, } from './tileset.js';
// ============================================================================
// Constants
// ============================================================================
export const SCENE_WIDTH = 7;
export const SCENE_HEIGHT = 6;
/**
 * Get a varied grass tile based on position for visual variety
 * Returns ~30% sparse grass, ~70% regular grass using a deterministic pattern
 */
function getGrassTile(row, col) {
    // Use a simple pattern based on position for variety
    // This creates a natural-looking distribution of grass types
    const pattern = (row * 3 + col * 7) % 10;
    if (pattern < 3)
        return TILE.GRASS_SPARSE;
    return TILE.GRASS;
}
/**
 * Get a varied tree tile based on position for natural look
 * Returns mix of pine and bare trees
 */
function getTreeTile(row, col) {
    const pattern = (row * 5 + col * 3) % 10;
    if (pattern < 3)
        return TILE.BARE_TREE;
    return TILE.PINE_TREE;
}
// ============================================================================
// Tile Render Cache
// ============================================================================
const tileCache = new Map();
/**
 * Generate cache key for a tile render
 */
function getCacheKey(tileIndex, mirrored) {
    return `${tileIndex}:${mirrored ? 'M' : 'N'}`;
}
/**
 * Get or create a cached tile render
 */
function getTileRender(tileset, grassPixels, tileIndex, mirrored = false) {
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
export function createBridgeGuardianScene() {
    const scene = [];
    for (let row = 0; row < SCENE_HEIGHT; row++) {
        const sceneRow = [];
        for (let col = 0; col < SCENE_WIDTH; col++) {
            // Right side: Cobblestone (cols 5-6)
            if (col >= 5) {
                sceneRow.push(TILE.COBBLESTONE);
            }
            // Chasm area (cols 2-4), except bridge on row 2
            else if (col >= 2 && col <= 4) {
                if (row === 2 && col >= 3) {
                    // Bridge tiles on the middle row (cols 3-4)
                    sceneRow.push(TILE.BRIDGE_H);
                }
                else if (row === 2 && col === 2) {
                    // Guardian position - use chasm as base (sprite will be overlaid)
                    sceneRow.push(TILE.CHASM);
                }
                else {
                    sceneRow.push(TILE.CHASM);
                }
            }
            // Left side: Trees and grass (cols 0-1)
            else {
                // Row 0: Trees
                if (row === 0) {
                    sceneRow.push(getTreeTile(row, col));
                }
                // Row 1: Grass
                else if (row === 1) {
                    sceneRow.push(getGrassTile(row, col));
                }
                // Row 2: Tree at col 0, grass at col 1 (player position)
                else if (row === 2) {
                    if (col === 0) {
                        sceneRow.push(getTreeTile(row, col));
                    }
                    else {
                        sceneRow.push(getGrassTile(row, col)); // Player position
                    }
                }
                // Row 3: Grass
                else if (row === 3) {
                    sceneRow.push(getGrassTile(row, col));
                }
                // Row 4: Trees
                else if (row === 4) {
                    sceneRow.push(getTreeTile(row, col));
                }
                // Row 5: Grass at col 0, Tree at col 1
                else {
                    if (col === 0) {
                        sceneRow.push(getGrassTile(row, col));
                    }
                    else {
                        sceneRow.push(getTreeTile(row, col));
                    }
                }
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
 * Row 1: TREE   COBBLE COBBLE COBBLE COBBLE COBBLE (odin)
 * Row 2: (enter) COBBLE WATER  WATER  WATER  COBBLE TREE
 * Row 3: TREE   COBBLE WATER  (mim)  WATER  COBBLE TREE
 * Row 4: TREE   COBBLE COBBLE (dest) COBBLE COBBLE TREE
 * Row 5: TREE   TREE   TREE   TREE   TREE   TREE   TREE
 *
 * Note: Positions for sprites (odin at 1,6, enter at 2,0, mim at 3,3, dest at 4,3)
 * use base tiles; sprites are overlaid during rendering.
 */
export function createWellspringScene() {
    const scene = [];
    for (let row = 0; row < SCENE_HEIGHT; row++) {
        const sceneRow = [];
        for (let col = 0; col < SCENE_WIDTH; col++) {
            // Row 0: All trees
            if (row === 0) {
                sceneRow.push(getTreeTile(row, col));
            }
            // Row 1: Tree, Cobbles, Odin position (tree base for Odin at col 6)
            else if (row === 1) {
                if (col === 0) {
                    sceneRow.push(getTreeTile(row, col));
                }
                else if (col === 6) {
                    // Odin position - use cobblestone as base
                    sceneRow.push(TILE.COBBLESTONE);
                }
                else {
                    sceneRow.push(TILE.COBBLESTONE);
                }
            }
            // Row 2: Enter position, Cobble, Water, Water, Water, Cobble, Tree
            else if (row === 2) {
                if (col === 0) {
                    // Enter position - use grass as base for player entry
                    sceneRow.push(getGrassTile(row, col));
                }
                else if (col === 1 || col === 5) {
                    sceneRow.push(TILE.COBBLESTONE);
                }
                else if (col >= 2 && col <= 4) {
                    sceneRow.push(TILE.WAVY_WATER);
                }
                else {
                    sceneRow.push(getTreeTile(row, col));
                }
            }
            // Row 3: Tree, Cobble, Water, Mim position (water), Water, Cobble, Tree
            else if (row === 3) {
                if (col === 0 || col === 6) {
                    sceneRow.push(getTreeTile(row, col));
                }
                else if (col === 1 || col === 5) {
                    sceneRow.push(TILE.COBBLESTONE);
                }
                else {
                    // Water tiles (cols 2-4), including Mim's position at col 3
                    sceneRow.push(TILE.WAVY_WATER);
                }
            }
            // Row 4: Tree, Cobbles with dest position at col 3, Tree
            else if (row === 4) {
                if (col === 0 || col === 6) {
                    sceneRow.push(getTreeTile(row, col));
                }
                else {
                    // Cobblestone path, including destination at col 3
                    sceneRow.push(TILE.COBBLESTONE);
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
function createDefaultScene() {
    const scene = [];
    for (let row = 0; row < SCENE_HEIGHT; row++) {
        const sceneRow = [];
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
export function createScene(_sprites, sceneType) {
    switch (sceneType) {
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
let chatBubbleQuarterCache = null;
/**
 * Get or create the cached chat bubble quarter tile
 */
function getChatBubbleQuarter(tileset) {
    if (!chatBubbleQuarterCache) {
        const quartersTile = extractTile(tileset, TILE.CHAT_BUBBLE_QUARTERS);
        chatBubbleQuarterCache = extractQuarterTile(quartersTile, 'top-right');
    }
    return chatBubbleQuarterCache;
}
// Cache for the alert/exclamation quarter tile (extracted once, reused)
let alertQuarterCache = null;
/**
 * Get or create the cached alert/exclamation quarter tile
 */
function getAlertQuarter(tileset) {
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
export function renderScene(tileset, background, sprites) {
    // Get grass pixels for compositing
    const grassPixels = extractTile(tileset, TILE.GRASS);
    // Build a map of sprite positions for quick lookup
    // Only include visible sprites
    const spriteMap = new Map();
    for (const sprite of sprites) {
        if (sprite.visible) {
            const key = `${sprite.position.row},${sprite.position.col}`;
            spriteMap.set(key, sprite);
        }
    }
    const renderedTiles = [];
    for (let row = 0; row < background.length; row++) {
        const renderedRow = [];
        for (let col = 0; col < background[row].length; col++) {
            const tileSpec = background[row][col];
            let tileIndex;
            let mirrored = false;
            if (typeof tileSpec === 'number') {
                tileIndex = tileSpec;
            }
            else {
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
                if (anim &&
                    (anim.type === 'magicSpawn' ||
                        anim.type === 'magicDespawn' ||
                        anim.type === 'magicTransform')) {
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
            }
            else {
                // Use cached render for background tiles
                renderedRow.push(getTileRender(tileset, grassPixels, tileIndex, mirrored));
            }
        }
        renderedTiles.push(renderedRow);
    }
    // Build output string with hopping animation support
    // When a sprite is hopping (frame 0), shift its render up by 1 row
    const lines = [];
    for (let tileRow = 0; tileRow < background.length; tileRow++) {
        for (let charRow = 0; charRow < CHAR_HEIGHT; charRow++) {
            let line = '';
            for (let tileCol = 0; tileCol < background[tileRow].length; tileCol++) {
                // Check if there's a hopping sprite at this position
                const posKey = `${tileRow},${tileCol}`;
                const sprite = spriteMap.get(posKey);
                const isHoppingUp = sprite?.animation?.type === 'hopping' &&
                    sprite.animation.frame === 0;
                // Check if tile below has a hopping sprite (for overflow effect)
                const posKeyBelow = `${tileRow + 1},${tileCol}`;
                const spriteBelow = spriteMap.get(posKeyBelow);
                const isTileBelowHopping = spriteBelow?.animation?.type === 'hopping' &&
                    spriteBelow.animation.frame === 0;
                if (isHoppingUp) {
                    // For the hopping tile, show the row below (shifted up)
                    if (charRow === 0) {
                        // First char row of hopping tile shows second row of the tile
                        line += renderedTiles[tileRow][tileCol][1];
                    }
                    else if (charRow === CHAR_HEIGHT - 1) {
                        // Last char row shows grass (the tile has moved up)
                        line += renderedTiles[tileRow][tileCol][charRow];
                    }
                    else {
                        // Show the next row down (shifted up by 1)
                        line += renderedTiles[tileRow][tileCol][charRow + 1];
                    }
                }
                else if (isTileBelowHopping) {
                    // For the tile above the hopping tile, the last row shows the first row of the hopping tile
                    if (charRow === CHAR_HEIGHT - 1) {
                        line += renderedTiles[tileRow + 1][tileCol][0];
                    }
                    else {
                        line += renderedTiles[tileRow][tileCol][charRow];
                    }
                }
                else {
                    line += renderedTiles[tileRow][tileCol][charRow];
                }
            }
            lines.push(line);
        }
    }
    // Join with newlines (no trailing newline to prevent extra line causing flicker)
    return lines.join('\n');
}
//# sourceMappingURL=scene.js.map