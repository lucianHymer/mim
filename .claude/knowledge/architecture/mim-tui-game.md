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

## Agent Integration

- Uses `query()` from `@anthropic-ai/claude-agent-sdk`
- WELLSPRING_SYSTEM_PROMPT from wellspring-agent.ts
- Outputs structured JSON: `{ message: string; done: boolean }` (both fields REQUIRED per zod schema)
- Tool usage tracked: denies AskUserQuestion, allows other tools
- Session ID tracked for logging
- Error handling for max_turns, budget, structured output retries
- Deletes processed review files after agent completes
