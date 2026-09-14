# Stream Widgets

**Audience:** developers adding a Herald overlay that Coffee Pub Studio crops into an OBS source.

Studio turns one element on Foundry's `/stream` page into its own OBS source. It measures that element with a CSS selector, then crops the window capture to the element's box, and it re-measures on every sync so the crop follows the element if it moves. The MVP leaderboard in `scripts/widget-stats.js` is the first of these. This page is the contract the next one has to keep.

A stream widget is a **Blacksmith tool window** (`HeraldStreamWindowBaseV2`) with Auto-Hide chrome. That is the whole point of Auto-Hide: at rest the title bar is a near-invisible strip, and when it opens it overlays the body so the measured box never grows and the content never shifts.

## Where it renders

Foundry has two pages that matter here, and they are not interchangeable:

- `/game` is the tabletop. Herald's cameraman view lives here: canvas, hidden UI, camera follow.
- `/stream` is the chat-only capture page. `game.view === 'stream'`. Studio captures this page. Modules load here the same way they load on the tabletop.

A stream widget mounts only on the capture page. Detection matches Blacksmith: `game.view === 'stream'` (toasts in `api-toast.js`) or `document.body.classList.contains('stream')` (loading overlay in `manager-loading-progress.js`, which is true before `game.view` exists). It must not appear on the cameraman tabletop: that feed is the map, and a stats box sitting on the map would be baked into the canvas capture.

The `/stream` client is typically logged in as the observer / camera user. Actor flags and world settings are readable there, so Blacksmith's `stats.party.getAggregate()` works without GM rights. Writes still belong to the GM.

## Tool window contract

Subclass `HeraldStreamWindowBaseV2`, not `BlacksmithToolWindowBaseV2` and not a raw DOM overlay.

```js
import { HeraldStreamWindowBaseV2, BLACKSMITH_TOOL_TITLEBARS } from './window-stream-base.js';

export class MyStreamWindow extends HeraldStreamWindowBaseV2 {
    static DEFAULT_OPTIONS = foundry.utils.mergeObject(
        {},
        {
            id: 'herald-my-widget',
            classes: ['herald-my-widget-window'],
            position: { width: 380, height: 320 },
            window: { title: 'My Widget', resizable: false, minimizable: false },
            windowPositionKey: 'herald-my-widget-stream'
        }
    );
}
```

Do **not** copy `super.DEFAULT_OPTIONS` into that object. Foundry already walks the prototype chain; copying it on v14 duplicates Detach/Attach in the header menu.

The base already sets:

| Option | Value | Why |
| --- | --- | --- |
| `toolTitlebar` | `BLACKSMITH_TOOL_TITLEBARS.AUTO` (`"auto"`) | Chrome is hidden in the OBS crop at rest. Hover/focus expands the full bar as an overlay. |
| `toolTheme` | Dark | Opaque fill for a clean crop. Users can still pick Light / Glass from the window menu. |
| `resizable` / `minimizable` | `false` | A resize or minimize changes the measured box. |
| `rememberPosition` | `true` | Drag once; Studio re-measures on sync. |
| `allowTitlebarModeToggle` | `true` | Right-click → **Title Bar** → Full / Micro / Auto-Hide. |

Users switch modes at runtime with the menu, or code can `await app.setToolTitlebarMode('auto')`. Never assign `this.options.toolTitlebar` — Foundry freezes Application V2 options.

Keep an in-content title. Auto-Hide conceals the window title bar at rest, so the crop would otherwise have no heading.

Do not detach. `_canDetach()` is `false` on the base: a popped-out copy leaves `/stream` and Studio crops empty space.

Close must not remove the element. The base intercepts `close()` and hides with `visibility` instead. Module unload passes `{ heraldForce: true }` to actually tear it down.

## The crop contract

Studio's selector is matched against the live page. A few habits make the measured box the box you intended.

**One root, one stable hook.** The MVP window's Application id is `#herald-stats`. Studio types that selector and clicks Measure. The hook must survive re-renders and module updates. Do not use Foundry's generated ids or depend on element order. Changing an existing selector is a breaking change for every Studio region already pointed at it.

**Everything visible stays inside the root.** Padding, background, border, and the in-content title included. The crop is the Application element's bounding box. Box shadows, glows, and absolutely positioned children that poke past the edge are cut off. Stream windows drop the Tool shell's drop shadow for that reason. Auto-Hide's expanded bar is an overlay *inside* the box — that is allowed. Do not let a hover state change the window's width or height.

**Fixed size, whole pixels.** `#herald-stats` is `380px` by `320px`. Growing text scrolls or truncates inside the list; it never resizes the root. Percentages and `auto` height make the crop jump when a name wraps or a seventh row appears.

**Remembered position, first-open fallback.** The first time a stream window opens it sits immediately to the right of Foundry's stream chat column (`#chat`), with a 12px gap, or at `left: 320px; top: 8px` if chat is not measured yet. After the user drags it, Blacksmith's remembered position wins. Studio re-measures on every sync, so a drag is a feature, not a break.

**Hide, do not remove.** An empty leaderboard still renders the window, with an empty state inside the box. Turning **Show MVP Leaderboard on Stream** off, or clicking Close, adds `herald-stream-window--hidden` (`visibility: hidden`). Removing the element makes the selector fail, and OBS keeps the last crop over whatever is now underneath.

**No transforms, no motion of the box.** Slide-ins, scale, and rotation change the measured rectangle mid-animation. Auto-Hide animates the header overlay, not the Application element. Animate contents if you like. Never the root.

**Nothing on top of it.** OBS captures pixels. A toast, dialog, or chat bubble that overlaps the widget is recorded. Do not park stream-targeted toasts on the top-right of `/stream` while this widget is live.

**Opaque widget background.** The crop shows the widget exactly as drawn. Dark theme (the default) gives Studio a clean source. Glass makes the Tool shell translucent and will show the page through the crop — leave that as a user choice, not the default. The *page* behind the window is a separate setting: **Transparent Stream Background** (default on) overrides Foundry's hardcoded `body.stream { background: lime }` on `html` and `body` so OBS can composite through the rest of `/stream`.

Paint inner markup with DOM-direct `createElement` + `textContent` (same idea as Blacksmith toasts). A Herald Handlebars template is an extra fetch on a thin capture page; names must not be concatenated into HTML.

Do not await `BlacksmithAPI.waitForReady()` on `/stream`. That promise only resolves, never rejects; if consumers are never marked ready, the window stays empty.

## Data

The leaderboard is Blacksmith's party aggregate, not a second ranking:

```js
const aggregate = await game.modules.get('coffee-pub-blacksmith')?.api?.stats?.party?.getAggregate();
const rows = aggregate?.leaderboard ?? [];
```

Each row is `{ rank, actorId, name, img, mvp: { totalScore, combats, averageScore, highScore }, ... }`, already sorted by lifetime MVP total, already formatted. Ties and party membership are Blacksmith's job; this widget must not re-reduce. The cache rebuilds on `blacksmith.combatSummaryReady` and on actor create / update / delete — the same events the widget refreshes on, debounced 250ms.

If the API is missing, the empty state stays inside the box.

## Testing in Studio

1. Open Foundry's `/stream` view, logged in as the observer user.
2. Confirm `#herald-stats` exists in the page (and stays there with no rankings). At rest the Blacksmith title bar should be a thin strip, not the full chrome.
3. In Studio, start the Stream window, add a region, choose CSS selector, enter `#herald-stats`, click Measure.
4. The measured size should be `380x320`. The OBS source should show only the widget.

Hover the top edge in the Foundry `/stream` tab: the full title bar (title, menu, Close) should overlay the content without changing the measured size. Right-click → **Title Bar** should offer Full / Micro / Auto-Hide.

## Files

| File | Role |
| --- | --- |
| `scripts/window-stream-base.js` | `HeraldStreamWindowBaseV2` — Auto-Hide, hide-without-remove, chat placement, no detach |
| `scripts/widget-stats.js` | MVP window + `/stream` mount manager |
| `styles/widget-stats.css` | Page transparency, crop clipping, stats body tokens |
| `scripts/const.js` | `STREAM_STATS.ROOT_ID` / `SELECTOR` — the Studio contract in one place |
