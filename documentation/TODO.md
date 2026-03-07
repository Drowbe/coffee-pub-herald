# TODO - Active Work and Future Ideas

**Master list:** This file contains all todos referenced in architecture and API documentation. 
**Process:** When a task is completed, add it to **`CHANGELOG.md`**, then remove it from this file and from any completed-task language in API/architecture docs.

**Completed in 13.0.1:** Menubar context menu on left-click (View Mode only, via Blacksmith context menu API); Broadcast button as simple toggle (no menu); Follow options in a "Follow" flyout. See `CHANGELOG.md` [13.0.1].


#### Broadcast: Combat Spectator Mode
- **Issue**: Add a "Combat Spectator" broadcast mode that follows all tokens in the combat tracker (not just the party)
- **Status**: PENDING - Needs implementation
- **Location**: `scripts/manager-herald.js`, `scripts/settings.js`
- **Need**: 
  - New broadcast mode similar to Spectator, but frame/follow all combatant tokens (party + NPCs/enemies) instead of only party tokens
  - Use same view-fill/zoom behavior as Spectator (e.g. center on combatant token positions, zoom to fit)
  - Add mode option to broadcast mode selector and settings; optional dedicated view-fill setting (or reuse spectator/combat setting)
- **Related**: Spectator mode (party only); Combat mode (current turn + targets). Combat Spectator = "show whole fight" framing.


#### Change Cameraman Selector to Dropdown
- **Issue**: Replace the current broadcast user (cameraman) selector with a dropdown for better UX
- **Status**: PENDING - Needs implementation
- **Location**: `scripts/settings.js`, `lang/en.json`
- **Need**: Use a dropdown/select control for `broadcastUserId` that lists connected users (or all users) instead of free-text input


#### Do Not Broadcast When Cameraman Not Connected
- **Issue**: When the designated cameraman is not connected, broadcast should not be active
- **Status**: PENDING - Needs implementation
- **Location**: `scripts/manager-herald.js`, possibly `scripts/settings.js`
- **Need**: Check that broadcast user is online before enabling broadcast view; disable or hide broadcast UI / mode when cameraman is disconnected


#### Verify Menubar Height and Expose as Setting
- **Issue**: Ensure broadcast/secondary bar height is set correctly; make it a setting if not already
- **Status**: PENDING - Needs verification and possibly implementation
- **Location**: `scripts/settings.js`, `styles/broadcast.css` or Blacksmith secondary bar config, `documentation/architecture-broadcast.md`
- **Need**: Verify Herald (or Blacksmith) sets menubar/secondary bar height; if not configurable, add a setting for bar height


#### Rename "Enable Broadcast" to Herald (Setting Label)
- **Issue**: Rename the "Enable Broadcast" setting/label to "Herald" in the settings UI
- **Status**: CANCELLED - Keeping "Broadcast" wording. The setting enables broadcasting, not the module. Setting label remains "Enable Broadcast"; context menu items remain "Enable Broadcast" / "Disable Broadcast".
- **Location**: N/A
- **Need**: (None - reverted/cancelled.)
