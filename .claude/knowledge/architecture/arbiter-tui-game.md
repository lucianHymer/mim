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

## Modal/Overlay Patterns

### DialogueBox
- 4-7 tiles wide × 2-3+ tiles tall (dynamic height)
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

