# TODO - Active Work and Future Ideas

**Master list:** This file contains all todos referenced in architecture and API documentation. 
**Process:** When a task is completed, add it to **`CHANGELOG.md`**, then remove it from this file and from any completed-task language in API/architecture docs.


#### Tune Default Zoom Levels for Broadcast Modes
- **Issue**: Default zoom levels for broadcast modes (follow, combat, spectator) may need tuning for optimal viewing
- **Status**: PENDING - Needs investigation and tuning
- **Location**: `scripts/manager-herald.js`
- **Need**: Review and adjust default zoom levels for each broadcast mode to ensure optimal framing and visibility


#### Broadcast: Combat Spectator Mode
- **Issue**: Add a "Combat Spectator" broadcast mode that follows all tokens in the combat tracker (not just the party)
- **Status**: PENDING - Needs implementation
- **Location**: `scripts/manager-herald.js`, `scripts/settings.js`
- **Need**: 
  - New broadcast mode similar to Spectator, but frame/follow all combatant tokens (party + NPCs/enemies) instead of only party tokens
  - Use same view-fill/zoom behavior as Spectator (e.g. center on combatant token positions, zoom to fit)
  - Add mode option to broadcast mode selector and settings; optional dedicated view-fill setting (or reuse spectator/combat setting)
- **Related**: Spectator mode (party only); Combat mode (current turn + targets). Combat Spectator = "show whole fight" framing.