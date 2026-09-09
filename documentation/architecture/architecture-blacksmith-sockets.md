# Blacksmith — sockets, unload, unregister (for Herald)

Authoritative note from Blacksmith maintainers; mirrored here for Herald’s wiki / `performance.md` cross-reference.

## `unloadModule` / teardown on Blacksmith’s SocketManager

`manager-sockets.js` does **not** hook `unloadModule` or `closeGame` to tear down SocketLib registration, the generic `__blacksmithGenericEvent` router, or native `game.socket.on('module.coffee-pub-blacksmith.', …)`.

Native inbound cleanup exists only as `_teardownNativeSocketListener()` (`game.socket.off` on the module channel), used **before re-init** so native fallback doesn’t stack listeners — **not** as a general “module disabled” lifecycle.

So: **Blacksmith does not currently register socket cleanup on module unload** in the sense Herald’s risk table usually means (explicit unregister on disable).

## Public API for dependents (`module.api.sockets`)

Exposed in `blacksmith.js` after SocketManager loads:

- `register(eventName, handler)` — SocketLib path stores handlers in `SocketManager._externalEventHandlers`; native path uses `socket.register` into `_nativeHandlers`.
- `emit`, `isReady`, `isUsingSocketLib`, `getSocket`.

## Unregister API

There is **no** `api.sockets.unregister` (or equivalent) today. External modules **cannot** remove an event from `_externalEventHandlers` through Blacksmith’s public API.

**Workaround for Herald:** treat handlers as **session-lifetime** unless Blacksmith adds an unregister helper; on **full page reload** everything is cleared. For Herald-only state, you can still use `Hooks.on('unloadModule', …)` on your module id to drop references / UI — that does **not** remove Blacksmith’s stored handler without a new API.

## One-line summary (e.g. High-Risk §3)

Blacksmith’s socket bridge (`api.sockets.register`) does **not** expose unregister; Blacksmith does **not** tear down its socket stack on `unloadModule`. Dependents should assume handlers last until a **full client reload** unless Blacksmith adds unregister + unload teardown.
