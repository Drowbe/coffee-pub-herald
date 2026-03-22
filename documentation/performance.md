# Performance / Memory Review

Scope: `coffee-pub-herald` (Foundry VTT v13+) with Blacksmith API usage.

This doc focuses on potential memory leaks, performance hotspots, and incomplete / risky usage patterns around Blacksmith `HookManager` and Blacksmith sockets.

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

### 1) `broadcast-windows` HookManager context is never disposed
**Where:** `scripts/manager-herald.js`
- Hooks are registered with `context: 'broadcast-windows'` in `_registerBroadcastWindowHooks()`
- `cleanup()` calls `disposeByContext(...)` for multiple contexts, but **does not include** `'broadcast-windows'`.

**Why this matters:** If the module is unloaded/disabled and re-enabled in the same browser session, those hooks can survive longer than expected and keep references alive, causing duplicated behavior and gradual memory growth.

**Recommendation / Status:**
- Add `this._blacksmith?.HookManager?.disposeByContext('broadcast-windows')` in `cleanup()` and reset `_broadcastWindowHooksRegistered` after cleanup.
- Implemented (see `cleanup()` changes in `scripts/manager-herald.js`).

---

### 2) Pending `setTimeout` calls are not fully tracked/cleared
**Where:** `scripts/manager-herald.js`
- There are many `setTimeout(...)` calls used for initialization and follow-up work.
- **Fixed:** All Herald-owned timers go through `_trackedSetTimeout` (single internal `setTimeout` wrapper). Debounced work (`_gmDebounce`, `_playerButtonsDebounce`, `_playerDebounces`) uses `_trackedSetTimeout` plus `_trackedClearTimeout` when cancelling/rescheduling so `_timeoutIds` stays consistent.
- **`cleanup()`** clears pending debounces explicitly, then clears any remaining `_timeoutIds`, then clears handler maps. `_stopAllPlayerViewportMonitoring()` iterates both `_playerPanHandlers` and `_playerDebounces` keys so orphaned debounce entries cannot survive.

**Why this matters:** If unload/disable occurs while timeouts are pending, those callbacks can still run after `cleanup()`, potentially re-registering hooks/tools or re-triggering socket emissions.

**Recommendation / Status:**
- Replace untracked `setTimeout` usages with `_trackedSetTimeout(...)` (or store IDs and clear them in `cleanup()`).
- **Done:** Initialization, viewport delays, GM/player portrait debounces, player viewport debounces, and the broadcast window auto-close socket path all use tracked timers; `cleanup()` mirrors full teardown.

---

### 3) Socket handler cleanup is not explicit (may be fine, but currently undocumented here)
**Where:** `scripts/manager-herald.js`
- Socket handlers are registered via `blacksmith.sockets.register(...)`.
- `cleanup()` clears `_socketHandlerNames`, but explicitly notes that internal socket handler cleanup isn’t accessible.

**Why this matters:** If Blacksmith does not automatically unregister handlers on module unload (or if unload doesn’t trigger full teardown), handlers could accumulate.

**Recommendation:**
- Confirm Blacksmith’s socket lifecycle behavior on module unload.
- If the socket API provides an unregister/return value (or a dispose-by-context equivalent), adopt it.
- Otherwise, add a short comment in code/doc clarifying that Blacksmith auto-cleans handlers on unload.

---

## Performance Hotspots

### 1) Excessive debug logging on camera hot paths
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

### 2) Bounding-box calculations are re-run frequently and expensively
**Where:** `scripts/manager-herald.js`
- `_onTokenUpdate()` and `_onCombatantTokensUpdate()` compute:
  - visible tokens list
  - group centers
  - auto-fit zoom → `_calculateAutoFitZoom()` → `_calculateTokenBoundingBox()`
- `_calculateTokenBoundingBox()` loops all tokens and performs per-token width/height math and texture scaling.

**Why this matters:** During active scenes (many tokens), any missed throttling means lots of math + garbage creation.

**Recommendation / Status:**
- Compute should-pan first and only compute zoom/bounding-box if needed.
- **Partial:** `_getViewportCssSize()` is cached (invalidated when renderer width/height/resolution change; cleared in `cleanup()`). Hot-path settings (`distanceThreshold`, `throttleMs`, fill percents, animation duration) use `_hotPathSettings` refreshed on init and `settingChange`.
- **Rank 7 (done):** `_getVisiblePartyTokens` / `_getVisibleCombatTokens` / `_getAllVisibleCanvasTokens` cache sorted token ids per scene (and combat roster key / placeables + visible count for spectator); on pure `x`/`y`/`rotation`/etc. moves they **re-resolve by id** in O(k) instead of scanning all placeables. `_calculateAutoFitZoom` caches last result by geometry signature + renderer key + fill percent. Invalidation: `cleanup()`, scene/camera init, `createToken`/`deleteToken`, structural `updateToken` (any change besides position/sort/elevation/rotation), combatant create/update/delete, combat start/end, `broadcastUserId` change, hot-path fill settings.

---

### 3) Settings lookups on hot paths
**Where:** `scripts/manager-herald.js`
- **Fixed:** `_shouldPan()`, party/combatant/token-spectator follow, combat framing, follow mode, map view, GM/player viewport apply use **`_hotPathSettings`** (populated by `_refreshHotPathSettingsCache()` on init and when any of `broadcastFollowDistanceThreshold`, `broadcastFollowThrottleMs`, `broadcastAnimationDuration`, `broadcastSpectatorPartyBoxFill`, `broadcastCombatViewFill`, or `broadcastFollowViewFill` changes — see `broadcast-settings` HookManager hook).

---

### 4) Token lists are recomputed on every update
**Where:**
- `_getVisiblePartyTokens()` uses `canvas.tokens.placeables.filter(...)` and visibility checks.
- `_getVisibleCombatTokens()` loops through all combatants and then visibility checks.
- `_getAllVisibleCanvasTokens()` filters `canvas.tokens.placeables` each time.

**Why this matters:** Each “camera follow” call rebuilds arrays and iterates potentially large lists.

**Recommendation / Status:**
- **Fixed (Rank 7):** Cached id lists + verification (see §2 above); Token Spectator uses `placeablesCount` + `visibleCount` so new visible tokens invalidate correctly.

---

### 5) Menubar full `renderMenubar` churn
**Where:** `scripts/manager-herald.js`
- `_setBroadcastMode()` used to call `renderMenubar(true)` while the `broadcast-mode-buttons` `settingChange` hook also rendered after the same `game.settings.set('broadcastMode', ...)`.
- Context menu mode picks, combat begin/end, and enable-toggle duplicated secondary-bar active updates + extra renders.

**Recommendation / Status:**
- **Fixed:** Centralize via **`_requestMenubarRender(immediate)`** — immediate for user-driven / settings UI; **100ms debounced** `renderMenubar(false)` for `userConnected` / `userDisconnected` and after portrait/follow bar rebuilds. Removed redundant renders from `_setBroadcastMode`, combat hooks, context menu, and enable toggle (single source: hooks + `_requestMenubarRender`).

---

## Blacksmith API Usage Notes (HookManager / Sockets)

### 1) HookManager usage is mostly correct, but cleanup gaps exist
**Where:** `scripts/manager-herald.js`
- Most hook registrations include `context: ...`
- `cleanup()` disposes several contexts, but misses `broadcast-windows`.

**Recommendation:** dispose the full set of contexts registered in `_registerHooks()` and subordinate `_register*()` functions.

---

### 2) Socket readiness is awaited repeatedly in hot paths (likely expensive)
**Where:** `scripts/manager-herald.js`
- `_sendGMViewportSync()` calls `await blacksmith.sockets.waitForReady()` on every send.
- `_sendPlayerViewportSync()` has the same pattern.

**Why this matters:** `canvasPan` can fire frequently; even a small overhead repeated many times adds up.

**Recommendation:**
- Create a cached readiness promise (e.g., `this._socketsReadyPromise ||= blacksmith.sockets.waitForReady()`) after initialization.
- Then await that promise in hot send paths instead of calling `waitForReady()` each time.

---

### 3) Potential overlap / queueing of `canvas.animatePan` calls
**Where:** multiple camera adjustment methods call `await canvas.animatePan(...)`.

**Why this matters:** If events arrive faster than animation duration, you may end up with overlapping animations or queue behavior (depending on Foundry’s implementation).

**Recommendation:**
- Track an “animation in flight” state and either:
  - ignore intermediate calls while one is running, or
  - coalesce multiple requests into the latest target (debounce cameraman viewport apply).

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

