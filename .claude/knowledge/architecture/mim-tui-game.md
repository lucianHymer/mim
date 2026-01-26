# Mím TUI Game Architecture

## Overview

Mím implements a game loop with 5 screens (TITLE, CHARACTER_SELECT, BRIDGE_APPROACH, BRIDGE_GUARDIAN, WELLSPRING) based on Arbiter patterns but adapted for knowledge review workflow.

## Game State Machine

**Class:** MimGame (src/tui/main.ts, lines 547-3048)

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
