# Settings

**Audience:** GMs configuring Herald.

Every Herald setting by its on-screen name. All of them are world settings — one GM changes them and they apply everywhere. Settings marked **(reload)** take effect after a browser refresh.

## General

**Enable Broadcast** — turns the whole feature on. With it off, Herald does nothing and the View Mode menu is inert. **(reload)**

**Broadcast User** — the user who serves as the camera. Pick from the dropdown of users in the world. Until this is set, the menubar shows *No cameraman*. **(reload)**

**Animation Duration (ms)** — how long camera pans and zooms take. Higher is slower and smoother; lower is snappier. Higher usually looks better on a stream.

**Follow Distance Threshold** — how far a token must move, in grid spaces, before the camera bothers to pan. Raise it to stop the camera twitching at every small step.

**Follow Throttle (ms)** — the minimum time between camera moves. Raise it if rapid token movement makes the picture judder.

**Automatically Close Windows** — closes windows on the camera that were opened by sharing something to players. Nobody is sitting at the camera to close them by hand, so they would otherwise stay up.

**Auto Close Delay (seconds)** — how long a shared window stays on the broadcast before it closes. Long enough for viewers to read it; short enough that the map comes back.

**Automatically Dismiss Stuck Toasts** — clears Blacksmith toasts that wait for a click. Only click-to-close toasts are swept; toasts with their own timer are left to expire so nothing is cut off mid-read.

**Toast Max Age (seconds)** — how long a click-to-close toast may sit on the camera before it is dismissed. Minimum 5.

## UI Visibility

**Hide Scene Background** — **this setting does nothing.** It has never worked, in any version. See [Known issues](../known-issues.md).

**Hide Left UI Section** — hides Foundry's navigation and players list on the camera.

**Hide Middle UI Section** — hides Foundry's middle interface section on the camera.

**Hide Right UI Section** — hides Foundry's sidebar on the camera.

**Hide Notifications** — hides Foundry's pop-up notifications on the camera. Note this covers *Foundry's* notifications; Blacksmith toasts are separate and handled by the toast settings above.

**Show Combat Bar in Broadcast** — keeps Blacksmith's combat bar visible on the broadcast. Often worth leaving on, since it tells viewers whose turn it is. Turn it off for a completely bare view.

**Show Cameraman Viewport Box** — draws a box on *your* canvas showing what the camera currently frames, so you can see what is going out without switching windows. Works while you and the camera are on the same scene. Also toggleable from the View Mode menu.

## Mode Configuration

**Camera Mode** — the current mode. Usually changed from the View Mode menu rather than here; see [Broadcast modes](userguide-broadcast-modes.md).

**Party / Token Spectator View Fill (%)** — how much of the screen the framed group fills in the two spectator modes.

**Combat Mode View Fill (%)** — the same, for Combatant mode.

**Follow Mode View Fill (%)** — the same, for Follow mode.

**Switch to (Combat Begin)** — the mode to adopt automatically when you click Begin Combat. **No change** leaves the mode alone.

**Switch to (Combat End)** — the mode to return to when you click End Combat. **No change** leaves the mode alone.
