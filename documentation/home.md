# Coffee Pub Herald

**Audience:** anyone using or working on Herald.

Herald gives one Foundry user a clean, UI-free view of the table that follows the action by itself. Point OBS, a second monitor, or a TV at that user's browser and you have a broadcast feed nobody has to drive. This page is the front door; the guides below are the content.

Herald **requires [Coffee Pub Blacksmith](https://github.com/Drowbe/coffee-pub-blacksmith)**. Install and enable Blacksmith first — Herald's controls live in Blacksmith's menubar and will not appear without it.

Foundry VTT **v13 and v14**.

## For GMs and players

- **[Getting started](userguides/userguide-getting-started.md)** — the first five minutes: pick a camera user, log it in, see a picture.
- **[Broadcast modes](userguides/userguide-broadcast-modes.md)** — the nine ways the camera can follow the action, and when each one is the right pick.
- **[Settings](userguides/userguide-settings.md)** — every setting by its on-screen name.
- **[Stream overlay](userguides/userguide-stream-widgets.md)** — MVP leaderboard on Foundry's `/stream` page, captured by Coffee Pub Studio.
- **[GM guide](userguides/userguide-gm.md)** — running a session with a camera: the View Mode menu, the Tools menu, combat.
- **[Player guide](userguides/userguide-player.md)** — what players see, and what the camera does with their view.

## Known problems

**[Known issues](known-issues.md)** — what is currently broken and what to do about it.

## For developers

- **[Broadcast architecture](architecture/architecture-broadcast.md)** — how the feature is built and why.
- **[Stream widgets](architecture/architecture-stream-widgets.md)** — overlays on `/stream` that Studio crops into OBS sources, and the crop contract they must keep.
- **[Blacksmith APIs](architecture/architecture-blacksmith-integration.md)** — which Blacksmith surfaces Herald consumes, and the contract changes every consumer needs to know.
- **[Blacksmith sockets](architecture/architecture-blacksmith-sockets.md)** — socket lifetime and the absent unregister API.
- **[Performance](architecture/architecture-performance.md)** — memory, hot paths, and hook-context cleanup.
