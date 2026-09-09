# Known Issues

**Audience:** anyone using Herald who has hit something that looks wrong.

Current known problems, what causes them, and what you can do. If your problem is not here, please [open an issue](https://github.com/Drowbe/coffee-pub-herald/issues).

## Hide Scene Background does nothing

**Status:** open, no workaround.

The **Hide Scene Background** setting has no effect, and never has — in any Foundry version, since Herald's first release. The setting appears in the UI and can be toggled, but the background stays visible on the broadcast.

The scene background is not a page element Herald can hide. Foundry renders the whole scene into a single canvas, and the background is a layer inside it rather than something addressable on its own. The one element that *could* be hidden draws the tokens too, so hiding it would black out the broadcast entirely rather than clean it up.

An implementation was written and withdrawn before release: during testing a client that should not have been affected loaded with a blank map, and that was never explained. Shipping a change that could not be accounted for was judged worse than leaving a setting that has never worked. See [Broadcast architecture](architecture/architecture-broadcast.md) for the full record if you intend to attempt it.

**What to do:** nothing, for now. The other UI-hiding settings work normally. If a plain background matters to your stream, set the scene's background to a flat colour or a plain image.

## Foundry's interface can reappear after a Foundry version bump

**Status:** fixed for v14; worth knowing about.

Herald hides Foundry's interface with rules that target Foundry's own page structure. When Foundry changes that structure, the rules stop matching — and because a rule that matches nothing raises no error, the failure is silent. The symptom is your navigation, players list, or sidebar simply being visible on camera with nothing in the console to explain it.

This happened at the v13-to-v14 boundary, when the three interface sections changed how they are identified, and was fixed in 14.0.0.

**What to do:** after any Foundry upgrade, glance at the camera view before you go live. If UI has reappeared, [report it](https://github.com/Drowbe/coffee-pub-herald/issues) with your Foundry version — it is a fast fix once known, but nothing detects it automatically.

## Ambient sounds do not play on the camera client

**Status:** open, by design of Foundry's audio.

Canvas-embedded ambient sounds do not play on the camera. Foundry decides what a client hears from the position of that client's *controlled tokens*, and the camera user normally controls none.

**What to do:** take stream audio from a client that has a controlled token, or from the GM's client, rather than from the camera.
