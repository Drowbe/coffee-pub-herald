// ==================================================================
// ===== HERALD - ENTRY POINT =======================================
// ==================================================================

import { MODULE } from './const.js';
import { registerSettings, registerBroadcastUserSetting } from './settings.js';
import { HeraldManager } from './manager-herald.js';
import './herald-audio.js';

Hooks.once('init', () => {
});

Hooks.once('ready', function () {
    registerBroadcastUserSetting();
    registerSettings();
    let blacksmith = game.modules.get('coffee-pub-blacksmith')?.api;
    if (!blacksmith) {
        console.warn(`${MODULE.TITLE} | Blacksmith not found; skipping API registration.`);
        return;
    }
    // Blacksmith attaches menubar API via dynamic import; if not ready yet, try once after a short delay (same pattern as other modules).
    if (typeof blacksmith.registerMenubarTool !== 'function') {
        setTimeout(function () {
            blacksmith = game.modules.get('coffee-pub-blacksmith')?.api;
            if (blacksmith && typeof blacksmith.registerMenubarTool === 'function') {
                HeraldManager.initialize(blacksmith);
            } else {
                console.warn(`${MODULE.TITLE} | Blacksmith menubar API not available; broadcast tools will not appear.`);
            }
        }, 150);
        return;
    }
    HeraldManager.initialize(blacksmith);
});
