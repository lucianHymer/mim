/**
 * Tileset loading and rendering utilities for the Mím TUI
 *
 * Provides functions for loading PNG tilesets, extracting individual tiles,
 * compositing tiles together, and rendering them to ANSI terminal output.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
// ============================================================================
// Constants
// ============================================================================
export const TILE_SIZE = 16;
export const TILES_PER_ROW = 10;
export const CHAR_HEIGHT = 8; // 16 pixels / 2 due to half-block rendering
// Get package root directory (works when installed globally or locally)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACKAGE_ROOT = path.resolve(__dirname, '..', '..'); // From dist/tui/ to package root
const TILESET_PATH = path.join(PACKAGE_ROOT, 'assets/jerom_16x16.png');
// ANSI escape sequences
export const RESET = '\x1b[0m';
export const CLEAR_SCREEN = '\x1b[2J';
export const CURSOR_HOME = '\x1b[H';
export const HIDE_CURSOR = '\x1b[?25l';
export const SHOW_CURSOR = '\x1b[?25h';
// Key tile indices from the tileset
export const TILE = {
    GRASS: 50,
    GRASS_SPARSE: 51,
    PINE_TREE: 57,
    BARE_TREE: 58,
    CAULDRON: 86,
    CAMPFIRE: 87,
    SMOKE: 90,
    SPELLBOOK: 102,
    HUMAN_1: 190,
    HUMAN_2: 191,
    HUMAN_3: 192,
    HUMAN_4: 193,
    HUMAN_5: 194,
    HUMAN_6: 195,
    HUMAN_7: 196,
    HUMAN_8: 197,
    ARBITER: 205,
    DEMON_1: 220,
    DEMON_2: 221,
    DEMON_3: 222,
    DEMON_4: 223,
    DEMON_5: 224,
    DEMON_6: 225,
    DEMON_7: 226,
    DEMON_8: 227,
    DEMON_9: 228,
    DEMON_10: 229,
    FOCUS: 270, // Focus overlay - corner brackets to highlight active speaker
    CHAT_BUBBLE_QUARTERS: 267, // Quarter tiles - top-right is chat bubble indicator
    ALERT_QUARTERS: 268, // Quarter tiles - top-left is exclamation/alert indicator
    SCROLL: 124,
    // Mím-specific tiles
    WATER: 70, // Water tile for the Wellspring
    BRIDGE: 71, // Bridge tile
    COBBLESTONE: 12,
    WAVY_WATER: 55, // For Wellspring pool
    BRIDGE_H: 59, // Horizontal bridge piece
    GUARDIAN: 199, // Bridge guardian (cloaked figure)
    ODIN: 209, // Odin watching at Wellspring
    MIM: 216, // Mim's head in the water
    TENTACLE: 219, // Tentacle for Wellspring water animation
    CHASM: 0, // Dark/empty tile for the chasm
};
// ============================================================================
// Core Functions
// ============================================================================
/**
 * Load the tileset PNG and return cached data
 */
export async function loadTileset() {
    const image = sharp(TILESET_PATH);
    const { data, info } = await image.raw().ensureAlpha().toBuffer({ resolveWithObject: true });
    return { width: info.width, height: info.height, data };
}
/**
 * Get a single pixel from the tileset data buffer
 */
function getPixel(data, width, x, y) {
    const idx = (y * width + x) * 4;
    return { r: data[idx], g: data[idx + 1], b: data[idx + 2], a: data[idx + 3] };
}
/**
 * Extract a 16x16 tile by index from the tileset
 */
export function extractTile(tileset, index) {
    const tileX = (index % TILES_PER_ROW) * TILE_SIZE;
    const tileY = Math.floor(index / TILES_PER_ROW) * TILE_SIZE;
    const pixels = [];
    for (let y = 0; y < TILE_SIZE; y++) {
        const row = [];
        for (let x = 0; x < TILE_SIZE; x++) {
            row.push(getPixel(tileset.data, tileset.width, tileX + x, tileY + y));
        }
        pixels.push(row);
    }
    return pixels;
}
/**
 * Composite foreground tile on background tile using alpha threshold
 * Pixels with alpha below threshold use the background pixel
 */
export function compositeTiles(fg, bg, alphaThreshold) {
    const size = fg.length;
    const result = [];
    for (let y = 0; y < size; y++) {
        const row = [];
        for (let x = 0; x < size; x++) {
            const fgPx = fg[y][x];
            const bgPx = bg[y]?.[x] || fgPx;
            row.push(fgPx.a < alphaThreshold ? bgPx : fgPx);
        }
        result.push(row);
    }
    return result;
}
/**
 * Composite focus overlay on character tile
 * The focus overlay has transparent center, only the corner brackets show
 */
export function compositeWithFocus(charPixels, focusPixels, alphaThreshold = 1) {
    const size = charPixels.length;
    const result = [];
    for (let y = 0; y < size; y++) {
        const row = [];
        for (let x = 0; x < size; x++) {
            const focusPx = focusPixels[y][x];
            const charPx = charPixels[y][x];
            // Focus overlay: if focus pixel is opaque, use it; otherwise use character
            row.push(focusPx.a >= alphaThreshold ? focusPx : charPx);
        }
        result.push(row);
    }
    return result;
}
/**
 * Mirror a tile horizontally (flip left-right)
 */
export function mirrorTile(pixels) {
    return pixels.map((row) => [...row].reverse());
}
/**
 * Extract an 8x8 quarter from a 16x16 tile
 * @param pixels The full 16x16 tile pixels
 * @param quarter Which quarter to extract
 * @returns 8x8 pixel array
 */
export function extractQuarterTile(pixels, quarter) {
    const halfSize = TILE_SIZE / 2; // 8
    let startX = 0;
    let startY = 0;
    switch (quarter) {
        case 'top-left':
            startX = 0;
            startY = 0;
            break;
        case 'top-right':
            startX = halfSize;
            startY = 0;
            break;
        case 'bottom-left':
            startX = 0;
            startY = halfSize;
            break;
        case 'bottom-right':
            startX = halfSize;
            startY = halfSize;
            break;
    }
    const result = [];
    for (let y = 0; y < halfSize; y++) {
        const row = [];
        for (let x = 0; x < halfSize; x++) {
            row.push(pixels[startY + y][startX + x]);
        }
        result.push(row);
    }
    return result;
}
/**
 * Composite an 8x8 quarter tile onto a specific corner of a 16x16 tile
 * @param base The full 16x16 tile pixels (will be cloned, not mutated)
 * @param quarter The 8x8 quarter tile to overlay
 * @param position Where to place the quarter tile
 * @param alphaThreshold Pixels with alpha below this use the base pixel
 * @returns New 16x16 pixel array with quarter composited
 */
export function compositeQuarterTile(base, quarter, position, alphaThreshold = 1) {
    const halfSize = TILE_SIZE / 2; // 8
    let startX = 0;
    let startY = 0;
    switch (position) {
        case 'top-left':
            startX = 0;
            startY = 0;
            break;
        case 'top-right':
            startX = halfSize;
            startY = 0;
            break;
        case 'bottom-left':
            startX = 0;
            startY = halfSize;
            break;
        case 'bottom-right':
            startX = halfSize;
            startY = halfSize;
            break;
    }
    // Clone the base tile
    const result = base.map((row) => row.map((px) => ({ ...px })));
    // Overlay the quarter
    for (let y = 0; y < halfSize; y++) {
        for (let x = 0; x < halfSize; x++) {
            const quarterPx = quarter[y][x];
            if (quarterPx.a >= alphaThreshold) {
                result[startY + y][startX + x] = quarterPx;
            }
        }
    }
    return result;
}
/**
 * Generate ANSI true color escape sequence
 */
function tc(r, g, b, bg) {
    return bg ? `\x1b[48;2;${r};${g};${b}m` : `\x1b[38;2;${r};${g};${b}m`;
}
/**
 * Render a tile to ANSI string array (16 chars wide x 8 rows)
 * Uses half-block characters for 2:1 vertical compression
 */
export function renderTile(pixels) {
    const lines = [];
    for (let y = 0; y < TILE_SIZE; y += 2) {
        let line = '';
        for (let x = 0; x < TILE_SIZE; x++) {
            const top = pixels[y][x];
            const bot = pixels[y + 1]?.[x] || top;
            line += `${tc(top.r, top.g, top.b, true) + tc(bot.r, bot.g, bot.b, false)}▄`;
        }
        line += RESET;
        lines.push(line);
    }
    return lines;
}
//# sourceMappingURL=tileset.js.map