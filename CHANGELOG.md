# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).




## [13.0.1] - 2025-03-07

### Added

- **Enable/Disable in context menu**: Right-click the Broadcast toggle or View Mode menubar tool for "Enable Herald" / "Disable Herald". Toggling refreshes the cameraman client (socket command with `force` so it works when disabling).
- **Show Combat Bar in Broadcast**: New setting (default on) to show the Blacksmith combat secondary bar (`data-bar-type="combat"`) on the cameraman view when in broadcast mode; disable for a fully clean view.
- **Menubar and secondary bar hiding**: In broadcast mode, hide `.blacksmith-menubar-container` and `.blacksmith-menubar-secondary`; combat bar is shown when "Show Combat Bar in Broadcast" is enabled.

### Changed

- **Menubar: add "Hide/Show broadcast bar" to context menu; left-click vs right-click is Blacksmith**: Herald adds "Hide/Show broadcast bar" as a context menu item on both the Broadcast toggle and View Mode tools (so the previous left-click action is in the menu). Both tools use an empty `onClick` so the only action is via the menu. **Changing the existing context menu from right-click to left-click, and making right-click do nothing, is done in Blacksmith** (menubar event binding), not in Herald.

- **What Enable controls**: Enable only controls broadcast behavior and cameraman UI; it no longer hides the menubar. Menubar tools stay visible when Herald is disabled so users can turn it back on.
- **Using tools when disabled**: Clicking any broadcast tool (toggle bar, mode buttons, close/refresh/settings) while Herald is disabled shows a notification: "Herald is not enabled."
- **Visibility override**: Menubar is never hidden via the Blacksmith visibility override (tools always visible); hiding is done via CSS when in broadcast mode.
- **Refresh on enable/disable**: `_emitBroadcastWindowCommand(action, options)` now accepts `options.force`. When toggling enable/disable, refresh is sent with `{ force: true }` so the cameraman always receives it and reloads.

### Fixed

- **Context menu**: Restored `mirrorUsers` declaration in view-mode context menu so Mirror/Follow items build correctly.
- **Default zoom levels**: Tune default zoom levels for broadcast modes (follow, combat, spectator) — completed.

### Technical

- New body class `broadcast-show-combat-bar` when setting "Show Combat Bar in Broadcast" is on; CSS shows `.blacksmith-menubar-secondary[data-bar-type="combat"]` only then.
- Setting change hook now reacts to `broadcastHideNotifications` and `broadcastShowCombatBar` for immediate UI update.


## [13.0.0] - 2025-03-03 

### NOTE: Initial release as a stand-alone module.

### Added

- **Initial release.** Herald is the standalone Broadcast module for Foundry VTT, migrated from Coffee Pub Blacksmith.
- **Broadcast / streaming view**: Designate a cameraman user for a clean, UI-free view suitable for streaming or player displays.
- **Menubar integration**: Broadcast toggle and View Mode tools in the Blacksmith menubar (requires Coffee Pub Blacksmith).
- **Secondary bar**: Broadcast controls bar with mode buttons (Manual, GM View, Combat, Combatant, Spectator, Map View, Mirror/Follow), close tools, and settings.
- **View modes**:
  - **Manual**: No automatic following; cameraman controls the view.
  - **GM View**: Mirror the GM’s viewport (center and zoom).
  - **Combat**: Frame current turn combatant + targets; updates on turn and target change.
  - **Combatant**: Frame all visible combatant tokens on the scene.
  - **Spectator**: Frame party tokens in a configurable box.
  - **Map View**: Fit the current scene map with configurable padding.
  - **Mirror**: Mirror a specific player’s viewport.
  - **Follow**: Follow a selected token on the canvas.
- **Settings**: Enable/disable broadcast, cameraman user selection, view fill percentages for follow/combat/spectator, and related options.
- **Visibility override**: Optional menubar hide for the broadcast user so they see a clean view (via Blacksmith API).
- **Localization**: English (en) language file.

### Dependencies

- Requires **Coffee Pub Blacksmith** (v13). Install and enable Blacksmith before Herald.

### Notes

- This module uses only the public Blacksmith API (menubar tools, secondary bar, sockets, visibility override). See Blacksmith’s “Registering with Blacksmith” documentation for integration details.
