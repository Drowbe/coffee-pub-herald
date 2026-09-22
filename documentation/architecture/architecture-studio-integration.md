# Studio (OBS) integration

**Audience:** developers working on Herald.

How the Studio menubar button talks to Coffee Pub Studio's automation server, and why it is built the way it is. Not to be confused with [Stream widgets](architecture-stream-widgets.md) (Blacksmith tool windows Studio crops out of `/stream`) or [Blacksmith APIs](architecture-blacksmith-integration.md) (the toast/menubar surfaces this feature consumes). Code lives in `scripts/manager-herald.js` (search `_studio`/`Studio`), settings in `scripts/settings.js`.

## The contract

Studio runs its own small HTTPS server, independent of Foundry, on the local network (e.g. `https://10.10.10.x:9500`). Herald is one consumer of its `/api/automations/*` surface, authenticated with a bearer token. Four endpoints:

- `GET /api/automations/capabilities` — `{ actions, ruleSets, scenes, sources }`. `actions` is the fixed catalog of things Studio can do *that are currently enabled on Studio's side* (`{action, param, paramType, group, label?}`) — an action Studio has toggled off simply is not in the array. `ruleSets` is the live event→action mapping actually configured on Studio's Automations tab (`{name, group, event, prompts}`) — see [Prompts](#prompts-rule-sets-that-need-answers-first) below for `prompts`. `scenes` (`{name, current}[]`) and `sources` (`string[]`) are OBS's real current scene/source lists.
- `POST /api/automations/event {event, prompts?}` — fires whatever `ruleSets` entry matches that event name. Silently does nothing if no rule matches, which is why Herald never lets a user type an arbitrary event — every event button in the menu comes from a `ruleSets` entry Studio just told us about. The optional top-level `prompts` object (`{fieldKey: value}`) answers whatever that rule set's own `prompts` currently demand; see below.
- `POST /api/automations/action {action, param}` — invokes an action directly, bypassing the rule layer. Synchronous: `200 {ok:true}` means it actually ran; `400`/`500` carry a real `{error}` (unknown/disabled action, or a runtime failure like OBS not connected). `setMetadataField` is a special case of this endpoint (`param` is a field *key*, not a value — see `_triggerStudioMetadataFieldAction`).
- `GET /api/automations/status` — `{obsConnected, recording, streaming}`, answered from Studio's own internal ~2s OBS poll cache, not a fresh round-trip. No point polling faster than that.

This contract was reverse-engineered collaboratively with Studio's own author over several iterations — the response shape changed more than once mid-build (`rules` → `ruleSets`, and `actions` gained `paramType`/`scenes`/`sources` after the fact). **Do not assume a field name without checking the live response first**; it has been wrong before.

## Why settings, not code, hold the URL/token

`studioApiUrl` and `studioApiToken` are world-scope settings (`scope: 'world'`), never hardcoded. Herald is a distributed/published module; a credential baked into source would ship to every installer and sit in git history permanently. `_studioBaseUrl()` normalizes the setting (trims trailing slash, and strips a legacy full-path value some early testing left behind) before every request builds its own path onto it.

## Why capabilities are cached, with an explicit refresh

`_getObsMenuItems()` fetches `/capabilities` once and holds it in `_studioCapabilitiesCache` (a plain static field) so *opening* the Studio menu repeatedly does not hit the network every time. A GM changing something on Studio's Automations tab will not see the menu's shape (new rule sets, new actions) reflected until **Options → Refresh Automations** (`_refreshStudioCapabilities()`), which nulls the cache and re-fetches. The fetch itself also passes `cache: 'no-store'` — without it, the browser's own HTTP cache for the GET was observed serving stale data underneath the in-memory cache, independent of it. The cache is also invalidated automatically if `studioApiUrl`/`studioApiToken` change mid-session (`settingChange` hook), and reset on every page load (it is not persisted).

**This cache is never consulted for `prompts`.** *Clicking* a rule-set item always does its own live, uncached `_getFreshStudioPrompts()` fetch first — per Studio's own guidance, whether a field still needs asking can change between the menu opening and the click, so the menu's cached copy of `prompts` is only ever used to decide the icon/label, never to decide whether to show a dialog.

## Prompts: rule sets that need answers first

This went through two designs before landing here — both abandoned once they turned out not to match how Studio actually resolves values, not because of anything wrong in Herald's code:

1. **Send title/description as event `data`.** Assumption: the filename template and `uploadToYouTube` step would read `data` directly off the triggering event. They don't — `applySessionFilename` composes the filename from a template (`{sessionTitle}` etc.) and the YouTube step's pickers likewise read Studio's own Metadata fields, hand-edited on the Session tab. `data` on an event never reaches either. Flagged by Studio's author before Herald shipped against it.
2. **Write fields directly via a new `setMetadataField` action** (`{action: "setMetadataField", param: fieldKey, data: {value}}`), called from bespoke Herald-side "Record Episode" / "Update Description" / "Stop & Upload" menu items that knew the exact field keys (`sessionTitle`/`sessionDescription`) and tracked in a Herald-side flag whether Description had already been set this recording, to decide whether Stop should ask again. This worked, but every bit of that — the specific field-key knowledge and the "already answered" tracking — duplicated something only Studio could actually know for certain (Studio's own state, not Herald's memory, is authoritative on whether a field is still blank).

**What's actually built:** every `ruleSets` entry now carries its own `prompts: [{key, label}]` — computed server-side, recursively, and specifically the fields *that rule set still needs answered right now*. Empty means "just fire the event." A field that already holds a value is satisfied without Herald supplying it again, and Studio's own automation (e.g. a `clearMetadataField` step after upload) is what resets a field back to blank for next time — Herald tracks none of this itself.

`_fireStudioRuleSet(rule)` is now the single click handler for every rule-set item in the menu, whatever it does:

1. `_getFreshStudioPrompts(rule.event)` — a live, uncached `/capabilities` fetch (Studio's own guidance: state can change between the menu opening and the click, e.g. a field answered via a different rule set in between), returning that rule set's current `prompts`.
2. If non-empty, `_collectStudioPrompts()` shows one dialog with a text field per `{key, label}` entry and returns `{key: value}` for each.
3. `_postStudioEvent(rule.event, answers)` — POSTs `{event, prompts: answers}` (or no `prompts` at all if the rule set needed none) and returns `{ok, status, error}` rather than throwing, so the caller can branch on *why* it failed.
4. If Studio rejects the POST with `400` and an error mentioning "prompt" — its signal that a field it now considers blank wasn't supplied, e.g. a race between step 1 and the fire — Herald re-checks prompts once more and re-prompts, rather than failing silently.

No settings screen or field-key mapping lives in Herald at all. A rule set Studio wires up with new prompts tomorrow works today, with zero Herald code changes — the whole point of building this against live data instead of a fixed list (see below).

`setMetadataField` also surfaces generically in the **Studio Control** flyout (it's just another entry in `capabilities.actions`, `paramType: 'metadataField'`) as a manual escape hatch for setting any other Text field outside of a rule set's own `prompts` flow. The generic single-prompt flow (`_triggerStudioAction`) can't handle it — it only collects one value and would send it as the field *key* with no `data.value` at all — so `paramType === 'metadataField'` is special-cased to `_triggerStudioMetadataFieldAction`, which prompts twice (key, then value) before calling `_setStudioMetadataField`.

## Why the menu is built from live data, not a fixed list

Every clickable item in the Studio menu traces back to something Studio just reported:

- Rule-set items send the event through `/event`, via `_fireStudioRuleSet` (prompts for whatever that rule set's live `prompts` currently demand — see above). Grouped by each rule set's own `group` field the same way actions are — a rule set with no group stays a flat top-level item, a named one (e.g. "Recording") collects into its own flyout.
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
