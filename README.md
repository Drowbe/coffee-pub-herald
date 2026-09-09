


# Coffee Pub Herald

![Latest Release](https://img.shields.io/github/v/release/Drowbe/coffee-pub-herald)
![GitHub Workflow Status](https://img.shields.io/github/actions/workflow/status/Drowbe/coffee-pub-herald/release.yml?event=push)
![GitHub all releases](https://img.shields.io/github/downloads/Drowbe/coffee-pub-herald/total)
![Foundry v13](https://img.shields.io/badge/foundry-v13-yellow)
![Foundry v14](https://img.shields.io/badge/foundry-v14-green)
![MIT License](https://img.shields.io/badge/license-MIT-blue)

**Streaming and broadcast view for Foundry VTT.** Designate a cameraman user for a clean, UI-free view with automatic token following—ideal for streaming, player displays, or a dedicated “TV” client.

**Requires [Coffee Pub Blacksmith](https://github.com/Drowbe/coffee-pub-blacksmith).** Herald adds Broadcast tools to Blacksmith’s menubar and uses Blacksmith’s secondary bar for mode controls.

**Compatibility:** Foundry VTT v13 and v14 (verified on v14).

> **Known issue:** the **Hide Scene Background** setting does nothing, and has never worked. The scene background is not an element Herald can hide by the method it used, and a replacement is still being verified. The other **Hide Interface** settings work normally.

## IMPORTANT NOTICE

**Herald requires [Coffee Pub Blacksmith](https://github.com/Drowbe/coffee-pub-blacksmith).** Install and enable Blacksmith before Herald. Broadcast tools will not appear without it.

## Disclaimer

This is a personal project created for my Foundry VTT games to introduce streaming and broadcast quality-of-life features.

If you stumble upon this repository and find it useful, feel free to try it out! However, please note that this project is developed for personal use, and I make no guarantees regarding stability, compatibility, or ongoing support.

**Use at your own risk.** I am not responsible for any issues, data loss, or unexpected behavior resulting from using this project.


## Installation

1. **Install Coffee Pub Blacksmith first** (Herald depends on it):
   - Manifest: `https://github.com/Drowbe/coffee-pub-blacksmith/releases/latest/download/module.json`
2. **Install Herald** — in Foundry VTT, use this manifest URL:
   ```
   https://github.com/Drowbe/coffee-pub-herald/releases/latest/download/module.json
   ```
3. Enable **Blacksmith**, then **Herald**, in your game world’s module settings.
4. Configure the broadcast user and options in Herald’s settings.


## Support

If you encounter any issues or have suggestions, please file them in the [Issues](https://github.com/Drowbe/coffee-pub-herald/issues) section of this repository.

<!-- global:ai-assistance -->
## AI Assistance and the Illusion of Good Code

I started writing Foundry modules for use at my own table back in 2020. There were already a ton of amazing modules out there, but they either didn't quite do what I wanted or didn't deliver the kind of user experience I was looking for.

I've been a design leader for more than 20 years, but I spent the first half of my career as a developer, so building my own modules seemed like a fun way to kill some time. I'm a pretty good designer. I'm a decent developer. But, over time, my hand-written code and hacks got a little messy (and memory-leaky, and a little buggy. Feels good to say it out loud.).

Today, the Coffee Pub suite of modules is developed with AI assistance, primarily Claude and Cursor, for documentation, refactoring, debugging, and other development work. Every change is reviewed and committed by me, and nothing reaches a release that I haven't crawled and run at my own table. I can't seem to give up my IDE. The UX design, architecture, and ideas still come from my own fever dreams and chronic lack of sleep.

Testing and verifying a change means running it in Foundry so I can watch the console, break things, fix them, and hone the experience. The repositories carry a set of tools for testing the things that are difficult to catch through review and manual testing alone. They help ensure styles don't conflict, shared coding and documentation standards stay consistent, and the suite of modules continues to work well as a system without silently breaking.

Those checks are there because AI-assisted development can move very quickly, and without oversight, engagement, and planning, it can also go confidently off the rails and deliver the illusion of good code. The AI helps me build faster. It doesn't decide what gets built, its architecture, or how it should work. You can blame this human for that.

If the idea of AI-assisted development keeps you up at night or just isn't your jam, no worries at all. I get it. You do you.
<!-- /global:ai-assistance -->

## License

This work is licensed under the included LICENSE file.

## Credits

Part of the Coffee Pub module collection



