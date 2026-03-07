# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


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
