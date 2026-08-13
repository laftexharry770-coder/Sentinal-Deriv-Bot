import {
    buildAuthorizationUrl,
    buildSignUpUrl,
    getAuthInfo,
    parseReferralLink,
    parseLandingParams,
    resolveReferralViaProxy,
} from '@/external/deriv-core';
import type { AuthConfig } from '@/external/deriv-core';
import { DerivWSAccountsService } from '@/services/derivws-accounts.service';
import brandConfig from '../../../../../brand.config.json';

// =============================================================================
// Constants - Domain & Server Configuration (from brand.config.json)
// =============================================================================

// Production app domains
export const PRODUCTION_DOMAINS = {
    COM: brandConfig.platform.hostname.production.com,
} as const;

// Staging app domains
export const STAGING_DOMAINS = {
    COM: brandConfig.platform.hostname.staging.com,
} as const;

// WebSocket server URLs
export const WS_SERVERS = {
    STAGING: `${brandConfig.platform.derivws.url.staging}options/ws/public`,
    PRODUCTION: `${brandConfig.platform.derivws.url.production}options/ws/public`,
} as const;

// =============================================================================
// Helper Functions
// =============================================================================

// Helper to check if we're on production.
// NEXT_PUBLIC_DERIV_ENV is the authoritative signal (set at build/deploy time and
// also read by vendored deriv-core for OAuth), so a deployed partner domain resolves the
// same environment for WebSocket and OAuth. Falls back to hostname detection when
// the env var is unset (e.g. local dev).
export const isProduction = () => {
    const env = process.env.NEXT_PUBLIC_DERIV_ENV;
    if (env === 'production') return true;
    if (env === 'preview' || env === 'staging') return false;

    const hostname = window.location.hostname;
    const productionDomains = Object.values(PRODUCTION_DOMAINS) as string[];
    return productionDomains.includes(hostname);
};

export const isLocal = () => /localhost(:\d+)?$/i.test(window.location.hostname);

const getDefaultServerURL = () => {
    const isProductionEnv = isProduction();

    try {
        return isProductionEnv ? WS_SERVERS.PRODUCTION : WS_SERVERS.STAGING;
    } catch (error) {
        console.error('Error in getDefaultServerURL:', error);
    }

    return isProductionEnv ? WS_SERVERS.PRODUCTION : WS_SERVERS.STAGING;
};

/**
 * Gets the WebSocket URL using the authenticated flow
 * 1. Get access token from auth_info (localStorage via vendored deriv-core)
 * 2. Fetch OTP WebSocket URL from DerivWSAccountsService
 *
 * @returns Promise with WebSocket URL or fallback to default server
 */
export const getSocketURL = async (): Promise<string> => {
    const authInfo = getAuthInfo();

    // Genuinely signed out: the public channel is the right answer.
    if (!authInfo || !authInfo.access_token) {
        return getDefaultServerURL();
    }

    // Signed in, so the public channel is never the right answer. It carries
    // market data only -- account-scoped reads like the balance are not
    // available on it at all, by design. Falling back to it on a transient OTP
    // failure produced a session that looked connected and simply never showed
    // a balance, until something else forced a reconnect.
    //
    // The OTP is short-lived and single-use, so a failure here is usually
    // timing rather than a refusal. A few quick attempts cost less than the
    // silence did.
    const attempts = 3;
    let lastError: unknown = null;

    for (let attempt = 0; attempt < attempts; attempt++) {
        try {
            return await DerivWSAccountsService.getAuthenticatedWebSocketURL(authInfo.access_token);
        } catch (error) {
            lastError = error;
            if (attempt < attempts - 1) {
                await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)));
            }
        }
    }

    // Out of attempts. The public channel still cannot serve a balance, but a
    // charting session beats a dead page -- and this says so rather than
    // leaving the empty balance to be puzzled over.
    console.error(
        '[DerivWS] Could not open an authenticated socket after %d attempts; falling back to the public ' +
            'channel, which cannot report a balance or place trades.',
        attempts,
        lastError
    );
    return getDefaultServerURL();
};

export const getDebugServiceWorker = () => {
    const debug_service_worker_flag = window.localStorage.getItem('debug_service_worker');
    if (debug_service_worker_flag) return !!parseInt(debug_service_worker_flag);

    return false;
};

/**
 * Generates the OAuth login or sign-up URL using vendored deriv-core
 *
 * @param prompt - Optional prompt parameter ('registration' for sign-up flow)
 * @returns Promise with the OAuth URL string
 */
export const generateOAuthURL = async (prompt?: string): Promise<string> => {
    try {
        const clientId = process.env.NEXT_PUBLIC_DERIV_APP_ID;
        if (!clientId) return '';

        // The app is served from a subpath on a project site, and origin drops
        // it — Deriv then sees a redirect_uri that does not match the one
        // registered against the application and answers invalid_request. The
        // base path the router and the assets already use makes it exact.
        const basePath = (process.env.PUBLIC_BASE_PATH ?? '').replace(/\/+$/, '');
        const config: AuthConfig = {
            clientId,
            redirectUri: `${window.location.origin}${basePath}/`,
            scopes: 'trade',
        };

        // Static referral link (fallback for direct visits without affiliate click)
        const referralLink = process.env.NEXT_PUBLIC_DERIV_REFERRAL_LINK;
        if (referralLink) {
            const referral = parseReferralLink(referralLink);
            if (referral) {
                config.affiliateToken = referral.affiliateToken;
                config.affiliateTokenParam = referral.affiliateTokenParam;
                config.utmCampaign = referral.utmCampaign;
                if (referral.utmSource) config.utmSource = referral.utmSource;
                if (referral.utmMedium) config.utmMedium = referral.utmMedium;
            }
        }

        // Override with live per-click params from landing URL (e.g. Scaleo t= token)
        const landing = parseLandingParams();
        if (landing) {
            // Only override the token when the landing URL actually carries one
            // (t=). parseLandingParams returns non-null for any utm_* param, so an
            // unguarded write would clobber a valid env token with '' on generic
            // marketing links (e.g. ?utm_source=google with no t=).
            if (landing.affiliateToken) {
                config.affiliateToken = landing.affiliateToken;
                config.affiliateTokenParam = landing.affiliateTokenParam;
            }
            if (landing.utmSource) config.utmSource = landing.utmSource;
            if (landing.utmMedium) config.utmMedium = landing.utmMedium;
            if (landing.utmCampaign) config.utmCampaign = landing.utmCampaign;
        }

        // If we still have no token and the referral link is a Scaleo click link,
        // resolve a fresh per-user token via the BFF proxy (non-blocking).
        if (!config.affiliateToken && referralLink) {
            const resolved = await resolveReferralViaProxy(referralLink);
            if (resolved) {
                config.affiliateToken = resolved.affiliateToken;
                config.affiliateTokenParam = resolved.affiliateTokenParam;
                if (resolved.utmSource) config.utmSource = resolved.utmSource;
                if (resolved.utmMedium) config.utmMedium = resolved.utmMedium;
                if (resolved.utmCampaign) config.utmCampaign = resolved.utmCampaign;
            }
        }

        if (prompt === 'registration') {
            return await buildSignUpUrl(config);
        }
        return await buildAuthorizationUrl(config);
    } catch (error) {
        console.error('Error generating OAuth URL:', error);
        return '';
    }
};
