# Getting Started

**Audience:** GMs setting up Herald for the first time.

The first five minutes: get a camera user on screen and confirm it works. Everything else — the camera modes, the settings, running a session — is covered in [Broadcast modes](userguide-broadcast-modes.md), [Settings](userguide-settings.md) and the [GM guide](userguide-gm.md).

## Before you start

Install and enable **[Coffee Pub Blacksmith](https://github.com/Drowbe/coffee-pub-blacksmith)** first, then Herald. Herald's controls live in Blacksmith's menubar and will not appear without it.

## The idea in one paragraph

Herald does not detect OBS or capture a window. You designate one Foundry user as the **camera**, and Herald configures *that user's client* differently from everyone else's: interface hidden, camera following the action. Nobody sits at it. You steer it from your own screen. Every other client, including yours, is untouched.

## Set it up

1. **Make a user for the camera.** In Foundry's user management, create a user — call it `Camera` or `Stream`. A **Player**-role user is the usual choice.
2. **Open Herald's settings** and turn on **Enable Broadcast**.
3. **Set Broadcast User** to the user you just made.
4. **Log that user in**, in a *separate browser window or profile* from your own. A different browser, or a private window, keeps the two sessions from colliding.

That is the whole setup. The camera client should now show the map with Foundry's interface hidden, and your own menubar should have gained a **Broadcast** control.

> **Choose the role deliberately.** The camera sees the world with its own user's permissions. A Player-role camera shows what a player would see — unexplored fog stays unexplored, hidden tokens stay hidden. That is usually what you want on a stream. A GM-role camera sees everything, including anything you would rather your audience did not.

## Check it works

With both clients up:

1. On your screen, open the **View Mode** menu in the menubar.
2. Pick **Party Spectator**.
3. Move a party token on the map.

The camera should pan to keep the party framed. If it does, you are done — point OBS at that browser window.

## If nothing happens

| What you see | What it means |
| --- | --- |
| No Broadcast control in the menubar | Blacksmith is missing or disabled. Enable it and reload. |
| The button says **No cameraman** | No Broadcast User is set in settings. |
| The button says **Cameraman offline** | That user is not logged in. Herald will not steer a client that is not there. |
| Camera is up but never moves | Check **Enable Broadcast** is on, the mode is not **Manual**, and both clients are on the same scene. |

## Next

- **[Broadcast modes](userguide-broadcast-modes.md)** — the nine ways the camera can follow the action.
- **[GM guide](userguide-gm.md)** — running a live session, including combat and clearing the screen.
- **[Settings](userguide-settings.md)** — tuning how the camera moves.
