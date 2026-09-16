// ==================================================================
// ===== STREAM STATS WINDOW ========================================
// ==================================================================
// Lifetime MVP leaderboard on Foundry's `/stream` capture page.
// Coffee Pub Studio crops `#herald-stats` into its own OBS source.
// Habits that make that crop reliable are in
// documentation/architecture/architecture-stream-widgets.md.
//
// This is a Blacksmith tool window with Auto-Hide chrome (see
// HeraldStreamWindowBaseV2). Inner markup is DOM-direct like Blacksmith
// toasts — no Herald Handlebars template — because a failed template
// fetch on `/stream` left this box empty.
//
// Do not await `window.BlacksmithAPI.waitForReady()` here. Verified live on
// `/stream` (2026-09-15): `window.BlacksmithAPI` exists but `.isReady` stays
// false for the full page session — Blacksmith's own `ready`-hook handler
// starts (far enough to dynamically import api/blacksmith-api.js and assign
// the global) but never reaches `markReadyForConsumers()` on this page,
// almost certainly because a later step in that same handler (menubar/UI
// setup) depends on chrome that `/stream` does not render and hangs.
// `waitForReady()` only ever resolves, never rejects, so a consumer that
// awaits it here waits forever and the window never gets data.
//
// Instead, wait for the one concrete precondition this widget actually
// needs: Blacksmith's `combatHistory` world setting being registered (see
// `_waitForCombatHistorySetting` below). That setting is registered by
// Blacksmith's `registerSettings()`, called early in the same ready-hook
// handler — before the part that hangs on `/stream` — so polling for it
// directly sidesteps the parts of Blacksmith's boot that never finish here.
// Calling `stats.party.getAggregate()` before it exists throws "combatHistory
// is not a registered game setting", caught below, and paints an empty state.

import { MODULE, STREAM_STATS, STREAM_WINDOW } from './const.js';
import { HeraldStreamWindowBaseV2 } from './window-stream-base.js';

function postConsoleAndNotification(strModuleID, message, result, blnDebug, blnNotification) {
    const api = game.modules.get('coffee-pub-blacksmith')?.api;
    const fromApi = api?.utils?.postConsoleAndNotification;
    const fromGlobal = globalThis.BlacksmithUtils?.postConsoleAndNotification;
    const fn = typeof fromApi === 'function' ? fromApi : typeof fromGlobal === 'function' ? fromGlobal : null;
    if (fn) {
        fn(strModuleID, message, result, blnDebug, blnNotification);
    } else if (blnDebug) {
        console.debug(strModuleID, message, result ?? '');
    }
}

function getSettingSafely(key, def) {
    try {
        const s = game.settings.settings.get(`${MODULE.ID}.${key}`);
        if (!s) return def;
        return game.settings.get(MODULE.ID, key) ?? def;
    } catch (_) {
        return def;
    }
}

export class StreamStatsWindow extends HeraldStreamWindowBaseV2 {
    static DEFAULT_OPTIONS = foundry.utils.mergeObject(
        {},
        {
            id: STREAM_STATS.ROOT_ID,
            classes: ['herald-stats-window'],
            position: {
                width: STREAM_STATS.WIDTH,
                height: STREAM_STATS.HEIGHT,
                left: STREAM_WINDOW.FALLBACK_LEFT,
                top: STREAM_WINDOW.FALLBACK_TOP
            },
            window: { title: 'Lifetime MVP', resizable: false, minimizable: false },
            windowPositionKey: STREAM_STATS.POSITION_KEY,
            windowSizeConstraints: {
                minWidth: STREAM_STATS.WIDTH,
                maxWidth: STREAM_STATS.WIDTH,
                minHeight: STREAM_STATS.HEIGHT,
                maxHeight: STREAM_STATS.HEIGHT
            }
        }
    );

    constructor(options = {}) {
        super(options);
        this._lastData = null;
    }

    isStreamContentEnabled() {
        return getSettingSafely(STREAM_STATS.SETTING_KEY, true) === true;
    }

    async onStreamDismissed() {
        try {
            const setting = game.settings.settings.get(`${MODULE.ID}.${STREAM_STATS.SETTING_KEY}`);
            if (!setting) return;
            if (game.settings.get(MODULE.ID, STREAM_STATS.SETTING_KEY) === false) return;
            await game.settings.set(MODULE.ID, STREAM_STATS.SETTING_KEY, false);
        } catch (_) { /* settings may not be registered yet */ }
    }

    async _onRender(context, options) {
        await super._onRender(context, options);
        this._paint(this._lastData ?? { hasLeaderboard: false, emptyMessage: 'Loading…' });
    }

    async refresh() {
        this._lastData = await this._getData();
        this._paint(this._lastData);
    }

    _body() {
        return this.element?.querySelector('.blacksmith-window-tool-body') ?? null;
    }

    _paint(data) {
        const body = this._body();
        if (!body || !data) return;

        const inner = document.createElement('div');
        inner.className = 'herald-stats-inner';

        const header = document.createElement('header');
        header.className = 'herald-stats-header';
        const icon = document.createElement('i');
        icon.className = 'fa-solid fa-trophy';
        icon.setAttribute('aria-hidden', 'true');
        const title = document.createElement('span');
        title.className = 'herald-stats-title';
        title.textContent = 'Lifetime MVP';
        header.append(icon, title);
        inner.appendChild(header);

        if (data.hasLeaderboard && data.leaderboard.length) {
            const cols = document.createElement('div');
            cols.className = 'herald-stats-columns';
            cols.setAttribute('aria-hidden', 'true');
            for (const [cls, label] of [
                ['herald-stats-col--rank', '#'],
                ['herald-stats-col--player', 'Player'],
                ['herald-stats-col--score', 'Total'],
                ['herald-stats-col--avg', 'Avg'],
                ['herald-stats-col--combats', 'Fights']
            ]) {
                const span = document.createElement('span');
                span.className = `herald-stats-col ${cls}`;
                span.textContent = label;
                cols.appendChild(span);
            }
            inner.appendChild(cols);

            const list = document.createElement('ol');
            list.className = 'herald-stats-list';
            for (const row of data.leaderboard) {
                list.appendChild(this._paintRow(row));
            }
            inner.appendChild(list);
        } else {
            const empty = document.createElement('div');
            empty.className = 'herald-stats-empty';
            empty.textContent = data.emptyMessage || 'No MVP rankings yet.';
            inner.appendChild(empty);
        }

        body.replaceChildren(inner);
    }

    _paintRow(row) {
        const li = document.createElement('li');
        li.className = `herald-stats-row ${row.rankClass || ''}`.trim();

        const rank = document.createElement('span');
        rank.className = 'herald-stats-col herald-stats-col--rank';
        if (row.rank === 1 || row.rank === 2 || row.rank === 3) {
            const medal = document.createElement('i');
            medal.className = 'fa-solid fa-medal';
            medal.setAttribute('aria-hidden', 'true');
            rank.appendChild(medal);
        } else {
            rank.textContent = String(row.rank);
        }

        const player = document.createElement('span');
        player.className = 'herald-stats-col herald-stats-col--player';
        const img = document.createElement('img');
        img.className = 'herald-stats-portrait';
        img.src = row.img;
        img.alt = '';
        const name = document.createElement('span');
        name.className = 'herald-stats-name';
        name.textContent = row.name;
        player.append(img, name);

        const score = document.createElement('span');
        score.className = 'herald-stats-col herald-stats-col--score';
        score.textContent = String(row.totalScore);

        const avg = document.createElement('span');
        avg.className = 'herald-stats-col herald-stats-col--avg';
        avg.textContent = String(row.averageScore);

        const combats = document.createElement('span');
        combats.className = 'herald-stats-col herald-stats-col--combats';
        combats.textContent = String(row.combats);

        li.append(rank, player, score, avg, combats);
        return li;
    }

    async _getData() {
        const payload = {
            hasBlacksmith: false,
            hasLeaderboard: false,
            leaderboard: [],
            emptyMessage: 'No MVP rankings yet.'
        };

        const api = game.modules.get('coffee-pub-blacksmith')?.api;
        const partyApi = api?.stats?.party;
        if (!partyApi || typeof partyApi.getAggregate !== 'function') {
            payload.emptyMessage = 'Blacksmith stats are unavailable.';
            return payload;
        }
        payload.hasBlacksmith = true;

        try {
            const aggregate = await partyApi.getAggregate();
            const rows = Array.isArray(aggregate?.leaderboard) ? aggregate.leaderboard : [];
            payload.leaderboard = rows.map((entry, index) => {
                const rank = Number(entry.rank) || (index + 1);
                const mvp = entry.mvp || {};
                return {
                    rank,
                    rankClass: rank === 1 ? 'herald-stats-row--first' : rank === 2 ? 'herald-stats-row--second' : rank === 3 ? 'herald-stats-row--third' : '',
                    actorId: entry.actorId,
                    name: entry.name || 'Unknown',
                    img: entry.img || 'icons/svg/mystery-man.svg',
                    totalScore: mvp.totalScore ?? '0.0',
                    averageScore: mvp.averageScore ?? '0.0',
                    combats: mvp.combats ?? 0
                };
            });
            payload.hasLeaderboard = payload.leaderboard.length > 0;
        } catch (error) {
            postConsoleAndNotification(MODULE.NAME, 'StreamStatsWindow: failed to load party aggregate', error?.message ?? error, false, false);
            payload.emptyMessage = 'Could not load MVP rankings.';
        }

        return payload;
    }
}

export class StreamStatsWidget {
    static _window = null;
    static _opening = null;
    static _mounted = false;
    static _refreshTimer = null;
    static _hooksRegistered = false;
    static _nativeHookFns = [];

    /**
     * Same capture-page tests Blacksmith uses.
     * Toasts: `game.view === 'stream'`.
     * Loading overlay: `body.stream` (available before `game.view`).
     * `body.no-ui` is NOT used here — that can appear on the cameraman
     * tabletop, which must not grow this overlay.
     */
    static isStreamView() {
        if (game?.view === 'stream') return true;
        if (typeof document === 'undefined' || !document.body) return false;
        return document.body.classList.contains('stream');
    }

    static initialize() {
        if (!this.isStreamView()) {
            postConsoleAndNotification(
                MODULE.NAME,
                'StreamStatsWidget: not the /stream view; skipping',
                { view: game?.view, path: window.location?.pathname, bodyClass: document.body?.className },
                true,
                false
            );
            return;
        }

        this.applyPageBackground();
        if (!this._hooksRegistered) {
            this._registerHooks();
            this._hooksRegistered = true;
        }
        void this._ensureWindow().then(async (win) => {
            if (!win) return;
            if (!this._mounted) {
                this._mounted = true;
                postConsoleAndNotification(MODULE.NAME, 'StreamStatsWidget: mounted', { selector: STREAM_STATS.SELECTOR }, false, false);
            }
            // Window chrome mounts at `init` so the capture page never shows a
            // gap. The data fetch waits for Blacksmith's `combatHistory`
            // setting specifically — see the file-level note above for why
            // that, and not BlacksmithAPI.waitForReady(), is the right gate.
            await this._waitForCombatHistorySetting();
            void this.refresh();
        });
    }

    static async _waitForCombatHistorySetting(timeoutMs = 20000, intervalMs = 100) {
        const key = 'coffee-pub-blacksmith.combatHistory';
        const deadline = Date.now() + timeoutMs;
        while (!game.settings.settings.get(key)) {
            if (Date.now() >= deadline) return false;
            await new Promise((resolve) => setTimeout(resolve, intervalMs));
        }
        return true;
    }

    static async _ensureWindow() {
        if (this._opening) return this._opening;
        this._opening = (async () => {
            try {
                if (!this._window) this._window = new StreamStatsWindow();
                if (!this._window.rendered) await this._window.render({ force: true });
                this._window.syncStreamVisibility();
                return this._window;
            } catch (error) {
                postConsoleAndNotification(
                    MODULE.NAME,
                    'StreamStatsWidget: failed to render stream window',
                    error?.message ?? error,
                    false,
                    false
                );
                return null;
            }
        })();
        try {
            return await this._opening;
        } finally {
            this._opening = null;
        }
    }

    static _registerHooks() {
        const api = game.modules.get('coffee-pub-blacksmith')?.api;
        const hookManager = api?.HookManager;
        const canManage = hookManager && typeof hookManager.registerHook === 'function';

        const register = (name, description, callback) => {
            if (canManage) {
                hookManager.registerHook({
                    name,
                    description,
                    context: 'herald-stream-stats',
                    priority: 3,
                    callback
                });
                return;
            }
            Hooks.on(name, callback);
            this._nativeHookFns.push({ name, callback });
        };

        register(
            'blacksmith.combatSummaryReady',
            'Herald stream stats: refresh MVP leaderboard when a combat ends',
            () => this._scheduleRefresh()
        );
        register(
            'updateActor',
            'Herald stream stats: refresh MVP leaderboard when an actor changes',
            (_actor, changes) => {
                if (!changes || changes.name || changes.img || changes.ownership || changes.flags) {
                    this._scheduleRefresh();
                }
            }
        );
        register(
            'createActor',
            'Herald stream stats: refresh MVP leaderboard when an actor is added',
            () => this._scheduleRefresh()
        );
        register(
            'deleteActor',
            'Herald stream stats: refresh MVP leaderboard when an actor is removed',
            () => this._scheduleRefresh()
        );
        register(
            'renderChatLog',
            'Herald stream stats: place the window beside chat once the log exists',
            () => this._placeBesideChat()
        );
        register(
            'canvasReady',
            'Herald stream stats: re-place beside chat if the stream page paints late',
            () => this._placeBesideChat()
        );

        window.addEventListener('resize', () => this._placeBesideChat());

        if (canManage && typeof hookManager.registerSettingChangeCallback === 'function') {
            hookManager.registerSettingChangeCallback({
                description: 'Herald stream stats: hide or show when the stream setting changes',
                context: 'herald-stream-stats',
                priority: 3,
                callback: (namespace, key) => {
                    if (namespace !== MODULE.ID) return;
                    if (key === STREAM_STATS.BACKGROUND_KEY) this.applyPageBackground();
                    if (key === STREAM_STATS.SETTING_KEY) this.onSettingChanged();
                }
            });
        }

        if (canManage) {
            hookManager.registerHook({
                name: 'unloadModule',
                description: 'Herald stream stats: tear down on module unload',
                context: 'herald-stream-stats',
                priority: 3,
                callback: (moduleId) => {
                    if (moduleId === MODULE.ID) this.cleanup();
                }
            });
        }
    }

    static _isEnabled() {
        return getSettingSafely(STREAM_STATS.SETTING_KEY, true) === true;
    }

    /**
     * Foundry hardcodes `body.stream { background: lime }` for chroma key.
     * OBS browser sources and Studio compositing want a transparent page
     * instead. Applied inline so that core rule cannot win.
     */
    static applyPageBackground() {
        if (!this.isStreamView()) return;
        const transparent = getSettingSafely(STREAM_STATS.BACKGROUND_KEY, true) === true;
        document.documentElement.classList.toggle('herald-stream-transparent', transparent);
        document.body.classList.toggle('herald-stream-transparent', transparent);
        for (const el of [document.documentElement, document.body]) {
            if (transparent) {
                el.style.setProperty('background', 'transparent', 'important');
                el.style.setProperty('background-color', 'transparent', 'important');
            } else {
                el.style.removeProperty('background');
                el.style.removeProperty('background-color');
            }
        }
    }

    static onSettingChanged() {
        this.applyPageBackground();
        if (!this.isStreamView()) return;
        void this._ensureWindow().then((win) => {
            if (!win) return;
            win.syncStreamVisibility();
            if (this._isEnabled()) void this.refresh();
        });
    }

    static _placeBesideChat() {
        this._window?._placeBesideChat?.();
    }

    static _scheduleRefresh() {
        if (!this._window?.rendered || !this._isEnabled()) return;
        if (this._refreshTimer) clearTimeout(this._refreshTimer);
        this._refreshTimer = setTimeout(() => {
            this._refreshTimer = null;
            void this.refresh();
        }, 250);
    }

    static async refresh() {
        if (!this._window?.rendered) return;
        await this._window.refresh();
    }

    static cleanup() {
        if (this._refreshTimer) {
            clearTimeout(this._refreshTimer);
            this._refreshTimer = null;
        }
        game.modules.get('coffee-pub-blacksmith')?.api?.HookManager?.disposeByContext('herald-stream-stats');
        for (const { name, callback } of this._nativeHookFns) {
            Hooks.off(name, callback);
        }
        this._nativeHookFns = [];
        this._hooksRegistered = false;
        this._mounted = false;
        this._opening = null;
        const win = this._window;
        this._window = null;
        void win?.close({ heraldForce: true });
    }
}
