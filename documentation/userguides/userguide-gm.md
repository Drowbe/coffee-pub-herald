# GM Guide

**Audience:** GMs running a live session with Herald.

Driving the camera during play. For first-time setup see [Getting started](userguide-getting-started.md); for what each mode does see [Broadcast modes](userguide-broadcast-modes.md).

## The View Mode menu

Everything lives in the **View Mode** control in Blacksmith's menubar. It is GM-only — players never see it. Left-click to open it.

The menu shows the camera modes, plus **Mirror** and **Follow** submenus, plus a **Tools** submenu. What appears depends on the state of the game: combat modes only while a combat runs, Mirror and Follow only when there are party tokens on the scene.

The button itself tells you the camera's status. **No cameraman** means no Broadcast User is set. **Cameraman offline** means that user is not logged in — Herald will not send camera commands to a client that is not there, so nothing you pick will do anything until it connects.

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

The cameraman tabletop is the map feed. Foundry's `/stream` page is a separate capture surface. Herald can draw overlays there for Coffee Pub Studio to crop into their own OBS sources — starting with the lifetime MVP leaderboard. That widget does not appear on your tabletop or on the camera's map. See [Stream overlay](userguide-stream-widgets.md).
