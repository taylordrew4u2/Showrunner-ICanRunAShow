/**
 * The two origins the end-to-end suite serves the app on.
 *
 * In production a co-producer's view runs on its own origin
 * (showrunner-theta.vercel.app), so its browser storage is never that of
 * either producer's own account. The suite reproduces that with one
 * `vite preview` answering on two addresses that a browser treats as two
 * origins: the owner's app on localhost, the co-producer's on 127.0.0.1.
 * playwright.config.ts builds with these as VITE_MAIN_ORIGIN and
 * VITE_COPRODUCE_ORIGIN, and the fake API (fake-coproducer.mjs) checks
 * callers' Origin headers against them, as api/coproducer.ts does.
 */
export const PORT = 4173;
export const MAIN_ORIGIN = `http://localhost:${PORT}`;
export const REVIEW_ORIGIN = `http://127.0.0.1:${PORT}`;
