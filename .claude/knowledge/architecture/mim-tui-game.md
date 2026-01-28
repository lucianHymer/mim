# Mím TUI Game Architecture

## Overview

Mím implements a game loop with 5 screens (TITLE, CHARACTER_SELECT, BRIDGE_APPROACH, BRIDGE_GUARDIAN, WELLSPRING) based on Arbiter patterns but adapted for knowledge review workflow.

## Game State Machine

**Class:** MimGame (src/tui/main.ts)

### State Properties
- `currentScreen`, `tileset`, `selectedCharacter`, `characterIndex`
- `messages`, `guardianAnswered`, `agentProcessing`, `agentDone`
- `textInputMode`
- `answeredReviews` - Reviews with user decisions ready for Mímir to apply
- `wellspringMode` - INSERT/SCROLL mode toggle: INSERT for typing messages, SCROLL for navigating message history
- `wellspringInputBuffer`, `wellspringCursorPosition` - Text input handling for Wellspring chat
- `currentTool`, `recentTools`, `toolCountSinceLastMessage` - Tool usage tracking for agent activity
- `showToolIndicator`, `lastToolTime` - UI indicators for agent tool activity

### Performance Tracking
- Tracker for minimal redraws: `lastTileFrame`, `lastMessageCount`, `lastScreen`
- Animation interval: 250ms (ANIMATION_INTERVAL)
- Full draw debounce: 50ms (FULL_DRAW_DEBOUNCE_MS)

### Signal Handlers
- SIGINT (Ctrl+C), SIGCONT (resume), SIGWINCH (resize), SIGHUP (reattach)

## BRIDGE_GUARDIAN Question Modal

- Modal dialog overlay for answering review questions
- Displays: question text, numbered options [1], [2], etc., "Other" text input option
- Select option by number, or choose "Other" for free-form text input
- Color coding: cyan, yellow, green for content; dim for status

## WELLSPRING Chat Panel

- Position: Right side panel at x = TILE_AREA_WIDTH + 3, width = Math.max(40, terminal_width - x - 1)
- Displays: Mímir agent messages, user messages, processing indicator, tool activity
- Text wrapping at panel width
- Color coding: cyan, yellow, green for content; dim for status
- Scrollable message history with INSERT/SCROLL mode toggle

## Sprite System

Reuses Arbiter patterns:
- Same animation types (walking, hopping, magic, bubbling, flipping)
- Same indicators (alert, chat)
- Controlled vs scripted movement
- Registered with animation loop: `registerSprite`, `unregisterSprite`

**Note:** Magic animation types (magicSpawn, magicDespawn, magicTransform) are available patterns inherited from Arbiter but not currently active in the Mím game. They remain in the codebase for potential future use.

## Agent Integration

- Uses `query()` from `@anthropic-ai/claude-agent-sdk`
- WELLSPRING_SYSTEM_PROMPT from wellspring-agent.ts
- Outputs structured JSON: `{ message: string; done: boolean }` (both fields REQUIRED per zod schema)
- Tool usage tracked: denies AskUserQuestion, allows other tools
- Session ID tracked for logging
- Error handling for max_turns, budget, structured output retries
- Deletes processed review files after agent completes
