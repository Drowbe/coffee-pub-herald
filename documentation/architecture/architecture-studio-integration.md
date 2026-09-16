# Studio (OBS) integration

**Audience:** developers working on Herald.

How the Studio menubar button talks to Coffee Pub Studio's automation server, and why it is built the way it is. Not to be confused with [Stream widgets](architecture-stream-widgets.md) (Blacksmith tool windows Studio crops out of `/stream`) or [Blacksmith APIs](architecture-blacksmith-integration.md) (the toast/menubar surfaces this feature consumes). Code lives in `scripts/manager-herald.js` (search `_studio`/`Studio`), settings in `scripts/settings.js`.

## The contract

Studio runs its own small HTTPS server, independent of Foundry, on the local network (e.g. `https://10.10.10.x:9500`). Herald is one consumer of its `/api/automations/*` surface, authenticated with a bearer token. Four endpoints:

- `GET /api/automations/capabilities` — `{ actions, ruleSets, scenes, sources }`. `actions` is the fixed catalog of things Studio can do *that are currently enabled on Studio's side* (`{action, param, paramType, group, label?}`) — an action Studio has toggled off simply is not in the array. `ruleSets` is the live event→action mapping actually configured on Studio's Automations tab (`{name, group, event}`). `scenes` (`{name, current}[]`) and `sources` (`string[]`) are OBS's real current scene/source lists.
- `POST /api/automations/event {event}` — fires whatever `ruleSets` entry matches that event name. Silently does nothing if no rule matches, which is why Herald never lets a user type an arbitrary event — every event button in the menu comes from a `ruleSets` entry Studio just told us about.
- `POST /api/automations/action {action, param}` — invokes an action directly, bypassing the rule layer. Synchronous: `200 {ok:true}` means it actually ran; `400`/`500` carry a real `{error}` (unknown/disabled action, or a runtime failure like OBS not connected).
- `GET /api/automations/status` — `{obsConnected, recording, streaming}`, answered from Studio's own internal ~2s OBS poll cache, not a fresh round-trip. No point polling faster than that.

This contract was reverse-engineered collaboratively with Studio's own author over several iterations — the response shape changed more than once mid-build (`rules` → `ruleSets`, and `actions` gained `paramType`/`scenes`/`sources` after the fact). **Do not assume a field name without checking the live response first**; it has been wrong before.

## Why settings, not code, hold the URL/token

`studioApiUrl` and `studioApiToken` are world-scope settings (`scope: 'world'`), never hardcoded. Herald is a distributed/published module; a credential baked into source would ship to every installer and sit in git history permanently. `_studioBaseUrl()` normalizes the setting (trims trailing slash, and strips a legacy full-path value some early testing left behind) before every request builds its own path onto it.

## Why capabilities are cached, with an explicit refresh

`_getObsMenuItems()` fetches `/capabilities` once and holds it in `_studioCapabilitiesCache` (a plain static field) so opening the Studio menu repeatedly does not hit the network every time. A GM changing something on Studio's Automations tab will not see it reflected until **Options → Refresh Automations** (`_refreshStudioCapabilities()`), which nulls the cache and re-fetches. The fetch itself also passes `cache: 'no-store'` — without it, the browser's own HTTP cache for the GET was observed serving stale data underneath the in-memory cache, independent of it. The cache is also invalidated automatically if `studioApiUrl`/`studioApiToken` change mid-session (`settingChange` hook), and reset on every page load (it is not persisted).

## Why the menu is built from live data, not a fixed list

Every clickable item in the Studio menu traces back to something Studio just reported:

- Rule-set items (top-level, one click) send the event straight through `/event`.
- Action-catalog items (grouped into **Scenes / Sources / Controls / Studio Control** flyouts, by each action's own `group` field) send through `/action`.
- **Scenes** specifically skips the generic "pick a param" prompt: since Studio now hands back the real scene list, each scene is its own menu entry (current scene gets a check icon), one click, no typing.
- **Sources** (Show/Hide/Toggle) still prompt, but the prompt is a `<select>` populated from Studio's real `sources` list rather than a free-text box — the module started with free text and it was rejected as "dumb and complicated" once source names were available to pick from instead.

The alternative — hardcoding known action/event names — was rejected early: an event or action Studio has no rule/toggle for fails silently (event) or 400s (action), so a menu item built from anything other than what Studio just reported risks looking like it worked while doing nothing.

## Why toasts, not `ui.notifications`

All Studio-related user feedback (`_showStudioToast`) goes through Blacksmith's `api.toast.show()`, not Foundry's core `ui.notifications`. This was a deliberate switch mid-build: Blacksmith's toast API is themeable and consistent with the rest of its UI, where `ui.notifications` is a fixed-style core banner. `postConsoleAndNotification` calls alongside each toast keep debug-console logging, with `blnNotification` forced off so the core banner does not also fire.

## The recording indicator

`_pollStudioStatus()` polls `/status` every `STUDIO_STATUS_POLL_MS` (2.5s) on the GM's client only (`game.user?.isGM` — no reason for every connected client to separately hit Studio's server for a `gmOnly` button). On an actual state change it calls `_setStudioRecordingIndicator(recording)`, which unregisters and re-registers the `studio-obs` menubar tool with a different `icon`/`iconColor` — per Blacksmith's menubar contract, icon changes are only covered by the unregister/re-register path, not by the lighter `updateMenubarToolIconColor` (which only touches color). This only happens on transitions, not every tick.

The pulse itself is pure CSS (`styles/broadcast.css`), keyed off the `fa-circle-dot` icon class the indicator swaps in:

```css
[data-tool="studio-obs"] i.fa-circle-dot {
    animation: herald-studio-recording-pulse 1.8s ease-in-out infinite;
}
```

No JS class-toggling involved, so it cannot drift out of sync with a Blacksmith-initiated menubar re-render for unrelated reasons.

Critically, `recording` reflects OBS's actual state regardless of how it got there — a manual click inside OBS, a successful automation, or a failed one. Herald never infers recording state from "which button did I click," since that would drift the first time someone touches OBS directly or an automation call fails without Herald noticing.
