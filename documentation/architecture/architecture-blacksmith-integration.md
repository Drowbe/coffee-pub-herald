# Blacksmith Integration

**Audience:** developers working on Herald, and on other Coffee Pub modules that consume Blacksmith.

Which Blacksmith surfaces Herald uses, and the contract changes every consumer needs to know. This covers consuming Blacksmith; how Herald's own broadcast feature is built is in [Broadcast architecture](architecture-broadcast.md). Stream overlays that consume `api.stats.party` are in [Stream widgets](architecture-stream-widgets.md).

## The API surfaces

Here are the important Blacksmith APIs other Coffee Pub modules should consider using if appropriate:

Blacksmith Wiki: https://github.com/Drowbe/coffee-pub-blacksmith/wiki (entry point)

API Core: https://github.com/Drowbe/coffee-pub-blacksmith/wiki/API:-Core-Blacksmith (utilities + console/notification helpers)

API Toolbar: https://github.com/Drowbe/coffee-pub-blacksmith/wiki/API:-Toolbar (register toolbar tools/UI)
    
API Menubar: https://github.com/Drowbe/coffee-pub-blacksmith/wiki/API:-Menubar (register menubar tools/layout)

API Canvas: https://github.com/Drowbe/coffee-pub-blacksmith/wiki/API:-Canvas (canvas layer helpers)

API Hook Manager: https://github.com/Drowbe/coffee-pub-blacksmith/wiki/API:-Hook-Manager (register/unregister hooks)

API Sockets: https://github.com/Drowbe/coffee-pub-blacksmith/wiki/API:-Sockets (emit/register for cross-client sync)

API Stats: https://github.com/Drowbe/coffee-pub-blacksmith/wiki/API:-Stats (combat/player statistics)

API Pins: https://github.com/Drowbe/coffee-pub-blacksmith/wiki/API:-Pins (canvas pins system)

API Chat Cards: https://github.com/Drowbe/coffee-pub-blacksmith/wiki/API:-Chat-Cards (chat card themes/helpers)

API Window: https://github.com/Drowbe/coffee-pub-blacksmith/wiki/API:-Window (Window API V2 registry)

API Request Roll: https://github.com/Drowbe/coffee-pub-blacksmith/wiki/API:-Request-Roll (open roll dialog)

API Campaign: https://github.com/Drowbe/coffee-pub-blacksmith/wiki/API:-Campaign (normalized campaign context)

API OpenAI: https://github.com/Drowbe/coffee-pub-blacksmith/wiki/API:-OpenAI (provided by `coffee-pub-regent` when installed; Blacksmith core does not ship an OpenAI surface)

API Importer: https://github.com/Drowbe/coffee-pub-blacksmith/wiki/API:-Importer (shared import window; you keep your own data model)

API Supplement: https://github.com/Drowbe/coffee-pub-blacksmith/wiki/API:-Supplement (misc helpers used by modules)   

---

## Contract Changes to Know

Recorded here because each of these either corrects earlier advice or changes behaviour that used to be implicit. Herald does not use all of them, but this file is the suite's shared crib sheet.

### 1. Base classes come from the bridge, NOT from `module.api` at top level

```js
import {
    BlacksmithWindowBaseV2,
    BlacksmithToolWindowBaseV2
} from '/modules/coffee-pub-blacksmith/api/blacksmith-api.js';

export class MyWindow extends BlacksmithWindowBaseV2 { }
```

`BLACKSMITH_WINDOW_STYLES`, `BLACKSMITH_TOOL_TITLEBARS` and `BLACKSMITH_TOOL_THEMES` come from the same path and are the same objects as `api.windowStyles`, `api.toolTitlebars`, `api.toolThemes`.

**The older advice to read these from `module.api` at module top level was wrong and could not work.** `extends` is evaluated when your module script is evaluated, at which point `game` does not exist — a top-level `game.modules.get('coffee-pub-blacksmith')` throws `Cannot read properties of undefined (reading 'get')`. Because ES modules cache a failed evaluation, that throw disables your module for the **whole session** rather than being retried. This broke a live world for at least one consumer.

- `scripts/` paths are still **not** a stable contract. The bridge is the supported path, and being a real ES module it resolves at evaluation time.
- `module.api` remains correct for anything resolved **after** `init`.

### 2. HookManager cancellation is opt-in

```js
BlacksmithHookManager.registerHook({
    name: 'preCreateItem',
    canCancel: true,              // top level -- NOT inside `options`
    callback: (item) => { if (isForbidden(item)) return false; }
});
```

Previously any callback returning a falsy value on a `pre*` hook cancelled the operation **world-wide, for every module**, because one Foundry handler serves every callback on a hook name. The dangerous case was never a deliberate veto — it was an ordinary callback whose natural return value happened to be boolean (`callback: (doc) => this.tracked.has(doc.id)` on `preCreateItem` silently blocked item creation everywhere).

- Cancellation is now inert unless declared. If you *intended* to cancel somewhere, add `canCancel`.
- `canCancel` placed inside `options` logs a warning rather than failing silently.
- A declared canceller also stops later callbacks on that hook, as Foundry does.
- **Herald declares no cancellers and registers no `pre*` hooks**, so this change is a no-op here.

### 3. `api.inventory` merges more reliably

Stacks that previously refused to merge now merge. The old predicate compared the payload you submit against the row that already exists — but the row your payload becomes is not the payload: creation fills schema defaults, writes `system.identifier` from the item's name, and normalises `properties`. A grant of constructed `itemData` could therefore never merge into a row built from that same data, and any item carrying a property dnd5e does not recognise never merged at all. Nothing to change on your side; local workarounds for non-merging stacks can go.

### 4. `api.importer` is public

`registerKind`, `getKind`, `openWindow`, `parsePayload`, `attachButton`. You supply `onValidateEntry` and `onImportEntry`, so you keep document construction and Blacksmith never learns your data model.

---

## FoundryVTT v13 / v14 Hook Notes

- **Journal sheets are ApplicationV2.** Register `renderJournalEntrySheet` and `renderJournalEntryPageSheet`. The v12-era `renderJournalSheet` / `renderJournalPageSheet` never fire.
- **Do not register both a legacy name and its modern equivalent.** Blacksmith's HookManager *remaps* the retired names onto the current ones, so holding both yields **two live registrations of the same callback**, not one. Herald hit exactly this: every journal open fired its handler twice. The remap turns a dead registration into a live one, which is a fix — but for anyone holding both it doubles rather than restores.
- **ApplicationV2 render hooks pass a native `HTMLElement`** where the V1 hooks passed jQuery. Callbacks taking arguments must expect an element.
- **`blacksmithSilentHooks()`** (Blacksmith 14.1.0+) lists registered hook names that have not fired. Run it after exercising your feature; anything still listed is a suspect or dead name.
- Retired names currently tracked in Blacksmith's `LEGACY_HOOKS`: `renderChatMessage`, `renderJournalSheet`, `renderJournalPageSheet`.

---

## Quick How-To (for other Coffee Pub modules)

1. Get the API safely, **after `init`** (never at module top level — see Contract Changes §1):
   `const api = game.modules.get('coffee-pub-blacksmith')?.api; if (!api) return;`

2. `postConsoleAndNotification` (debug + console + optional UI toast):
   use `api.utils.postConsoleAndNotification(moduleId, message, data?, blnDebug, blnNotification)`
   - `blnDebug=true` logs only when Blacksmith debug is enabled (keeps noise down for normal users).
   - `blnNotification=true` shows a user-facing notification (use for actionable errors/warnings).

3. Windows: always use the Window API registry for Application V2 windows (register/open via `api.registerWindow` / `api.openWindow`), rather than ad-hoc window wiring. To *subclass* a Blacksmith window base, import it from the bridge — see Contract Changes §1.

4. Sockets: use `api.sockets` for sync instead of custom socket globals:
   `api.sockets?.register(eventName, handler)` and `api.sockets?.emit(eventName, data)` (optionally `executeAsGM` for GM-only actions).
   - **Unload / unregister:** Blacksmith does not expose `unregister` or tear down registered handlers on `unloadModule`; see **`documentation/blacksmith-sockets-unload.md`**.

5. Prefer API surfaces over direct imports:
   use `api.registerToolbarTool`, `api.registerSecondaryBarItem` / `api.registerMenubarTool`, and existing APIs (roll/dialog, pins, chat cards).

6. Shared roll flow + context reuse:
   `api.openRequestRollDialog({ silent, initialType, initialValue, dc, actors, onRollComplete })` and read normalized prompt input from `api.campaign` (read-only contract).










