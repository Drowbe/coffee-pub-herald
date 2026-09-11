// ==================================================================
// ===== HERALD - ENTRY POINT =======================================
// ==================================================================

import { MODULE } from './const.js';
import { registerSettings, registerBroadcastUserSetting } from './settings.js';
import { HeraldManager } from './manager-herald.js';
import { StreamStatsWidget } from './widget-stats.js';
import './herald-audio.js';

Hooks.once('init', () => {
    // body.stream is already on the /stream document here, matching
    // Blacksmith's loading-overlay check. Do not wait for ready — a
    // capture page that stalls before ready would never grow the widget.
    StreamStatsWidget.initialize();
});

Hooks.once('ready', function () {
    try { registerBroadcastUserSetting(); } catch (error) {
        console.warn(`${MODULE.TITLE} | Failed to register broadcast user setting`, error);
    }
    try { registerSettings(); } catch (error) {
        console.warn(`${MODULE.TITLE} | Failed to register settings`, error);
    }
    StreamStatsWidget.initialize();
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
