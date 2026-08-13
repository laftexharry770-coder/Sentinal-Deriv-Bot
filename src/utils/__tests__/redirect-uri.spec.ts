import { webcrypto } from 'node:crypto';
import { TextEncoder } from 'node:util';
import { generateOAuthURL } from '@/components/shared/utils/config/config';
import { completeOAuthLogin } from '../complete-oauth-login';
import { getRedirectUri } from '../redirect-uri';

// PKCE needs real WebCrypto (SHA-256 for the code challenge); jsdom ships
// getRandomValues but not subtle.
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
if (!globalThis.TextEncoder) {
    Object.defineProperty(globalThis, 'TextEncoder', { value: TextEncoder, configurable: true });
}

const BASE_PATH = '/Sentinal-Deriv-Bot/';

const originalEnv = { ...process.env };

beforeEach(() => {
    process.env.NEXT_PUBLIC_DERIV_APP_ID = 'test-app-id';
    process.env.NEXT_PUBLIC_DERIV_REFERRAL_LINK = '';
});

afterEach(() => {
    process.env = { ...originalEnv };
    sessionStorage.clear();
    localStorage.clear();
});

describe('getRedirectUri', () => {
    it('includes the subpath a project site is served from, with a trailing slash', () => {
        process.env.PUBLIC_BASE_PATH = BASE_PATH;
        expect(getRedirectUri()).toBe(`${window.location.origin}/Sentinal-Deriv-Bot/`);
    });

    it('adds the trailing slash when the configured base path lacks one', () => {
        process.env.PUBLIC_BASE_PATH = '/Sentinal-Deriv-Bot';
        expect(getRedirectUri()).toBe(`${window.location.origin}/Sentinal-Deriv-Bot/`);
    });

    it('is the bare origin for a root deploy', () => {
        process.env.PUBLIC_BASE_PATH = '';
        expect(getRedirectUri()).toBe(`${window.location.origin}/`);
    });
});

/**
 * Drives the two halves of the real sign-in — the URL the Sign in button sends
 * the browser to, and the callback handler that runs when Deriv sends it back —
 * against a stubbed Deriv, and reports the redirect_uri each half sent.
 *
 * Both halves are the production functions. That is the point: the two used to
 * compute this value independently, and a test that computed it once could not
 * have noticed them disagreeing.
 */
const roundTrip = async () => {
    const authorizeUrl = new URL(await generateOAuthURL());
    const sentToAuthorize = authorizeUrl.searchParams.get('redirect_uri');
    const state = authorizeUrl.searchParams.get('state');

    let sentToTokenEndpoint: string | null = null;

    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
        if (String(url).endsWith('/token')) {
            sentToTokenEndpoint = new URLSearchParams(String(init?.body)).get('redirect_uri');
            return {
                ok: true,
                json: async () => ({
                    access_token: 'access-token',
                    token_type: 'Bearer',
                    expires_in: 3600,
                    scope: 'trade',
                    refresh_token: 'refresh-token',
                }),
            };
        }
        // The accounts list, fetched once the tokens are in hand.
        return {
            ok: true,
            json: async () => ({
                data: [
                    {
                        account_id: 'DOT93898941',
                        balance: '10000.00',
                        currency: 'USD',
                        group: 'demo',
                        status: 'active',
                        account_type: 'demo',
                    },
                ],
            }),
        };
    }) as unknown as typeof fetch;

    const initApi = jest.fn(async () => undefined);
    const callbackUrl = `${getRedirectUri()}?code=auth-code&state=${state}`;
    await completeOAuthLogin(callbackUrl, { initApi });

    return { sentToAuthorize, sentToTokenEndpoint, initApi };
};

describe('the OAuth round trip', () => {
    it('sends one and the same redirect_uri to both legs', async () => {
        process.env.PUBLIC_BASE_PATH = BASE_PATH;

        const { sentToAuthorize, sentToTokenEndpoint } = await roundTrip();

        // OAuth 2.0 compares these as exact strings. They were computed in two
        // places and disagreed — the authorization request carried the subpath
        // and the exchange sent the bare origin — so Deriv accepted the login
        // and then refused the token, leaving the app silently signed out.
        expect(sentToAuthorize).toBe(`${window.location.origin}/Sentinal-Deriv-Bot/`);
        expect(sentToTokenEndpoint).toBe(sentToAuthorize);
    });

    it('does not send the bare origin when the app lives on a subpath', async () => {
        process.env.PUBLIC_BASE_PATH = BASE_PATH;

        const { sentToTokenEndpoint } = await roundTrip();

        expect(sentToTokenEndpoint).not.toBe(window.location.origin);
        expect(sentToTokenEndpoint).toContain('/Sentinal-Deriv-Bot/');
    });

    it('still agrees on a root deploy', async () => {
        process.env.PUBLIC_BASE_PATH = '';

        const { sentToAuthorize, sentToTokenEndpoint } = await roundTrip();

        expect(sentToAuthorize).toBe(`${window.location.origin}/`);
        expect(sentToTokenEndpoint).toBe(sentToAuthorize);
    });

    it('reads a DOT… account as demo, and connects', async () => {
        process.env.PUBLIC_BASE_PATH = BASE_PATH;

        const { initApi } = await roundTrip();

        expect(localStorage.getItem('active_loginid')).toBe('DOT93898941');
        // The prefix guess this replaced tested for VRT only, so it labelled a
        // demo account real — next to controls that stake money.
        expect(localStorage.getItem('account_type')).toBe('demo');
        expect(initApi).toHaveBeenCalled();
    });
});
