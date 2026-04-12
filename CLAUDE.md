# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chili Catcher is a Foundry VTT minigame module (v2.0.0) - a 60-second catch game where players collect falling chilis. Features PIXI.js graphics, persistent leaderboard, multi-user score synchronization via socket + chat fallback, and i18n support (German/English).

## Development Workflow

**No build step required** - pure JavaScript ES6 modules with direct browser refresh to test changes.

1. Edit `.js`/`.css` files directly
2. Reload Foundry browser to see changes
3. Check console for `[chili-catcher]` debug logs

## Architecture

### Entry Points
- **main.js** - Module initialization, socket handlers, macro auto-creation, score relay (GM-side save logic)
- **app.js** - ChiliCatcherApp class extending `HandlebarsApplicationMixin(ApplicationV2)` (game logic, PIXI graphics, player movement)

### ApplicationV2 Pattern

The module uses Foundry's modern ApplicationV2 API:

```javascript
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ChiliCatcherApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "chili-catcher-app",
    classes: ["chili-catcher"],
    window: { title: "CHILI-CATCHER.Title", resizable: true },
    position: { width: 960, height: 820 },
    actions: {
      start: ChiliCatcherApp.#onStart,
      retry: ChiliCatcherApp.#onRetry,
      clearLeaderboard: ChiliCatcherApp.#onClearLeaderboard
    }
  };

  static PARTS = {
    main: { template: `modules/chili-catcher/templates/app.hbs` }
  };
}
```

### Key Patterns

**Actions System (V2):**
- Click events use `data-action` attributes in templates
- Actions defined in `DEFAULT_OPTIONS.actions` as static methods
- `this` context is automatically bound to the instance

**Lifecycle Methods (V2):**
- `_prepareContext()` - Prepare template data (replaces `getData()`)
- `_onRender()` - After render callback (replaces `activateListeners()`)
- `_onClose()` - Cleanup on close

**Socket + Chat Fallback Communication:**
```javascript
// Player submits score via socket (2.5s timeout)
// If timeout: falls back to ChatMessage with flags
// GM-side hook saves score and broadcasts leaderboardUpdated
```

**Deduplication:** Each submission uses `requestId` (UUID) to prevent duplicates in multi-user scenarios.

### Internationalization (i18n)

Language files in `lang/` directory:
- `en.json` - English
- `de.json` - German (Deutsch)

Usage in code:
```javascript
game.i18n.localize("CHILI-CATCHER.StartButton")
```

Usage in templates:
```handlebars
{{i18n.startButton}}
```

Context preparation passes localized strings:
```javascript
async _prepareContext(options) {
  return {
    isGM: game.user.isGM,
    i18n: {
      startButton: game.i18n.localize("CHILI-CATCHER.StartButton"),
      // ...
    }
  };
}
```

### Dependencies
- **PIXI.js** - WebGL/Canvas 2D graphics (global `PIXI`)
- **Howler.js** - Audio with fade effects (optional, fallback to HTML5 Audio)
- **Foundry APIs** - game.settings, game.socket, Hooks, ApplicationV2

## Module Settings

```javascript
// World-scoped leaderboard (hidden from UI)
game.settings.get("chili-catcher", "leaderboard")  // Array of {rid, actorId, name, img, score, ts}
```

## Public API

```javascript
game.chiliCatcher.open()  // Returns ChiliCatcherApp instance
// OR
game.modules.get("chili-catcher").api.open()
```

## Key Code Locations

| Task | Location |
|------|----------|
| Actions (start, retry, clear) | `app.js:209-236` - static action handlers |
| Score submission | `app.js:374` - `_submitScore()` |
| Score save (GM) | `main.js:51` - `saveScore()` |
| Game tick/collision | `app.js:274` - ticker callback |
| Draw chili graphics | `app.js:333` - `_drawChili()` |
| Leaderboard refresh | `app.js:459` - `_refreshLeaderboardPanel()` |
| Context preparation | `app.js:37` - `_prepareContext()` |

## Game Balance Parameters

| Object | Points | Spawn Rate | Velocity |
|--------|--------|------------|----------|
| Red chili | +1 | 520ms | 2.0-3.0 px/frame |
| Black chili | +3 | 1350ms | 4.0-6.1 px/frame |
| Bug | -2 | 880ms | 2.8-4.0 px/frame |

## Testing

Manual testing only - no automated test framework configured.

- Test as both GM and player to verify socket/chat fallback paths
- Check browser console for `[chili-catcher]` logs
- Verify leaderboard updates across multiple connected clients
- Test both language settings (en/de)

## Important Implementation Notes

- Uses **ApplicationV2** with `HandlebarsApplicationMixin` - modern Foundry API
- Actions defined as static private methods with `#` prefix
- Pointer events for touch-friendly input (pointerdown, pointermove, pointerup)
- HTML escaping via `esc()` function for player names in leaderboard
- RequestId deduplication is critical - preserve this logic when modifying score submission
- Socket communication wrapped in try-catch with graceful fallback
- Clear leaderboard button only visible to GMs (via `isGM` context flag)
- Old macro "ChiliCatcher: Bestenliste löschen" is auto-removed on first load
