# Arbiter TUI Patterns

Reusable patterns from Arbiter TUI that can be applied to similar projects (e.g., Mím).

## 1. Dialogue/Modal Pattern

Tile-based modal construction:
- Dialogue boxes are rendered tile-based overlays (not text-only)
- Window composed of 4 corner tiles + middle fill rows
- Middle fill created by sampling tile pixels and using block characters
- Text overlaid with background color sampling from dialogue tile
- Centering: calculate `padding = (interiorWidth - visibleLength) / 2`
- `stripAnsi()` helper to get visible length (regex removes ANSI codes)
- Wrap text with background: replace RESET codes with RESET + bgColor combo
- Position dialogue relative to scene (`sceneOffsetX` + calculated position)

## 2. Sound Integration

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

## 3. Animation/Sprite System

Sprite class handles:
- **Controlled sprites**: use `step()` for instant movement, plays footstep
- **Non-controlled sprites**: use `walk()` for animated movement over 1000ms per step
- Position getter returns copy (prevents external mutation)
- Animation state tracks type, elapsed time, callbacks
- `tick(deltaMs)` called per frame to advance animations
- Magic effects: `magicSpawn()`, `magicDespawn()`, `magicTransform()`
- Indicators: `intrigued()` for alert, `chatting()` for speech bubble
- Bubbling: `startBubbling()` for continuous appearance toggle
