# Arbiter TUI Patterns

Reusable patterns from Arbiter TUI that can be applied to similar projects (e.g., Mím).

## 1. TitleScreen Pattern

- ASCII art with gradient coloring (diagonal fire gradient applied per character)
- Terminal-kit fullscreen mode setup: `term.fullscreen(true)`, `term.hideCursor()`, `term.grabInput()`
- Centered content calculation: `Math.max(1, Math.floor((width - artWidth) / 2))`
- ANSI color codes applied inline during rendering, not post-render
- Color optimization: only emit color code when color changes (`lastColorIdx` tracking)
- Sound toggles that don't progress (m/s keys don't continue, return early)
- Uses DIM for subtle hints, BOLD for emphasis
- Cleanup pattern: `term.removeAllListeners('key')`, `cleanupTerminal()`, `exitTerminal()`
- `process.stdout.write()` for direct output + RESET constant at end of lines

## 2. ForestIntro Walking Pattern (Player Control)

Core mechanics:
- Sprite class with position tracking and `step()` for instant movement
- Arrow keys (UP/DOWN/LEFT/RIGHT) or vim keys (hjkl) for movement
- Collision detection via COLLISION_MAP: tile positions marked as WALKABLE/BLOCKED/SIGN/EXIT
- Movement flow: detect direction → calculate new position → check collisions → check off-screen → `step()` on sprite
- Off-screen triggers: exit right, death, retreat left
- Change tracking for minimal redraws: compare current state against tracker object
- Only redraw when something changes (player position, phase, message visibility)

## 3. Collision System

Three-layer detection:
1. Off-screen check: `isOffScreen(x, y)` - returns false for x/y outside scene bounds
2. Walkable check: `isWalkable(x, y)` - queries COLLISION_MAP, returns false for BLOCKED tiles
3. Special zone checks: `isNextToSign()`, `isNextToRat()` for proximity interactions

Implementation:
- COLLISION_MAP pre-computed as 2D array of tile types
- Early return pattern: detect collision → return early, don't move
- Valid moves use `sprite.step()` which plays footstep sound internally

## 4. Signpost/NPC Interaction

Proximity-based:
- `isNextToSign()` checks for specific tile positions (5,1) with player at (5,2) or (4,1)
- Dialogue boxes rendered as tile composites (dialogue tiles 38-39, 48-49)
- 2x2 tile dialogue boxes with 5-6 tile widths for expanded text
- Text rendering: extract tiles → render tiles → compose fill rows → overlay text with background color
- Dialogue appears only when player is next to sign/rat
- Different dialogue box sizes for different NPCs (5 tiles vs 6 tiles)
- Player must see sign to progress (`hasSeenSign` flag checked at exit)

## 5. Death Screen Pattern

Triggers:
- Walking off screen in wrong direction
- Skipping the sign interaction and walking away
- Wandering into forest/blocked areas

Flow:
- Phase change to `'dead'`
- Clear screen, render gravestone + skeleton tiles centered
- Display red death messages with specific wording
- Prompt for 'y' to try again (returns `'death'` to trigger restart)
- Sound: `'death'` SFX on trigger
- Minimal redraw: only shows when phase changes to dead

## 6. Retreat Flow

Left edge off-screen exit:
- Check: `newX < 0 && newY === START_Y`
- Phase change to `'retreat'`
- Similar screen layout to death (centered character sprite)
- Blue retreat messages with different wording
- Prompt for 'y' to restart or 'q' to quit
- Returns `'death'` (reuses same code path as death retry)
- Sound: `'quickNotice'` SFX on trigger

## 7. Dialogue/Modal Pattern

Tile-based modal construction:
- Dialogue boxes are rendered tile-based overlays (not text-only)
- Window composed of 4 corner tiles + middle fill rows
- Middle fill created by sampling tile pixels and using block characters
- Text overlaid with background color sampling from dialogue tile
- Centering: calculate `padding = (interiorWidth - visibleLength) / 2`
- `stripAnsi()` helper to get visible length (regex removes ANSI codes)
- Wrap text with background: replace RESET codes with RESET + bgColor combo
- Position dialogue relative to scene (`sceneOffsetX` + calculated position)

## 8. Screen Layout Mathematics

Universal pattern:
```
// Get terminal dimensions (with NaN checks)
const width = term.width;
const height = term.height;

// Calculate content dimensions
const contentWidth = artWidth;  // or similar
const contentHeight = artHeight;

// Calculate start position (centered)
const startX = Math.max(1, Math.floor((width - contentWidth) / 2));
const startY = Math.max(1, Math.floor((height - contentHeight) / 2));

// Use offsets for all positioning within screen
const sceneOffsetX = startX;
const sceneOffsetY = startY;
```

- Dialogue positioned relative to scene, not absolute terminal position
- Hint text positioned relative to scene bottom

## 9. Sound Integration

Pattern:
- `playSfx('key')` called for each state change
- SFX keys: `menuSelect`, `quickNotice`, `footstep`, `death`, `menuLeft/Right`, `jump`, `magic`, `hmm`
- m/s keys toggle music/sfx and redraw hints immediately
- `getMusicMode()` returns `'on'`/`'quiet'`/`'off'`
- `isSfxEnabled()` returns boolean
- `cycleMusicMode()` rotates through modes
- `toggleSfx()` flips boolean
- Sound hint shows current state with green=on, yellow=quiet, red=off
- Sound toggle doesn't consume the key (doesn't progress the screen)

## 10. Animation/Sprite System

Sprite class handles:
- **Controlled sprites**: use `step()` for instant movement, plays footstep
- **Non-controlled sprites**: use `walk()` for animated movement over 1000ms per step
- Position getter returns copy (prevents external mutation)
- Animation state tracks type, elapsed time, callbacks
- `tick(deltaMs)` called per frame to advance animations
- Magic effects: `magicSpawn()`, `magicDespawn()`, `magicTransform()`
- Indicators: `intrigued()` for alert, `chatting()` for speech bubble
- Bubbling: `startBubbling()` for continuous appearance toggle

## 11. Minimal Redraw Pattern (Strategy 5)

Applied in ForestIntro and CharacterSelect:

```typescript
interface ChangeTracker {
  lastTileFrame: number;
  lastSelectionIndex: number;
  // ... other tracked state
}

function draw(tracker: ChangeTracker, currentState: State) {
  // Compare current state against tracker
  if (currentState.tileFrame === tracker.lastTileFrame &&
      currentState.selectionIndex === tracker.lastSelectionIndex) {
    return; // Nothing changed, skip redraw
  }

  // Sound plays BEFORE redraw (gives feedback even if visual same)
  playSfx('menuSelect');

  // Only redraw changed areas
  term.moveTo(x, y);
  process.stdout.write(newContent);

  // Update tracker AFTER detecting change
  tracker.lastTileFrame = currentState.tileFrame;
  tracker.lastSelectionIndex = currentState.selectionIndex;
}
```

Key principles:
- Track previous state in ChangeTracker object
- Compare current state against tracker at draw time
- Return early if nothing changed
- Update tracker only after detecting change
- Only `term.moveTo()` + `process.stdout.write()` for changed areas
- Clear lines before rewriting to prevent trailing characters
