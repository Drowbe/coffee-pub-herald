# GM Guide

**Audience:** GMs running a live session with Herald.

Driving the camera during play. For first-time setup see [Getting started](userguide-getting-started.md); for what each mode does see [Broadcast modes](userguide-broadcast-modes.md).

## The Herald menu

Everything lives in the single **Herald** button in Blacksmith's menubar. It is GM-only — players never see it. Left-click to open it.

The button's label is the current camera mode in a word or two — **Manual**, **GM**, **Combatant**, **Combat**, **Tokens**, **Party**, **Map**, **Mirror**, **Follow** — and its tooltip has the full name (the player or token name for Mirror and Follow). While broadcast is off it reads **Broadcast**.

The menu is in order of how often you reach for it mid-session, with a divider between blocks:

- **Camera modes** — the current one is checked. **Mirror** and **Follow** are submenus. Combat modes only appear while a combat runs; Mirror and Follow only when there are party tokens on the scene.
- **Studio** — only when [Enable Studio Support](userguide-settings.md#studio-obs) is on. See [Studio (OBS) control](#studio-obs-control).
- **Tools** and **Options** — Tools is the camera clean-up commands (below). Options holds **Show/Hide cameraman viewport box** and **Enable/Disable Broadcast**. While broadcast is off, the Enable item sits at the top level instead.

The button also tells you the camera's status through its tooltip. **No cameraman** means no Broadcast User is set. **Cameraman offline** means that user is not logged in — Herald will not send camera commands to a client that is not there, so nothing you pick will do anything until it connects.

## Watching what goes out

Turn on **Show Cameraman Viewport Box** and Herald draws a box on your own canvas showing exactly what the camera has framed. This is the single most useful habit for streaming: you can see what your audience sees without alt-tabbing to the other browser.

It only works while you and the camera are on the same scene.

## Combat

Set **Switch to (Combat Begin)** and **Switch to (Combat End)** once, and the camera changes mode by itself when you start and end a fight. **Combatant** on begin and **Party Spectator** on end is a good default.

If you would rather drive it by hand, set both to **No change** and pick modes from the menu.

**Combat** frames the whole engagement; **Combatant** follows whoever is acting. Combat is better when positioning matters, Combatant when the drama does.

## Clearing the camera's screen

When you share an image or a journal entry to your players, it also opens on the camera — and nobody is there to close it.

**Automatically Close Windows** handles the common case: the shared window closes on the camera after **Auto Close Delay**. Viewers see the handout, then the map returns.

For anything that gets stuck, the **Tools** submenu has:

- **Close Images** — close shared images on the camera
- **Close Journals** — close shared journal entries
- **Close All Windows** — close everything
- **Close Toasts** — clear every Blacksmith toast on the camera immediately, timer or not
- **Toggle combat bar** — show or hide the combat bar on the camera without changing the setting
- **Refresh** — re-render the camera's view

**Close Toasts** and the automatic toast dismissal differ: the automatic sweep only removes toasts that wait for a click, and only after they have been up for a while. Close Toasts clears the lot, now.

## Habits worth forming

**Check the camera before you go live.** Especially after a Foundry upgrade — Herald's interface hiding depends on Foundry's own page structure, and when that changes the hiding fails silently rather than raising an error. A glance at the camera view catches it.

**Watch what GM View exposes.** In GM View the audience sees your screen. That includes anything you open, pan to, or reveal. Switch away from it before consulting your notes.

**Mind the camera's permissions.** A Player-role camera sees what players see, which is usually right. A GM-role camera sees everything, including secret tokens and unexplored map.

## Stream overlay

The cameraman tabletop is the map feed. Foundry's `/stream` page is a separate capture surface. Herald draws Blacksmith tool windows there for Coffee Pub Studio to crop into their own OBS sources — starting with the lifetime MVP leaderboard. Those windows do not appear on your tabletop or on the camera's map. See [Stream overlay](userguide-stream-widgets.md).

## Studio (OBS) control

Studio support is off by default. Turn on **Enable Studio Support** and set the server URL and token under [Settings](userguide-settings.md#studio-obs); until then the Herald menu has no Studio entries and Herald never contacts a Studio server. Worlds that had a URL and token saved before this setting existed are switched on automatically the first time they load. GM-only, and independent of Enable Broadcast.

Studio lives in the Herald menu, not a button of its own. It talks directly to your Coffee Pub Studio automation server.

- **Start Recording / Stop Recording** — directly in the menu, and only the one that applies: **Begin Session Recording** while OBS is idle, **End Session Recording** while it is recording. They are the recording rule sets, one click each. If one needs a title or description first, a dialog asks for it. Cancelling asks for nothing.
- **Studio** flyout — **Pause/Resume Recording** (pauses while OBS is recording, resumes otherwise) and any other ungrouped rule sets; then **Stream Widgets**, **Scenes**, and **Controls**; then **Helpers**, **Sources**, **Studio Control**, and **Refresh Automations**. Scenes is every OBS scene, one click to switch, with the current scene checked. Controls is start/stop recording and streaming. Sources is Show, Hide, and Toggle, each a dropdown of the real OBS sources. Studio Control is the whole-studio actions Studio has enabled (wake audio, start/stop all windows, sync OBS). Refresh reloads the list after you change something on Studio's Automations tab.

The Herald button itself tells you whether OBS is actually recording: the video icon turns into a red dot (and the tooltip adds "Recording") when Studio reports `recording: true`, and reverts the moment it isn't — whether recording was stopped from this menu, from inside OBS directly, or failed silently. It is polled every few seconds, not tied to which item you last clicked.

If the Studio machine is off or the address does not answer, the button switches to a grey unplugged icon and stops asking. The menu then shows **Studio server unreachable** and **Retry connection** in place of the Studio entries; the camera modes and Tools are unaffected. Retry makes one attempt. If Studio answers, the button goes back to normal and the recording poll starts again. If it doesn't, the button stays unplugged and the same entries are what you get next time. Nothing calls the server on its own after the first refusal.
