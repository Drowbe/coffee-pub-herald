// ==================================================================
// ===== STREAM STATS WIDGET ========================================
// ==================================================================
// Overlay for Foundry's /stream capture page. Coffee Pub Studio crops
// this element into its own OBS source by measuring #herald-stats.
// Habits that make that crop reliable are in
// documentation/architecture/architecture-stream-widgets.md.
//
// Stream detection matches Blacksmith: toasts gate on `game.view ===
// 'stream'` (api-toast.js); the loading overlay also accepts
// `body.stream` (manager-loading-progress.js), which is true before
// `game.view` exists. Layout is inline and JS-owned, same reason as
// the toast billboard layer: a stale or missing stylesheet must not
// let this box participate in Foundry's body layout.

import { MODULE, STREAM_STATS } from './const.js';

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

export class StreamStatsWidget {
    static _initialized = false;
    static _root = null;
    static _refreshTimer = null;
    static _placeTimer = null;
    static _nativeHookFns = [];
    static _left = STREAM_STATS.FALLBACK_LEFT;
    static _top = STREAM_STATS.FALLBACK_TOP;

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

        const first = !this._initialized;
        this._initialized = true;
        this._ensureRoot();
        this._placeBesideChat();
        this._applyVisibility();
        if (first) {
            this._registerHooks();
            // Paint immediately so the box is never an empty rectangle while
            // stats load. Blacksmith's waitForReady() only resolves — if the
            // stream page never marks consumers ready, awaiting it leaves this
            // overlay black forever.
            this._paint({ hasLeaderboard: false, emptyMessage: 'Loading…' });
            postConsoleAndNotification(MODULE.NAME, 'StreamStatsWidget: mounted', { selector: STREAM_STATS.SELECTOR }, false, false);
        }
        void this.refresh();
    }

    static _ensureRoot() {
        let root = document.getElementById(STREAM_STATS.ROOT_ID);
        if (!root) {
            root = document.createElement('aside');
            root.id = STREAM_STATS.ROOT_ID;
            root.className = 'herald-stats-widget';
            root.setAttribute('data-herald-widget', 'mvp-leaderboard');
            root.setAttribute('aria-label', 'Lifetime MVP leaderboard');
            document.body.appendChild(root);
        }
        this._root = root;
        this._applyInlineBox(this._left, this._top);
    }

    /**
     * Sit immediately to the right of Foundry's stream chat column.
     * Size and position are whole pixels and inline so Studio's crop
     * does not depend on module CSS winning against body.stream rules.
     */
    static _placeBesideChat() {
        if (!this._root) return;
        const chat = this._findChatColumn();
        let left = STREAM_STATS.FALLBACK_LEFT;
        let top = STREAM_STATS.FALLBACK_TOP;
        if (chat) {
            const r = chat.getBoundingClientRect();
            if (r.width > 0) {
                left = Math.round(r.right) + STREAM_STATS.GAP;
                top = Math.round(Math.max(STREAM_STATS.FALLBACK_TOP, r.top));
            }
        }
        this._left = left;
        this._top = top;
        this._applyInlineBox(left, top);
    }

    static _findChatColumn() {
        for (const selector of ['#chat', 'section#chat', '#chat-log', '#chat-notifications']) {
            const el = document.querySelector(selector);
            if (!el) continue;
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) return el;
        }
        return null;
    }

    static _applyInlineBox(left, top) {
        const root = this._root;
        if (!root) return;
        const hidden = !this._isEnabled();
        const set = (prop, value) => root.style.setProperty(prop, value, 'important');
        set('position', 'fixed');
        set('top', `${top}px`);
        set('left', `${left}px`);
        set('right', 'auto');
        set('width', `${STREAM_STATS.WIDTH}px`);
        set('height', `${STREAM_STATS.HEIGHT}px`);
        set('margin', '0');
        set('padding', '0');
        set('box-sizing', 'border-box');
        set('overflow', 'hidden');
        set('z-index', '9990');
        set('pointer-events', 'none');
        set('display', 'block');
        set('visibility', hidden ? 'hidden' : 'visible');
        set('background', '#222222');
        set('border', '1px solid #8d8061');
        set('color', '#bdbdae');
        set('transform', 'none');
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
            'Herald stream stats: place the widget beside chat once the log exists',
            () => this._placeBesideChat()
        );
        register(
            'canvasReady',
            'Herald stream stats: re-place beside chat if the stream page paints late',
            () => this._placeBesideChat()
        );

        window.addEventListener('resize', () => this._placeBesideChat());

        if (this._placeTimer) clearTimeout(this._placeTimer);
        this._placeTimer = setTimeout(() => this._placeBesideChat(), 250);

        if (canManage && typeof hookManager.registerSettingChangeCallback === 'function') {
            hookManager.registerSettingChangeCallback({
                description: 'Herald stream stats: hide or show when the stream setting changes',
                context: 'herald-stream-stats',
                priority: 3,
                callback: (namespace, key) => {
                    if (namespace !== MODULE.ID || key !== STREAM_STATS.SETTING_KEY) return;
                    this.onSettingChanged();
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

    static onSettingChanged() {
        if (!this._root) return;
        this._applyVisibility();
        if (this._isEnabled()) void this.refresh();
    }

    /**
     * Hide with visibility, never display:none or remove. Studio measures
     * this box on every sync; a missing element makes the selector fail and
     * OBS keeps the last crop over whatever is now underneath.
     */
    static _applyVisibility() {
        this._applyInlineBox(this._left, this._top);
        if (!this._root) return;
        this._root.classList.toggle('herald-stats-widget--hidden', !this._isEnabled());
    }

    static _scheduleRefresh() {
        if (!this._root || !this._isEnabled()) return;
        if (this._refreshTimer) clearTimeout(this._refreshTimer);
        this._refreshTimer = setTimeout(() => {
            this._refreshTimer = null;
            void this.refresh();
        }, 250);
    }

    static async refresh() {
        if (!this._root) return;
        this._paint(await this._getData());
    }

    /**
     * DOM-direct, same as Blacksmith toasts. Handlebars is not used: the
     * /stream page is a thin capture surface, and a failed template fetch
     * left this box empty. Names land via textContent.
     */
    static _paint(data) {
        const root = this._root;
        if (!root) return;

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

        root.replaceChildren(inner);
    }

    static _paintRow(row) {
        const li = document.createElement('li');
        li.className = `herald-stats-row ${row.rankClass || ''}`.trim();

        const rank = document.createElement('span');
        rank.className = 'herald-stats-col herald-stats-col--rank';
        rank.textContent = String(row.rank);

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

    static async _getData() {
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
            postConsoleAndNotification(MODULE.NAME, 'StreamStatsWidget: failed to load party aggregate', error?.message ?? error, false, false);
            payload.emptyMessage = 'Could not load MVP rankings.';
        }

        return payload;
    }

    static cleanup() {
        if (this._refreshTimer) {
            clearTimeout(this._refreshTimer);
            this._refreshTimer = null;
        }
        if (this._placeTimer) {
            clearTimeout(this._placeTimer);
            this._placeTimer = null;
        }
        game.modules.get('coffee-pub-blacksmith')?.api?.HookManager?.disposeByContext('herald-stream-stats');
        for (const { name, callback } of this._nativeHookFns) {
            Hooks.off(name, callback);
        }
        this._nativeHookFns = [];
        this._root?.remove();
        this._root = null;
        this._initialized = false;
    }
}
