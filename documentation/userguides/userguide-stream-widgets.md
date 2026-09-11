# Stream Overlay

**Audience:** GMs capturing Herald widgets with Coffee Pub Studio.

Foundry's `/stream` page is a capture surface, separate from the cameraman tabletop. Herald can draw small overlays there so Studio can crop each one into its own OBS source. The first of these is the lifetime MVP leaderboard.

This is not the map feed. The cameraman view is still the canvas. These widgets sit on `/stream` so they can be composed in OBS next to that feed, not painted onto it.

## MVP leaderboard

When **Show MVP Leaderboard on Stream** is on, `/stream` shows a fixed box titled **Lifetime MVP** immediately to the right of the chat column. Rank, portrait, name, total score, average, and fight count come from Blacksmith's party statistics — the same ranking as the Party Statistics window and Squire's party panel. It updates when a combat ends.

The box stays the same size whether the party is two people or ten. Extra rows scroll inside it. With no rankings yet, the box still sits there with an empty line rather than vanishing.

It does not appear on the GM's screen, on a player's screen, or on the cameraman tabletop.

## Capturing it in Studio

1. Start the Stream window in Studio (Foundry's `/stream` view, logged in as the observer user).
2. Add a region on that tab.
3. Choose **CSS selector**.
4. Enter `#herald-stats`.
5. Click **Measure**.

The measured size should be 380 by 320 pixels, immediately to the right of the chat column. The OBS source should show only the widget: dark background, title, rows. If the crop includes chat or a slice of green screen, the selector is wrong or the widget is not on `/stream`.

Leave the selector as `#herald-stats`. Studio re-measures on every sync; a stable id is what makes that reliable.

## Turning it off

Uncheck **Show MVP Leaderboard on Stream** in Herald's settings. The box hides but is not removed, so a Studio region already pointed at `#herald-stats` keeps a valid crop instead of snapping onto whatever is underneath.

## Settings

**Show MVP Leaderboard on Stream** — world setting, on by default. See [Settings](userguide-settings.md).
