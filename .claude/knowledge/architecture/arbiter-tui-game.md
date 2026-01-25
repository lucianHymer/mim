# Arbiter TUI Game Architecture

## Core Screens

### TitleScreen
**File:** `/workspace/arbiter/src/tui/screens/TitleScreen-termkit.ts`
- Displays ASCII art "The Arbiter" with diagonal fire gradient (white→yellow→orange→red)
- Uses 14-color palette for fire effect with row-weighted diagonal calculation
- Shows sound control hints (m: music toggle, s: sfx toggle) with colored state indicators
- Continues on any key press to CharacterSelect

### CharacterSelect
**File:** `/workspace/arbiter/src/tui/screens/CharacterSelect-termkit.ts`
- Displays 8 human characters (HUMAN_1 through HUMAN_8) in horizontal row
- Each character 16 chars wide (TILE_SIZE=16), composited on grass background
- Selected character highlighted with FOCUS tile overlay
- Character name displayed below (cyan, bold)
- Navigation: Arrow keys or hjkl, ENTER to select, SPACE to skip intro
- Shows sound controls at bottom with color-coded states

### ForestIntro
**File:** `/workspace/arbiter/src/tui/screens/ForestIntro-termkit.ts`
- Walking scene: 7 tiles wide × 5 tiles tall (112×40 chars)
- Player controls character with arrow keys (hjkl navigation)
- Collision system with walkable/blocked/sign/exit tile types
- NPCs: Rat (RAT_TILE=210 at position 2,1) above path warns about sacrificing for requirements
- Signpost at (5,1) displays dialogue when player approaches
- Dialogue boxes: 5-6 tiles wide with multi-row support using quarter-tile compositing
- Music/SFX hints in bottom-right
- Death screen when wandering off path, with retry option
- Retreat screen when turning back (off left edge)
- Exit: walk right off screen after seeing sign

## Animation System

**File:** `/workspace/arbiter/src/tui/animation-loop.ts`

- Global sprite registry with tick-based updates at ~60fps (16ms interval)
- Tracks actual delta time for smooth animations regardless of system load
- Functions: `registerSprite`, `unregisterSprite`, `getSprite`, `getAllSprites`, `startAnimationLoop`, `stopAnimationLoop`, `hasActiveAnimations`

## Sprite System

**File:** `/workspace/arbiter/src/tui/sprite.ts`

### Animation Types
- **walking**: 1000ms per step
- **hopping**: 250ms up, 250ms down, 150ms rest
- **magic spawn/despawn/transform**: 400ms
- **bubbling**: random intervals

### Indicators
- `'alert'` (top-left) and `'chat'` (top-right) overlay quarter-tiles

### Methods
`step()`, `walk(target)`, `hop(count)`, `magicSpawn()`, `magicDespawn()`, `magicTransform(toTile)`, `physicalSpawn()`, `startBubbling()`, `stopBubbling()`, `intrigued(ms)`, `chatting(ms)`, `tick(deltaMs)`

### Movement Modes
- `controlled=true`: uses `step()` for user input
- `controlled=false`: uses `walk()` for scripted animations

## Scene System

**File:** `/workspace/arbiter/src/tui/scene.ts`

- SCENE_WIDTH=7, SCENE_HEIGHT=6
- Background tiles only, sprites rendered on top via position lookup
- Cached tile renders with `getCacheKey(tileIndex, mirrored)`
- Quarter-tile support for chat/alert indicators
- Hopping animation support: shifts sprite up 1 row during jump frame

## Tileset System

**File:** `/workspace/arbiter/src/tui/tileset.ts`

- TILE_SIZE=16 pixels, CHAR_HEIGHT=8 (half-block rendering), TILES_PER_ROW=10
- Path: `assets/jerom_16x16.png`
- Functions: `loadTileset()`, `extractTile(tileset, index)`, `compositeTiles(fg, bg, alphaThreshold)`, `extractQuarterTile`, `renderTile` (ANSI output)

### Key Tile Indices
| Tile | Index |
|------|-------|
| GRASS | 50 |
| GRASS_SPARSE | 51 |
| PINE_TREE | 57 |
| BARE_TREE | 58 |
| CAULDRON | 86 |
| CAMPFIRE | 87 |
| SMOKE | 90 |
| HUMAN_1-8 | 190-197 |
| ARBITER | 205 |
| DEMON_1-10 | 220-229 |
| FOCUS | 270 |
| CHAT_BUBBLE_QUARTERS | 267 |
| ALERT_QUARTERS | 268 |

## Modal/Overlay Patterns

### DialogueBox
- 2-5 tiles wide × 2 tiles tall
- Uses DIALOGUE_TILES (38=TOP_LEFT, 39=TOP_RIGHT, 48=BOTTOM_LEFT, 49=BOTTOM_RIGHT)
- Middle fill rows use `createMiddleFill()` sampling from left tile's middle column
- Text centered with padding, background color sampled from tile center

### RequirementsOverlay
**File:** `/workspace/arbiter/src/tui/requirementsOverlay.ts`
- File picker with fuzzy search (Fzf library)
- Modes: `'none'` | `'prompt'` | `'picker'` | `'rat-transform'`
- Dialogue box modal with scrollable list
- Returns selected file path

### QuestLog
**File:** `/workspace/arbiter/src/tui/questLog.ts`
- Bottom-left corner overlay using dialogue tiles
- Task status icons: ○ (pending), ◐ (in_progress), ● (completed)
- Color-coded status (dim gray, yellow, green)
- Max 8 visible tasks with scrolling

## Rendering Strategy

**Strategy 5: Minimal Redraws**

- Change tracking to avoid full redraws (`tracker.lastTileFrame`, `lastSelectionIndex`, etc.)
- Terminal-kit terminal object manages fullscreen, cursor, input grabbing
- Direct stdout writes with ANSI positioning (`\x1b[row;colH`)
- Debouncing for resize/SIGWINCH signals
