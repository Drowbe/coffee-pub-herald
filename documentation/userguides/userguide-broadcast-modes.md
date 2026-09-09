# Broadcast Modes

**Audience:** GMs choosing how the camera should follow the action.

What each camera mode does and when to reach for it. Modes are switched from the **View Mode** menu in the menubar, or set as a default in [Settings](userguide-settings.md).

## The modes

| Mode | What the camera does |
| --- | --- |
| **Party Spectator** | Frames all party tokens on the scene and keeps them in shot as they move. |
| **Token Spectator** | Frames every token the camera can see, not just party members. |
| **Combat** | Frames all combatants as a group, including targeted tokens. |
| **Combatant** | Follows whoever's turn it is, panning on each turn change. |
| **GM View** | Mirrors your own viewport — where you look, the camera looks. |
| **Map View** | Fits the whole scene to the screen and holds still. |
| **Manual** | Herald stops moving the camera. |
| **Mirror ▸ *player*** | Mirrors one specific player's viewport. |
| **Follow ▸ *token*** | Follows one specific token wherever it goes. |

**Combat** and **Combatant** appear in the menu only while a combat is running. **Mirror** and **Follow** are submenus built from the party's players and tokens, so they appear only when there are party tokens on the scene.

## Which to use

**Party Spectator** is the default and the right answer most of the time. It keeps the party in shot without any input from you.

**Token Spectator** is for when the interesting thing is not a party member — a chase, an NPC entrance, a fight the party is watching rather than in.

**Combat** shows the whole engagement, so viewers can read positioning. It uses a minimum frame size so a one-on-one duel does not zoom absurdly close.

**Combatant** follows the turn. Better for a narrative stream where you want the audience looking at whoever is acting; worse for a tactical one where position matters.

**GM View** hands the camera to you. Whatever you look at, the audience sees. Useful when you are deliberately showing something, and risky when you forget it is on and go rummaging through your notes.

**Map View** is the establishing shot — useful between scenes or while you talk over a map.

**Manual** parks the camera. Use it when you want to compose a shot by hand and have Herald leave it alone.

**Mirror** puts the audience in one player's seat, which is effective during that player's spotlight moment. **Follow** locks onto one token regardless of whose it is.

## Combat switching

Rather than remembering to change mode when a fight starts, set it once:

- **Switch to (Combat Begin)** — the mode to adopt when you click Begin Combat.
- **Switch to (Combat End)** — the mode to return to when you click End Combat.

Either can be **No change**, which leaves the mode alone. A common pairing is **Combatant** on begin and **Party Spectator** on end.

## Framing and smoothing

Three settings control how tightly the camera frames, each as a percentage of the screen to fill:

- **Party / Token Spectator View Fill** — the two spectator modes
- **Combat Mode View Fill** — Combatant
- **Follow Mode View Fill** — Follow

Lower percentages pull back and give context; higher percentages push in.

Three more control how it moves. If the camera feels twitchy, these are the dials, in this order:

1. **Follow Distance Threshold** — how far a token must move before the camera reacts at all. Raise it first.
2. **Follow Throttle (ms)** — a floor on how often the camera may move. Raise it if fast movement makes the picture judder.
3. **Animation Duration (ms)** — how long each pan takes. Higher is slower and calmer, which usually reads better on a stream.
