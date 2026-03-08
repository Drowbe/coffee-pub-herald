# TODO - Active Work and Future Ideas

**Master list:** This file contains all todos referenced in architecture and API documentation. 
**Process:** When a task is completed, add it to **`CHANGELOG.md`**, then remove it from this file and from any completed-task language in API/architecture docs.


#### Canvas Ambient Sound for Herald Client *(low priority)*
- **Issue**: On the cameraman client, no canvas-embedded (ambient) sounds play because Foundry uses controlled-token positions as the listener; the broadcast user typically has no controlled tokens.
- **Status**: PENDING - Needs implementation
- **Location**: New small module or script (e.g. herald-listener), `libWrapper` dependency
- **Need**: Light approach: use **libWrapper** to wrap Foundry’s ambient-sound listener-resolution (e.g. in `SoundsLayer` / `AmbientSound`). On the Herald client only, substitute **one listener position** (e.g. center of one observed token—first party token, or any token we can see—no need for “leader”; Blacksmith may not expose that). Return that point so ambient sounds play; any canvas sounds are better than none.
- **Avoid**: Heavy custom ambient manager, polling, or reproducing Foundry’s attenuation. Goal: one wrapper, one listener-point resolver, one refresh path (~30–50 lines once the hook is found).




#### Work with Blacksmith API to Support Text on Secondary Bar
- **Issue**: Blacksmith secondary bar API currently supports buttons/items and group banners, but not arbitrary bar-level text (e.g. "Cameraman Disconnected" label next to the buttons).
- **Status**: PENDING - Coordinate with Blacksmith
- **Location**: Blacksmith Menubar/Secondary Bar API, then `scripts/manager-herald.js`
- **Need**: Work with Blacksmith API to support text/labels on the secondary bar (not just buttons), so Herald can show e.g. "Cameraman Disconnected" when the cameraman is offline.
