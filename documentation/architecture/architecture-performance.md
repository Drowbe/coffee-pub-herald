# Performance / Memory Review

Scope: `coffee-pub-herald` (Foundry VTT v13+) with Blacksmith API usage.

This doc focuses on potential memory leaks, performance hotspots, and incomplete / risky usage patterns around Blacksmith `HookManager` and Blacksmith sockets.

**Status:** The stack-ranked table below is **fully fixed** in current Herald. Later sections record what was at risk, what was implemented, and **optional** follow-ups (not ranked).

---

## Current Findings (Stack Ranked)

| Rank | Severity | Area | Status |
| --- | --- | --- | --- |
| 1 | High | HookManager context cleanup gaps (`broadcast-windows`) | Fixed |
| 2 | High | Delayed timer lifecycle (`setTimeout` tracking/cleanup) | Fixed |
| 3 | High | Socket readiness overhead on frequent sync paths | Fixed |
| 4 | Medium | Hot-path per-token debug payload allocations | Fixed |
| 5 | Medium | Menubar full rerenders on frequent update paths | Fixed |
| 6 | Medium | Repeated settings lookups in hot camera paths | Fixed |
| 7 | Low | Token list/bounding box recomputation opportunities | Fixed |

---

## High-Risk Memory / Lifecycle Issues

### 1) `broadcast-windows` HookManager context cleanup **(fixed)**
**Where:** `scripts/manager-herald.js`
- Hooks are registered with `context: 'broadcast-windows'` in `_registerBroadcastWindowHooks()`.

**Was at risk:** If `'broadcast-windows'` were omitted from `cleanup()`, hooks could survive a reload/re-enable and duplicate behavior.

**Status:** `cleanup()` calls `HookManager.disposeByContext('broadcast-windows')` together with the other Herald contexts, and clears **`_broadcastWindowHooksRegistered`** so window hooks can register again on re-init.

---

### 2) Pending `setTimeout` calls **(fixed)**
**Where:** `scripts/manager-herald.js`
- There are many `setTimeout(...)` calls used for initialization and follow-up work.
- **Fixed:** All Herald-owned timers go through `_trackedSetTimeout` (single internal `setTimeout` wrapper). Debounced work (`_gmDebounce`, `_playerButtonsDebounce`, `_playerDebounces`) uses `_trackedSetTimeout` plus `_trackedClearTimeout` when cancelling/rescheduling so `_timeoutIds` stays consistent.
- **`cleanup()`** clears pending debounces explicitly, then clears any remaining `_timeoutIds`, then clears handler maps. `_stopAllPlayerViewportMonitoring()` iterates both `_playerPanHandlers` and `_playerDebounces` keys so orphaned debounce entries cannot survive.

**Why this matters:** If unload/disable occurs while timeouts are pending, those callbacks can still run after `cleanup()`, potentially re-registering hooks/tools or re-triggering socket emissions.

**Recommendation / Status:**
- Replace untracked `setTimeout` usages with `_trackedSetTimeout(...)` (or store IDs and clear them in `cleanup()`).
- **Done:** Initialization, viewport delays, GM/player portrait debounces, player viewport debounces, and the broadcast window auto-close socket path all use tracked timers; `cleanup()` mirrors full teardown.

---

### 3) Socket handler cleanup via Blacksmith **(documented — upstream behavior confirmed)**
**Where:** `scripts/manager-herald.js` — `blacksmith.sockets.register(...)`; `cleanup()` clears **`_socketHandlerNames`** only.

**Blacksmith (authoritative):** `api.sockets` has **no unregister**. SocketManager does **not** hook `unloadModule` / `closeGame` to tear down SocketLib, the generic router, or native `game.socket` listeners as a full “module disabled” lifecycle; native `off` exists for **re-init** stacking, not general unload. **Handlers registered via Blacksmith persist until a full client reload** unless Blacksmith adds unregister + unload teardown.

**Herald:** Treat socket registrations as **session-lifetime**; use `cleanup()` for Herald-owned hooks/timers/UI. See **`documentation/blacksmith-sockets-unload.md`** for the full note (suitable to paste into a wiki).

---

## Performance Hotspots

### 1) Debug logging on camera hot paths **(fixed — Rank 4)**
**Where:** `scripts/manager-herald.js`
- **Fixed:** Removed `postConsoleAndNotification(..., true, ...)` (and large inline `result` objects) from:
  - `updateToken` / `createToken` HookManager callbacks
  - `_onTokenUpdate` / `_onCombatantTokensUpdate` (including pan/zoom gating and execute paths)
  - GM/player viewport sync: `_sendGMViewportSync`, `_applyGMViewport`, GM viewport socket handler, `_sendPlayerViewportSync`, `_applyPlayerViewport`, `_startGMViewportMonitoring` “ON” log
  - `_adjustViewportForMode` immediate sync logs
  - `broadcast-mode-buttons` `settingChange` viewport-adjustment debug
  - `_updateBroadcastMode` “checking mode” / “activated” payloads and the DOM verification block used only for that log
- **Note:** `_calculateTokenBoundingBox()` / `_shouldPan()` were already free of per-token debug; errors in `catch` blocks still use `postConsoleAndNotification` where useful.

**Why this matters:** Even when debug output is suppressed, building log payloads on every token move or every debounced pan costs allocations and work on the main thread.

**Recommendation / Status:**
- Prefer no debug plumbing on paths tied to `updateToken`, `canvasPan`, or socket apply; use one-shot init logs or errors only where needed.
- **Done** for Rank 4 scope above.

---

### 2) Bounding-box / follow-path cost **(mitigated)**
**Where:** `scripts/manager-herald.js`
- `_onTokenUpdate()` and `_onCombatantTokensUpdate()` compute:
  - visible tokens list
  - group centers
  - auto-fit zoom → `_calculateAutoFitZoom()` → `_calculateTokenBoundingBox()`
- `_calculateTokenBoundingBox()` loops all tokens and performs per-token width/height math and texture scaling.

**Why this matters:** During active scenes (many tokens), any missed throttling means lots of math + garbage creation.

**Recommendation / Status:**
- **Done:** `_getViewportCssSize()` is cached (invalidated when renderer width/height/resolution change; cleared in `cleanup()`). Hot-path settings use **`_hotPathSettings`** refreshed on init and `settingChange`.
- **Rank 7 (done):** `_getVisiblePartyTokens` / `_getVisibleCombatTokens` / `_getAllVisibleCanvasTokens` cache sorted token ids per scene (and combat roster key / placeables + visible count for spectator); on pure `x`/`y`/`rotation`/etc. moves they **re-resolve by id** in O(k) instead of scanning all placeables. `_calculateAutoFitZoom` caches the last result by geometry signature + renderer key + fill percent. Invalidation: `cleanup()`, scene/camera init, `createToken`/`deleteToken`, structural `updateToken` (any change besides position/sort/elevation/rotation), combatant create/update/delete, combat start/end, `broadcastUserId` change, hot-path fill settings.
- **Optional later:** Skip bbox/auto-fit when pan/zoom is already ruled out (easy to get wrong; only if profiling warrants it).

---

### 3) Settings lookups on hot paths **(fixed)**
**Where:** `scripts/manager-herald.js`
- **Fixed:** `_shouldPan()`, party/combatant/token-spectator follow, combat framing, follow mode, map view, GM/player viewport apply use **`_hotPathSettings`** (populated by `_refreshHotPathSettingsCache()` on init and when any of `broadcastFollowDistanceThreshold`, `broadcastFollowThrottleMs`, `broadcastAnimationDuration`, `broadcastSpectatorPartyBoxFill`, `broadcastCombatViewFill`, or `broadcastFollowViewFill` changes — see `broadcast-settings` HookManager hook).

---

### 4) Token list scans on camera follow **(fixed — Rank 7)**
**Where:** `scripts/manager-herald.js` — `_getVisiblePartyTokens()`, `_getVisibleCombatTokens()`, `_getAllVisibleCanvasTokens()`.

**Was at risk:** Every follow tick could scan all `placeables` / all combatants.

**Status:** Cached **sorted token ids** + cheap re-verification (see **§2**). Token Spectator also stores **`placeablesCount`** and **`visibleCount`** so the visible set cannot go stale when visibility toggles without a placeable count change.

---

### 5) Menubar `renderMenubar` churn **(fixed)**
**Where:** `scripts/manager-herald.js`
- `_setBroadcastMode()` used to call `renderMenubar(true)` while the `broadcast-mode-buttons` `settingChange` hook also rendered after the same `game.settings.set('broadcastMode', ...)`.
- Context menu mode picks, combat begin/end, and enable-toggle duplicated secondary-bar active updates + extra renders.

**Recommendation / Status:**
- **Fixed:** Centralize via **`_requestMenubarRender(immediate)`** — immediate for user-driven / settings UI; **100ms debounced** `renderMenubar(false)` for `userConnected` / `userDisconnected` and after portrait/follow bar rebuilds. Removed redundant renders from `_setBroadcastMode`, combat hooks, context menu, and enable toggle (single source: hooks + `_requestMenubarRender`).

---

## Blacksmith API Usage Notes (HookManager / Sockets)

### 1) HookManager contexts and `cleanup()` **(fixed)**
**Where:** `scripts/manager-herald.js`

**Status:** Registrations use `context: ...` per feature area. `cleanup()` calls **`disposeByContext`** for all Herald contexts, including **`broadcast-windows`**, **`broadcast-camera`**, **`broadcast-camera-init`**, **`broadcast-settings`**, **`broadcast-gmview-sync`**, **`broadcast-mode-buttons`**, **`broadcast-playerview-sync`**, **`broadcast-player-buttons`**, and **`broadcast-cleanup`**.

---

### 2) Socket readiness on hot paths **(fixed)**
**Where:** `scripts/manager-herald.js` — `_sendGMViewportSync()`, `_sendPlayerViewportSync()`, and other emit paths use **`_waitForSocketsReady()`**.

**Status:** A single cached promise **`_socketsReadyPromise`** is assigned from `sockets.waitForReady()` on first use and awaited thereafter. **`cleanup()`** sets **`_socketsReadyPromise = null`** so a re-enabled module obtains a fresh readiness promise.

---

### 3) Potential overlap / queueing of `canvas.animatePan` calls **(optional)**
**Where:** Multiple camera paths call `await canvas.animatePan(...)`.

**Why this matters:** If events arrive faster than animation duration, behavior depends on Foundry’s internal queuing.

**Recommendation (not implemented):** Track “animation in flight” or coalesce/debounce cameraman viewport updates.

---

## Quick Checklist (Action Items)

1. Add missing `disposeByContext('broadcast-windows')` in `cleanup()`. (done)
2. Track/clear all delayed initialization `setTimeout`s via `_trackedSetTimeout`. (done)
3. Reduce/remove debug payload allocations on token move, pan/sync, and spectator/combat camera paths (`updateToken`, `_onTokenUpdate`, viewport sync, etc.). (done)
4. Cache settings used in hot functions (`_shouldPan`, fillPercent, animation duration, thresholds`). (done — `_hotPathSettings` + `settingChange`)
5. Cache viewport CSS size for `_shouldPan()` / zoom math (invalidate on resize / pan changes if needed). (done — renderer-keyed cache + `cleanup()` invalidation)
6. Cache socket readiness promise to avoid repeated `waitForReady()` calls in `canvasPan`-driven paths. (done)
7. Debounce / dedupe menubar `renderMenubar` (remove double-render from `_setBroadcastMode` + setting hook; debounce noisy user connect paths). (done — `_requestMenubarRender`)
8. Cache visible token id lists + `_calculateAutoFitZoom` for follow paths (invalidate on structural token/combat/scene changes). (done — Rank 7)

**Optional (not checklist items):** Consider `animatePan` coalescing (Blacksmith API §3). Socket unregister / unload teardown is **upstream** — see **`documentation/blacksmith-sockets-unload.md`**.
