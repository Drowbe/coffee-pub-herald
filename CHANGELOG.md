# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## [13.0.5] - 2026-04-01

### Fixed

- **`postConsoleAndNotification` on `ready`**: The guard used `typeof BlacksmithUtils !== 'undefined'`, which is still true when **`BlacksmithUtils` is `null`**, so the code accessed **`null.postConsoleAndNotification`** and threw. Resolution now prefers **`HeraldManager._blacksmith?.utils?.postConsoleAndNotification`**, then **`globalThis.BlacksmithUtils?.postConsoleAndNotification`**, with the existing **`console.debug`** fallback when debug logging is on and neither is available.

## [13.0.4] - 2026-03-31

Blacksmith socket lifecycle clarified for maintainers (authoritative upstream behavior: no `unregister`, no full socket stack teardown on `unloadModule`). Herald code comments and risk docs aligned; runtime behavior of `cleanup()` is unchanged (still clears **`_socketHandlerNames`** only).

### Added

- **`documentation/blacksmith-sockets-unload.md`**: Note on SocketManager / `api.sockets` (no unregister API, handlers persist until full client reload, native `off` used for re-init stacking, not general unload).

### Documentation

- **`documentation/performance.md`**: High-Risk §3 updated from “confirm upstream” to confirmed behavior; Herald guidance and link to **`blacksmith-sockets-unload.md`**; optional checklist line adjusted (socket item moved to upstream doc).
- **`documentation/blacksmith-apis.md`**: Sockets item documents unload / lack of unregister and links to **`blacksmith-sockets-unload.md`**.

### Technical

- **`scripts/manager-herald.js`** (`cleanup()`): Socket-handler comment replaced with accurate Blacksmith semantics and pointer to **`documentation/blacksmith-sockets-unload.md`** (same **`_socketHandlerNames.clear()`** bookkeeping as before).

## [13.0.3] - 2026-03-30

### Fixed

- **Broadcast mode UI after changing view (menubar menu / secondary bar)**: `_setBroadcastMode` now calls **`_syncSecondaryBarActiveForBroadcastMode`**, **`_refreshBroadcastSecondaryBarData`** (`updateSecondaryBar` with live mode + sync timestamp when the broadcast bar is open), and **`_requestMenubarRender(true)`** immediately after persisting `broadcastMode`, so active buttons and View Mode tool match the cameraman without relying only on HookManager `settingChange`. Initial bar sync and the `broadcast-mode-buttons` hook use the same helpers.

## [13.0.2] - 2026-03-07

Performance, lifecycle, menubar churn, clearer View Mode status when the cameraman is missing or offline, and a GM tool to toggle the combat bar on the cameraman client.

### Added

- **Toggle combat bar (cameraman)**: Broadcast **Tools** (secondary bar + View Mode → Tools), icon **`fa-solid fa-browser`**, emits `broadcast.windowCommand` **`toggle-combat-bar`**. Cameraman toggles body class `broadcast-show-combat-bar`. Session **`_combatBarVisibilityOverride`** until **Show Combat Bar in Broadcast** changes or module `cleanup()`.

### Changed

- **Hot-path camera settings**: `_hotPathSettings` + `_refreshHotPathSettingsCache()` on init and when follow threshold/throttle, animation duration, or view-fill settings change; `_shouldPan` and pan/zoom paths use the cache.
- **Viewport CSS cache**: `_getViewportCssSize()` reuses width/height while PIXI renderer dimensions/resolution are unchanged; `_invalidateViewportCssCache()` on `cleanup()`.
- **Default fill literals**: Party/token spectator and combat view fill fallbacks in code aligned with `settings.js` (e.g. 70% / 35%).
- **Menubar / secondary bar churn**: Fewer duplicate `renderMenubar` calls; debounced menubar refresh on `userConnected` / `userDisconnected` and after portrait/follow bar sync; redundant bar updates removed from context menu mode picks and combat begin/end where `_setBroadcastMode` drives state.
- **View Mode menubar title/tooltip**: Shows the live mode name only when **`isBroadcastActive()`** (enabled + broadcast user set + user logged in). If enabled but not active: **No cameraman** vs **Cameraman offline**; if broadcast off, localized disabled strings (`view-mode-title-disabled`, `view-mode-tooltip-disabled`, `view-mode-tooltip-suffix`, etc.) plus new tool strings (`context-tool-toggle-combat-bar`, hint).
- **`documentation/performance.md`**: Ranks 2, 4, 5, 6, 7 and checklist updated for timers, hot-path debug removal, menubar debouncing, settings/viewport caching, token-list / auto-fit caching; doc aligned with code (`broadcast-windows` disposal, cached `waitForReady`, socket-handler note, Blacksmith sections, optional `animatePan` follow-up).
- **`documentation/TODO.md`**: Current release pointer updated to **13.0.2** vs **13.0.1**.
- **Rank 7 — token list + auto-fit cache**: `_getVisiblePartyTokens`, `_getVisibleCombatTokens`, and `_getAllVisibleCanvasTokens` reuse cached sorted ids when scene/roster/visibility signature matches and re-resolve by id (O(k)); `_calculateAutoFitZoom` caches by geometry + renderer + fill percent. Invalidation on `cleanup()`, camera init, `createToken`/`deleteToken`, non-move `updateToken` changes, combatant/combat lifecycle, `broadcastUserId`, and hot-path fill settings.

### Fixed

- **Hot-path debug allocations** (performance doc Rank 4): Removed verbose `postConsoleAndNotification(..., true, ...)` and heavy `result` objects from `updateToken` / `createToken`, `_onTokenUpdate` / `_onCombatantTokensUpdate`, GM/player viewport send/apply/socket paths, `_adjustViewportForMode` sync logs, `broadcast-mode-buttons` viewport branch, and `_updateBroadcastMode` verification logging; dropped DOM queries that existed only for that log.

- **Timer lifecycle on unload** (performance doc Rank 2): Herald-owned delays use `_trackedSetTimeout`; debounced paths use `_trackedClearTimeout`; `cleanup()` clears GM/player debounces and remaining `_timeoutIds`; `_stopAllPlayerViewportMonitoring()` walks both `_playerPanHandlers` and `_playerDebounces`; broadcast window auto-close uses tracked timers.
- **Broadcast bar / menubar after menubar optimization**: `_setBroadcastMode` always runs **`_syncSecondaryBarActiveForBroadcastMode`** and **`_requestMenubarRender(true)`** after persisting mode — UI is not tied solely to HookManager `settingChange` for `broadcastMode`.
- **`_stopAllPlayerViewportMonitoring`**: Union of handler and debounce map keys so orphaned player viewport debounces cannot remain.

### Technical

- **`_syncSecondaryBarActiveForBroadcastMode`**, **`_requestMenubarRender`**, **`_trackedClearTimeout`**, **`_HOT_PATH_SETTING_KEYS`**, **`_menubarRenderDebounceId`**, **`_viewportCssCache`**, **`_combatBarVisibilityOverride`**, **`_partyTokensCache`**, **`_combatTokensCache`**, **`_allCanvasTokensCache`**, **`_autoFitZoomCache`**, **`_invalidateVisibleTokenListCaches`**, **`_tokenGeometrySignature`**: support the above behavior in `scripts/manager-herald.js`.

## [13.0.1] - 2025-03-07

### Added

- **Enable/Disable in context menu**: View Mode menubar tool menu includes "Enable Broadcast" / "Disable Broadcast". Toggling refreshes the cameraman client (socket command with `force` so it works when disabling).
- **Show Combat Bar in Broadcast**: New setting (default on) to show the Blacksmith combat secondary bar (`data-bar-type="combat"`) on the cameraman view when in broadcast mode; disable for a fully clean view.
- **Menubar and secondary bar hiding**: In broadcast mode, hide `.blacksmith-menubar-container` and `.blacksmith-menubar-secondary`; combat bar is shown when "Show Combat Bar in Broadcast" is enabled.
- **Follow flyout**: View Mode menu has a "Follow" submenu; followable tokens are listed there (labels without "Follow:" prefix).
- **Broadcast bar height**: New `broadcastBarHeight` setting (default 60px, range 36–120). Height is passed to Blacksmith via `registerSecondaryBarType` and CSS variable `--blacksmith-menubar-secondary-broadcast-height`.
- **Tools flyout in context menu**: View Mode menu has a "Tools" flyout at the end with Close Images, Close Journals, Close All Windows, Refresh, and Settings (matches broadcast bar tools).
- **Combat mode switches**: Auto-switch broadcast mode when combat starts and ends. New settings `broadcastCombatBeginMode` and `broadcastCombatEndMode` (dropdowns: Manual, GM View, Combat, Combatant, Spectator, Map View, No change). Defaults: Combatant on begin, Spectator on end. Uses `combatStart` (Begin Combat) and `deleteCombat` (End Combat) hooks.
- **Audio unlock**: New `herald-audio.js` runs on `ready` and `canvasReady` to unlock Foundry audio without a manual canvas click. Uses OBS browser source `obsstudio.getStatus()` when available for gesture context, then `game.audio.unlock`. Enables playlists, interface sounds, and environment audio on the cameraman client.
- **Combat/Combatant only when in combat**: Combat and Combatant view modes are disabled when there is no active combat. Combat and Combatant bar buttons are visible only when `game.combat` exists. Context menu shows Combat/Combatant only when combat is active. If mode is combat or combatant and combat ends (or was never started), view switches to the "Switch to (Combat End)" fallback (default Spectator). New notification: "No active combat. Start combat first." (i18n: `notification-no-combat`).
- **Mirror flyout**: Mirror options are grouped under a "Mirror" flyout in the View Mode context menu. Logged-in users with party tokens appear as submenu items under Mirror (i18n: `context-mirror-flyout`).
- **Token Spectator mode**: New broadcast mode "Token Spectator" that frames **all tokens on the canvas** (party, NPCs, and any other tokens visible to the broadcast user). Use case: frame party and monsters when **out of combat**. Uses the same view-fill setting as Party Spectator (`broadcastSpectatorPartyBoxFill`). Available anytime (not combat-only); bar button and context menu always show. Replaces the earlier "Combat Spectator" which only framed combat-tracker tokens.

### Changed

- **Menubar context menu on left-click**: View Mode tool opens its menu on **left-click** via Blacksmith's context menu API (`uiContextMenu.show`). Menu uses zones (`core`, `gm`) with separators; includes Enable/Disable Broadcast, Hide/Show broadcast bar, modes, Mirror, Follow (flyout), and Tools (flyout). Right-click does nothing.
- **Cameraman selector**: Replaced free-text input with a dropdown for `broadcastUserId`. Lists "None" and all users in the world. Setting is registered in `ready` with choices from `game.users`.
- **Broadcast button**: No context menu. Click only toggles the broadcast secondary bar (show/hide). Enable/Disable and Hide/Show bar are available only from the View Mode menu.
- **What Enable controls**: Enable only controls broadcast behavior and cameraman UI; it no longer hides the menubar. Menubar tools stay visible when Herald is disabled so users can turn it back on.
- **Using tools when disabled**: Clicking any broadcast tool (toggle bar, mode buttons, close/refresh/settings) while broadcast is disabled shows a notification: "Broadcast is not enabled."
- **Visibility override**: Menubar is never hidden via the Blacksmith visibility override (tools always visible); hiding is done via CSS when in broadcast mode.
- **Refresh on enable/disable**: `_emitBroadcastWindowCommand(action, options)` now accepts `options.force`. When toggling enable/disable, refresh is sent with `{ force: true }` so the cameraman always receives it and reloads.
- **Herald audio**: Simplified; no dialog and no automatic unlock attempts. Broadcast view relies on one manual click in the browser source (e.g. OBS Interact) to enable audio. `herald-audio.js` is a stub with a short comment.
- **Notifications hiding**: Re-enabled. When broadcast is on, the "Hide Notifications" setting again adds/removes the `hide-notifications` body class (was temporarily disabled for debug).
- **Spectator renamed to Party Spectator**: The former "Spectator" mode is now labeled "Party Spectator" everywhere (settings, bar tooltip, context menu, View Mode tooltip). It follows party tokens only. **Combat** mode (combat-only) frames all tokens in the combat tracker. **Combatant** mode follows the current combatant. **Token Spectator** frames all tokens on the canvas and works out of combat.
- **Party / Token Spectator view fill**: Setting label updated to "Party / Token Spectator View Fill (%)" (used by both Party Spectator and Token Spectator); hint clarifies it applies to both modes.
- **Combat vs Combatant names aligned**: Internal mode IDs now match display names: **Combat** (`combat`) = frame all tokens in the combat tracker; **Combatant** (`combatant`) = follow current combatant. Bar order: Combatant (helmet icon) first, Combat (swords icon) second. Icons: Token Spectator = chess, Combat = helmet-battle, Combatant = swords. One-time migration renames saved `broadcastMode` / `broadcastCombatBeginMode` / `broadcastCombatEndMode` so existing worlds keep the same behavior; default for "Switch to (Combat Begin)" is now Combatant.
- **Mirror view display name**: When mirroring a player's view, the View Mode tooltip and display name show only the player's name (e.g. "Alice"); the "Mirror:" prefix is no longer appended.

### Fixed

- **Context menu**: Fixed zone keys to use Blacksmith's documented `core` and `gm` (was `view`/`tools`, which Blacksmith does not render). Added `maxWidth: 340` to prevent label truncation (e.g. "Hide/Show broadcast bar").
- **Default zoom levels**: Tune default zoom levels for broadcast modes (follow, combat, spectator) — completed.
- **Syntax error**: Removed invalid `await` in `_registerBroadcastTools()` (non-async function). Initial correction of combat/combatant mode when no combat uses fire-and-forget `_setBroadcastMode(fallback)`.

### Technical

- New body class `broadcast-show-combat-bar` when setting "Show Combat Bar in Broadcast" is on; CSS shows `.blacksmith-menubar-secondary[data-bar-type="combat"]` only then.
- Setting change hook now reacts to `broadcastHideNotifications` and `broadcastShowCombatBar` for immediate UI update.
- View Mode menu items built by `_getViewModeMenuItems()`; shown via `_showBlacksmithContextMenu()` using Blacksmith's `uiContextMenu.show()` with `maxWidth: 340`.
- Cameraman disconnected: broadcast is only active when designated cameraman is connected (`user.active`). All send paths guard with `isBroadcastActive()`. View Mode tooltip shows "Disconnected" when enabled but cameraman offline. `userConnected`/`userDisconnected` hooks update mode and render menubar.


## [13.0.0] - 2025-03-03 

### NOTE: Initial release as a stand-alone module.

### Added

- **Initial release.** Herald is the standalone Broadcast module for Foundry VTT, migrated from Coffee Pub Blacksmith.
- **Broadcast / streaming view**: Designate a cameraman user for a clean, UI-free view suitable for streaming or player displays.
- **Menubar integration**: Broadcast toggle and View Mode tools in the Blacksmith menubar (requires Coffee Pub Blacksmith).
- **Secondary bar**: Broadcast controls bar with mode buttons (Manual, GM View, Combat, Combatant, Spectator, Map View, Mirror/Follow), close tools, and settings.
- **View modes**:
  - **Manual**: No automatic following; cameraman controls the view.
  - **GM View**: Mirror the GM’s viewport (center and zoom).
  - **Combat**: Frame current turn combatant + targets; updates on turn and target change.
  - **Combatant**: Frame all visible combatant tokens on the scene.
  - **Spectator**: Frame party tokens in a configurable box.
  - **Map View**: Fit the current scene map with configurable padding.
  - **Mirror**: Mirror a specific player’s viewport.
  - **Follow**: Follow a selected token on the canvas.
- **Settings**: Enable/disable broadcast, cameraman user selection, view fill percentages for follow/combat/spectator, and related options.
- **Visibility override**: Optional menubar hide for the broadcast user so they see a clean view (via Blacksmith API).
- **Localization**: English (en) language file.

### Dependencies

- Requires **Coffee Pub Blacksmith** (v13). Install and enable Blacksmith before Herald.

### Notes

- This module uses only the public Blacksmith API (menubar tools, secondary bar, sockets, visibility override). See Blacksmith’s “Registering with Blacksmith” documentation for integration details.
