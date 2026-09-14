// ==================================================================
// ===== HERALD STREAM WINDOW BASE ==================================
// ==================================================================
//
// Blacksmith tool windows that live on Foundry's `/stream` capture page
// so Coffee Pub Studio can crop them. The next stream window subclasses
// this rather than BlacksmithToolWindowBaseV2 directly.
//
// Default chrome is Auto-Hide (`BLACKSMITH_TOOL_TITLEBARS.AUTO`): the
// title bar is a near-invisible strip at rest and expands as an overlay
// on hover/focus, so the OBS crop does not grow and the body never
// shifts. Users can still pick Full / Micro / Auto-Hide from the window's
// Title Bar submenu.
//
// Import the base from Blacksmith's bridge, not from `module.api`. Do not
// copy `super.DEFAULT_OPTIONS` into a subclass — Foundry already walks
// the prototype chain, and copying it on v14 duplicates Detach/Attach.

import {
    BlacksmithToolWindowBaseV2,
    BLACKSMITH_TOOL_TITLEBARS,
    BLACKSMITH_TOOL_THEMES
} from '/modules/coffee-pub-blacksmith/api/blacksmith-api.js';
import { STREAM_WINDOW } from './const.js';

export { BLACKSMITH_TOOL_TITLEBARS, BLACKSMITH_TOOL_THEMES };

export class HeraldStreamWindowBaseV2 extends BlacksmithToolWindowBaseV2 {
    static DEFAULT_OPTIONS = foundry.utils.mergeObject(
        {},
        {
            classes: ['herald-stream-window'],
            toolTitlebar: BLACKSMITH_TOOL_TITLEBARS.AUTO,
            toolTheme: BLACKSMITH_TOOL_THEMES.DARK,
            window: {
                resizable: false,
                minimizable: false
            },
            rememberPosition: true,
            rememberTitlebarMode: true,
            allowTitlebarModeToggle: true,
            rememberToolTheme: true,
            allowToolThemeToggle: true
        }
    );

    constructor(options = {}) {
        super(options);
        this._placing = false;
        this._userMoved = false;
        this._placeTimer = null;
    }

    async getData() {
        return {
            appId: `${this.id}-body`,
            bodyContent: ''
        };
    }

    /**
     * Override per window: false hides with visibility so Studio's selector
     * stays in the page.
     */
    isStreamContentEnabled() {
        return true;
    }

    /**
     * Called when the user dismisses the window (Close / Escape) instead of
     * removing it. Override to persist a setting.
     */
    async onStreamDismissed() {}

    setStreamVisible(visible) {
        const el = this.element;
        if (!el) return;
        el.classList.toggle('herald-stream-window--hidden', !visible);
        el.style.setProperty('visibility', visible ? 'visible' : 'hidden', 'important');
    }

    syncStreamVisibility() {
        this.setStreamVisible(this.isStreamContentEnabled());
    }

    /**
     * Studio crops this element. Hide it; do not let ApplicationV2 remove it.
     * Module unload passes `{ heraldForce: true }` to actually close.
     */
    async close(options = {}) {
        if (options?.heraldForce) {
            if (this._placeTimer) {
                clearTimeout(this._placeTimer);
                this._placeTimer = null;
            }
            return super.close(options);
        }
        this.setStreamVisible(false);
        await this.onStreamDismissed();
        return this;
    }

    /**
     * A detached copy would leave `/stream`, and Studio's crop would follow
     * empty space. Stream windows stay in this document.
     */
    _canDetach() {
        return false;
    }

    setPosition(position = {}) {
        if (!this._placing && this.rendered) this._userMoved = true;
        return super.setPosition(position);
    }

    async _onFirstRender(context, options) {
        await super._onFirstRender(context, options);
        this.syncStreamVisibility();
        if (!this._loadWindowPosition()) {
            this._placeBesideChat();
            if (this._placeTimer) clearTimeout(this._placeTimer);
            this._placeTimer = setTimeout(() => {
                this._placeTimer = null;
                if (!this._userMoved) this._placeBesideChat();
            }, 250);
        }
    }

    async _onRender(context, options) {
        await super._onRender?.(context, options);
        this.syncStreamVisibility();
    }

    /**
     * First open sits immediately to the right of Foundry's stream chat
     * column. After the user drags the window, remembered position wins.
     */
    _placeBesideChat() {
        if (!this.element || this._userMoved) return;
        const chat = HeraldStreamWindowBaseV2.findChatColumn();
        let left = STREAM_WINDOW.FALLBACK_LEFT;
        let top = STREAM_WINDOW.FALLBACK_TOP;
        if (chat) {
            const r = chat.getBoundingClientRect();
            if (r.width > 0) {
                left = Math.round(r.right) + STREAM_WINDOW.GAP;
                top = Math.round(Math.max(STREAM_WINDOW.FALLBACK_TOP, r.top));
            }
        }
        const width = Number(this.options?.position?.width) || this.position?.width;
        const height = Number(this.options?.position?.height) || this.position?.height;
        this._placing = true;
        this.setPosition({ left, top, width, height });
        this._placing = false;
    }

    static findChatColumn() {
        for (const selector of ['#chat', 'section#chat', '#chat-log', '#chat-notifications']) {
            const el = document.querySelector(selector);
            if (!el) continue;
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) return el;
        }
        return null;
    }
}
