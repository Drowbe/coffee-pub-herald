# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## [Unreleased]

### Added

- **MVP leaderboard stream widget**: Foundry's `/stream` capture page now draws a fixed lifetime MVP ranking so Coffee Pub Studio can crop it into its own OBS source. The root is `#herald-stats` (380 by 320 pixels), placed immediately to the right of the stream chat column. Detection matches Blacksmith: `game.view === 'stream'` (toasts) or `body.stream` (loading overlay), and the box is mounted on `init` as well as `ready`. Inner markup is DOM-direct like Blacksmith toasts — no Handlebars — because awaiting `BlacksmithAPI.waitForReady()` (which only resolves, never rejects) on `/stream` left the box an empty black rectangle. Position, size, and visibility are inline styles so Foundry's `body.stream` stylesheet cannot hide or reflow it. Rank, portrait, name, total, average, and fight count come from Blacksmith's `stats.party.getAggregate()`. Extra rows scroll inside the box; an empty board still leaves the element in the page. The widget does not render on `/game`. See `documentation/architecture/architecture-stream-widgets.md`.

## [14.0.0]

### Changed

- **FoundryVTT v14 support**: `compatibility` is now `minimum: "13"`, `verified: "14"`, `maximum: "14"`. v13 is still supported — nothing in the suite has dropped it. Verified against 14.367.
- **Broadcast UI-hiding selectors fixed for v14 (`styles/broadcast.css`)**: The left/middle/right interface sections moved from classes to IDs. Through v13 they were `section.ui-left` / `.ui-middle` / `.ui-right`; on v14 they are `section#ui-left.flexrow`, `section#ui-middle`, `section#ui-right.flexrow`, and there is no shared class left to target since `ui-middle` carries none. The rules now use `#interface > section#ui-left` and siblings.
  - **This was a silent break, which is why it matters more than it reads.** A CSS rule that matches nothing raises no error and logs no warning — it simply stops applying. On v14 the three granular "Hide Interface" settings would have appeared to do nothing, leaving the streamer's navigation, players list and sidebar **visible on camera** with no indication anything was wrong. The full-interface rule (`#interface`) and `#notifications` were unaffected, so the failure would only have shown up for users hiding sections individually.
  - `.blacksmith-menubar-container`, `.blacksmith-menubar-secondary` and `.squire-tray` are unchanged on v14 and were left alone. The secondary bar is frequently absent from the DOM because it only exists while something has registered one — that is not a sign the rule is stale.
- **Journal hooks corrected to the ApplicationV2 names (`_registerBroadcastWindowHooks`)**: Now registers `renderJournalEntrySheet` and `renderJournalEntryPageSheet` only. Herald had been registering four names, including the retired v12-era `renderJournalSheet` and `renderJournalPageSheet`.
  - **This was fixing a double-emit, not just a warning.** The legacy names never fire on their own, but Blacksmith 14.1.0 remaps `renderJournalSheet` onto `renderJournalEntrySheet` — and Herald *also* registered `renderJournalEntrySheet` directly, so the remap produced two live registrations of the same callback. Every journal open fired `_emitBroadcastWindowOpened()` twice, sending two "window opened" socket messages to the cameraman client instead of one. The remap turns a dead registration into a live one, which is correct; for a module holding both names it doubles rather than restores.
  - The ApplicationV2 render hooks pass a native `HTMLElement` where the V1 hooks passed jQuery. Herald's callbacks are zero-arg, so the signature change has no effect here, but any future callback taking arguments must expect an element rather than a jQuery object.
- **Camera code unchanged**: `canvas.scene._viewPosition`, `canvas.pan` and `canvas.animatePan` all behave on v14 as they did on v13, and no public accessor has replaced `_viewPosition`. Verified, not assumed.

### Notes

- **"Hide Scene Background" (`broadcastHideBackground`) still does nothing, and is now labelled as such in the setting hint.** The setting has existed since Herald's initial commit and has never worked in any Foundry generation. Its CSS rule targeted `canvas.background`, an element that does not exist — the scene renders into a single `canvas#board` and the background is a PIXI mesh *inside* that canvas, not a DOM node, so no selector could reach it. It failed silently, which is why a dead toggle went unreported for the module's whole life.
  - A JS implementation was written for this release and **reverted before shipping**. It set `canvas.environment.primary.background.visible`, gated on the broadcast user. During testing a **non-broadcast client loaded with a black game view** — behaviour the gating does not account for, since the hide path is reachable only where `matchUserBySetting()` returns true, `_isBroadcastUser()` was evaluated at fire time rather than captured at registration, and `visible` is per-client PIXI state that is never socketed or persisted. The black view could not be reproduced afterwards, and the leading theory is an unrelated cause with coincidental timing. Rather than ship a change that could not be explained, it was pulled. A setting that has never worked is a much smaller problem than a map that fails to render for an ordinary player.
  - The mechanism itself was since verified sound, and the reasoning behind it corrected: the background and token *sprites* share `PrimaryCanvasGroup` (only the `TokenLayer` interaction layer sits in `InterfaceCanvasGroup`), but `visible` is per-object PIXI state that does not propagate to siblings, so hiding the background mesh leaves tokens rendering. See `documentation/architecture-broadcast.md` §1a before attempting this again.
  - `canvas#board` was ruled out as a substitute regardless: it renders tokens and tiles too, so hiding it would black out the broadcast rather than clean it up.
  - The dead CSS rule is replaced by a comment recording what was tried and why it was withdrawn, so the next attempt does not repeat it. Nothing about the toggle is persisted — `visible` is per-client PIXI render state — so any client left with a hidden background is fixed by a reload.

## [13.0.8]

### Added

- **Toast watchdog (cameraman only)**: Blacksmith toasts are DOM-direct — no Application instance, no `close()`, nothing in `ui.windows` — so Herald's existing window-closing paths (`_getOpenWindows()`, `_closeAllWindows()`) never saw them. A **persistent** toast (`duration: 0`) waits for a click, and nobody is sitting at the cameraman client to give it one, so it stayed on the broadcast screen indefinitely. `HeraldManager._sweepStuckToasts()` now polls `api.toast.getActive()` every second and calls `api.toast.remove(id)` on persistent toasts older than the configured age.
  - **Only persistent toasts are swept.** Everything else carries a duration (8s default) and removes itself; reaping those early would just truncate them mid-read. At the 5s default this means a persistent toast tracks roughly the lifetime of an ordinary one, rather than lingering.
  - **Age comes from `shownAt`** (added in Blacksmith 13.15.0). If a toast lacks it, Herald falls back to when the watchdog first saw the toast — always later than the true render time, so the error is toward leaving a toast up longer, never cutting one short.
  - **Deliberately conservative**, because `remove()` is silent by design: `onDismiss` fires on auto-timeout and on the close button, but never on programmatic removal, `clearByModule()`, `stackKey` replacement, or stack-cap eviction. Senders that hang cleanup on `onDismiss` (Bibliosoph's click-to-roll toasts drop their armed-toast entry there) leak that entry when Herald reaps. Not fatal, but the reason this waits for a genuinely stuck toast rather than tidying aggressively.
  - Runs only where `isEnabled() && _isBroadcastUser() && broadcastAutoDismissToasts`, gated through `_applyToastWatchdogState()` — the same start/stop-from-one-check shape as `_applyCameramanBoxState()`. Reacts to `enableBroadcast`, `broadcastUserId`, and both new settings.
  - **Scope note**: if the cameraman account is on Blacksmith's `toastExcludedUsers`, most toasts never render there and this is a backstop for deliberate GM sends (`bypassExclusion` in the Send Toast window). If it is *not* excluded, exclusion plus channels is the better primary fix and this is the safety net.
- **`broadcastAutoDismissToasts`** (default on) and **`broadcastToastMaxAgeSeconds`** (default 5, range 5–300): the watchdog toggle and age threshold. A toast is removed within `maxAge + 1s`.
- **"Close Toasts" tool**: New GM tool in the broadcast bar's `tools` group (`fa-comment-slash`, order 5 — settings moved to 6) and in the Tools context menu, emitting the new `close-toasts` window command. Unlike the watchdog it clears **every** toast on the cameraman, persistent or not, and does not wait for an age — it is a human deliberately clearing the broadcast screen.
- **`_trackedSetInterval` / `_trackedClearInterval`** and an `_intervalIds` set, mirroring the existing timeout tracking so `cleanup()` tears intervals down too.

### Notes

- The existing `broadcastHideNotifications` setting does **not** cover this. Its CSS targets Foundry's `#notifications` queue; Blacksmith toasts render in their own container.

## [13.0.7]

### Changed

- **Broadcast bar migrated to Blacksmith size presets**: `registerSecondaryBarType('broadcast', …)` now passes **`size: 'large'`** instead of `height`. Blacksmith's secondary bar height is a preset — `'default'` (30px), `'large'` (45px), `'xlarge'` (60px) — with no pixel option; `config.height` is ignored and logs a warning. **The bar is 15px shorter** (60px → 45px) while its buttons stay the size they were, because Blacksmith's group banners are now **additive** rather than subtractive: a banner is added on top of the bar's height instead of taken out of the items' share. The button box is `height - 12px`, so the `mirror` and `follow` groups render **33px portraits** — roughly what the old 60px bar actually produced once the banner, gap, and chrome were subtracted.
  - The preset is chosen for the portraits. Every Herald bar item passes `label: null`, so the body-text scaling that moves most suite bars to `'default'` does not apply — the only text on this bar is the group banner, which clamps to 8px at all three presets. `'default'` was ruled out because its 18px portraits are too small to tell one player from another; `'xlarge'` (48px) was tested and is available if the bar is ever meant to be read at a distance.
  - **Requires the Blacksmith fix to `--secondary-bar-item-image-size`.** That variable was `100%`, which is cyclic against a shrink-to-fit button and resolved to each portrait's intrinsic size — image items rendered hundreds of pixels wide and the bar clipped a horizontal band out of them. Blacksmith now derives it from bar height. On an older Blacksmith the broadcast bar's portraits will be unusable at any preset.
- **`toggleSecondaryBar('broadcast')`** no longer passes a `{ height }` override from the menubar tool or the context menu. That override exists for bars that change appearance at runtime (Blacksmith's encounter bar switching in/out of combat); the broadcast bar has one fixed appearance.

### Removed

- **`broadcastBarHeight` setting**: Removed along with its `en.json` strings. Under the preset model a pixel slider was a portrait-size control mislabelled as a height, and only three values in its 36–120 range were reachable. Stored values in existing worlds are ignored; no migration needed.
- **`HeraldManager._applyBroadcastBarHeightCss()`**: Removed, with both call sites and its `broadcastBarHeight` branch in the settings-changed handler. It wrote **`--blacksmith-menubar-secondary-broadcast-height`** directly onto `documentElement`, but Blacksmith deleted that variable when it took ownership of secondary bar sizing — the method had no effect.

### Documentation

- **`documentation/architecture-broadcast.md`**: Secondary bar section rewritten for the preset model. Removed the stale `--blacksmith-menubar-secondary-broadcast-height` references from the styling, bar, and file-structure sections; documented why `'large'` applies here and why the `{ height }` override is not an escape hatch.

## [13.0.6]

### Added

- **Cameraman viewport box (GM overlay)**: A GM-only box drawn on the canvas showing what the cameraman client currently sees. Toggle it from the **View Mode menu** (left-click the view-mode menubar tool) or the new **Show Cameraman Viewport Box** module setting. The cameraman reports its viewport center, zoom, screen size, and scene id back to the GM over the Blacksmith socket; the GM converts that to a world-space rectangle drawn on `canvas.interface` so it pans/zooms with the GM's own view. The box only appears while the GM and cameraman are on the same scene, and its border/label stay a constant on-screen size regardless of GM zoom. The label in the box's top-left corner shows the current broadcast view mode.
  - New world setting: **`broadcastShowCameramanBox`** (default off, no reload).
  - New sockets: **`broadcast.cameramanBoxState`** (GM → cameraman: start/stop reporting) and **`broadcast.cameramanViewportSync`** (cameraman → GM: viewport state).

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
