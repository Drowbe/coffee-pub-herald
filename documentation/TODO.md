# TODO - Active Work and Future Ideas

**Master list:** This file contains all todos referenced in architecture and API documentation. 
**Process:** When a task is completed, add it to **`CHANGELOG.md`**, then remove it from this file and from any completed-task language in API/architecture docs.

**Completed in 13.0.1:** See `CHANGELOG.md` [13.0.1]. Menubar context menu (left-click, zones, Tools flyout); Cameraman dropdown; Broadcast bar height; Cameraman disconnected handling; Context menu fix (zone keys).


#### Broadcast: Combat Spectator Mode
- **Issue**: Add a "Combat Spectator" broadcast mode that follows all tokens in the combat tracker (not just the party)
- **Status**: PENDING - Needs implementation
- **Location**: `scripts/manager-herald.js`, `scripts/settings.js`
- **Need**: 
  - rename the existing "Specataor mode" to "Party Spectator" mode
  - New broadcast mode similar to Spectator, but frame/follow all combatant tokens (party + NPCs/enemies) instead of only party tokens
  - Use same view-fill/zoom behavior as Spectator (e.g. center on combatant token positions, zoom to fit)
  - Add mode option to broadcast mode selector and settings; optional dedicated view-fill setting (or reuse spectator/combat setting)
- **Related**: Spectator mode (party only); Combat mode (current turn + targets). Combat Spectator = "show whole fight" framing.


#### Select Player Tokens on Load
- **Issue**: On cameraman client load, select all player tokens so the canvas has usual focus and sounds are broadcast.
- **Status**: PENDING - Needs implementation
- **Location**: `scripts/manager-herald.js` (broadcast window / cameraman initialization)
- **Need**: When broadcast mode activates on the cameraman client, select all player-owned tokens so Foundry treats the canvas as focused and broadcasts sounds as usual.


#### Combat Mode Switches (Begin and End)
- **Issue**: Automatically switch broadcast mode when combat starts and ends.
- **Status**: PENDING - Needs implementation
- **Location**: `scripts/manager-herald.js` (combat hooks)
- **Need**: 
  - On `createCombat`: Auto-switch to combat mode when combat starts (optional setting?).
  - On `deleteCombat`: Transition from combat mode to spectator mode (or previous mode) when combat ends.
- **Related**: `updateCombat` already handles turn changes; `createCombat`/`deleteCombat` hooks are missing. See `documentation/architecture-broadcast.md` (Combat End, Combat Mode Transition).


#### Work with Blacksmith API to Support Text on Secondary Bar
- **Issue**: Blacksmith secondary bar API currently supports buttons/items and group banners, but not arbitrary bar-level text (e.g. "Cameraman Disconnected" label next to the buttons).
- **Status**: PENDING - Coordinate with Blacksmith
- **Location**: Blacksmith Menubar/Secondary Bar API, then `scripts/manager-herald.js`
- **Need**: Work with Blacksmith API to support text/labels on the secondary bar (not just buttons), so Herald can show e.g. "Cameraman Disconnected" when the cameraman is offline.
