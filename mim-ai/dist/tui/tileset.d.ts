/**
 * Tileset loading and rendering utilities for the Mím TUI
 *
 * Provides functions for loading PNG tilesets, extracting individual tiles,
 * compositing tiles together, and rendering them to ANSI terminal output.
 */
export declare const TILE_SIZE = 16;
export declare const TILES_PER_ROW = 10;
export declare const CHAR_HEIGHT = 8;
export declare const RESET = "\u001B[0m";
export declare const CLEAR_SCREEN = "\u001B[2J";
export declare const CURSOR_HOME = "\u001B[H";
export declare const HIDE_CURSOR = "\u001B[?25l";
export declare const SHOW_CURSOR = "\u001B[?25h";
export declare const TILE: {
    readonly GRASS: 50;
    readonly GRASS_SPARSE: 51;
    readonly PINE_TREE: 57;
    readonly BARE_TREE: 58;
    readonly CAULDRON: 86;
    readonly CAMPFIRE: 87;
    readonly SMOKE: 90;
    readonly SPELLBOOK: 102;
    readonly HUMAN_1: 190;
    readonly HUMAN_2: 191;
    readonly HUMAN_3: 192;
    readonly HUMAN_4: 193;
    readonly HUMAN_5: 194;
    readonly HUMAN_6: 195;
    readonly HUMAN_7: 196;
    readonly HUMAN_8: 197;
    readonly ARBITER: 205;
    readonly DEMON_1: 220;
    readonly DEMON_2: 221;
    readonly DEMON_3: 222;
    readonly DEMON_4: 223;
    readonly DEMON_5: 224;
    readonly DEMON_6: 225;
    readonly DEMON_7: 226;
    readonly DEMON_8: 227;
    readonly DEMON_9: 228;
    readonly DEMON_10: 229;
    readonly FOCUS: 270;
    readonly CHAT_BUBBLE_QUARTERS: 267;
    readonly ALERT_QUARTERS: 268;
    readonly SCROLL: 124;
    readonly WATER: 70;
    readonly BRIDGE: 71;
    readonly COBBLESTONE: 12;
    readonly WAVY_WATER: 55;
    readonly BRIDGE_H: 59;
    readonly GUARDIAN: 199;
    readonly ODIN: 209;
    readonly MIM: 216;
    readonly CHASM: 0;
};
export type QuarterPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export interface RGB {
    r: number;
    g: number;
    b: number;
    a: number;
}
export interface Tileset {
    width: number;
    height: number;
    data: Buffer;
}
/**
 * Load the tileset PNG and return cached data
 */
export declare function loadTileset(): Promise<Tileset>;
/**
 * Extract a 16x16 tile by index from the tileset
 */
export declare function extractTile(tileset: Tileset, index: number): RGB[][];
/**
 * Composite foreground tile on background tile using alpha threshold
 * Pixels with alpha below threshold use the background pixel
 */
export declare function compositeTiles(fg: RGB[][], bg: RGB[][], alphaThreshold: number): RGB[][];
/**
 * Composite focus overlay on character tile
 * The focus overlay has transparent center, only the corner brackets show
 */
export declare function compositeWithFocus(charPixels: RGB[][], focusPixels: RGB[][], alphaThreshold?: number): RGB[][];
/**
 * Mirror a tile horizontally (flip left-right)
 */
export declare function mirrorTile(pixels: RGB[][]): RGB[][];
/**
 * Extract an 8x8 quarter from a 16x16 tile
 * @param pixels The full 16x16 tile pixels
 * @param quarter Which quarter to extract
 * @returns 8x8 pixel array
 */
export declare function extractQuarterTile(pixels: RGB[][], quarter: QuarterPosition): RGB[][];
/**
 * Composite an 8x8 quarter tile onto a specific corner of a 16x16 tile
 * @param base The full 16x16 tile pixels (will be cloned, not mutated)
 * @param quarter The 8x8 quarter tile to overlay
 * @param position Where to place the quarter tile
 * @param alphaThreshold Pixels with alpha below this use the base pixel
 * @returns New 16x16 pixel array with quarter composited
 */
export declare function compositeQuarterTile(base: RGB[][], quarter: RGB[][], position: QuarterPosition, alphaThreshold?: number): RGB[][];
/**
 * Render a tile to ANSI string array (16 chars wide x 8 rows)
 * Uses half-block characters for 2:1 vertical compression
 */
export declare function renderTile(pixels: RGB[][]): string[];
//# sourceMappingURL=tileset.d.ts.map