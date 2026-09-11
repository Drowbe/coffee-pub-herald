// ==================================================================
// ===== HERALD CONSTANTS ============================================
// ==================================================================

const moduleData = {
    id: "coffee-pub-herald",
    title: "Coffee Pub Herald",
    version: "14.0.0",
    authors: [{ name: "COFFEE PUB" }]
};

export const MODULE = {
    ID: moduleData.id,
    NAME: "HERALD",
    TITLE: moduleData.title,
    VERSION: moduleData.version,
    AUTHOR: moduleData.authors[0]?.name || "COFFEE PUB",
    APIVERSION: "14.0.0"
};

/**
 * Stream overlay widgets captured by Coffee Pub Studio.
 * The root id is the CSS selector Studio measures; do not change it lightly.
 */
export const STREAM_STATS = {
    ROOT_ID: 'herald-stats',
    SELECTOR: '#herald-stats',
    SETTING_KEY: 'streamShowMvpLeaderboard',
    WIDTH: 380,
    HEIGHT: 320,
    GAP: 12,
    FALLBACK_LEFT: 320,
    FALLBACK_TOP: 8
};
