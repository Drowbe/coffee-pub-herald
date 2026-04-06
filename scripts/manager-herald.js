// ==================================================================
// ===== IMPORTS ====================================================
// ==================================================================

import { MODULE } from './const.js';

function getSettingSafely(moduleId, key, def) {
    try {
        const s = game.settings.settings.get(`${moduleId}.${key}`);
        if (!s) return def;
        return game.settings.get(moduleId, key) ?? def;
    } catch (_) { return def; }
}

function matchUserBySetting(user, settingValue) {
    if (!user || !settingValue) return false;
    const tokens = String(settingValue).split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
    if (!tokens.length) return false;
    return tokens.includes(user.id?.toLowerCase()) || (user.name ? tokens.includes(user.name.toLowerCase()) : false);
}

function postConsoleAndNotification(strModuleID, message, result, blnDebug, blnNotification) {
    const fromApi = HeraldManager._blacksmith?.utils?.postConsoleAndNotification;
    const fromGlobal = globalThis.BlacksmithUtils?.postConsoleAndNotification;
    const fn = typeof fromApi === 'function' ? fromApi : typeof fromGlobal === 'function' ? fromGlobal : null;
    if (fn) {
        fn(strModuleID, message, result, blnDebug, blnNotification);
    } else if (blnDebug) {
        console.debug(strModuleID, message, result ?? '');
    }
}

// ==================================================================
// ===== HERALD MANAGER =============================================
// ==================================================================

/** HeraldManager - Broadcast/streaming; uses Blacksmith API only. */
export class HeraldManager {
    static isInitialized = false;
    static _blacksmith = null;
    static _lastPanPosition = { x: null, y: null };
    static _lastPanTime = 0;
    static _lastModeEmit = { mode: null, at: 0 };
    static _playerButtonsDebounce = null;
    static _lastBroadcastMode = null;
    static _combatTargetIdsByUser = new Map(); // userId -> Set<tokenId>
    static _broadcastWindowHooksRegistered = false;
    
    // Resource tracking for cleanup
    static _hookIds = new Set(); // HookManager callback IDs
    static _timeoutIds = new Set(); // setTimeout references
    static _socketHandlerNames = new Set(); // Socket handler event names
    static _socketsReadyPromise = null; // Cached Blacksmith socket readiness promise

    /**
     * Settings read heavily during camera follow / pan / zoom paths.
     * Refreshed in `initialize()` and when any listed key changes (`broadcast-settings` hook).
     */
    static _hotPathSettings = {
        followDistanceThreshold: 1,
        followThrottleMs: 100,
        animationDuration: 500,
        spectatorPartyBoxFill: 70,
        combatViewFill: 35,
        followViewFill: 20
    };

    /** `{ width, height, rkey }` — invalidated when PIXI renderer width/height/resolution change. */
    static _viewportCssCache = null;

    /**
     * Rank 7: Rebuild visible token lists from cached ids (O party size) instead of scanning all placeables
     * when membership/visibility is unchanged. Invalidated on scene/combat/structural token changes.
     */
    static _partyTokensCache = null;
    static _combatTokensCache = null;
    static _allCanvasTokensCache = null;
    /** Last `_calculateAutoFitZoom` result: `{ sig, fillPercent, zoom }` */
    static _autoFitZoomCache = null;

    /** Debounced `renderMenubar(false)` id from `_requestMenubarRender` (tracked timeout). */
    static _menubarRenderDebounceId = null;

    /**
     * Cameraman-only: when non-null, overrides world `broadcastShowCombatBar` for body class until the setting changes.
     * @type {boolean|null}
     */
    static _combatBarVisibilityOverride = null;

    /** Setting keys that affect `_hotPathSettings` (must match `settings.js` defaults). */
    static _HOT_PATH_SETTING_KEYS = new Set([
        'broadcastFollowDistanceThreshold',
        'broadcastFollowThrottleMs',
        'broadcastAnimationDuration',
        'broadcastSpectatorPartyBoxFill',
        'broadcastCombatViewFill',
        'broadcastFollowViewFill'
    ]);

    /**
     * Initialize the HeraldManager (called with Blacksmith API from herald.js).
     * Follows registering-with-blacksmith.md: guard on blacksmith and required methods; use sub-APIs when present.
     */
    static initialize(blacksmith) {
        if (this.isInitialized) {
            postConsoleAndNotification(MODULE.NAME, "HeraldManager: Already initialized", "", true, false);
            return;
        }
        if (!blacksmith || typeof blacksmith.registerMenubarTool !== 'function') {
            postConsoleAndNotification(MODULE.NAME, "HeraldManager: Blacksmith API or registerMenubarTool not available", "", false, false);
            return;
        }
        this._blacksmith = blacksmith;
        const api = this._blacksmith;

        postConsoleAndNotification(MODULE.NAME, "HeraldManager: Initializing", "", true, false);

        if (typeof api.registerMenubarVisibilityOverride === 'function') {
            api.registerMenubarVisibilityOverride(MODULE.ID, (_user) => {
                // Never hide the menubar for the broadcast user; enable/disable only controls
                // broadcast behavior and cameraman UI, not menubar visibility.
                return { hide: false };
            });
        }

        this._registerHooks();
        this._refreshHotPathSettingsCache();
        if (api.HookManager && typeof api.HookManager.registerHook === 'function') {
            api.HookManager.registerHook({
                name: 'unloadModule',
                description: 'HeraldManager: Cleanup on module unload',
                context: 'broadcast-cleanup',
                priority: 3,
                callback: (moduleId) => {
                    if (moduleId === MODULE.ID) this.cleanup();
                }
            });
        }

        this.isInitialized = true;
        postConsoleAndNotification(MODULE.NAME, "HeraldManager: Initialized", "", true, false);
    }

    /**
     * Register hooks for broadcast mode management
     */
    static _registerHooks() {
        const api = this._blacksmith;
        if (!api?.HookManager || typeof api.HookManager.registerHook !== 'function') {
            return;
        }
        // Hook into setting changes to update broadcast mode
this._blacksmith.HookManager.registerHook({
            name: 'settingChange',
            description: 'BroadcastManager: Update broadcast mode when settings change',
            context: 'broadcast-settings',
            priority: 3,
            callback: (moduleId, settingKey, value) => {
                //  ------------------- BEGIN - HOOKMANAGER CALLBACK -------------------
                
                if (moduleId === MODULE.ID && this._HOT_PATH_SETTING_KEYS.has(settingKey)) {
                    this._refreshHotPathSettingsCache();
                    this._invalidateAutoFitZoomCache();
                }

                if (moduleId === MODULE.ID && settingKey === 'broadcastShowCombatBar') {
                    this._combatBarVisibilityOverride = null;
                }

                if (moduleId === MODULE.ID && (
                    settingKey === 'enableBroadcast' || 
                    settingKey === 'broadcastUserId' ||
                    settingKey === 'broadcastHideInterfaceLeft' ||
                    settingKey === 'broadcastHideInterfaceMiddle' ||
                    settingKey === 'broadcastHideInterfaceRight' ||
                    settingKey === 'broadcastHideBackground' ||
                    settingKey === 'broadcastHideNotifications' ||
                    settingKey === 'broadcastShowCombatBar' ||
                    settingKey === 'broadcastBarHeight'
                )) {
                    if (settingKey === 'broadcastUserId') {
                        this._invalidateVisibleTokenListCaches();
                    }
                    this._updateBroadcastMode();
                    if (settingKey === 'broadcastBarHeight') this._applyBroadcastBarHeightCss();
                    // Re-render menubar to update view mode button visibility
                    this._requestMenubarRender(true);
                }
                
                //  ------------------- END - HOOKMANAGER CALLBACK ---------------------
            }
        });

        // Hook into user connection/disconnection to update view mode button visibility
this._blacksmith.HookManager.registerHook({
            name: 'userConnected',
            description: 'BroadcastManager: Update menubar when users connect',
            context: 'broadcast-settings',
            priority: 3,
            callback: () => {
                //  ------------------- BEGIN - HOOKMANAGER CALLBACK -------------------
                this._updateBroadcastMode();
                // Debounced: connect/disconnect bursts should not full-render per event
                this._requestMenubarRender(false);
                //  ------------------- END - HOOKMANAGER CALLBACK ---------------------
            }
        });

this._blacksmith.HookManager.registerHook({
            name: 'userDisconnected',
            description: 'BroadcastManager: Update menubar when users disconnect',
            context: 'broadcast-settings',
            priority: 3,
            callback: () => {
                //  ------------------- BEGIN - HOOKMANAGER CALLBACK -------------------
                this._updateBroadcastMode();
                this._requestMenubarRender(false);
                //  ------------------- END - HOOKMANAGER CALLBACK ---------------------
            }
        });

        // We are already in ready (called from herald.js ready). Register bar and tools immediately with short delay.
        this._trackedSetTimeout(async () => {
            this._updateBroadcastMode();
            this._registerCameraHooks();
            await this._registerBroadcastBarType();
            this._applyBroadcastBarHeightCss();
            this._registerBroadcastTools();
            this._requestMenubarRender(true);
        }, 100);
    }

    /**
     * Register hooks for camera following (token updates, combat updates)
     */
    static _registerCameraHooks() {
        // Helper function to initialize camera on scene load
        const initializeCamera = async () => {
            this._invalidateVisibleTokenListCaches();
            // Only process for broadcast user (for spectator/combat modes)
            // For GM view mode, GM client initializes monitoring separately
            if (!this._isBroadcastUser()) {
                return;
            }
            if (!this.isEnabled()) {
                return;
            }
            
            const mode = getSettingSafely(MODULE.ID, 'broadcastMode', 'spectator');
            
            // Initialize spectator mode camera
            if (mode === 'spectator') {
                // Wait a bit for canvas to fully initialize
                this._trackedSetTimeout(async () => {
                    postConsoleAndNotification(MODULE.NAME, "BroadcastManager: Initializing camera on scene load (spectator mode)", "", true, false);
                    // Trigger camera update by calling _onTokenUpdate with null changes
                    // This will force a pan/zoom to current party token positions
                    await this._onTokenUpdate(null, {});
                }, 500);
            }
            // Initialize combat mode camera (frame all combatants)
            if (mode === 'combat') {
                // Wait a bit for canvas to fully initialize
                this._trackedSetTimeout(async () => {
                    postConsoleAndNotification(MODULE.NAME, "BroadcastManager: Initializing camera on scene load (combat mode)", "", true, false);
                    // Trigger camera update by calling _onCombatantTokensUpdate with null changes
                    await this._onCombatantTokensUpdate(null, {});
                }, 500);
            }
            // Initialize combat spectator mode camera (frame all combatants)
            if (mode === 'tokenspectator') {
                this._trackedSetTimeout(async () => {
                    await this._onTokenSpectatorUpdate(null, {}, true);
                }, 500);
            }
            // For gmview mode, the GM client will send initial sync via socket
            // The cameraman client just needs to wait for the socket message
        };
        
        // Hook for canvas ready - initialize camera position when canvas is ready
this._blacksmith.HookManager.registerHook({
            name: 'canvasReady',
            description: 'BroadcastManager: Initialize camera position when canvas is ready',
            context: 'broadcast-camera-init',
            priority: 5,
            callback: async () => {
                //  ------------------- BEGIN - HOOKMANAGER CALLBACK -------------------
                await initializeCamera.call(this);
                //  ------------------- END - HOOKMANAGER CALLBACK ---------------------
            }
        });
        
        // Also hook into canvasInit as a fallback
this._blacksmith.HookManager.registerHook({
            name: 'canvasInit',
            description: 'BroadcastManager: Initialize camera position when canvas initializes',
            context: 'broadcast-camera-init',
            priority: 5,
            callback: async () => {
                //  ------------------- BEGIN - HOOKMANAGER CALLBACK -------------------
                await initializeCamera.call(this);
                //  ------------------- END - HOOKMANAGER CALLBACK ---------------------
            }
        });
        
        // Also manually trigger after hooks are registered (in case canvas is already ready)
        // This ensures initialization happens even if hooks fire before we register
        this._trackedSetTimeout(async () => {
            if (canvas?.ready) {
                postConsoleAndNotification(MODULE.NAME, "BroadcastManager: Canvas already ready, manually initializing camera", "", true, false);
                await initializeCamera.call(this);
            }
        }, 1000);
        
        // Hook for token position updates (spectator/follow/combat modes)
this._blacksmith.HookManager.registerHook({
            name: 'updateToken',
            description: 'BroadcastManager: Follow tokens on movement (spectator/follow/combat modes)',
            context: 'broadcast-camera',
            priority: 3,
            callback: async (tokenDocument, changes, options, userId) => {
                //  ------------------- BEGIN - HOOKMANAGER CALLBACK -------------------
                
                if (tokenDocument && this._tokenChangesMayChangeVisibleMembership(changes)) {
                    this._invalidateVisibleTokenListCaches();
                }

                // Only process for broadcast user
                if (!this._isBroadcastUser()) {
                    return;
                }
                if (!this.isEnabled()) {
                    return;
                }
                
                // Check if we're in spectator, combat spectator, follow, or combat mode
                const mode = getSettingSafely(MODULE.ID, 'broadcastMode', 'spectator');
                if (mode === 'playerview-follow') {
                    const followTokenId = getSettingSafely(MODULE.ID, 'broadcastFollowTokenId', '');
                    if (followTokenId && tokenDocument?.id === followTokenId) {
                        await this._onFollowTokenUpdate(tokenDocument);
                    }
                    return;
                }
                if (mode === 'combatant') {
                    const combat = game.combat;
                    if (!combat) return;
                    const currentCombatant = combat.combatants.get(combat.current.combatantId);
                    const combatToken = currentCombatant?.token;
                    if (combatToken && combatToken.id === tokenDocument?.id) {
                        this._onCombatUpdate(combat);
                    }
                    return;
                }
                if (mode === 'combat') {
                    await this._onCombatantTokensUpdate(tokenDocument, changes);
                    return;
                }
                if (mode === 'tokenspectator') {
                    await this._onTokenSpectatorUpdate(tokenDocument, changes);
                    return;
                }
                if (mode !== 'spectator') {
                    return;
                }
                
                // Process token update (even if no position changes in this hook call)
                // This ensures we pan/zoom to final position when token stops moving
                // The _shouldPan() check will handle throttling and distance threshold
                // Follow party tokens (await to ensure zoom updates complete)
                // Pass changes but always check current token position
                await this._onTokenUpdate(tokenDocument, changes);
                
                //  ------------------- END - HOOKMANAGER CALLBACK ---------------------
            }
        });

        // Hook for token creation (when token is dropped on canvas)
this._blacksmith.HookManager.registerHook({
            name: 'createToken',
            description: 'BroadcastManager: Adapt viewport when party token is created',
            context: 'broadcast-camera',
            priority: 3,
            callback: async (tokenDocument, options, userId) => {
                //  ------------------- BEGIN - HOOKMANAGER CALLBACK -------------------
                
                this._invalidateVisibleTokenListCaches();

                // Only process for broadcast user
                if (!this._isBroadcastUser()) {
                    return;
                }
                if (!this.isEnabled()) {
                    return;
                }
                
                // Check if we're in spectator or follow mode
                const mode = getSettingSafely(MODULE.ID, 'broadcastMode', 'spectator');
                if (mode === 'playerview-follow') {
                    const followTokenId = getSettingSafely(MODULE.ID, 'broadcastFollowTokenId', '');
                    if (followTokenId && tokenDocument?.id === followTokenId) {
                        await this._onFollowTokenUpdate(tokenDocument);
                    }
                    return;
                }
                if (mode === 'combat') {
                    // Wait a bit for token to be fully added to canvas, then reframe combatants
                    this._trackedSetTimeout(async () => {
                        await this._onCombatantTokensUpdate(tokenDocument, {});
                    }, 100);
                    return;
                }
                if (mode === 'tokenspectator') {
                    this._trackedSetTimeout(async () => {
                        await this._onTokenSpectatorUpdate(tokenDocument, {});
                    }, 100);
                    return;
                }
                if (mode !== 'spectator') {
                    return;
                }
                
                // Wait a bit for token to be fully added to canvas
                this._trackedSetTimeout(async () => {
                    // Trigger camera update to adapt to new party token
                    // Pass the tokenDocument but no changes (it's a new token at its initial position)
                    await this._onTokenUpdate(tokenDocument, {});
                }, 100);
                
                //  ------------------- END - HOOKMANAGER CALLBACK ---------------------
            }
        });

        // Hook for combat turn changes (combat mode)
this._blacksmith.HookManager.registerHook({
            name: 'updateCombat',
            description: 'BroadcastManager: Follow current combatant on turn change (combat mode)',
            context: 'broadcast-camera',
            priority: 3,
            callback: (combat, updateData, options, userId) => {
                //  ------------------- BEGIN - HOOKMANAGER CALLBACK -------------------
                
                // Only process for broadcast user
                if (!this._isBroadcastUser()) return;
                if (!this.isEnabled()) return;
                
                // Check if we're in combat mode (frame all) or combatant mode (follow current)
                const mode = getSettingSafely(MODULE.ID, 'broadcastMode', 'spectator');
                if (mode === 'combat') {
                    // Reframe combatants when combat state changes
                    this._onCombatantTokensUpdate(null, {}, true);
                    return;
                }
                if (mode !== 'combatant') return;
                
                // Only process on turn change (when current turn index changes)
                if (!updateData || updateData.turn === undefined) return;
                
                // Follow current combatant
                this._onCombatUpdate(combat, true);
                
                //  ------------------- END - HOOKMANAGER CALLBACK ---------------------
            }
        });

        // Hooks for combatant list changes (combatant mode)
        const combatantUpdateHandler = async () => {
            //  ------------------- BEGIN - HOOKMANAGER CALLBACK -------------------
            this._invalidateVisibleTokenListCaches();
            if (!this._isBroadcastUser()) return;
            if (!this.isEnabled()) return;
            if (getSettingSafely(MODULE.ID, 'broadcastMode', 'spectator') !== 'combat') return;
            await this._onCombatantTokensUpdate(null, {}, true);
            //  ------------------- END - HOOKMANAGER CALLBACK ---------------------
        };

this._blacksmith.HookManager.registerHook({
            name: 'createCombatant',
            description: 'BroadcastManager: Reframe combatants when combatant is created (combatant mode)',
            context: 'broadcast-camera',
            priority: 3,
            callback: combatantUpdateHandler
        });

this._blacksmith.HookManager.registerHook({
            name: 'updateCombatant',
            description: 'BroadcastManager: Reframe combatants when combatant updates (combatant mode)',
            context: 'broadcast-camera',
            priority: 3,
            callback: combatantUpdateHandler
        });

this._blacksmith.HookManager.registerHook({
            name: 'deleteCombatant',
            description: 'BroadcastManager: Reframe combatants when combatant is deleted (combatant mode)',
            context: 'broadcast-camera',
            priority: 3,
            callback: combatantUpdateHandler
        });

        // Hook for target changes (combat mode)
this._blacksmith.HookManager.registerHook({
            name: 'targetToken',
            description: 'BroadcastManager: Sync combat targets for viewport framing',
            context: 'broadcast-camera',
            priority: 3,
            callback: (user, token, targeted) => {
                //  ------------------- BEGIN - HOOKMANAGER CALLBACK -------------------
                if (!user || user.id !== game.user.id) return;
                if (!this.isEnabled()) return;
                if (getSettingSafely(MODULE.ID, 'broadcastMode', 'spectator') !== 'combatant') return;
                const combat = game.combat;
                if (!combat?.combatant) return;

                const currentCombatant = combat.combatant;
                const ownerId = this._getCombatantOwnerUserId(currentCombatant);
                if (ownerId && ownerId !== user.id && !user.isGM) return;

                this._emitCombatTargets(user.id);
                //  ------------------- END - HOOKMANAGER CALLBACK ---------------------
            }
        });

        // Hook for combat begin (when GM clicks Begin Combat)
this._blacksmith.HookManager.registerHook({
            name: 'combatStart',
            description: 'BroadcastManager: Auto-switch mode when combat starts',
            context: 'broadcast-camera',
            priority: 3,
            callback: async (combat, updateData) => {
                this._invalidateVisibleTokenListCaches();
                if (!this.isEnabled()) return;
                const mode = getSettingSafely(MODULE.ID, 'broadcastCombatBeginMode', 'combatant');
                if (mode === 'no-change') return;
                await this._setBroadcastMode(mode);
            }
        });

        // Hook for combat end (when GM clicks End Combat)
this._blacksmith.HookManager.registerHook({
            name: 'deleteCombat',
            description: 'BroadcastManager: Auto-switch mode when combat ends',
            context: 'broadcast-camera',
            priority: 3,
            callback: async (combat, options, userId) => {
                this._invalidateVisibleTokenListCaches();
                if (!this.isEnabled()) return;
                const mode = getSettingSafely(MODULE.ID, 'broadcastCombatEndMode', 'spectator');
                if (mode === 'no-change') return;
                await this._setBroadcastMode(mode);
            }
        });

        // Register GM view syncing (only if broadcast is enabled and mode is gmview)
        this._registerGMViewSync();
        
        // Register player view syncing (for playerview-{userId} modes)
        this._registerPlayerViewSync();
    }

    /**
     * Register GM viewport syncing (GM client sends viewport, cameraman receives)
     */
    static _registerGMViewSync() {
        postConsoleAndNotification(MODULE.NAME, "BroadcastManager: _registerGMViewSync called", "", true, false);
        
        // Since we're already in a ready hook context (called from _registerCameraHooks which is called from ready),
        // we can't use Hooks.once('ready') here. Execute directly but async for socket readiness.
        (async () => {
            postConsoleAndNotification(MODULE.NAME, "BroadcastManager: GM view sync initialization starting", "", true, false);
            // Wait for socket system to be ready
            try {
                const blacksmith = game.modules.get('coffee-pub-blacksmith')?.api;
                if (!blacksmith) {
                    postConsoleAndNotification(MODULE.NAME, "BroadcastManager: Blacksmith API not available for GM view socket", "", true, false);
                    return;
                }
                if (!blacksmith.sockets) {
                    postConsoleAndNotification(MODULE.NAME, "BroadcastManager: Blacksmith sockets API not available for GM view socket", "", true, false);
                    return;
                }
                
                await blacksmith.sockets.waitForReady();
                
                // Register socket handler for receiving GM viewport updates (cameraman client)
                const gmViewportSyncHandler = 'broadcast.gmViewportSync';
                this._socketHandlerNames.add(gmViewportSyncHandler);
                await blacksmith.sockets.register(gmViewportSyncHandler, async (data, userId) => {
                    //  ------------------- BEGIN - HOOKMANAGER CALLBACK -------------------
                    
                    // Only process if we're the broadcast user and in GM view mode
                    if (!this._isBroadcastUser()) {
                        return;
                    }
                    if (!this.isEnabled()) {
                        return;
                    }
                    
                    const mode = getSettingSafely(MODULE.ID, 'broadcastMode', 'spectator');
                    if (mode !== 'gmview') {
                        return;
                    }
                    
                    // Apply GM's viewport to cameraman's viewport
                    await this._applyGMViewport(data);
                    
                    //  ------------------- END - HOOKMANAGER CALLBACK ---------------------
                });
                
                postConsoleAndNotification(MODULE.NAME, "BroadcastManager: GM view socket handler registered successfully", "", true, false);

                // Register socket handler for broadcast mode changes (all clients)
                const modeChangedHandler = 'broadcast.modeChanged';
                this._socketHandlerNames.add(modeChangedHandler);
                await blacksmith.sockets.register(modeChangedHandler, async (data) => {
                    //  ------------------- BEGIN - HOOKMANAGER CALLBACK -------------------
                    
                    if (!data || !data.mode) return;
                    postConsoleAndNotification(MODULE.NAME, "BroadcastManager: Received mode change socket", { data }, true, false);
                    
                    // Adjust viewport for the new mode (client-specific behavior)
                    await this._adjustViewportForMode(data.mode);
                    
                    //  ------------------- END - HOOKMANAGER CALLBACK ---------------------
                });
                
                postConsoleAndNotification(MODULE.NAME, "BroadcastManager: Mode change socket handler registered successfully", "", true, false);

                // Register socket handler for map view (all clients)
                const mapViewHandler = 'broadcast.mapView';
                this._socketHandlerNames.add(mapViewHandler);
                await blacksmith.sockets.register(mapViewHandler, async () => {
                    //  ------------------- BEGIN - HOOKMANAGER CALLBACK -------------------
                    await this._applyMapView();
                    //  ------------------- END - HOOKMANAGER CALLBACK ---------------------
                });
                
                postConsoleAndNotification(MODULE.NAME, "BroadcastManager: Map view socket handler registered successfully", "", true, false);

                // Register socket handler for broadcast window commands (cameraman only)
                const windowCommandHandler = 'broadcast.windowCommand';
                this._socketHandlerNames.add(windowCommandHandler);
                await blacksmith.sockets.register(windowCommandHandler, async (data) => {
                    //  ------------------- BEGIN - HOOKMANAGER CALLBACK -------------------
                    if (!data?.action) return;
                    postConsoleAndNotification(MODULE.NAME, "BroadcastManager: Received window command", {
                        data,
                        isBroadcastUser: this._isBroadcastUser(),
                        isEnabled: this.isEnabled()
                    }, true, false);
                    if (data.targetUserId && !matchUserBySetting(game.user, data.targetUserId)) {
                        postConsoleAndNotification(MODULE.NAME, "BroadcastManager: Window command ignored (not target user)", { targetUserId: data.targetUserId }, true, false);
                        return;
                    }
                    if (!this._isBroadcastUser()) return;

                    switch (data.action) {
                        case 'close-images':
                            for (const app of this._getOpenWindows()) {
                                if (!app?.close) continue;
                                if (app.constructor?.name !== 'ImagePopout') continue;
                                app.close({ animate: false });
                            }
                            break;
                        case 'close-journals':
                            for (const app of this._getOpenWindows()) {
                                if (!app?.close) continue;
                                const doc = app.document;
                                const isJournal = doc instanceof JournalEntry || doc instanceof JournalEntryPage
                                    || app.constructor?.name?.toLowerCase?.().includes('journal');
                                if (!isJournal) continue;
                                app.close({ animate: false });
                            }
                            break;
                        case 'close-all':
                            await this._closeAllWindows();
                            break;
                        case 'refresh':
                            window.location.reload();
                            break;
                        case 'settings':
                            game.settings.sheet.render(true);
                            break;
                        case 'toggle-combat-bar':
                            this._toggleCombatBarVisibilityOnCameramanClient();
                            break;
                        default:
                            break;
                    }
                    //  ------------------- END - HOOKMANAGER CALLBACK ---------------------
                });
                
                postConsoleAndNotification(MODULE.NAME, "BroadcastManager: Window command socket handler registered successfully", "", true, false);

                // Register socket handler for cameraman window opened (GM starts timer)
                const windowOpenedHandler = 'broadcast.windowOpened';
                this._socketHandlerNames.add(windowOpenedHandler);
                await blacksmith.sockets.register(windowOpenedHandler, async () => {
                    //  ------------------- BEGIN - HOOKMANAGER CALLBACK -------------------
                    if (!game.user.isGM) return;
                    if (!this.isEnabled()) return;

                    const shouldAutoClose = getSettingSafely(MODULE.ID, 'broadcastAutoCloseWindows', true);
                    if (!shouldAutoClose) return;

                    const delaySeconds = getSettingSafely(MODULE.ID, 'broadcastAutoCloseDelaySeconds', 3);
                    const delayMs = Math.max(1, delaySeconds) * 1000;

                    this._trackedSetTimeout(() => {
                        this._emitBroadcastWindowCommand('close-images');
                        this._emitBroadcastWindowCommand('close-journals');
                    }, delayMs);
                    //  ------------------- END - HOOKMANAGER CALLBACK ---------------------
                });

                postConsoleAndNotification(MODULE.NAME, "BroadcastManager: Window opened socket handler registered successfully", "", true, false);

                const combatTargetsHandler = 'broadcast.combatTargets';
                this._socketHandlerNames.add(combatTargetsHandler);
                await blacksmith.sockets.register(combatTargetsHandler, async (data) => {
                    //  ------------------- BEGIN - HOOKMANAGER CALLBACK -------------------
                    if (!data?.userId || !Array.isArray(data.targetIds)) return;
                    if (!this.isEnabled()) return;

                    const targetSet = new Set(data.targetIds);
                    this._combatTargetIdsByUser.set(data.userId, targetSet);

                    if (this._isBroadcastUser()
                        && getSettingSafely(MODULE.ID, 'broadcastMode', 'spectator') === 'combatant') {
                        this._onCombatUpdate(game.combat, true);
                    }
                    //  ------------------- END - HOOKMANAGER CALLBACK ---------------------
                });

                postConsoleAndNotification(MODULE.NAME, "BroadcastManager: Combat targets socket handler registered successfully", "", true, false);
            } catch (error) {
                postConsoleAndNotification(MODULE.NAME, "BroadcastManager: Failed to register GM view socket handler", error, true, false);
            }
            
            // If broadcast is enabled, check for viewport monitoring setup
            if (this.isEnabled()) {
                const mode = getSettingSafely(MODULE.ID, 'broadcastMode', 'spectator');
                
                // GM viewport monitoring (GM only)
                if (game.user.isGM && mode === 'gmview') {
                    // Wait for canvas to be ready if not already
                    if (!canvas?.ready) {
                        postConsoleAndNotification(MODULE.NAME, "BroadcastManager: Canvas not ready, waiting for canvasReady", "", true, false);
                        Hooks.once('canvasReady', () => {
                            this._trackedSetTimeout(() => {
                                this._startGMViewportMonitoring();
                            }, 500);
                        });
                    } else {
                        this._trackedSetTimeout(() => {
                            this._startGMViewportMonitoring();
                        }, 500);
                    }
                } 
                // Player viewport monitoring (any player)
                else if (typeof mode === 'string' && mode.startsWith('playerview-') && mode !== 'playerview-follow') {
                    // Initialize player viewport monitoring if mode is playerview
                    if (!canvas?.ready) {
                        Hooks.once('canvasReady', () => {
                            this._trackedSetTimeout(() => {
                                this._updatePlayerViewportMonitoring();
                            }, 500);
                        });
                    } else {
                        this._trackedSetTimeout(() => {
                            this._updatePlayerViewportMonitoring();
                        }, 500);
                    }
                }
            }
        })();

        // Hook into setting changes to start/stop GM viewport monitoring
this._blacksmith.HookManager.registerHook({
            name: 'settingChange',
            description: 'BroadcastManager: Start/stop GM viewport monitoring when mode changes',
            context: 'broadcast-gmview-sync',
            priority: 5,
            key: 'broadcast-gmview-setting-change',
            callback: async (moduleId, settingKey, value) => {
                //  ------------------- BEGIN - HOOKMANAGER CALLBACK -------------------
                
                if (moduleId === MODULE.ID && settingKey === 'broadcastMode') {
                    
                    // If we're GM and mode changed to gmview, start monitoring
                    if (game.user.isGM && this.isEnabled() && value === 'gmview') {
                        this._startGMViewportMonitoring();
                    } else {
                        // Stop monitoring if mode changed away from gmview
                        this._stopGMViewportMonitoring();
                    }
                }
                
                //  ------------------- END - HOOKMANAGER CALLBACK ---------------------
            }
        });
    }

    static _gmPanHandler = null;
    static _gmDebounce = null;

    /**
     * Start monitoring GM viewport changes (GM client only)
     */
    static _startGMViewportMonitoring() {
        this._stopGMViewportMonitoring();

        if (!game.user.isGM) return;

        // If canvas isn't ready yet, retry once it is
        if (!canvas?.ready) {
            Hooks.once('canvasReady', () => this._startGMViewportMonitoring());
            return;
        }

        this._gmPanHandler = (c, position) => {
            // position is {x,y,scale} center coords
            if (!this.isEnabled()) return;
            if (getSettingSafely(MODULE.ID, 'broadcastMode', 'spectator') !== 'gmview') return;

            // Debounce emits so we don't spam
            if (this._gmDebounce) this._trackedClearTimeout(this._gmDebounce);
            this._gmDebounce = this._trackedSetTimeout(() => {
                this._gmDebounce = null;
                this._sendGMViewportSync(position);
            }, 150);
        };

        Hooks.on('canvasPan', this._gmPanHandler);

        // Send initial state immediately - match canvasPan format (center coords)
        const view = canvas.scene?._viewPosition ?? canvas.pan ?? { x: 0, y: 0, scale: 1 };
        const initialPosition = {
            x: view.x ?? 0,
            y: view.y ?? 0,
            scale: view.scale ?? canvas.stage?.scale?.x ?? 1
        };
        
        // Use a small timeout to ensure canvas is fully ready
        this._trackedSetTimeout(() => {
            void this._sendGMViewportSync(initialPosition);
        }, 100);
    }

    /**
     * Stop monitoring GM viewport changes
     */
    static _stopGMViewportMonitoring() {
        if (this._gmDebounce) {
            this._trackedClearTimeout(this._gmDebounce);
            this._gmDebounce = null;
        }
        if (this._gmPanHandler) {
            Hooks.off('canvasPan', this._gmPanHandler);
            this._gmPanHandler = null;
        }
    }

    /**
     * Send GM viewport state to broadcast user via socket (GM client only)
     * @param {Object} position - Viewport position from canvasPan hook: {x, y, scale}
     */
    static async _sendGMViewportSync(position) {
        if (!game.user.isGM) return;
        if (!this.isBroadcastActive()) return;
        if (!canvas?.ready) return;
        if (getSettingSafely(MODULE.ID, 'broadcastMode', 'spectator') !== 'gmview') return;

        const viewportState = {
            x: position.x,
            y: position.y,
            scale: position.scale ?? canvas.stage?.scale?.x ?? 1
        };

        try {
            if (!this._blacksmith?.sockets) return;
            await this._waitForSocketsReady();
            await this._blacksmith.sockets.emit('broadcast.gmViewportSync', viewportState);
        } catch (error) {
            postConsoleAndNotification(MODULE.NAME, "BroadcastManager: Failed to send GM viewport sync", error, true, false);
        }
    }

    /**
     * Apply GM viewport state to cameraman's viewport (cameraman client only)
     * @param {Object} viewportState - Viewport state from GM with {centerX, centerY, zoom}
     */
    static async _applyGMViewport(viewportState) {
        if (!this._isBroadcastUser()) return;
        if (!this.isEnabled()) return;
        if (!canvas?.ready) return;
        if (getSettingSafely(MODULE.ID, 'broadcastMode', 'spectator') !== 'gmview') return;

        // Guard correctly (allow 0)
        if (viewportState?.x == null || viewportState?.y == null || viewportState?.scale == null) return;

        const duration = this._hotPathSettings.animationDuration;

        await canvas.animatePan({
            x: viewportState.x,
            y: viewportState.y,
            scale: viewportState.scale,
            duration,
            easing: 'easeInOutCosine'
        });
    }

    /**
     * Update broadcast mode class on body based on current user
     */
    static _updateBroadcastMode() {
        // Check if document.body exists (might not be ready yet)
        if (!document.body) {
            postConsoleAndNotification(MODULE.NAME, "BroadcastManager: Document body not ready yet, skipping update", "", true, false);
            return;
        }

        // Check if broadcast is enabled - use getSettingSafely but default to false only if setting exists
        // If setting doesn't exist yet, getSettingSafely returns the default, but we should check if it's actually registered
        let isEnabled = false;
        try {
            // Try to check if setting is registered
            const settingExists = game.settings.settings.has(`${MODULE.ID}.enableBroadcast`);
            if (settingExists) {
                isEnabled = getSettingSafely(MODULE.ID, 'enableBroadcast', false);
            } else {
                // Setting not registered yet, skip check
                postConsoleAndNotification(MODULE.NAME, "BroadcastManager: enableBroadcast setting not registered yet, skipping update", "", true, false);
                return;
            }
        } catch (error) {
            // Settings system not ready yet
            postConsoleAndNotification(MODULE.NAME, "BroadcastManager: Settings not ready yet, skipping update", "", true, false);
            return;
        }

        if (!isEnabled) {
            document.body.classList.remove('broadcast-mode', 'hide-interface-left', 'hide-interface-middle', 'hide-interface-right', 'hide-background', 'hide-notifications', 'broadcast-show-combat-bar');
            return;
        }

        const isBroadcastUser = this._isBroadcastUser();

        if (isBroadcastUser) {
            document.body.classList.add('broadcast-mode');
            
            // Apply granular control classes based on settings
            if (getSettingSafely(MODULE.ID, 'broadcastHideInterfaceLeft', true)) {
                document.body.classList.add('hide-interface-left');
            } else {
                document.body.classList.remove('hide-interface-left');
            }
            
            if (getSettingSafely(MODULE.ID, 'broadcastHideInterfaceMiddle', true)) {
                document.body.classList.add('hide-interface-middle');
            } else {
                document.body.classList.remove('hide-interface-middle');
            }
            
            if (getSettingSafely(MODULE.ID, 'broadcastHideInterfaceRight', true)) {
                document.body.classList.add('hide-interface-right');
            } else {
                document.body.classList.remove('hide-interface-right');
            }
            
            // Apply background hiding class
            if (getSettingSafely(MODULE.ID, 'broadcastHideBackground', true)) {
                document.body.classList.add('hide-background');
            } else {
                document.body.classList.remove('hide-background');
            }
            
            // Apply notifications hiding class
            if (getSettingSafely(MODULE.ID, 'broadcastHideNotifications', true)) {
                document.body.classList.add('hide-notifications');
            } else {
                document.body.classList.remove('hide-notifications');
            }
            
            // Apply combat bar visibility (world setting, or session override from GM tool / socket)
            {
                const combatBarFromSetting = getSettingSafely(MODULE.ID, 'broadcastShowCombatBar', true);
                const showCombatBar = this._combatBarVisibilityOverride !== null
                    ? this._combatBarVisibilityOverride
                    : combatBarFromSetting;
                if (showCombatBar) {
                    document.body.classList.add('broadcast-show-combat-bar');
                } else {
                    document.body.classList.remove('broadcast-show-combat-bar');
                }
            }
        } else {
            document.body.classList.remove('broadcast-mode', 'hide-interface-left', 'hide-interface-middle', 'hide-interface-right', 'hide-background', 'hide-notifications', 'broadcast-show-combat-bar');
        }
    }

    /**
     * Cameraman client: flip combat secondary bar visibility (CSS class), independent of world setting until setting changes.
     * Invoked from `broadcast.windowCommand` action `toggle-combat-bar`.
     */
    static _toggleCombatBarVisibilityOnCameramanClient() {
        if (!this._isBroadcastUser()) return;
        if (!document.body) return;
        if (!this.isEnabled()) return;

        const combatBarFromSetting = getSettingSafely(MODULE.ID, 'broadcastShowCombatBar', true);
        const effective = this._combatBarVisibilityOverride !== null
            ? this._combatBarVisibilityOverride
            : combatBarFromSetting;
        const next = !effective;
        this._combatBarVisibilityOverride = next;
        if (next) {
            document.body.classList.add('broadcast-show-combat-bar');
        } else {
            document.body.classList.remove('broadcast-show-combat-bar');
        }
    }

    /**
     * Handle token position update (spectator mode)
     * 
     * This method calculates the center of party tokens and pans the cameraman's viewport
     * to center that position. All calculations use world coordinates and are relative
     * to the cameraman's viewport (not GM's viewport).
     * 
     * @param {TokenDocument} tokenDocument - The token document that was updated
     * @param {Object} changes - The changes made to the token
     */
    static async _onTokenUpdate(tokenDocument, changes) {
        try {
            // IMPORTANT: This code only runs for the broadcast user (cameraman)
            // All pan/zoom operations affect the cameraman's viewport only
            
            // Allow null tokenDocument for initialization (scene load)
            const isInitialization = !tokenDocument;
            
            // Get party tokens visible to broadcast user
            let partyTokens = this._getVisiblePartyTokens();
            
            if (!partyTokens || partyTokens.length === 0) {
                return;
            }
            
            // If we have a tokenDocument with position changes, update the corresponding token's position
            // This ensures we use the NEW position, not the old one from the placeable
            if (tokenDocument && changes && (changes.x !== undefined || changes.y !== undefined)) {
                partyTokens = partyTokens.map(token => {
                    if (token.id === tokenDocument.id) {
                        // Create a copy of the token with updated position from tokenDocument
                        const updatedToken = Object.assign({}, token);
                        // Use the NEW position from tokenDocument, not the placeable
                        updatedToken.x = changes.x !== undefined ? changes.x : token.x;
                        updatedToken.y = changes.y !== undefined ? changes.y : token.y;
                        return updatedToken;
                    }
                    return token;
                });
            }
            
            // Calculate target position (center of party tokens in world coordinates)
            // Use Token.center if available (handles size, scale, grid type automatically)
            // Fallback to manual calculation if needed
            const targetPosition = partyTokens.length === 1
                ? this._getTokenCenter(partyTokens[0])
                : this._getGroupCenter(partyTokens);
            
            if (!targetPosition) return;
            
            // Calculate zoom based on token count (affects cameraman's viewport)
            let finalZoom;
            
            // Use auto-fit zoom based on bounding box + padding (single or multiple tokens)
            const fillPercent = this._hotPathSettings.spectatorPartyBoxFill;
            const autoFitZoom = this._calculateAutoFitZoom(partyTokens, fillPercent);
            
            if (autoFitZoom !== null) {
                finalZoom = autoFitZoom;
            } else {
                // Fallback to current zoom if auto-fit calculation fails
                finalZoom = canvas.stage?.scale?.x ?? 1.0;
            }
            
            // When a token in the group moved, always reframe (don't gate by distance/throttle)
            const tokenMoved = tokenDocument && changes && (changes.x !== undefined || changes.y !== undefined);
            
            // Pan gating (existing logic: distance threshold + throttle)
            // Skip gating for initialization (scene load) or when a token moved - always pan/zoom
            // Pass partyTokens to check if any are off-screen (forces pan)
            const shouldPan = isInitialization || tokenMoved || this._shouldPan(targetPosition, partyTokens);
            
            // Zoom gating (new: check if zoom needs to change)
            // Always check zoom since we always calculate finalZoom now
            const currentZoom = canvas.stage?.scale?.x ?? canvas.scene?._viewPosition?.scale ?? 1.0;
            const shouldZoom = Math.abs(currentZoom - finalZoom) > 0.001;
            
            // If neither pan nor zoom is needed, return early
            if (!shouldPan && !shouldZoom) {
                return;
            }
            
            // Sanity check zoom value and bounds
            if (finalZoom !== undefined) {
                if (!Number.isFinite(finalZoom)) {
                    return;
                }
                const min = canvas.scene?._viewPosition?.minScale ?? 0.25;
                const max = canvas.scene?._viewPosition?.maxScale ?? 3.0;
                if (finalZoom < min || finalZoom > max) {
                    // Clamp to bounds
                    finalZoom = Math.max(min, Math.min(max, finalZoom));
                }
            }
            
            // Pan and zoom together in one atomic operation
            // canvas.animatePan() appears to center the coordinate in the viewport automatically
            // (combat mode uses canvasToken.x/y which centers perfectly, so we use token center here)
            // Always include scale since we always calculate finalZoom now
            const animationDuration = this._hotPathSettings.animationDuration;
            const panOptions = {
                x: targetPosition.x,
                y: targetPosition.y,
                scale: finalZoom,
                duration: animationDuration,
                easing: "easeInOutCosine" // Smooth ease in/out animation
            };
            
            // Await to ensure scale update completes before updating lastPanPosition
            await canvas.animatePan(panOptions);
            
            // Only update lastPanPosition/time when pan actually ran
            if (shouldPan) {
                this._lastPanPosition = targetPosition;
                this._lastPanTime = Date.now();
            }
            
        } catch (error) {
            postConsoleAndNotification(MODULE.NAME, "BroadcastManager: Error following token", error, false, false);
        }
    }

    /**
     * Handle combatant token updates (combatant mode)
     *
     * This mirrors spectator mode but uses active combatant tokens instead of party tokens.
     *
     * @param {TokenDocument} tokenDocument - The token document that was updated
     * @param {Object} changes - The changes made to the token
     * @param {boolean} forcePan - Force pan/zoom regardless of thresholds
     */
    static async _onCombatantTokensUpdate(tokenDocument, changes, forcePan = false) {
        try {
            const isInitialization = !tokenDocument;

            // Get visible combatant tokens
            let combatTokens = this._getVisibleCombatTokens();

            if (!combatTokens || combatTokens.length === 0) {
                return;
            }

            // If we have a tokenDocument with position changes, update the corresponding token's position
            if (tokenDocument && changes && (changes.x !== undefined || changes.y !== undefined)) {
                combatTokens = combatTokens.map(token => {
                    if (token.id === tokenDocument.id) {
                        const updatedToken = Object.assign({}, token);
                        updatedToken.x = changes.x !== undefined ? changes.x : token.x;
                        updatedToken.y = changes.y !== undefined ? changes.y : token.y;
                        return updatedToken;
                    }
                    return token;
                });
            }

            // Calculate target position (center of combatant tokens in world coordinates)
            const targetPosition = combatTokens.length === 1
                ? this._getTokenCenter(combatTokens[0])
                : this._getGroupCenter(combatTokens);

            if (!targetPosition) return;

            // Calculate zoom based on bounding box + viewport fill
            let finalZoom;
            const fillPercent = this._hotPathSettings.spectatorPartyBoxFill;
            const autoFitZoom = this._calculateAutoFitZoom(combatTokens, fillPercent);

            if (autoFitZoom !== null) {
                finalZoom = autoFitZoom;
            } else {
                finalZoom = canvas.stage?.scale?.x ?? 1.0;
            }

            // When a combatant token moved, always reframe (same as spectator modes)
            const tokenMoved = tokenDocument && changes && (changes.x !== undefined || changes.y !== undefined);
            const shouldPan = forcePan ? true : (isInitialization ? true : tokenMoved || this._shouldPan(targetPosition, combatTokens));

            const currentZoom = canvas.stage?.scale?.x ?? canvas.scene?._viewPosition?.scale ?? 1.0;
            const shouldZoom = Math.abs(currentZoom - finalZoom) > 0.001;

            if (!shouldPan && !shouldZoom) {
                return;
            }

            if (finalZoom !== undefined) {
                if (!Number.isFinite(finalZoom)) {
                    return;
                }
                const min = canvas.scene?._viewPosition?.minScale ?? 0.25;
                const max = canvas.scene?._viewPosition?.maxScale ?? 3.0;
                if (finalZoom < min || finalZoom > max) {
                    finalZoom = Math.max(min, Math.min(max, finalZoom));
                }
            }

            const animationDuration = this._hotPathSettings.animationDuration;
            const panOptions = {
                x: targetPosition.x,
                y: targetPosition.y,
                scale: finalZoom,
                duration: animationDuration,
                easing: "easeInOutCosine"
            };

            await canvas.animatePan(panOptions);

            if (shouldPan) {
                this._lastPanPosition = targetPosition;
                this._lastPanTime = Date.now();
            }
        } catch (error) {
            postConsoleAndNotification(MODULE.NAME, "BroadcastManager: Error following combatant tokens", error, false, false);
        }
    }

    /**
     * Handle token spectator updates (Token Spectator mode) – frame all tokens on the canvas.
     * @param {TokenDocument} tokenDocument - The token document that was updated (or null for init)
     * @param {Object} changes - The changes made to the token
     * @param {boolean} forcePan - Force pan/zoom regardless of thresholds
     */
    static async _onTokenSpectatorUpdate(tokenDocument, changes, forcePan = false) {
        try {
            const isInitialization = !tokenDocument;
            let allTokens = this._getAllVisibleCanvasTokens();

            if (!allTokens || allTokens.length === 0) return;

            if (tokenDocument && changes && (changes.x !== undefined || changes.y !== undefined)) {
                allTokens = allTokens.map((token) => {
                    if (token.id === tokenDocument.id) {
                        return Object.assign({}, token, {
                            x: changes.x !== undefined ? changes.x : token.x,
                            y: changes.y !== undefined ? changes.y : token.y
                        });
                    }
                    return token;
                });
            }

            const targetPosition = allTokens.length === 1
                ? this._getTokenCenter(allTokens[0])
                : this._getGroupCenter(allTokens);
            if (!targetPosition) return;

            const fillPercent = this._hotPathSettings.spectatorPartyBoxFill;
            const autoFitZoom = this._calculateAutoFitZoom(allTokens, fillPercent);
            const finalZoom = autoFitZoom !== null ? autoFitZoom : (canvas.stage?.scale?.x ?? 1.0);

            // When a token moved, always reframe; otherwise respect forcePan, init, or _shouldPan
            const tokenMoved = tokenDocument && changes && (changes.x !== undefined || changes.y !== undefined);
            const shouldPan = forcePan || isInitialization || tokenMoved || this._shouldPan(targetPosition, allTokens);
            const currentZoom = canvas.stage?.scale?.x ?? 1.0;
            const shouldZoom = Math.abs(currentZoom - finalZoom) > 0.001;
            if (!shouldPan && !shouldZoom) return;

            const min = canvas.scene?._viewPosition?.minScale ?? 0.25;
            const max = canvas.scene?._viewPosition?.maxScale ?? 3.0;
            const clampedZoom = Math.max(min, Math.min(max, finalZoom));

            await canvas.animatePan({
                x: targetPosition.x,
                y: targetPosition.y,
                scale: clampedZoom,
                duration: this._hotPathSettings.animationDuration,
                easing: 'easeInOutCosine'
            });

            if (shouldPan) {
                this._lastPanPosition = targetPosition;
                this._lastPanTime = Date.now();
            }
        } catch (error) {
            postConsoleAndNotification(MODULE.NAME, "BroadcastManager: Error in Token Spectator", error, false, false);
        }
    }

    /**
     * Adjust viewport immediately when mode changes
     * @param {string} mode - The new broadcast mode
     */
    static async _adjustViewportForMode(mode) {
        if (!this.isEnabled() || !canvas?.ready) return;

        // Combat and combatant modes require an active combat; switch to fallback if none
        if (mode === 'combat' || mode === 'combatant') {
            if (!game.combat) {
                const fallback = getSettingSafely(MODULE.ID, 'broadcastCombatEndMode', 'spectator');
                await this._setBroadcastMode(fallback);
                return;
            }
        }
        
        if (mode === 'spectator') {
            // Only adjust viewport for broadcast user (cameraman)
            if (this._isBroadcastUser()) {
                // Immediately pan/zoom to party tokens
                await this._onTokenUpdate(null, {});
            }
        } else if (mode === 'combat') {
            // Only adjust viewport for broadcast user (cameraman)
            if (this._isBroadcastUser()) {
                // Immediately pan/zoom to combatant tokens
                await this._onCombatantTokensUpdate(null, {}, true);
            }
        } else if (mode === 'tokenspectator') {
            if (this._isBroadcastUser()) {
                await this._onTokenSpectatorUpdate(null, {}, true);
            }
        } else if (mode === 'combatspectator') {
            // Backwards compat: old Combat Spectator → same as Token Spectator
            if (this._isBroadcastUser()) {
                await this._onTokenSpectatorUpdate(null, {}, true);
            }
        } else if (mode === 'combatant') {
            // Only adjust viewport for broadcast user (cameraman)
            if (this._isBroadcastUser()) {
                // Immediately pan to current combatant if combat is active
                const combat = game.combat;
                if (combat) {
                    this._onCombatUpdate(combat, true);
                }
            }
        } else if (mode === 'gmview') {
            // For GM view, the GM client sends initial sync, cameraman receives it
            // GM: trigger initial sync (not the broadcast user, so early return doesn't apply)
            if (game.user.isGM) {
                // The _startGMViewportMonitoring will send initial state
                // But we should also trigger it here if not already monitoring
                if (!this._gmPanHandler) {
                    this._startGMViewportMonitoring();
                } else {
                    // Already monitoring, just send current viewport immediately
                    const view = canvas.scene?._viewPosition ?? canvas.pan ?? { x: 0, y: 0, scale: 1 };
                    const centerX = view.x ?? 0;
                    const centerY = view.y ?? 0;
                    const currentScale = view.scale ?? canvas.stage?.scale?.x ?? 1;
                    this._sendGMViewportSync({ x: centerX, y: centerY, scale: currentScale });
                }
            }
            // Cameraman: just wait for socket message (handled by socket handler)
        } else if (mode === 'mapview') {
            // Map View mode: broadcast user fits scene to viewport
            if (this._isBroadcastUser()) {
                await this._applyMapView();
            }
        } else if (typeof mode === 'string' && mode.startsWith('playerview-')) {
            // For player view, the player client sends initial sync, cameraman receives it
            // Player: trigger initial sync (not the broadcast user, so early return doesn't apply)
            if (mode === 'playerview-follow') {
                if (this._isBroadcastUser()) {
                    const followTokenId = getSettingSafely(MODULE.ID, 'broadcastFollowTokenId', '');
                    await this._onFollowTokenUpdate(null, followTokenId, true);
                }
                return;
            }
            const userId = mode.replace('playerview-', '');
            if (game.user.id === userId) {
                // The _startPlayerViewportMonitoring will send initial state
                // But we should also trigger it here if not already monitoring
                if (!this._playerPanHandlers.has(userId)) {
                    this._startPlayerViewportMonitoring(userId);
                } else {
                    // Already monitoring, just send current viewport immediately
                    const view = canvas.scene?._viewPosition ?? canvas.pan ?? { x: 0, y: 0, scale: 1 };
                    const centerX = view.x ?? 0;
                    const centerY = view.y ?? 0;
                    const currentScale = view.scale ?? canvas.stage?.scale?.x ?? 1;
                    this._sendPlayerViewportSync(userId, { x: centerX, y: centerY, scale: currentScale });
                }
            }
            // Cameraman: just wait for socket message (handled by socket handler)
        }
        // Manual mode: do nothing (manual camera control)
    }

    /**
     * Handle combat turn update (combat mode)
     * @param {Combat} combat - The combat instance
     */
    static _onCombatUpdate(combat, forcePan = false) {
        try {
            if (!this._isBroadcastUser()) return;
            if (!this.isEnabled()) return;
            if (!canvas?.ready) return;
            if (getSettingSafely(MODULE.ID, 'broadcastMode', 'spectator') !== 'combatant') return;
            if (!combat) return;
            
            const currentCombatant = combat.combatants.get(combat.current.combatantId);
            if (!currentCombatant) return;
            
            const token = currentCombatant.token;
            if (!token) return;
            const canvasToken = canvas.tokens.get(token.id);
            if (!canvasToken) return;

            const center = this._getTokenCenter(canvasToken);
            if (!center) return;

            const ownerId = this._getCombatantOwnerUserId(currentCombatant);
            const targetTokens = this._getCombatTargetsForUser(ownerId);
            const tokensToFrame = [canvasToken, ...targetTokens].filter((value, index, self) => {
                const tokenId = value?.id;
                return tokenId && self.findIndex(t => t?.id === tokenId) === index;
            });

            const gridSize = canvas.grid?.size || 100;
            const minBoxSize = 3 * gridSize;

            const bbox = this._calculateTokenBoundingBox(tokensToFrame);
            if (!bbox) return;

            const minX = Math.min(bbox.minX, center.x - (minBoxSize / 2));
            const maxX = Math.max(bbox.maxX, center.x + (minBoxSize / 2));
            const minY = Math.min(bbox.minY, center.y - (minBoxSize / 2));
            const maxY = Math.max(bbox.maxY, center.y + (minBoxSize / 2));

            const frameCenter = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
            const shouldPan = forcePan ? true : this._shouldPan(frameCenter, tokensToFrame);
            if (!shouldPan) return;

            const fillPercent = this._hotPathSettings.combatViewFill;
            const boxWidth = maxX - minX;
            const boxHeight = maxY - minY;
            const fillZoom = this._calculateViewportFillZoom(boxWidth, boxHeight, fillPercent);
            const finalZoom = fillZoom ?? (canvas.stage?.scale?.x ?? 1.0);
            const duration = this._hotPathSettings.animationDuration;

            canvas.animatePan({
                x: frameCenter.x,
                y: frameCenter.y,
                scale: finalZoom,
                duration,
                easing: 'easeInOutCosine'
            });
            
        } catch (error) {
            postConsoleAndNotification(MODULE.NAME, "BroadcastManager: Error following combatant", error, false, false);
        }
    }

    /**
     * Follow a specific token in playerview-follow mode.
     * @param {TokenDocument|null} tokenDocument - Token document to follow
     * @param {string|null} tokenIdOverride - Token ID to follow
     */
    static async _onFollowTokenUpdate(tokenDocument, tokenIdOverride = null, forcePan = false) {
        try {
            if (!this._isBroadcastUser()) return;
            if (!this.isEnabled()) return;
            if (!canvas?.ready) return;
            if (getSettingSafely(MODULE.ID, 'broadcastMode', 'spectator') !== 'playerview-follow') return;

            const tokenId = tokenIdOverride || tokenDocument?.id;
            if (!tokenId) return;

            const canvasToken = canvas.tokens.get(tokenId);
            if (!canvasToken) return;

            const center = this._getTokenCenter(canvasToken);
            if (!center) return;
            const shouldPan = forcePan ? true : this._shouldPan({ x: center.x, y: center.y }, [canvasToken]);
            if (!shouldPan) return;

            const fillPercent = this._hotPathSettings.followViewFill;
            const followBoxGridSize = 3;
            const fixedZoom = this._calculateFixedBoxZoom(followBoxGridSize, fillPercent);
            const finalZoom = fixedZoom ?? (canvas.stage?.scale?.x ?? 1.0);

            const duration = this._hotPathSettings.animationDuration;
            await canvas.animatePan({
                x: center.x,
                y: center.y,
                scale: finalZoom,
                duration,
                easing: 'easeInOutCosine'
            });
        } catch (error) {
            postConsoleAndNotification(MODULE.NAME, "BroadcastManager: Error following token (follow mode)", error, false, false);
        }
    }

    /**
     * Fit the current scene to the viewport (broadcast user only).
     */
    static async _applyMapView() {
        try {
            if (!this._isBroadcastUser()) return;
            if (!this.isEnabled()) return;
            if (!canvas?.ready) return;

            const dims = canvas.scene?.dimensions;
            if (!dims) return;

            const { width: viewWidth, height: viewHeight } = this._getViewportCssSize();
            if (!viewWidth || !viewHeight) return;

            const rect = dims.sceneRect || { x: 0, y: 0, width: dims.width, height: dims.height };
            const centerX = rect.x + (rect.width / 2);
            const centerY = rect.y + (rect.height / 2);
            const scale = Math.min(viewWidth / rect.width, viewHeight / rect.height) * 0.95;

            const duration = this._hotPathSettings.animationDuration;
            await canvas.animatePan({
                x: centerX,
                y: centerY,
                scale,
                duration,
                easing: 'easeInOutCosine'
            });
        } catch (error) {
            postConsoleAndNotification(MODULE.NAME, "BroadcastManager: Error applying map view", error, false, false);
        }
    }

    /**
     * Count visible placeables for the broadcast user (O(N); used to validate Token Spectator cache).
     */
    static _countVisiblePlaceablesForBroadcastUser(broadcastUser) {
        if (!canvas?.tokens?.placeables) return 0;
        let n = 0;
        for (const token of canvas.tokens.placeables) {
            if (this._isTokenVisibleToBroadcastUser(token, broadcastUser)) n++;
        }
        return n;
    }

    /**
     * Get all party tokens visible to the broadcast user
     * @returns {Array} Array of visible party token placeables
     */
    static _getVisiblePartyTokens() {
        if (!canvas || !canvas.tokens) return [];

        const broadcastUser = this._getBroadcastUser();
        if (!broadcastUser) return [];

        const sceneId = canvas.scene?.id;
        if (!sceneId) return [];

        const cache = this._partyTokensCache;
        if (cache && cache.sceneId === sceneId && cache.userId === broadcastUser.id && cache.tokenIds?.length) {
            const out = [];
            let ok = true;
            for (const id of cache.tokenIds) {
                const token = canvas.tokens.get(id);
                if (!token || !this._isPartyTokenForBroadcastUser(token, broadcastUser)) {
                    ok = false;
                    break;
                }
                out.push(token);
            }
            if (ok && out.length === cache.tokenIds.length) {
                return out;
            }
        }

        const tokens = canvas.tokens.placeables.filter((token) => this._isPartyTokenForBroadcastUser(token, broadcastUser));
        const tokenIds = tokens.map((t) => t.id).sort();
        this._partyTokensCache = { sceneId, userId: broadcastUser.id, tokenIds };
        return tokens;
    }

    /**
     * Get combatant tokens visible to the broadcast user on the current scene.
     * @returns {Array} Array of visible combatant token placeables
     */
    static _getVisibleCombatTokens() {
        if (!canvas?.tokens) return [];
        const combat = game.combat;
        if (!combat?.combatants?.size) return [];

        const broadcastUser = this._getBroadcastUser();
        if (!broadcastUser) return [];

        const sceneId = canvas.scene?.id;
        if (!sceneId) return [];

        const rosterKey = this._combatRosterKey(combat);
        const cache = this._combatTokensCache;
        if (
            cache
            && cache.sceneId === sceneId
            && cache.userId === broadcastUser.id
            && cache.rosterKey === rosterKey
            && cache.tokenIds?.length
        ) {
            const out = [];
            let ok = true;
            for (const id of cache.tokenIds) {
                const token = canvas.tokens.get(id);
                if (!token || !this._isTokenVisibleToBroadcastUser(token, broadcastUser)) {
                    ok = false;
                    break;
                }
                out.push(token);
            }
            if (ok && out.length === cache.tokenIds.length) {
                return out;
            }
        }

        const tokens = [];
        for (const combatant of combat.combatants) {
            const tokenDoc = combatant?.token;
            if (!tokenDoc) continue;
            if (tokenDoc.scene?.id && canvas.scene?.id && tokenDoc.scene.id !== canvas.scene.id) continue;

            const token = canvas.tokens.get(tokenDoc.id);
            if (!token) continue;

            if (token.document?.testUserVisibility) {
                if (!token.document.testUserVisibility(broadcastUser)) continue;
            } else if (!token.visible) {
                continue;
            }

            tokens.push(token);
        }

        const tokenIds = tokens.map((t) => t.id).sort();
        this._combatTokensCache = { sceneId, userId: broadcastUser.id, rosterKey, tokenIds };
        return tokens;
    }

    /**
     * Get all tokens on the canvas visible to the broadcast user (for Token Spectator mode).
     * @returns {Array} Array of visible token placeables
     */
    static _getAllVisibleCanvasTokens() {
        if (!canvas?.tokens?.placeables) return [];
        const broadcastUser = this._getBroadcastUser();
        if (!broadcastUser) return [];

        const sceneId = canvas.scene?.id;
        if (!sceneId) return [];

        const placeablesCount = canvas.tokens.placeables.length;
        const cache = this._allCanvasTokensCache;
        if (
            cache
            && cache.sceneId === sceneId
            && cache.userId === broadcastUser.id
            && cache.placeablesCount === placeablesCount
            && cache.tokenIds?.length
        ) {
            const visibleCount = this._countVisiblePlaceablesForBroadcastUser(broadcastUser);
            if (visibleCount === cache.visibleCount) {
                const out = [];
                let ok = true;
                for (const id of cache.tokenIds) {
                    const token = canvas.tokens.get(id);
                    if (!token || !this._isTokenVisibleToBroadcastUser(token, broadcastUser)) {
                        ok = false;
                        break;
                    }
                    out.push(token);
                }
                if (ok && out.length === cache.tokenIds.length) {
                    return out;
                }
            }
        }

        const tokens = canvas.tokens.placeables.filter((token) => this._isTokenVisibleToBroadcastUser(token, broadcastUser));
        const tokenIds = tokens.map((t) => t.id).sort();
        const visibleCount = tokens.length;
        this._allCanvasTokensCache = {
            sceneId,
            userId: broadcastUser.id,
            placeablesCount,
            visibleCount,
            tokenIds
        };
        return tokens;
    }

    /**
     * Get the broadcast user object
     * @returns {User|null} The broadcast user, or null if not found
     */
    static _getBroadcastUser() {
        const settingValue = getSettingSafely(MODULE.ID, 'broadcastUserId', '') || '';
        if (!settingValue) return null;
        
        // Try to match by ID first
        const byId = game.users.get(settingValue);
        if (byId) return byId;
        
        // Try to match by name
        const byName = game.users.find(u => u.name?.toLowerCase() === settingValue.toLowerCase());
        if (byName) return byName;
        
        return null;
    }

    static _shouldTrackBroadcastWindows() {
        return this.isEnabled() && this._isBroadcastUser();
    }

    static async _emitBroadcastWindowOpened() {
        try {
            if (!this.isEnabled()) return;
            if (!this._isBroadcastUser()) return;
            if (!this._blacksmith?.sockets) return;
            await this._waitForSocketsReady();
            await this._blacksmith.sockets.emit('broadcast.windowOpened', {
                sourceUserId: game.user.id
            });
        } catch (error) {
            postConsoleAndNotification(MODULE.NAME, "BroadcastManager: Failed to emit window opened", { error }, true, false);
        }
    }

    static async _emitCombatTargets(userId) {
        try {
            if (!this.isBroadcastActive()) return;
            const targetIds = Array.from(game.user?.targets || []).map(t => t?.id).filter(Boolean);
            if (!this._blacksmith?.sockets) return;
            await this._waitForSocketsReady();
            await this._blacksmith.sockets.emit('broadcast.combatTargets', {
                userId,
                targetIds
            });
        } catch (error) {
            postConsoleAndNotification(MODULE.NAME, "BroadcastManager: Failed to emit combat targets", { error }, true, false);
        }
    }

    static _getCombatantOwnerUserId(combatant) {
        const token = combatant?.token;
        const actor = token?.actor;
        if (!actor) return null;
        const ownership = token?.document?.ownership || actor.ownership || {};
        const OWNER_LEVEL = CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
        const owners = Object.entries(ownership)
            .filter(([, level]) => level === OWNER_LEVEL)
            .map(([userId]) => game.users.get(userId))
            .filter(Boolean);
        const activeNonGm = owners.find(user => user.active && !user.isGM);
        if (activeNonGm) return activeNonGm.id;
        const activeGm = owners.find(user => user.active && user.isGM);
        return activeGm?.id || null;
    }

    static _getCombatTargetsForUser(userId) {
        if (!userId) return [];
        const targetIds = this._combatTargetIdsByUser.get(userId);
        if (!targetIds?.size) return [];
        return Array.from(targetIds)
            .map(id => canvas.tokens.get(id))
            .filter(Boolean);
    }

    static async _closeAllWindows() {
        const windows = this._getOpenWindows();
        postConsoleAndNotification(MODULE.NAME, "BroadcastManager: Closing all windows on cameraman", {
            count: windows.length,
            windows: windows.map(app => ({
                appId: app?.appId,
                name: app?.constructor?.name,
                title: app?.title
            }))
        }, true, false);
        for (const app of windows) {
            if (!app) continue;
            try {
                if (typeof app.close === 'function') {
                    await app.close({ animate: false });
                } else if (typeof app.render === 'function') {
                    app.render(false);
                }
            } catch (error) {
                postConsoleAndNotification(MODULE.NAME, "BroadcastManager: Failed to close window", { appId: app?.appId, error }, true, false);
            }
        }
    }

    static _getOpenWindows() {
        const windows = [];
        const seen = new Set();

        for (const app of Object.values(ui.windows || {})) {
            if (!app) continue;
            const key = app.appId ?? app;
            if (seen.has(key)) continue;
            seen.add(key);
            windows.push(app);
        }

        const v2Instances = foundry?.applications?.instances;
        if (v2Instances && typeof v2Instances.values === 'function') {
            for (const app of v2Instances.values()) {
                if (!app) continue;
                const key = app.appId ?? app;
                if (seen.has(key)) continue;
                seen.add(key);
                windows.push(app);
            }
        }

        return windows;
    }

    static _registerBroadcastWindowHooks() {
        if (this._broadcastWindowHooksRegistered) return;
        this._broadcastWindowHooksRegistered = true;
        console.log(`[${MODULE.NAME}] BroadcastManager: Registering broadcast window hooks`);

this._blacksmith.HookManager.registerHook({
            name: 'renderImagePopout',
            description: 'BroadcastManager: Auto-close images after share',
            context: 'broadcast-windows',
            priority: 5,
            key: 'broadcast-windows-image',
            callback: () => {
                //  ------------------- BEGIN - HOOKMANAGER CALLBACK -------------------
                this._emitBroadcastWindowOpened();
                //  ------------------- END - HOOKMANAGER CALLBACK ---------------------
            }
        });

this._blacksmith.HookManager.registerHook({
            name: 'renderJournalSheet',
            description: 'BroadcastManager: Auto-close journals after share',
            context: 'broadcast-windows',
            priority: 5,
            key: 'broadcast-windows-journal',
            callback: () => {
                //  ------------------- BEGIN - HOOKMANAGER CALLBACK -------------------
                this._emitBroadcastWindowOpened();
                //  ------------------- END - HOOKMANAGER CALLBACK ---------------------
            }
        });

this._blacksmith.HookManager.registerHook({
            name: 'renderJournalPageSheet',
            description: 'BroadcastManager: Auto-close journals after share (page view)',
            context: 'broadcast-windows',
            priority: 5,
            key: 'broadcast-windows-journal-page',
            callback: () => {
                //  ------------------- BEGIN - HOOKMANAGER CALLBACK -------------------
                this._emitBroadcastWindowOpened();
                //  ------------------- END - HOOKMANAGER CALLBACK ---------------------
            }
        });

this._blacksmith.HookManager.registerHook({
            name: 'renderJournalEntrySheet',
            description: 'BroadcastManager: Auto-close journals after share (entry sheet)',
            context: 'broadcast-windows',
            priority: 5,
            key: 'broadcast-windows-journal-entry',
            callback: () => {
                //  ------------------- BEGIN - HOOKMANAGER CALLBACK -------------------
                this._emitBroadcastWindowOpened();
                //  ------------------- END - HOOKMANAGER CALLBACK ---------------------
            }
        });
    }

    /**
     * Get reliable world-space center for a single token
     * Uses Token.center if available (handles size, scale, grid type automatically)
     * Falls back to manual calculation if needed
     * 
     * @param {Token} token - Token placeable object
     * @returns {Object|null} Center position {x, y} in world coordinates, or null if invalid
     */
    static _getTokenCenter(token) {
        if (!token) return null;
        
        // Prefer Token.center property if available (most reliable)
        if (token.center) {
            return { x: token.center.x, y: token.center.y };
        }
        
        // Fallback: manual calculation (accounts for texture scale if present)
        const size = canvas.dimensions?.size || canvas.grid?.size || 100;
        const w = (token.width ?? 1) * size;
        const h = (token.height ?? 1) * size;
        
        // Account for texture scale if present (common for "slightly bigger" tokens)
        const sx = token.texture?.scaleX ?? 1;
        const sy = token.texture?.scaleY ?? 1;
        
        return {
            x: token.x + (w * sx) / 2,
            y: token.y + (h * sy) / 2
        };
    }

    /**
     * Calculate center point of multiple tokens using bounding box of centers
     * More stable than averaging when tokens are spread out
     * 
     * @param {Array} tokens - Array of token placeables
     * @returns {Object|null} Center position {x, y} in world coordinates, or null if no tokens
     */
    static _getGroupCenter(tokens) {
        if (!tokens || tokens.length === 0) return null;
        
        // Get centers for all tokens
        const centers = tokens.map(t => this._getTokenCenter(t)).filter(Boolean);
        if (centers.length === 0) return null;
        
        // Bounding box center (more stable than average when tokens are spread)
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const c of centers) {
            minX = Math.min(minX, c.x);
            minY = Math.min(minY, c.y);
            maxX = Math.max(maxX, c.x);
            maxY = Math.max(maxY, c.y);
        }
        
        return {
            x: (minX + maxX) / 2,
            y: (minY + maxY) / 2
        };
    }

    /**
     * Calculate bounding box of all tokens including their actual size
     * @param {Array} tokens - Array of token placeables
     * @returns {Object|null} Bounding box {minX, minY, maxX, maxY, width, height} or null
     */
    static _calculateTokenBoundingBox(tokens) {
        if (!tokens || tokens.length === 0) return null;
        
        // Use canvas.grid.size for consistency (this is pixels per grid square)
        const gridSize = canvas.grid?.size || 100;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        
        for (const token of tokens) {
            // Get token dimensions in world coordinates
            // Use token.document.width/height (in grid units) not token.width/height
            // Multiply by grid size to get pixels
            const tokenWidthGrid = token.document?.width ?? token.width ?? 1;
            const tokenHeightGrid = token.document?.height ?? token.height ?? 1;
            
            const tokenWidthPixels = tokenWidthGrid * gridSize;
            const tokenHeightPixels = tokenHeightGrid * gridSize;
            
            // Account for texture scale if present
            const sx = token.texture?.scaleX ?? 1;
            const sy = token.texture?.scaleY ?? 1;
            
            const tokenWidth = tokenWidthPixels * sx;
            const tokenHeight = tokenHeightPixels * sy;
            
            // Token bounds (token.x, token.y are top-left in world coordinates/pixels)
            const tokenMinX = token.x;
            const tokenMinY = token.y;
            const tokenMaxX = token.x + tokenWidth;
            const tokenMaxY = token.y + tokenHeight;
            
            minX = Math.min(minX, tokenMinX);
            minY = Math.min(minY, tokenMinY);
            maxX = Math.max(maxX, tokenMaxX);
            maxY = Math.max(maxY, tokenMaxY);
            
        }
        
        const bbox = {
            minX: minX,
            minY: minY,
            maxX: maxX,
            maxY: maxY,
            width: maxX - minX,
            height: maxY - minY
        };
        
        return bbox;
    }

    /**
     * Reload cached values for hot camera paths (must match `settings.js` defaults).
     */
    static _refreshHotPathSettingsCache() {
        const h = this._hotPathSettings;
        h.followDistanceThreshold = getSettingSafely(MODULE.ID, 'broadcastFollowDistanceThreshold', 1);
        h.followThrottleMs = getSettingSafely(MODULE.ID, 'broadcastFollowThrottleMs', 100);
        h.animationDuration = getSettingSafely(MODULE.ID, 'broadcastAnimationDuration', 500);
        h.spectatorPartyBoxFill = getSettingSafely(MODULE.ID, 'broadcastSpectatorPartyBoxFill', 70);
        h.combatViewFill = getSettingSafely(MODULE.ID, 'broadcastCombatViewFill', 35);
        h.followViewFill = getSettingSafely(MODULE.ID, 'broadcastFollowViewFill', 20);
    }

    static _invalidateViewportCssCache() {
        this._viewportCssCache = null;
    }

    /** Clear cached visible token lists and auto-fit zoom (scene/combat/membership changes). */
    static _invalidateVisibleTokenListCaches() {
        this._partyTokensCache = null;
        this._combatTokensCache = null;
        this._allCanvasTokensCache = null;
        this._autoFitZoomCache = null;
    }

    static _invalidateAutoFitZoomCache() {
        this._autoFitZoomCache = null;
    }

    /**
     * True if token update may change which tokens are visible / party membership (not pure move).
     * @param {object} [changes] - `updateToken` changes object
     */
    static _tokenChangesMayChangeVisibleMembership(changes) {
        if (!changes || typeof changes !== 'object') return false;
        for (const k of Object.keys(changes)) {
            if (k === 'x' || k === 'y' || k === 'elevation' || k === 'sort' || k === 'rotation') continue;
            return true;
        }
        return false;
    }

    /** Sorted combat token document ids on the active canvas scene (roster signature). */
    static _combatRosterKey(combat) {
        if (!combat?.combatants) return '';
        const sceneId = canvas?.scene?.id;
        const ids = [];
        for (const c of combat.combatants) {
            const td = c?.token;
            if (!td) continue;
            if (td.scene?.id && sceneId && td.scene.id !== sceneId) continue;
            ids.push(td.id);
        }
        ids.sort();
        return ids.join(',');
    }

    static _isPartyTokenForBroadcastUser(token, broadcastUser) {
        const actor = token.actor;
        if (!actor || actor.type !== 'character' || !actor.hasPlayerOwner) return false;
        if (token.document?.testUserVisibility) {
            return !!token.document.testUserVisibility(broadcastUser);
        }
        return token.visible;
    }

    static _isTokenVisibleToBroadcastUser(token, broadcastUser) {
        if (token.document?.testUserVisibility) {
            return !!token.document.testUserVisibility(broadcastUser);
        }
        return token.visible;
    }

    /** Geometry signature for bbox / auto-fit zoom caching (shallow copies with overridden x/y OK). */
    static _tokenGeometrySignature(tokens) {
        if (!tokens?.length) return '';
        return tokens.map((t) => {
            const tw = t.document?.width ?? t.width ?? 1;
            const th = t.document?.height ?? t.height ?? 1;
            const sx = t.texture?.scaleX ?? 1;
            const sy = t.texture?.scaleY ?? 1;
            return `${t.id}:${t.x}:${t.y}:${tw}:${th}:${sx}:${sy}`;
        }).join('|');
    }

    /**
     * Get viewport size in CSS pixels (independent of renderer DPR).
     * Cached while PIXI renderer dimensions/resolution are unchanged (avoids repeated `getBoundingClientRect` in one pan/zoom evaluation).
     * @returns {Object} { width, height }
     */
    static _getViewportCssSize() {
        const renderer = canvas?.app?.renderer;
        const rkey = renderer?.width && renderer?.height
            ? `${renderer.width}|${renderer.height}|${renderer.resolution ?? window.devicePixelRatio ?? 1}`
            : 'nor';

        if (this._viewportCssCache?.rkey === rkey) {
            return { width: this._viewportCssCache.width, height: this._viewportCssCache.height };
        }

        try {
            const view = canvas?.app?.view;
            if (view?.getBoundingClientRect) {
                const rect = view.getBoundingClientRect();
                if (rect?.width && rect?.height) {
                    const width = rect.width;
                    const height = rect.height;
                    this._viewportCssCache = { width, height, rkey };
                    return { width, height };
                }
            }
        } catch (error) {
            // Ignore and fall through to renderer/window sizing
        }

        if (renderer?.width && renderer?.height) {
            const resolution = renderer.resolution || window.devicePixelRatio || 1;
            const width = renderer.width / resolution;
            const height = renderer.height / resolution;
            this._viewportCssCache = { width, height, rkey };
            return { width, height };
        }

        const width = window.innerWidth || 1920;
        const height = window.innerHeight || 1080;
        this._viewportCssCache = { width, height, rkey };
        return { width, height };
    }

    /**
     * Calculate zoom level for a box to fill a percentage of the viewport.
     * @param {number} boxWidth - Box width in pixels
     * @param {number} boxHeight - Box height in pixels
     * @param {number} fillPercent - Percent of viewport the box should fill (0-100)
     * @returns {number|null} Calculated zoom level or null if unable to calculate
     */
    static _calculateViewportFillZoom(boxWidth, boxHeight, fillPercent) {
        if (!boxWidth || !boxHeight || boxWidth <= 0 || boxHeight <= 0) return null;
        const { width: viewportWidth, height: viewportHeight } = this._getViewportCssSize();
        const clampedFill = Math.max(1, Math.min(100, fillPercent));
        const fillFraction = clampedFill / 100;

        const zoomX = (viewportWidth * fillFraction) / boxWidth;
        const zoomY = (viewportHeight * fillFraction) / boxHeight;
        const zoom = Math.min(zoomX, zoomY);

        const min = canvas.scene?._viewPosition?.minScale ?? 0.25;
        const max = canvas.scene?._viewPosition?.maxScale ?? 3.0;
        const finalZoom = Math.max(min, Math.min(max, zoom));

        return finalZoom;
    }

    /**
     * Calculate zoom level to fit party bounding box based on viewport fill percent
     * @param {Array} tokens - Array of token placeables
     * @param {number} fillPercent - Percent of viewport the box should fill (0-100)
     * @returns {number|null} Calculated zoom level or null if unable to calculate
     */
    static _calculateAutoFitZoom(tokens, fillPercent) {
        if (!tokens || tokens.length === 0) return null;

        const renderer = canvas?.app?.renderer;
        const vk = renderer?.width && renderer?.height
            ? `${renderer.width}|${renderer.height}|${renderer.resolution ?? 1}`
            : 'nor';
        const geomSig = this._tokenGeometrySignature(tokens);
        const sig = `${geomSig}@@${vk}`;
        const c = this._autoFitZoomCache;
        if (c && c.sig === sig && c.fillPercent === fillPercent) {
            return c.zoom;
        }

        const bbox = this._calculateTokenBoundingBox(tokens);
        if (!bbox || bbox.width <= 0 || bbox.height <= 0) {
            return null;
        }

        const zoom = this._calculateViewportFillZoom(bbox.width, bbox.height, fillPercent);
        this._autoFitZoomCache = { sig, fillPercent, zoom };
        return zoom;
    }

    /**
     * Calculate zoom level to fit a fixed-size box (in grid units) based on viewport fill percent.
     * @param {number} boxSizeGrid - Box size in grid units (assumes square)
     * @param {number} fillPercent - Percent of viewport the box should fill (0-100)
     * @returns {number|null} Calculated zoom level or null if unable to calculate
     */
    static _calculateFixedBoxZoom(boxSizeGrid, fillPercent) {
        if (!boxSizeGrid || boxSizeGrid <= 0) return null;
        const gridSize = canvas.grid?.size || 100;
        const boxPixels = boxSizeGrid * gridSize;
        return this._calculateViewportFillZoom(boxPixels, boxPixels, fillPercent);
    }

    /**
     * Check if camera should pan based on distance threshold and throttle
     * @param {Object} newPosition - New position {x, y}
     * @param {Array} partyTokens - Optional array of party tokens to check if they're off-screen
     * @returns {boolean} True if should pan
     */
    static _shouldPan(newPosition, partyTokens = null) {
        const { followDistanceThreshold: distanceThreshold, followThrottleMs: throttleMs } = this._hotPathSettings;
        
        // Check if any party tokens are off-screen or near edge - always pan in this case
        if (partyTokens && partyTokens.length > 0) {
            const { width: viewportWidth, height: viewportHeight } = this._getViewportCssSize();
            const currentZoom = canvas.stage?.scale?.x ?? 1.0;
            
            // Viewport bounds in world coordinates
            const viewportLeft = canvas.pan?.x ?? 0;
            const viewportTop = canvas.pan?.y ?? 0;
            const viewportRight = viewportLeft + (viewportWidth / currentZoom);
            const viewportBottom = viewportTop + (viewportHeight / currentZoom);
            
            // Check if any token is outside viewport (with small margin for edge detection)
            const margin = canvas.grid.size * 2; // 2 grid units margin
            for (const token of partyTokens) {
                const tokenCenter = this._getTokenCenter(token);
                if (!tokenCenter) continue;
                
                // Check if token is outside viewport bounds (with margin)
                if (tokenCenter.x < (viewportLeft - margin) || 
                    tokenCenter.x > (viewportRight + margin) ||
                    tokenCenter.y < (viewportTop - margin) || 
                    tokenCenter.y > (viewportBottom + margin)) {
                    return true; // Force pan if token is off-screen
                }
            }
        }
        
        // Check distance threshold first (if we have a last position)
        if (this._lastPanPosition.x !== null && this._lastPanPosition.y !== null) {
            const distance = Math.sqrt(
                Math.pow(newPosition.x - this._lastPanPosition.x, 2) +
                Math.pow(newPosition.y - this._lastPanPosition.y, 2)
            );
            
            // Convert pixels to grid units
            const gridUnits = distance / canvas.grid.size;
            
            // If token hasn't moved enough, don't pan
            if (gridUnits < distanceThreshold) {
                return false;
            }
            
            // If token has moved significantly (more than 2x threshold), bypass throttle
            // Reduced from 3x to 2x for more responsive following during long drags
            if (gridUnits > (distanceThreshold * 2)) {
                return true; // Bypass throttle for large movements
            }
        }
        
        // Check throttle (time-based) for normal movements
        const now = Date.now();
        if (now - this._lastPanTime < throttleMs) {
            return false;
        }
        
        return true;
    }

    /**
     * Apply auto-fit zoom to show all tokens
     * @param {Array} tokens - Array of token placeables
     */
    static _applyAutoFitZoom(tokens) {
        try {
            if (!tokens || tokens.length === 0) return;
            
            // Calculate bounds of all tokens
            let minX = Infinity;
            let minY = Infinity;
            let maxX = -Infinity;
            let maxY = -Infinity;
            
            tokens.forEach(token => {
                const tokenWidth = token.width * canvas.grid.size;
                const tokenHeight = token.height * canvas.grid.size;
                minX = Math.min(minX, token.x);
                minY = Math.min(minY, token.y);
                maxX = Math.max(maxX, token.x + tokenWidth);
                maxY = Math.max(maxY, token.y + tokenHeight);
            });
            
            // Add padding (20% margin)
            const padding = Math.max(maxX - minX, maxY - minY) * 0.2;
            minX -= padding;
            minY -= padding;
            maxX += padding;
            maxY += padding;
            
            // Calculate zoom to fit bounds
            const canvasWidth = canvas.scene.width * canvas.grid.size;
            const canvasHeight = canvas.scene.height * canvas.grid.size;
            const boundsWidth = maxX - minX;
            const boundsHeight = maxY - minY;
            
            const zoomX = canvasWidth / boundsWidth;
            const zoomY = canvasHeight / boundsHeight;
            const zoom = Math.min(zoomX, zoomY, 1.0); // Don't zoom in beyond 1.0
            
            if (zoom > 0 && zoom !== canvas.stage.scale.x) {
                // FoundryVTT v12+: Use canvas.stage.scale to set zoom
                if (canvas.stage && canvas.stage.scale) {
                    canvas.stage.scale.set(zoom, zoom);
                }
            }
            
        } catch (error) {
            postConsoleAndNotification(MODULE.NAME, "BroadcastManager: Error applying auto-fit zoom", error, false, false);
        }
    }

    /**
     * Check if the current user (or specified user) is the broadcast user
     * @param {User} user - Optional user to check (defaults to current user)
     * @returns {boolean} True if user is the broadcast user
     */
    static _isBroadcastUser(user) {
        if (!user) user = game.user;
        const settingValue = getSettingSafely(MODULE.ID, 'broadcastUserId', '') || '';
        return matchUserBySetting(user, settingValue);
    }

    /**
     * Check if broadcast feature is enabled
     * @returns {boolean} True if broadcast is enabled
     */
    static isEnabled() {
        return getSettingSafely(MODULE.ID, 'enableBroadcast', false) === true;
    }

    /**
     * Check if the designated broadcast user (cameraman) is currently connected.
     * Used so we do not send to or consider broadcast "active" when cameraman is offline.
     * @returns {boolean} True if broadcast user exists and has an active connection
     */
    static _isBroadcastUserConnected() {
        const user = this._getBroadcastUser();
        return user ? (user.active === true) : false;
    }

    /**
     * Check if broadcast is effectively active: enabled and cameraman is connected.
     * Use this when sending to the cameraman or when treating broadcast as "on" from the GM side.
     * On the cameraman client, this equals isEnabled() when they are the broadcast user.
     * @returns {boolean} True if broadcast is enabled and cameraman is online
     */
    static isBroadcastActive() {
        return this.isEnabled() && this._isBroadcastUserConnected();
    }

    /**
     * If broadcast is not enabled, show a notification and return true (caller should return).
     * @returns {boolean} True if not enabled (notification was shown), false if enabled
     */
    static _warnIfNotEnabled() {
        if (this.isEnabled()) return false;
        const msg = game.i18n?.localize?.('coffee-pub-herald.notification-not-enabled') ?? 'Broadcast is not enabled.';
        ui.notifications?.info?.(msg);
        return true;
    }

    // ==================================================================
    // ===== PLAYER VIEWPORT TRACKING ==================================
    // ==================================================================

    static _playerPanHandlers = new Map(); // userId -> handler function
    static _playerDebounces = new Map(); // userId -> timeout

    /**
     * Get party tokens with their owner user information
     * @returns {Array} Array of {token, userId, user, actor} objects
     */
    static _getPartyTokensWithUsers() {
        if (!canvas || !canvas.tokens) return [];
        
        const resultsByUser = new Map();
        const addResult = (userId, data) => {
            if (!userId || resultsByUser.has(userId)) return;
            resultsByUser.set(userId, data);
        };
        const OWNER_LEVEL = CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
        const pickActiveOwner = (ownership) => {
            const entries = Object.entries(ownership || {})
                .filter(([userId, level]) => level === OWNER_LEVEL)
                .filter(([userId]) => {
                    const user = game.users.get(userId);
                    return user?.active && !user.isGM;
                });
            if (!entries.length) return null;
            return entries[0];
        };
        
        for (const token of canvas.tokens.placeables) {
            const actor = token.actor;
            // Must be player character
            if (!actor || actor.type !== 'character') {
                continue;
            }
            
            // Prefer token ownership for unlinked tokens, fallback to actor ownership
            const tokenOwnership = token.document?.ownership || {};
            const actorOwnership = actor.ownership || {};
            let ownerEntry = pickActiveOwner(tokenOwnership);
            if (!ownerEntry) {
                ownerEntry = pickActiveOwner(actorOwnership);
            }
            if (!ownerEntry) continue;
            
            const [userId] = ownerEntry;
            const user = game.users.get(userId);
            if (!user || user.isGM) continue;
            
            addResult(userId, {
                token,
                userId,
                user,
                actor
            });
        }
        
        // Fallback: include active users with assigned characters even if no token is on canvas
        for (const user of game.users) {
            if (!user?.active || user.isGM || resultsByUser.has(user.id)) continue;
            const actor = user.character;
            if (!actor || actor.type !== 'character') continue;
            if (actor.ownership?.[user.id] !== OWNER_LEVEL) continue;

            const token = canvas.tokens.placeables.find(t => t.actor?.id === actor.id) || null;
            addResult(user.id, {
                token,
                userId: user.id,
                user,
                actor
            });
        }
        
        return Array.from(resultsByUser.values());
    }

    /**
     * Get party tokens on canvas for follow mode (GM view).
     * @returns {Array} Array of token placeables
     */
    static _getPartyTokensOnCanvas() {
        if (!canvas || !canvas.tokens) return [];
        return canvas.tokens.placeables.filter(token => {
            const actor = token.actor;
            if (!actor || actor.type !== 'character') return false;
            // Follow list includes player-owned characters even if the player is offline
            if (actor.hasPlayerOwner) return true;
            const ownership = token.document?.ownership || actor.ownership || {};
            return Object.entries(ownership).some(([userId, level]) => {
                const user = game.users.get(userId);
                return level === (CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3) && user && !user.isGM;
            });
        });
    }

    /**
     * Apply broadcast bar height to the Blacksmith CSS variable so the secondary bar uses our setting.
     * Blacksmith may use --blacksmith-menubar-secondary-broadcast-height for the broadcast bar; we set it from Herald's setting.
     */
    static _applyBroadcastBarHeightCss() {
        const height = getSettingSafely(MODULE.ID, 'broadcastBarHeight', 60);
        document.documentElement.style.setProperty('--blacksmith-menubar-secondary-broadcast-height', `${height}px`);
    }

    /**
     * Register the broadcast secondary bar type
     * @private
     */
    static async _registerBroadcastBarType() {
        const height = getSettingSafely(MODULE.ID, 'broadcastBarHeight', 60);
        await this._blacksmith.registerSecondaryBarType('broadcast', {
            height,
            persistence: 'manual',
            groupBannerEnabled: true,
            groupBannerColor: 'rgba(62, 92, 13, 0.9)',
            groups: {
                'modes': {
                    mode: 'switch',  // Radio-button behavior: only one mode active at a time
                    order: 0,
                    masterSwitchGroup: 'broadcast-view'
                },
                'mirror': {
                    mode: 'switch',  // Radio-button behavior: only one player selected at a time
                    order: 1,
                    masterSwitchGroup: 'broadcast-view',
                    bannerColor: 'rgba(65, 29, 18, 0.9)'  // Custom banner color for mirror group
                },
                'follow': {
                    mode: 'switch',  // Radio-button behavior: only one token selected at a time
                    order: 2,
                    masterSwitchGroup: 'broadcast-view',
                    bannerColor: 'rgba(36, 60, 110, 0.9)'  // Custom banner color for follow group
                },
                'tools': {
                    mode: 'default',
                    order: 3,
                    bannerColor: 'rgba(13, 107, 87, 0.9)'
                }
            }
        });
    }

    /**
     * Show Blacksmith context menu (same API we use for right-click) at event position.
     * Used so the same menu opens on left-click; contextMenuItems is set to [] so right-click does nothing.
     * @param {MouseEvent} event - click event (clientX/clientY used)
     * @param {Array<{name: string, icon?: string, onClick?: function, submenu?: Array}>|Object} itemsOrZones - flat array of items, or zones object { core: [], view: [], tools: [] }
     * @param {string} menuId - unique id for the menu (e.g. 'herald-broadcast-toggle-menu')
     */
    static _showBlacksmithContextMenu(event, itemsOrZones, menuId) {
        const ContextMenu = this._blacksmith?.uiContextMenu;
        if (!ContextMenu?.show) return;

        const toZoneEntry = (it) => {
            const entry = {
                name: it.name,
                icon: it.icon ?? '',
                callback: typeof it.onClick === 'function' ? it.onClick : undefined
            };
            if (it.submenu?.length) {
                entry.submenu = it.submenu.map((sub) => ({
                    name: sub.name,
                    icon: sub.icon ?? '',
                    callback: typeof sub.onClick === 'function' ? sub.onClick : undefined
                }));
            }
            return entry;
        };

        let zones;
        if (Array.isArray(itemsOrZones)) {
            if (!itemsOrZones.length) return;
            zones = itemsOrZones.map(toZoneEntry);
            ContextMenu.show({
                id: menuId,
                x: event.clientX,
                y: event.clientY,
                zones,
                zoneClass: 'core',
                maxWidth: 340
            });
        } else if (itemsOrZones && typeof itemsOrZones === 'object') {
            const zoneObj = {};
            for (const [key, arr] of Object.entries(itemsOrZones)) {
                if (Array.isArray(arr) && arr.length) {
                    zoneObj[key] = arr.map(toZoneEntry);
                }
            }
            if (Object.keys(zoneObj).length === 0) return;
            ContextMenu.show({
                id: menuId,
                x: event.clientX,
                y: event.clientY,
                zones: zoneObj,
                maxWidth: 340
            });
        }
    }

    /**
     * Items for the broadcast-view-mode menubar tool. Returns zones object for Blacksmith context menu.
     * Uses documented zone keys: core, gm (see Blacksmith API Context Menu - zones object).
     * @returns {Object} { core: Array, gm?: Array }
     */
    static _getViewModeMenuItems() {
        const core = [];
        const enabled = this.isEnabled();
        const labelKey = enabled ? MODULE.ID + '.context-disable-herald' : MODULE.ID + '.context-enable-herald';
        core.push({
            name: game.i18n.localize(labelKey),
            icon: enabled ? 'fa-solid fa-toggle-off' : 'fa-solid fa-toggle-on',
            onClick: async () => {
                const newValue = !enabled;
                await game.settings.set(MODULE.ID, 'enableBroadcast', newValue);
                this._updateBroadcastMode();
                // Menubar: `broadcast-settings` hook calls `_requestMenubarRender(true)`
                await this._emitBroadcastWindowCommand('refresh', { force: true });
                if (this._isBroadcastUser()) window.location.reload();
            }
        });
        core.push({
            name: game.i18n.localize(MODULE.ID + '.context-hide-show-broadcast-bar'),
            icon: 'fa-solid fa-bars',
            onClick: () => {
                if (this._warnIfNotEnabled()) return;
                const height = getSettingSafely(MODULE.ID, 'broadcastBarHeight', 60);
                this._blacksmith.toggleSecondaryBar('broadcast', { height });
            }
        });

        const zones = { core };
        if (!game.user.isGM || !this.isEnabled()) return zones;

        // GM-only zone: view modes + Tools flyout (Blacksmith API uses "gm" for this zone)
        const gm = [
            { name: 'Manual', icon: 'fa-solid fa-hand', onClick: async () => { if (this._warnIfNotEnabled()) return; await this._setBroadcastMode('manual'); } },
            { name: 'GM View', icon: 'fa-solid fa-chess-king', onClick: async () => { if (this._warnIfNotEnabled()) return; await this._setBroadcastMode('gmview'); } },
            ...(game.combat ? [
                { name: game.i18n.localize(MODULE.ID + '.view-mode-combatant'), icon: 'fa-solid fa-helmet-battle', onClick: async () => { if (this._warnIfNotEnabled()) return; if (!game.combat) { ui.notifications?.info?.(game.i18n?.localize?.('coffee-pub-herald.notification-no-combat') ?? 'No active combat.'); return; } await this._setBroadcastMode('combatant'); } },
                { name: game.i18n.localize(MODULE.ID + '.view-mode-combat'), icon: 'fa-solid fa-swords', onClick: async () => { if (this._warnIfNotEnabled()) return; if (!game.combat) { ui.notifications?.info?.(game.i18n?.localize?.('coffee-pub-herald.notification-no-combat') ?? 'No active combat.'); return; } await this._setBroadcastMode('combat'); } }
            ] : []),
            { name: game.i18n.localize(MODULE.ID + '.view-mode-tokenspectator'), icon: 'fa-solid fa-chess', onClick: async () => { if (this._warnIfNotEnabled()) return; await this._setBroadcastMode('tokenspectator'); } },
            { name: game.i18n.localize(MODULE.ID + '.view-mode-spectator'), icon: 'fa-solid fa-users', onClick: async () => { if (this._warnIfNotEnabled()) return; await this._setBroadcastMode('spectator'); } },
            { name: 'Map View', icon: 'fa-solid fa-map', onClick: async () => { if (this._warnIfNotEnabled()) return; await this._setBroadcastMode('mapview'); } }
        ];

        const mirrorUsers = this._getPartyTokensWithUsers().map(entry => entry.user).filter(Boolean);
        const mirrorSubmenu = mirrorUsers.map((user) => {
            const userId = user.id;
            return {
                name: user.name,
                icon: 'fa-solid fa-helmet-battle',
                onClick: async () => {
                    if (this._warnIfNotEnabled()) return;
                    await this._setBroadcastMode(`playerview-${userId}`);
                }
            };
        });
        if (mirrorSubmenu.length) {
            gm.push({
                name: game.i18n.localize(MODULE.ID + '.context-mirror-flyout'),
                icon: 'fa-solid fa-helmet-battle',
                submenu: mirrorSubmenu
            });
        }

        const followTokens = this._getPartyTokensOnCanvas();
        const followSubmenu = followTokens.map((token) => {
            const label = token?.actor?.name || token?.name || 'Token';
            const tokenId = token.id;
            return {
                name: label,
                icon: 'fa-solid fa-location-crosshairs',
                onClick: async () => {
                    if (this._warnIfNotEnabled()) return;
                    await game.settings.set(MODULE.ID, 'broadcastFollowTokenId', tokenId);
                    await this._setBroadcastMode('playerview-follow');
                }
            };
        });
        if (followSubmenu.length) {
            gm.push({
                name: 'Follow',
                icon: 'fa-solid fa-location-crosshairs',
                submenu: followSubmenu
            });
        }

        const toolsSubmenu = [
            { name: game.i18n.localize(MODULE.ID + '.context-tool-close-images'), icon: 'fa-solid fa-image', onClick: async () => { if (this._warnIfNotEnabled()) return; await this._emitBroadcastWindowCommand('close-images'); } },
            { name: game.i18n.localize(MODULE.ID + '.context-tool-close-journals'), icon: 'fa-solid fa-book-open', onClick: async () => { if (this._warnIfNotEnabled()) return; await this._emitBroadcastWindowCommand('close-journals'); } },
            { name: game.i18n.localize(MODULE.ID + '.context-tool-close-all'), icon: 'fa-solid fa-circle-xmark', onClick: async () => { if (this._warnIfNotEnabled()) return; await this._emitBroadcastWindowCommand('close-all'); } },
            { name: game.i18n.localize(MODULE.ID + '.context-tool-refresh'), icon: 'fa-solid fa-rotate', onClick: async () => { if (this._warnIfNotEnabled()) return; await this._emitBroadcastWindowCommand('refresh'); } },
            { name: game.i18n.localize(MODULE.ID + '.context-tool-toggle-combat-bar'), icon: 'fa-solid fa-browser', onClick: async () => { if (this._warnIfNotEnabled()) return; await this._emitBroadcastWindowCommand('toggle-combat-bar'); } },
            { name: game.i18n.localize(MODULE.ID + '.context-tool-settings'), icon: 'fa-solid fa-gear', onClick: async () => { if (this._warnIfNotEnabled()) return; await this._emitBroadcastWindowCommand('settings'); } }
        ];
        gm.push({
            name: game.i18n.localize(MODULE.ID + '.context-tools-flyout'),
            icon: 'fa-solid fa-wrench',
            submenu: toolsSubmenu
        });

        zones.gm = gm;
        return zones;
    }

    /**
     * Register broadcast tools in the broadcast secondary bar
     * @private
     */
    static _registerBroadcastTools() {
        const api = this._blacksmith;
        // Register the broadcast bar toggle button in the menubar (Herald owns this when running as separate module)
        api.registerMenubarTool('broadcast-toggle', {
            icon: 'fa-solid fa-video',
            name: 'broadcast-toggle',
            title: () => 'Broadcast',
            tooltip: () => 'Show or hide broadcast bar',
            onClick: () => {
                if (this._warnIfNotEnabled()) return;
                const height = getSettingSafely(MODULE.ID, 'broadcastBarHeight', 60);
                this._blacksmith.toggleSecondaryBar('broadcast', { height });
            },
            zone: 'middle',
            group: 'combat',
            groupOrder: 1,
            order: 4,
            moduleId: MODULE.ID,
            gmOnly: true,
            leaderOnly: false,
            visible: () => true,
            toggleable: true,
            active: false,
            iconColor: null,
            buttonNormalTint: null,
            buttonSelectedTint: null,
            contextMenuItems: () => []
        });
        api.registerSecondaryBarTool('broadcast', 'broadcast-toggle');

        // Register Manual mode button
this._blacksmith.registerSecondaryBarItem('broadcast', 'broadcast-mode-manual', {
            icon: 'fa-solid fa-hand',
            label: null,
            tooltip: 'Manual - No automatic following (manual camera control)',
            group: 'modes',
            toggleable: false,
            order: 0,
            iconColor: null,
            buttonColor: null,
            borderColor: null,
            visible: true,
            onClick: async () => {
                postConsoleAndNotification(MODULE.NAME, "BroadcastManager: Manual mode button clicked", "", true, false);
                if (this._warnIfNotEnabled()) return;
                // Only GMs can change broadcast mode
                if (!game.user.isGM) {
                    postConsoleAndNotification(MODULE.NAME, "Broadcast: Only GMs can change broadcast mode", "", false, false);
                    return;
                }
                postConsoleAndNotification(MODULE.NAME, "BroadcastManager: Setting broadcast mode to 'manual'", "", true, false);
                await this._setBroadcastMode('manual');
                // Switch mode automatically manages active state - no manual re-rendering needed
            }
        });
        
        
        // Register GM View mode button
this._blacksmith.registerSecondaryBarItem('broadcast', 'broadcast-mode-gmview', {
            icon: 'fa-solid fa-chess-king',
            label: null,
            tooltip: 'GM View - Mirror GM\'s viewport (center and zoom)',
            group: 'modes',
            toggleable: false,
            order: 1,
            iconColor: null,
            buttonColor: null,
            borderColor: null,
            visible: true,
            onClick: async () => {
                postConsoleAndNotification(MODULE.NAME, "BroadcastManager: GM View mode button clicked", "", true, false);
                if (this._warnIfNotEnabled()) return;
                // Only GMs can change broadcast mode
                if (!game.user.isGM) {
                    postConsoleAndNotification(MODULE.NAME, "Broadcast: Only GMs can change broadcast mode", "", false, false);
                    return;
                }
                postConsoleAndNotification(MODULE.NAME, "BroadcastManager: Setting broadcast mode to 'gmview'", "", true, false);
                await this._setBroadcastMode('gmview');
                // Switch mode automatically manages active state - no manual re-rendering needed
            }
        });


        // Register Combatant mode button (follow current combatant; only visible when there is an active combat)
this._blacksmith.registerSecondaryBarItem('broadcast', 'broadcast-mode-combatant', {
            icon: 'fa-solid fa-helmet-battle',
            label: null,
            tooltip: () => (game.i18n.localize(MODULE.ID + '.view-mode-combatant') || 'Combatant') + ' - Follow current combatant automatically',
            group: 'modes',
            toggleable: false,
            order: 2,
            iconColor: null,
            buttonColor: null,
            borderColor: null,
            visible: () => !!game.combat,
            onClick: async () => {
                postConsoleAndNotification(MODULE.NAME, "BroadcastManager: Combatant mode button clicked", "", true, false);
                if (this._warnIfNotEnabled()) return;
                if (!game.combat) {
                    ui.notifications?.info?.(game.i18n?.localize?.('coffee-pub-herald.notification-no-combat') ?? 'No active combat. Start combat first.');
                    return;
                }
                if (!game.user.isGM) {
                    postConsoleAndNotification(MODULE.NAME, "Broadcast: Only GMs can change broadcast mode", "", false, false);
                    return;
                }
                postConsoleAndNotification(MODULE.NAME, "BroadcastManager: Setting broadcast mode to 'combatant'", "", true, false);
                await this._setBroadcastMode('combatant');
                // Switch mode automatically manages active state - no manual re-rendering needed
            }
        });

        
        // Register Combat mode button (frame all combatants; only visible when there is an active combat)
this._blacksmith.registerSecondaryBarItem('broadcast', 'broadcast-mode-combat', {
            icon: 'fa-solid fa-swords',
            label: null,
            tooltip: () => (game.i18n.localize(MODULE.ID + '.view-mode-combat') || 'Combat') + ' - Frame all visible combatants automatically',
            group: 'modes',
            toggleable: false,
            order: 3,
            iconColor: null,
            buttonColor: null,
            borderColor: null,
            visible: () => !!game.combat,
            onClick: async () => {
                postConsoleAndNotification(MODULE.NAME, "BroadcastManager: Combat mode button clicked", "", true, false);
                if (this._warnIfNotEnabled()) return;
                if (!game.combat) {
                    ui.notifications?.info?.(game.i18n?.localize?.('coffee-pub-herald.notification-no-combat') ?? 'No active combat. Start combat first.');
                    return;
                }
                if (!game.user.isGM) {
                    postConsoleAndNotification(MODULE.NAME, "Broadcast: Only GMs can change broadcast mode", "", false, false);
                    return;
                }
                postConsoleAndNotification(MODULE.NAME, "BroadcastManager: Setting broadcast mode to 'combat'", "", true, false);
                await this._setBroadcastMode('combat');
                // Switch mode automatically manages active state - no manual re-rendering needed
            }
        });


        // Register Token Spectator mode button (frame all tokens on canvas; available anytime)
this._blacksmith.registerSecondaryBarItem('broadcast', 'broadcast-mode-tokenspectator', {
            icon: 'fa-solid fa-chess',
            label: null,
            tooltip: () => game.i18n.localize(MODULE.ID + '.view-mode-tokenspectator') + ' - Frame all tokens on the canvas',
            group: 'modes',
            toggleable: false,
            order: 4,
            iconColor: null,
            buttonColor: null,
            borderColor: null,
            visible: true,
            onClick: async () => {
                postConsoleAndNotification(MODULE.NAME, "BroadcastManager: Token Spectator mode button clicked", "", true, false);
                if (this._warnIfNotEnabled()) return;
                if (!game.user.isGM) {
                    postConsoleAndNotification(MODULE.NAME, "Broadcast: Only GMs can change broadcast mode", "", false, false);
                    return;
                }
                await this._setBroadcastMode('tokenspectator');
            }
        });


        // Register Spectator mode button (Party Spectator)
this._blacksmith.registerSecondaryBarItem('broadcast', 'broadcast-mode-spectator', {
            icon: 'fa-solid fa-users',
            label: null,
            tooltip: () => (game.i18n.localize(MODULE.ID + '.view-mode-spectator') || 'Party Spectator') + ' - Follow party tokens automatically',
            group: 'modes',
            toggleable: false,
            order: 5,
            iconColor: null,
            buttonColor: null,
            borderColor: null,
            visible: true,
            onClick: async () => {
                postConsoleAndNotification(MODULE.NAME, "BroadcastManager: Party Spectator mode button clicked", "", true, false);
                if (this._warnIfNotEnabled()) return;
                if (!game.user.isGM) {
                    postConsoleAndNotification(MODULE.NAME, "Broadcast: Only GMs can change broadcast mode", "", false, false);
                    return;
                }
                postConsoleAndNotification(MODULE.NAME, "BroadcastManager: Setting broadcast mode to 'spectator'", "", true, false);
                await this._setBroadcastMode('spectator');
                // Switch mode automatically manages active state - no manual re-rendering needed
            }
        });


        // Register Map View mode button (fit scene to viewport)
this._blacksmith.registerSecondaryBarItem('broadcast', 'broadcast-mode-mapview', {
            icon: 'fa-solid fa-map',
            label: null,
            tooltip: 'Map View - Fit scene to viewport (camera mode)',
            group: 'modes',
            toggleable: false,
            order: 6,
            iconColor: null,
            buttonColor: null,
            borderColor: null,
            visible: true,
            onClick: async () => {
                postConsoleAndNotification(MODULE.NAME, "BroadcastManager: Map View mode button clicked", "", true, false);
                if (this._warnIfNotEnabled()) return;
                if (!game.user.isGM) {
                    postConsoleAndNotification(MODULE.NAME, "Broadcast: Only GMs can change broadcast mode", "", false, false);
                    return;
                }
                await this._setBroadcastMode('mapview');
            }
        });

        // Register broadcast tools (GM-only)
this._blacksmith.registerSecondaryBarItem('broadcast', 'broadcast-tool-close-images', {
            icon: 'fa-solid fa-image',
            label: null,
            tooltip: 'Close broadcast images',
            group: 'tools',
            toggleable: false,
            order: 0,
            visible: () => game.user.isGM,
            onClick: async () => {
                if (!game.user.isGM) return;
                if (this._warnIfNotEnabled()) return;
                await this._emitBroadcastWindowCommand('close-images');
            }
        });

this._blacksmith.registerSecondaryBarItem('broadcast', 'broadcast-tool-close-journals', {
            icon: 'fa-solid fa-book-open',
            label: null,
            tooltip: 'Close broadcast journals',
            group: 'tools',
            toggleable: false,
            order: 1,
            visible: () => game.user.isGM,
            onClick: async () => {
                if (!game.user.isGM) return;
                if (this._warnIfNotEnabled()) return;
                await this._emitBroadcastWindowCommand('close-journals');
            }
        });

this._blacksmith.registerSecondaryBarItem('broadcast', 'broadcast-tool-close-windows', {
            icon: 'fa-solid fa-circle-xmark',
            label: null,
            tooltip: 'Close all windows',
            group: 'tools',
            toggleable: false,
            order: 2,
            visible: () => game.user.isGM,
            onClick: async () => {
                if (!game.user.isGM) return;
                if (this._warnIfNotEnabled()) return;
                await this._emitBroadcastWindowCommand('close-all');
            }
        });

this._blacksmith.registerSecondaryBarItem('broadcast', 'broadcast-tool-refresh', {
            icon: 'fa-solid fa-rotate',
            label: null,
            tooltip: 'Refresh broadcast client',
            group: 'tools',
            toggleable: false,
            order: 3,
            visible: () => game.user.isGM,
            onClick: async () => {
                if (!game.user.isGM) return;
                if (this._warnIfNotEnabled()) return;
                await this._emitBroadcastWindowCommand('refresh');
            }
        });

this._blacksmith.registerSecondaryBarItem('broadcast', 'broadcast-tool-toggle-combat-bar', {
            icon: 'fa-solid fa-browser',
            label: null,
            tooltip: () => game.i18n.localize(MODULE.ID + '.context-tool-toggle-combat-bar-hint'),
            group: 'tools',
            toggleable: false,
            order: 4,
            visible: () => game.user.isGM,
            onClick: async () => {
                if (!game.user.isGM) return;
                if (this._warnIfNotEnabled()) return;
                await this._emitBroadcastWindowCommand('toggle-combat-bar');
            }
        });

this._blacksmith.registerSecondaryBarItem('broadcast', 'broadcast-tool-settings', {
            icon: 'fa-solid fa-gear',
            label: null,
            tooltip: 'Open broadcast settings',
            group: 'tools',
            toggleable: false,
            order: 5,
            visible: () => game.user.isGM,
            onClick: async () => {
                if (!game.user.isGM) return;
                if (this._warnIfNotEnabled()) return;
                await this._emitBroadcastWindowCommand('settings');
            }
        });

        

        // Register player view buttons (mirror/follow)
        this.registerPlayerPortraitButtons();
        this.registerFollowTokenButtons();
        this._registerPlayerPortraitSyncHooks();
        this._registerBroadcastWindowHooks();

        // Register view mode button in main menubar (right section)
        this._registerBroadcastMenubarButton();

        // Set initial active state based on current broadcastMode setting
        // Switch mode will default to first item if none is set, so we set the correct one
        let currentMode = this._getCachedBroadcastMode();
        // If mode is combat/combatant but there's no active combat, switch to fallback before showing UI
        if ((currentMode === 'combat' || currentMode === 'combatant') && !game.combat) {
            const fallback = getSettingSafely(MODULE.ID, 'broadcastCombatEndMode', 'spectator');
            this._setBroadcastMode(fallback); // fire-and-forget; setting will update and sync
            currentMode = fallback;
        }

        this._syncSecondaryBarActiveForBroadcastMode(currentMode);
        this._refreshBroadcastSecondaryBarData(currentMode);

        // Listen for broadcast mode setting changes to sync button active state and adjust camera
this._blacksmith.HookManager.registerHook({
            name: 'settingChange',
            description: 'BroadcastManager: Sync broadcast mode button active state when mode changes',
            context: 'broadcast-mode-buttons',
            priority: 5,
            key: 'broadcastModeButtons',
            callback: async (moduleId, settingKey, value) => {
                //  ------------------- BEGIN - HOOKMANAGER CALLBACK -------------------
                
                if (moduleId === MODULE.ID && settingKey === 'broadcastMode') {
                    this._lastBroadcastMode = value;
                    this._syncSecondaryBarActiveForBroadcastMode(value);
                    this._refreshBroadcastSecondaryBarData(value);
                    this._requestMenubarRender(true);

                    // If GM changes mode, broadcast to other clients immediately
                    if (game.user.isGM && this._shouldEmitModeChange(value)) {
                        await this._emitModeChange(value);
                    }
                    
                    // Immediately adjust viewport when mode changes
                    // Note: For GM/Player view modes, the GM/Player client needs to send sync
                    // For Spectator/Combat modes, only the broadcast user (cameraman) adjusts viewport
                    if (this.isEnabled() && canvas?.ready) {
                        // Use a small delay to ensure mode change is fully processed
                        this._trackedSetTimeout(async () => {
                            await this._adjustViewportForMode(value);
                        }, 50);
                    }
                }
                
                //  ------------------- END - HOOKMANAGER CALLBACK -------------------
            }
        });

        postConsoleAndNotification(MODULE.NAME, "BroadcastManager: Broadcast tools registered", "", true, false);
    }

    /**
     * Register view mode button in main menubar (right section)
     * Only shows when cameraman is connected and broadcast is active
     * @private
     */
    static _registerBroadcastMenubarButton() {
        // Get mode display names
        const getModeDisplayName = (mode) => {
            if (mode === 'playerview-follow') {
                const followTokenId = getSettingSafely(MODULE.ID, 'broadcastFollowTokenId', '');
                const tokenName = followTokenId ? canvas.tokens.get(followTokenId)?.name : null;
                return tokenName || 'Follow';
            }
            if (typeof mode === 'string' && mode.startsWith('playerview-')) {
                const userId = mode.replace('playerview-', '');
                const user = game.users.get(userId);
                const name = user?.name || 'Player';
                return name;
            }
            const modeNames = {
                'manual': 'Manual',
                'gmview': 'GM View',
                'combat': game.i18n.localize(MODULE.ID + '.view-mode-combat') || 'Combat',
                'combatant': game.i18n.localize(MODULE.ID + '.view-mode-combatant') || 'Combatant',
                'tokenspectator': game.i18n.localize(MODULE.ID + '.view-mode-tokenspectator') || 'Token Spectator',
                'combatspectator': game.i18n.localize(MODULE.ID + '.view-mode-tokenspectator') || 'Token Spectator',
                'spectator': game.i18n.localize(MODULE.ID + '.view-mode-spectator') || 'Party Spectator',
                'mapview': 'Map View',
                'playerview': 'Player View'
            };
            return modeNames[mode] || 'Manual';
        };

        // Get mode icon
        const getModeIcon = (mode) => {
            if (typeof mode === 'string' && mode.startsWith('playerview-')) {
                return 'fa-solid fa-helmet-battle';
            }
            const modeIcons = {
                'manual': 'fa-solid fa-hand',
                'gmview': 'fa-solid fa-chess-king',
                'combat': 'fa-solid fa-swords',
                'combatant': 'fa-solid fa-helmet-battle',
                'tokenspectator': 'fa-solid fa-chess',
                'combatspectator': 'fa-solid fa-chess', // backwards compat
                'spectator': 'fa-solid fa-users',
                'mapview': 'fa-solid fa-map',
                'playerview': 'fa-solid fa-helmet-battle'
            };
            return modeIcons[mode] || 'fa-solid fa-hand';
        };

const success = this._blacksmith.registerMenubarTool('broadcast-view-mode', {
            icon: 'fa-solid fa-video',
            name: 'broadcast-view-mode',
            title: () => {
                if (!this.isEnabled()) {
                    return game.i18n.localize(MODULE.ID + '.view-mode-title-disabled') || 'View Mode';
                }
                // Never show the live mode name unless broadcast is actually reachable (user set + logged in)
                if (!this.isBroadcastActive()) {
                    if (!this._getBroadcastUser()) {
                        return game.i18n.localize(MODULE.ID + '.view-mode-no-cameraman') || 'No cameraman';
                    }
                    return game.i18n.localize(MODULE.ID + '.view-mode-cameraman-disconnected') || 'Cameraman offline';
                }
                const mode = this._getCachedBroadcastMode();
                return getModeDisplayName(mode);
            },
            tooltip: () => {
                const suffix = game.i18n.localize(MODULE.ID + '.view-mode-tooltip-suffix') || ' — Left-click: open menu';
                if (!this.isEnabled()) {
                    return (game.i18n.localize(MODULE.ID + '.view-mode-tooltip-disabled') || 'View Mode (broadcast off)') + suffix;
                }
                if (!this.isBroadcastActive()) {
                    if (!this._getBroadcastUser()) {
                        return (game.i18n.localize(MODULE.ID + '.view-mode-no-cameraman-hint') || 'No broadcast user selected in module settings') + suffix;
                    }
                    return (game.i18n.localize(MODULE.ID + '.view-mode-cameraman-offline-hint') || 'The broadcast user is not logged in') + suffix;
                }
                const mode = this._getCachedBroadcastMode();
                return `${getModeDisplayName(mode)}${suffix}`;
            },
            zone: 'right',
            group: 'general',
            groupOrder: 999,
            order: 10, // After timer-section
            moduleId: MODULE.ID,
            gmOnly: true,
            leaderOnly: false,
            visible: () => {
                // TODO: Add visibility checks after button is confirmed working
                // Always show for now to debug
                return true;
            },
            toggleable: false,
            active: false,
            iconColor: null,
            buttonNormalTint: null,
            buttonSelectedTint: null,
            onClick: (event) => {
                this._showBlacksmithContextMenu(event, this._getViewModeMenuItems(), 'herald-view-mode-menu');
            },
            contextMenuItems: () => []
        });

        if (success) {
            postConsoleAndNotification(MODULE.NAME, "BroadcastManager: View mode menubar button registered", "", true, false);
            this._requestMenubarRender(true);
        } else {
            postConsoleAndNotification(MODULE.NAME, "BroadcastManager: Failed to register view mode menubar button", "", false, false);
        }
    }

    /**
     * Register portrait buttons for all party tokens
     * Called from _registerBroadcastTools when registering broadcast tools
     */
    static registerPlayerPortraitButtons() {
        const partyData = this._getPartyTokensWithUsers();

        // Remove old buttons (any button starting with broadcast-mode-player-)
        const existingItems = this._blacksmith.getSecondaryBarItems('broadcast');
        const itemIds = Array.isArray(existingItems) ? existingItems.map(it => it?.id ?? it?.name).filter(Boolean) : (existingItems && typeof existingItems.keys === 'function' ? [...existingItems.keys()] : []);
        for (const itemId of itemIds) {
            if (itemId.startsWith('broadcast-mode-player-')) {
                this._blacksmith.unregisterSecondaryBarItem('broadcast', itemId);
            }
        }
        
        // Register buttons for each party token
        let order = 10; // Start after manual (order 3), give some space
        for (const {token, userId, user, actor} of partyData) {
            const itemId = `broadcast-mode-player-${userId}`;
            const modeValue = `playerview-${userId}`;
            
            // Get token portrait image (actor.img is the portrait, not token texture which is the token image)
            const portraitImg = token?.document?.texture?.src || actor?.img || actor?.prototypeToken?.texture?.src || user?.avatar || '';
            
    this._blacksmith.registerSecondaryBarItem('broadcast', itemId, {
                icon: 'fas fa-user', // Fallback icon if image is not available
                image: portraitImg || null, // Use portrait image if available
                label: null,
                tooltip: `Mirror ${user.name}'s viewport`,
                group: 'mirror',
                toggleable: false,
                order: order++,
                iconColor: null,
                buttonColor: null,
                borderColor: null,
                visible: () => game.user.isGM, // Only GMs can see/use these buttons
                onClick: async () => {
                    // Double-check: Only GMs can change broadcast mode
                    if (!game.user.isGM) {
                        postConsoleAndNotification(MODULE.NAME, "Broadcast: Only GMs can change broadcast mode", "", false, false);
                        return;
                    }
                    if (this._warnIfNotEnabled()) return;
                    try {
                        await this._setBroadcastMode(modeValue);
                    } catch (error) {
                        postConsoleAndNotification(MODULE.NAME, "Broadcast: Failed to update mode", error.message, false, false);
                    }
                }
            });
        }

        // Re-sync active state for current playerview mode after rebuild
        const currentMode = this._getCachedBroadcastMode();
        if (typeof currentMode === 'string' && currentMode.startsWith('playerview-') && currentMode !== 'playerview-follow') {
            const userId = currentMode.replace('playerview-', '');
            const activeItemId = `broadcast-mode-player-${userId}`;
            this._blacksmith.updateSecondaryBarItemActive('broadcast', activeItemId, true);
        }
    }

    /**
     * Register follow-token buttons for player view follow mode.
     */
    static registerFollowTokenButtons() {
        const tokens = this._getPartyTokensOnCanvas();
        
        // Remove old buttons (any button starting with broadcast-follow-token-)
        const existingItems = this._blacksmith.getSecondaryBarItems('broadcast');
        const itemIds = Array.isArray(existingItems) ? existingItems.map(it => it?.id ?? it?.name).filter(Boolean) : (existingItems && typeof existingItems.keys === 'function' ? [...existingItems.keys()] : []);
        for (const itemId of itemIds) {
            if (itemId.startsWith('broadcast-follow-token-')) {
                this._blacksmith.unregisterSecondaryBarItem('broadcast', itemId);
            }
        }
        
        let order = 10;
        for (const token of tokens) {
            const itemId = `broadcast-follow-token-${token.id}`;
            const actor = token.actor;
            const label = actor?.name || token.name || 'Token';
            const image = actor?.img || token.document?.texture?.src || '';
            
    this._blacksmith.registerSecondaryBarItem('broadcast', itemId, {
                icon: 'fas fa-location-crosshairs',
                image: image || null,
                label: null,
                tooltip: `Follow ${label}`,
                group: 'follow',
                toggleable: false,
                order: order++,
                iconColor: null,
                buttonColor: null,
                borderColor: null,
                visible: () => game.user.isGM, // Only GMs can see/use these buttons
                onClick: async () => {
                    if (!game.user.isGM) {
                        postConsoleAndNotification(MODULE.NAME, "Broadcast: Only GMs can change broadcast mode", "", false, false);
                        return;
                    }
                    if (this._warnIfNotEnabled()) return;
                    await game.settings.set(MODULE.ID, 'broadcastFollowTokenId', token.id);
                    await this._setBroadcastMode('playerview-follow');
                }
            });
        }

        // Re-sync active state for current follow selection
        const currentMode = this._getCachedBroadcastMode();
        if (currentMode === 'playerview-follow') {
            const followTokenId = getSettingSafely(MODULE.ID, 'broadcastFollowTokenId', '');
            if (followTokenId) {
                this._blacksmith.updateSecondaryBarItemActive('broadcast', `broadcast-follow-token-${followTokenId}`, true);
            }
        }
    }

    /**
     * Register hooks to keep player portrait buttons in sync.
     */
    static _registerPlayerPortraitSyncHooks() {
        if (!game.user.isGM) return;

this._blacksmith.HookManager.registerHook({
            name: 'updateUser',
            description: 'BroadcastManager: Sync player portrait buttons when users connect/disconnect',
            context: 'broadcast-player-buttons',
            priority: 5,
            key: 'broadcast-player-buttons-updateUser',
            callback: (user, changes) => {
                //  ------------------- BEGIN - HOOKMANAGER CALLBACK -------------------
                if (!this.isEnabled()) return;
                if (!changes || changes.active === undefined) return;
                this._queuePlayerPortraitSync('updateUser');
                //  ------------------- END - HOOKMANAGER CALLBACK ---------------------
            }
        });

this._blacksmith.HookManager.registerHook({
            name: 'userConnected',
            description: 'BroadcastManager: Sync player portrait buttons when user connects',
            context: 'broadcast-player-buttons',
            priority: 5,
            key: 'broadcast-player-buttons-userConnected',
            callback: () => {
                //  ------------------- BEGIN - HOOKMANAGER CALLBACK -------------------
                if (!this.isEnabled()) return;
                this._queuePlayerPortraitSync('userConnected');
                //  ------------------- END - HOOKMANAGER CALLBACK ---------------------
            }
        });

this._blacksmith.HookManager.registerHook({
            name: 'userDisconnected',
            description: 'BroadcastManager: Sync player portrait buttons when user disconnects',
            context: 'broadcast-player-buttons',
            priority: 5,
            key: 'broadcast-player-buttons-userDisconnected',
            callback: () => {
                //  ------------------- BEGIN - HOOKMANAGER CALLBACK -------------------
                if (!this.isEnabled()) return;
                this._queuePlayerPortraitSync('userDisconnected');
                //  ------------------- END - HOOKMANAGER CALLBACK ---------------------
            }
        });

this._blacksmith.HookManager.registerHook({
            name: 'createToken',
            description: 'BroadcastManager: Sync player portrait buttons when party tokens are created',
            context: 'broadcast-player-buttons',
            priority: 5,
            key: 'broadcast-player-buttons-createToken',
            callback: () => {
                //  ------------------- BEGIN - HOOKMANAGER CALLBACK -------------------
                if (!this.isEnabled()) return;
                this._queuePlayerPortraitSync('createToken');
                //  ------------------- END - HOOKMANAGER CALLBACK ---------------------
            }
        });

this._blacksmith.HookManager.registerHook({
            name: 'deleteToken',
            description: 'BroadcastManager: Sync player portrait buttons when party tokens are removed',
            context: 'broadcast-player-buttons',
            priority: 5,
            key: 'broadcast-player-buttons-deleteToken',
            callback: () => {
                //  ------------------- BEGIN - HOOKMANAGER CALLBACK -------------------
                if (!this.isEnabled()) return;
                this._queuePlayerPortraitSync('deleteToken');
                //  ------------------- END - HOOKMANAGER CALLBACK ---------------------
            }
        });

this._blacksmith.HookManager.registerHook({
            name: 'canvasReady',
            description: 'BroadcastManager: Sync player portrait buttons when scenes change',
            context: 'broadcast-player-buttons',
            priority: 5,
            key: 'broadcast-player-buttons-canvasReady',
            callback: () => {
                //  ------------------- BEGIN - HOOKMANAGER CALLBACK -------------------
                if (!this.isEnabled()) return;
                this._queuePlayerPortraitSync('canvasReady');
                //  ------------------- END - HOOKMANAGER CALLBACK ---------------------
            }
        });
    }

    /**
     * Debounced sync for player portrait buttons.
     * @param {string} reason - Reason for sync
     */
    static _queuePlayerPortraitSync(reason) {
        if (!game.user.isGM) return;
        if (!this.isEnabled()) return;
        if (this._playerButtonsDebounce) {
            this._trackedClearTimeout(this._playerButtonsDebounce);
        }
        this._playerButtonsDebounce = this._trackedSetTimeout(() => {
            this._playerButtonsDebounce = null;
            postConsoleAndNotification(MODULE.NAME, "BroadcastManager: Syncing player portrait buttons", { reason }, true, false);
            this.registerPlayerPortraitButtons();
            this.registerFollowTokenButtons();
            this._requestMenubarRender(false);
        }, 150);
    }

    /**
     * Pick a default playerview mode based on last selection or first party member.
     * @returns {string|null} playerview-{userId} mode string or null if none available
     */
    static _getDefaultPlayerViewMode() {
        const currentMode = getSettingSafely(MODULE.ID, 'broadcastMode', 'spectator');
        if (typeof currentMode === 'string' && currentMode.startsWith('playerview-') && currentMode !== 'playerview-follow') {
            return currentMode;
        }
        
        const partyData = this._getPartyTokensWithUsers();
        if (!partyData.length) return null;
        
        const firstUserId = partyData[0]?.userId;
        return firstUserId ? `playerview-${firstUserId}` : null;
    }

    /**
     * Emit a broadcast mode change to all clients.
     * @param {string} mode - The new broadcast mode
     */
    static async _emitModeChange(mode) {
        try {
            if (!this.isBroadcastActive()) return;
            this._lastModeEmit = { mode, at: Date.now() };
            if (!this._blacksmith?.sockets) return;
            await this._waitForSocketsReady();
            await this._blacksmith.sockets.emit('broadcast.modeChanged', { mode });
        } catch (error) {
            postConsoleAndNotification(MODULE.NAME, "BroadcastManager: Failed to emit mode change", error, true, false);
        }
    }

    /**
     * Emit a map view request to all clients.
     */
    static async _emitMapView() {
        try {
            if (!this.isBroadcastActive()) return;
            if (!this._blacksmith?.sockets) return;
            await this._waitForSocketsReady();
            await this._blacksmith.sockets.emit('broadcast.mapView', {});
        } catch (error) {
            postConsoleAndNotification(MODULE.NAME, "BroadcastManager: Failed to emit map view", error, true, false);
        }
    }

    /**
     * Emit a broadcast window command to the cameraman client.
     * @param {string} action - Command action (close-images, close-journals, close-all, refresh)
     * @param {{ force?: boolean }} [options] - If force is true, send even when Herald is disabled (e.g. to refresh cameraman after enable/disable)
     */
    static async _emitBroadcastWindowCommand(action, options = {}) {
        try {
            if (!options.force && !this.isEnabled()) return;
            if (!options.force && !this._isBroadcastUserConnected()) return;
            const targetUserId = getSettingSafely(MODULE.ID, 'broadcastUserId', '') || '';
            if (!targetUserId) {
                postConsoleAndNotification(MODULE.NAME, "BroadcastManager: No broadcast user configured for window command", { action }, true, false);
                return;
            }
            postConsoleAndNotification(MODULE.NAME, "BroadcastManager: Emitting window command", { action, targetUserId, force: options.force }, true, false);
            if (!this._blacksmith?.sockets) return;
            await this._waitForSocketsReady();
            await this._blacksmith.sockets.emit('broadcast.windowCommand', { action, targetUserId });
        } catch (error) {
            postConsoleAndNotification(MODULE.NAME, "BroadcastManager: Failed to emit window command", { action, error }, true, false);
        }
    }

    /**
     * Decide whether to emit a mode change (dedupe rapid repeats).
     * @param {string} mode - The mode to emit
     * @returns {boolean} True if we should emit
     */
    static _shouldEmitModeChange(mode) {
        if (!mode) return false;
        const now = Date.now();
        if (this._lastModeEmit.mode === mode && (now - this._lastModeEmit.at) < 500) {
            return false;
        }
        return true;
    }

    /**
     * Update which broadcast secondary bar item is active (mirror / follow / mode buttons).
     * Must run after `broadcastMode` is persisted so UI matches cameraman view.
     * @param {string} mode - Current `broadcastMode` value
     */
    static _syncSecondaryBarActiveForBroadcastMode(mode) {
        const api = this._blacksmith;
        if (!api?.updateSecondaryBarItemActive || typeof mode !== 'string') return;

        if (mode.startsWith('playerview-') && mode !== 'playerview-follow') {
            const userId = mode.replace('playerview-', '');
            const activeItemId = `broadcast-mode-player-${userId}`;
            api.updateSecondaryBarItemActive('broadcast', activeItemId, true);
            const followTokenId = getSettingSafely(MODULE.ID, 'broadcastFollowTokenId', '');
            if (followTokenId) {
                api.updateSecondaryBarItemActive('broadcast', `broadcast-follow-token-${followTokenId}`, false);
            }
        } else if (mode === 'playerview-follow') {
            const followTokenId = getSettingSafely(MODULE.ID, 'broadcastFollowTokenId', '');
            if (followTokenId) {
                api.updateSecondaryBarItemActive('broadcast', `broadcast-follow-token-${followTokenId}`, true);
            }
        } else {
            const modeItemMap = {
                spectator: 'broadcast-mode-spectator',
                combat: 'broadcast-mode-combat',
                combatant: 'broadcast-mode-combatant',
                tokenspectator: 'broadcast-mode-tokenspectator',
                combatspectator: 'broadcast-mode-tokenspectator',
                gmview: 'broadcast-mode-gmview',
                manual: 'broadcast-mode-manual',
                mapview: 'broadcast-mode-mapview'
            };
            const activeItemId = modeItemMap[mode] || 'broadcast-mode-spectator';
            api.updateSecondaryBarItemActive('broadcast', activeItemId, true);
        }
    }

    /**
     * Merge live mode into Blacksmith secondary bar `data` and full menubar refresh (when broadcast bar is open).
     * @param {string} mode - Current `broadcastMode` value
     */
    static _refreshBroadcastSecondaryBarData(mode) {
        if (typeof this._blacksmith?.updateSecondaryBar !== 'function') return;
        this._blacksmith.updateSecondaryBar({
            heraldBroadcastMode: mode,
            _heraldSyncAt: Date.now()
        });
    }

    /**
     * Set broadcast mode, emit to clients, and adjust local viewport.
     * @param {string} mode - The new broadcast mode
     * @returns {Promise<boolean>} True if set succeeded
     */
    static async _setBroadcastMode(mode) {
        if (!mode) return false;
        try {
            this._lastBroadcastMode = mode;
            await game.settings.set(MODULE.ID, 'broadcastMode', mode);
            this._syncSecondaryBarActiveForBroadcastMode(mode);
            this._refreshBroadcastSecondaryBarData(mode);
            this._requestMenubarRender(true);
            if (game.user.isGM && this._shouldEmitModeChange(mode)) {
                await this._emitModeChange(mode);
            }
            if (this.isEnabled() && canvas?.ready) {
                await this._adjustViewportForMode(mode);
            }
            return true;
        } catch (error) {
            postConsoleAndNotification(MODULE.NAME, "BroadcastManager: Failed to set broadcast mode", error, true, false);
            return false;
        }
    }

    /**
     * Get the most recent broadcast mode for UI rendering.
     * @returns {string} Broadcast mode
     */
    static _getCachedBroadcastMode() {
        return this._lastBroadcastMode || getSettingSafely(MODULE.ID, 'broadcastMode', 'manual');
    }

    /**
     * Start monitoring player viewport (for a specific player)
     * @param {string} userId - The user ID to monitor
     */
    static _startPlayerViewportMonitoring(userId) {
        if (!userId) return;
        
        // Stop existing monitoring for this user
        this._stopPlayerViewportMonitoring(userId);
        
        // Only monitor if this is the current user
        if (game.user.id !== userId) return;
        if (!canvas?.ready) {
            Hooks.once('canvasReady', () => this._startPlayerViewportMonitoring(userId));
            return;
        }

        const handler = (c, position) => {
            // Check if we should send viewport updates
            if (!this.isEnabled()) return;
            const mode = getSettingSafely(MODULE.ID, 'broadcastMode', 'spectator');
            if (mode !== `playerview-${userId}`) return;

            // Debounce emits
            if (this._playerDebounces.has(userId)) {
                this._trackedClearTimeout(this._playerDebounces.get(userId));
            }
            let timeout;
            timeout = this._trackedSetTimeout(() => {
                if (this._playerDebounces.get(userId) === timeout) {
                    this._playerDebounces.delete(userId);
                }
                this._sendPlayerViewportSync(userId, position);
            }, 150);
            this._playerDebounces.set(userId, timeout);
        };

        Hooks.on('canvasPan', handler);
        this._playerPanHandlers.set(userId, handler);

        // Send initial state
        const initial = canvas.scene?._viewPosition ?? canvas.pan;
        if (initial) this._sendPlayerViewportSync(userId, initial);
    }

    /**
     * Stop monitoring player viewport (for a specific player)
     * @param {string} userId - The user ID to stop monitoring
     */
    static _stopPlayerViewportMonitoring(userId) {
        if (this._playerDebounces.has(userId)) {
            this._trackedClearTimeout(this._playerDebounces.get(userId));
            this._playerDebounces.delete(userId);
        }
        if (this._playerPanHandlers.has(userId)) {
            const handler = this._playerPanHandlers.get(userId);
            Hooks.off('canvasPan', handler);
            this._playerPanHandlers.delete(userId);
        }
    }

    /**
     * Send player viewport state to cameraman via socket
     * @param {string} userId - The player's user ID
     * @param {Object} position - Viewport position from canvasPan hook
     */
    static async _sendPlayerViewportSync(userId, position) {
        if (!userId || game.user.id !== userId) return;
        if (!this.isBroadcastActive()) return;
        if (!canvas?.ready) return;
        
        const mode = getSettingSafely(MODULE.ID, 'broadcastMode', 'spectator');
        if (mode !== `playerview-${userId}`) return;

        const viewportState = {
            userId,
            x: position.x,
            y: position.y,
            scale: position.scale ?? canvas.stage?.scale?.x ?? 1
        };

        try {
            if (!this._blacksmith?.sockets) return;
            await this._waitForSocketsReady();
            await this._blacksmith.sockets.emit('broadcast.playerViewportSync', viewportState);
        } catch (error) {
            postConsoleAndNotification(MODULE.NAME, `BroadcastManager: Failed to send player viewport sync for ${userId}`, error, true, false);
        }
    }

    /**
     * Register player viewport syncing (socket handler and monitoring setup)
     */
    static _registerPlayerViewSync() {
        postConsoleAndNotification(MODULE.NAME, "BroadcastManager: _registerPlayerViewSync called", "", true, false);
        
        (async () => {
            try {
                const blacksmith = game.modules.get('coffee-pub-blacksmith')?.api;
                if (!blacksmith?.sockets) {
                    postConsoleAndNotification(MODULE.NAME, "BroadcastManager: Blacksmith sockets API not available for player view socket", "", true, false);
                    return;
                }
                
                await blacksmith.sockets.waitForReady();
                
                // Register socket handler for receiving player viewport updates (cameraman client)
                const playerViewportSyncHandler = 'broadcast.playerViewportSync';
                this._socketHandlerNames.add(playerViewportSyncHandler);
                await blacksmith.sockets.register(playerViewportSyncHandler, async (data, userId) => {
                    //  ------------------- BEGIN - HOOKMANAGER CALLBACK -------------------
                    
                    // Only process if we're the broadcast user and in the correct playerview mode
                    if (!this._isBroadcastUser()) return;
                    if (!this.isEnabled()) return;
                    
                    const mode = getSettingSafely(MODULE.ID, 'broadcastMode', 'spectator');
                    if (mode !== `playerview-${data.userId}`) return;
                    
                    // Apply player's viewport to cameraman's viewport
                    await this._applyPlayerViewport(data);
                    
                    //  ------------------- END - HOOKMANAGER CALLBACK ---------------------
                });
                
                postConsoleAndNotification(MODULE.NAME, "BroadcastManager: Player view socket handler registered successfully", "", true, false);
            } catch (error) {
                postConsoleAndNotification(MODULE.NAME, "BroadcastManager: Failed to register player view socket handler", error, true, false);
            }
            
            // Start monitoring for each player if mode matches
            this._updatePlayerViewportMonitoring();
        })();

        // Hook into setting changes to start/stop player viewport monitoring
this._blacksmith.HookManager.registerHook({
            name: 'settingChange',
            description: 'BroadcastManager: Start/stop player viewport monitoring when mode changes',
            context: 'broadcast-playerview-sync',
            priority: 5,
            key: 'broadcast-playerview-setting-change',
            callback: (moduleId, settingKey, value) => {
                //  ------------------- BEGIN - HOOKMANAGER CALLBACK -------------------
                
                if (moduleId === MODULE.ID && settingKey === 'broadcastMode') {
                    // Check if mode is a playerview mode
                    if (typeof value === 'string' && value.startsWith('playerview-') && value !== 'playerview-follow') {
                        const userId = value.replace('playerview-', '');
                        if (game.user.id === userId) {
                            this._startPlayerViewportMonitoring(userId);
                        } else {
                            this._stopPlayerViewportMonitoring(userId);
                        }
                    } else {
                        // Stop all player monitoring if mode changed away from playerview
                        this._stopAllPlayerViewportMonitoring();
                    }
                }
                
                //  ------------------- END - HOOKMANAGER CALLBACK ---------------------
            }
        });
    }

    /**
     * Update player viewport monitoring based on current mode
     */
    static _updatePlayerViewportMonitoring() {
        const mode = getSettingSafely(MODULE.ID, 'broadcastMode', 'spectator');
        
        if (typeof mode === 'string' && mode.startsWith('playerview-') && mode !== 'playerview-follow') {
            const userId = mode.replace('playerview-', '');
            if (game.user.id === userId) {
                this._startPlayerViewportMonitoring(userId);
            }
        } else {
            this._stopAllPlayerViewportMonitoring();
        }
    }

    /**
     * Stop all player viewport monitoring
     */
    static _stopAllPlayerViewportMonitoring() {
        const userIds = new Set([...this._playerPanHandlers.keys(), ...this._playerDebounces.keys()]);
        for (const userId of userIds) {
            this._stopPlayerViewportMonitoring(userId);
        }
    }

    /**
     * Apply player viewport to cameraman's viewport
     * @param {Object} viewportState - Viewport state {userId, x, y, scale}
     */
    static async _applyPlayerViewport(viewportState) {
        if (!this._isBroadcastUser()) return;
        if (!this.isEnabled()) return;
        if (!canvas?.ready) return;
        
        const mode = getSettingSafely(MODULE.ID, 'broadcastMode', 'spectator');
        if (mode !== `playerview-${viewportState.userId}`) return;

        // Guard correctly (allow 0)
        if (viewportState?.x == null || viewportState?.y == null || viewportState?.scale == null) return;

        const duration = this._hotPathSettings.animationDuration;

        await canvas.animatePan({
            x: viewportState.x,
            y: viewportState.y,
            scale: viewportState.scale,
            duration,
            easing: 'easeInOutCosine'
        });
    }

    // ==================================================================
    // ===== CLEANUP ====================================================
    // ==================================================================

    /**
     * Helper to track setTimeout for cleanup
     * @param {Function} callback - Callback function
     * @param {number} delay - Delay in milliseconds
     * @returns {number} Timeout ID
     */
    static _trackedSetTimeout(callback, delay) {
        const timeoutId = setTimeout(() => {
            this._timeoutIds.delete(timeoutId);
            callback();
        }, delay);
        this._timeoutIds.add(timeoutId);
        return timeoutId;
    }

    /**
     * Cancel a tracked timeout and remove it from `_timeoutIds` (use when cancelling debounced work early).
     * @param {number|undefined|null} timeoutId - Return value from `_trackedSetTimeout`
     */
    static _trackedClearTimeout(timeoutId) {
        if (timeoutId == null) return;
        clearTimeout(timeoutId);
        this._timeoutIds.delete(timeoutId);
    }

    /**
     * Request a Blacksmith menubar re-render; debounces non-immediate calls to coalesce noisy hooks.
     * @param {boolean} [immediate=false] - If true, render now and cancel any pending debounced render.
     */
    static _requestMenubarRender(immediate = false) {
        const api = this._blacksmith;
        if (typeof api?.renderMenubar !== 'function') return;
        if (immediate) {
            if (this._menubarRenderDebounceId != null) {
                this._trackedClearTimeout(this._menubarRenderDebounceId);
                this._menubarRenderDebounceId = null;
            }
            api.renderMenubar(true);
            return;
        }
        if (this._menubarRenderDebounceId != null) {
            this._trackedClearTimeout(this._menubarRenderDebounceId);
        }
        this._menubarRenderDebounceId = this._trackedSetTimeout(() => {
            this._menubarRenderDebounceId = null;
            api.renderMenubar(false);
        }, 100);
    }

    /**
     * Cached Blacksmith sockets readiness.
     * Helps avoid repeated `waitForReady()` calls on frequent sync paths (e.g. `canvasPan`).
     */
    static async _waitForSocketsReady() {
        const sockets = this._blacksmith?.sockets ?? game.modules.get('coffee-pub-blacksmith')?.api?.sockets;
        if (!sockets?.waitForReady) return;
        if (!this._socketsReadyPromise) {
            this._socketsReadyPromise = sockets.waitForReady();
        }
        await this._socketsReadyPromise;
    }

    /**
     * Clean up all resources (hooks, timeouts, socket handlers, Maps)
     */
    static cleanup() {
        postConsoleAndNotification(MODULE.NAME, "BroadcastManager: Cleaning up resources", "", true, false);

        // Stop all monitoring
        this._stopGMViewportMonitoring();
        this._stopAllPlayerViewportMonitoring();

        // Reset cached socket readiness (module reload / re-enable should recreate it)
        this._socketsReadyPromise = null;
        this._invalidateViewportCssCache();
        this._invalidateVisibleTokenListCaches();
        this._combatBarVisibilityOverride = null;

        // Clear debounced timers (tracked in `_timeoutIds`); null refs so callbacks cannot run stale logic
        if (this._gmDebounce) {
            this._trackedClearTimeout(this._gmDebounce);
            this._gmDebounce = null;
        }
        if (this._playerButtonsDebounce) {
            this._trackedClearTimeout(this._playerButtonsDebounce);
            this._playerButtonsDebounce = null;
        }
        for (const tid of this._playerDebounces.values()) {
            this._trackedClearTimeout(tid);
        }
        this._playerDebounces.clear();

        if (this._menubarRenderDebounceId != null) {
            this._trackedClearTimeout(this._menubarRenderDebounceId);
            this._menubarRenderDebounceId = null;
        }

        // Clear any remaining tracked timeouts (defensive; overlaps above are no-ops)
        for (const timeoutId of this._timeoutIds) {
            clearTimeout(timeoutId);
        }
        this._timeoutIds.clear();

        // Clear Maps (handlers already removed by _stopAllPlayerViewportMonitoring)
        this._playerPanHandlers.clear();

        // Unregister all HookManager hooks by context
        this._blacksmith?.HookManager?.disposeByContext('broadcast-settings');
        this._blacksmith?.HookManager?.disposeByContext('broadcast-camera-init');
        this._blacksmith?.HookManager?.disposeByContext('broadcast-camera');
        this._blacksmith?.HookManager?.disposeByContext('broadcast-gmview-sync');
        this._blacksmith?.HookManager?.disposeByContext('broadcast-mode-buttons');
        this._blacksmith?.HookManager?.disposeByContext('broadcast-playerview-sync');
        this._blacksmith?.HookManager?.disposeByContext('broadcast-player-buttons');
        this._blacksmith?.HookManager?.disposeByContext('broadcast-windows');
        this._blacksmith?.HookManager?.disposeByContext('broadcast-cleanup');

        // Unregister menubar visibility override (if API provides it)
        if (typeof this._blacksmith?.unregisterMenubarVisibilityOverride === 'function') {
            this._blacksmith.unregisterMenubarVisibilityOverride(MODULE.ID);
        }

        // Socket handlers: Blacksmith has no api.sockets.unregister; handlers persist until full client reload.
        // See documentation/blacksmith-sockets-unload.md. We only clear our name list for Herald bookkeeping.
        this._socketHandlerNames.clear();

        // Clear hook IDs tracking
        this._hookIds.clear();

        // Reset initialization flag
        this.isInitialized = false;
        // Allow window hooks to be re-registered on re-initialize
        this._broadcastWindowHooksRegistered = false;

        postConsoleAndNotification(MODULE.NAME, "BroadcastManager: Cleanup complete", "", true, false);
    }
}
