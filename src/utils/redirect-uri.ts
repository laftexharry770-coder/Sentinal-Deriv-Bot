/**
 * The OAuth redirect URI, in one place.
 *
 * OAuth 2.0 compares this value twice, and both comparisons are exact string
 * matches:
 *
 *   1. the authorization request, against the Redirect URL registered on the
 *      application at developers.deriv.com — a mismatch answers invalid_request
 *      before the user ever sees a consent screen;
 *   2. the token exchange, against the value sent in step 1 — a mismatch here
 *      answers invalid_grant *after* the user has consented, so the round trip
 *      looks like it worked right up until the app is still signed out.
 *
 * They were computed separately and disagreed: the authorization request
 * included the project-site subpath while the exchange used only the origin. A
 * single function is what keeps the two halves from drifting again.
 *
 * PUBLIC_BASE_PATH is the same subpath the assets and the React Router basename
 * use; it is empty for a root deploy, which yields `${origin}/`.
 */
export const getRedirectUri = (): string => {
    const basePath = (process.env.PUBLIC_BASE_PATH ?? '').replace(/\/+$/, '');
    return `${window.location.origin}${basePath}/`;
};
