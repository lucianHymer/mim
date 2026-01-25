# Mím TUI Game Architecture

## Overview

Mím implements a simplified game loop with 3 screens (CHARACTER_SELECT, BRIDGE_GUARDIAN, WELLSPRING) based on Arbiter patterns but adapted for knowledge review workflow.

## Core Screens

### TitleScreen
**File:** `/workspace/project/mim-ai/src/tui/title-screen.ts`

- Gradient logo (pink→purple→violet) using diagonal row-weighted calculation (rowWeight=4)
- Simpler implementation than Arbiter (uses 256-color palette, no fire effect)
- Functions: `showTitleScreen()`, `printTitleArt()`, `getTitleArt()`
- Not used as fullscreen state machine like Arbiter

### CHARACTER_SELECT
**Location:** main.ts

- Reuses CharacterSelect rendering from Arbiter patterns
- Shows 8 human characters with selection and focus overlay
- Navigation: Arrow keys/hjkl, ENTER to select, SPACE to skip intro
- Transitions to BRIDGE_GUARDIAN on ENTER, WELLSPRING on SPACE

### BRIDGE_GUARDIAN
**Location:** main.ts

- 7×6 tile scene with bridge and chasm
- Layout: Trees/grass left, Chasm middle (cols 2-4), Cobblestone right (cols 5-6)
- Bridge tiles at (row 2, cols 3-4)
- Sprites: humanSprite (col 1), guardianSprite (col 2)
- Questions displayed in right panel (chat area)
- Options: [A-D] for answers, [O] for custom text input
- Text input mode with ENTER/ESC/BACKSPACE handling
- Animations: guardian steps aside, player walks across bridge
- Transitions to WELLSPRING after answering all questions

### WELLSPRING
**Location:** main.ts

- 7×6 tile scene with water/cobblestone platform
- Layout: Trees border, Cobblestones as platform, Water center
- Sprites: humanSprite (enters at 2,0), odinSprite (1,6), mimSprite (3,3 - bubbles)
- Animation: human walks to destination (4,3)
- Runs Wellspring Agent to process answered reviews
- Right panel shows agent messages and progress
- Exit on ESC only when agent complete

## Game State Machine

**Class:** MimGame (main.ts, lines 366-1561)

### State Properties
- `currentScreen`, `tileset`, `selectedCharacter`, `characterIndex`
- `messages`, `guardianAnswered`, `agentProcessing`, `agentDone`
- `textInputMode`

### Performance Tracking
- Tracker for minimal redraws: `lastTileFrame`, `lastMessageCount`, `lastScreen`
- Animation interval: 250ms (ANIMATION_INTERVAL)
- Full draw debounce: 50ms (FULL_DRAW_DEBOUNCE_MS)

### Signal Handlers
- SIGINT (Ctrl+C), SIGCONT (resume), SIGWINCH (resize), SIGHUP (reattach)

## Scene System

**File:** `/workspace/project/mim-ai/src/tui/scene.ts`

### Scene Builders
- `createBridgeGuardianScene()`: Bridge/chasm layout with trees and grass
- `createWellspringScene()`: Water/cobblestone with trees
- `createDefaultScene()`: Simple grass field
- `createScene(sprites, sceneType)`: Route to correct scene builder
- `renderScene(tileset, background, sprites)`: Sprite overlay rendering

## Key Differences from Arbiter

| Aspect | Arbiter | Mím |
|--------|---------|-----|
| Animation loop | Global AnimationLoop module | setInterval in main.ts (250ms) |
| NPC interaction | Signpost/rat/dialogue system | None |
| Dialogue display | Scene-based dialogue boxes | Right side chat panel |
| Agent integration | None | Wellspring agent via claude-agent-sdk |
| Text input | N/A | Custom text input mode for "Other" option |
| Data source | N/A | Pending review files from .claude/knowledge/pending-review |

## Chat/Info Panel

- Position: x = TILE_AREA_WIDTH + 3, width = Math.max(40, terminal_width - x - 1)
- Content varies by screen:
  - **BRIDGE_GUARDIAN**: Questions, options, context, input mode UI
  - **WELLSPRING**: Status, agent messages, processing indicator
- Text wrapping at panel width
- Color coding: yellow (questions), cyan (options), green (agent), dim (hints)

## Sprite System

Reuses Arbiter patterns:
- Same animation types (walking, hopping, magic, bubbling)
- Same indicators (alert, chat)
- Controlled vs scripted movement
- Registered with animation loop: `registerSprite`, `unregisterSprite`

## Input Handling Flow

### Setup
`setupInput()` sets up `term.on('key', ...)`

### Global Keys
- CTRL_C (exit)
- CTRL_Z (suspend)

### Screen-Specific Handlers
- `handleCharacterSelectInput`
- `handleBridgeGuardianInput`
- `handleWellspringInput`

### Text Input
Separate handler `handleTextInput` for ENTER/ESC/BACKSPACE/printable chars

## Agent Integration

- Uses `query()` from `@anthropic-ai/claude-agent-sdk`
- WELLSPRING_SYSTEM_PROMPT from wellspring-agent.ts
- Outputs structured JSON: `{ message?: string; done?: boolean }`
- Tool usage tracked: denies AskUserQuestion, allows other tools
- Session ID tracked for logging
- Error handling for max_turns, budget, structured output retries
- Deletes processed review files after agent completes
