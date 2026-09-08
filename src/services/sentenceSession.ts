// Evaluated once per app cold start (JS bundle load). Any generated sentence
// with createdAt >= SESSION_START belongs to "this session".
export const SESSION_START = Date.now();

// Languages for which we've already kicked off a fresh batch this session, so
// the Sentence Trainer only auto-refreshes once per language per launch.
export const sessionRefreshedLangs = new Set<string>();
