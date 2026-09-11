# Stream Widgets

**Audience:** developers adding a Herald overlay that Coffee Pub Studio crops into an OBS source.

Studio turns one element on Foundry's `/stream` page into its own OBS source. It measures that element with a CSS selector, then crops the window capture to the element's box, and it re-measures on every sync so the crop follows the element if it moves. The MVP leaderboard in `scripts/widget-stats.js` is the first of these. This page is the contract the next one has to keep.

This is not a Foundry application. Application V2 windows have chrome, can be dragged, and can be closed — all of which break the crop. A stream widget is a DOM overlay with a stable root.

## Where it renders

Foundry has two pages that matter here, and they are not interchangeable:

- `/game` is the tabletop. Herald's cameraman view lives here: canvas, hidden UI, camera follow.
- `/stream` is the chat-only capture page. `game.view === 'stream'`. Studio captures this page. Modules load here the same way they load on the tabletop.

A stream widget mounts only on the capture page. Detection matches Blacksmith: `game.view === 'stream'` (toasts in `api-toast.js`) or `document.body.classList.contains('stream')` (loading overlay in `manager-loading-progress.js`, which is true before `game.view` exists). It must not appear on the cameraman tabletop: that feed is the map, and a stats box sitting on the map would be baked into the canvas capture.

The `/stream` client is typically logged in as the observer / camera user. Actor flags and world settings are readable there, so Blacksmith's `stats.party.getAggregate()` works without GM rights. Writes still belong to the GM.

## The crop contract

Studio's selector is matched against the live page. A few habits make the measured box the box you intended.

**One root, one stable hook.** The MVP widget's root is `#herald-stats` (also classed `.herald-stats-widget`). Studio types that selector and clicks Measure. The hook must survive re-renders and module updates. Do not use Foundry's generated ids or depend on element order. Changing an existing selector is a breaking change for every Studio region already pointed at it.

**Everything visible stays inside the root.** Padding, background, border, and title included. The crop is the root's bounding box. Box shadows, glows, and absolutely positioned children that poke past the edge are cut off. Keep them inside or drop them.

**Fixed size, whole pixels.** `#herald-stats` is `380px` by `320px`. Growing text scrolls or truncates inside the list; it never resizes the root. Percentages and `auto` height make the crop jump when a name wraps or a seventh row appears.

**Fixed or absolute position.** The MVP widget sits immediately to the right of Foundry's stream chat column (`#chat`), with a 12px gap. Position and size are applied as inline styles with `!important` — the same reason Blacksmith's toast billboard layer is JS-owned: a stale or missing stylesheet must not let the box participate in Foundry's body layout. If chat is not measured yet, it falls back to `left: 320px; top: 8px`.

**Hide, do not remove.** An empty leaderboard still renders the root, with an empty state inside the box. Turning **Show MVP Leaderboard on Stream** off adds `herald-stats-widget--hidden` (`visibility: hidden`). Removing the element makes the selector fail, and OBS keeps the last crop over whatever is now underneath.

**No transforms, no motion of the box.** Slide-ins, scale, and rotation change the measured rectangle mid-animation. Animate contents if you like. Never the root.

**Nothing on top of it.** OBS captures pixels. A toast, dialog, or chat bubble that overlaps the widget is recorded. The MVP widget uses `z-index: 9990`, under Blacksmith toasts (`10001`). Do not park stream-targeted toasts on the top-right of `/stream` while this widget is live.

**Opaque background.** The crop shows the widget exactly as drawn. An opaque fill (`--blacksmith-surface-dark-1`) gives Studio a clean source. A transparent one lets `/stream`'s page (often a chroma key) show through.

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
2. Confirm `#herald-stats` exists in the page (and stays there with no rankings).
3. In Studio, start the Stream window, add a region, choose CSS selector, enter `#herald-stats`, click Measure.
4. The measured position and size should be `380x320` immediately to the right of the chat column. The OBS source should show only the widget.

## Files

| File | Role |
| --- | --- |
| `scripts/widget-stats.js` | Mount, DOM-direct paint (no Handlebars), hide-without-remove |
| `styles/widget-stats.css` | Size, position, and clipping of `#herald-stats` |
| `scripts/const.js` | `STREAM_STATS.ROOT_ID` / `SELECTOR` — the Studio contract in one place |
