import { webcrypto } from 'node:crypto';
import { TextEncoder } from 'node:util';
import { generateOAuthURL } from '@/components/shared/utils/config/config';
import { completeOAuthLogin, NoAccountsError } from '../complete-oauth-login';
import { getRedirectUri } from '../redirect-uri';

Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
if (!globalThis.TextEncoder) {
    Object.defineProperty(globalThis, 'TextEncoder', { value: TextEncoder, configurable: true });
}

const originalEnv = { ...process.env };

const DEMO_ACCOUNT = {
    account_id: 'DOT90004580',
    balance: 10000,
    currency: 'USD',
    group: 'row',
    status: 'active',
    account_type: 'demo',
};

beforeEach(() => {
    process.env.NEXT_PUBLIC_DERIV_APP_ID = 'test-app-id';
    process.env.NEXT_PUBLIC_DERIV_REFERRAL_LINK = '';
    process.env.PUBLIC_BASE_PATH = '/Sentinal-Deriv-Bot/';
});

afterEach(() => {
    process.env = { ...originalEnv };
    sessionStorage.clear();
    localStorage.clear();
});

interface StubbedCall {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: unknown;
}

/**
 * Signs in against a stubbed Deriv whose accounts list is empty, and reports
 * every call the sign-in made.
 */
const signInWithNoExistingAccounts = async (createResponse: {
    ok: boolean;
    status?: number;
    payload: unknown;
}) => {
    const calls: StubbedCall[] = [];

    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        calls.push({
            url: String(url),
            method,
            headers: (init?.headers ?? {}) as Record<string, string>,
            body: init?.body ? String(init.body) : undefined,
        });

        if (String(url).endsWith('/token')) {
            return {
                ok: true,
                json: async () => ({ access_token: 'access-token', token_type: 'Bearer', expires_in: 3600 }),
            };
        }
        if (String(url).endsWith('/accounts') && method === 'POST') {
            return {
                ok: createResponse.ok,
                status: createResponse.status ?? (createResponse.ok ? 201 : 403),
                statusText: createResponse.ok ? 'Created' : 'Forbidden',
                json: async () => createResponse.payload,
            };
        }
        // The list, empty — a Deriv user with no Options account yet.
        return { ok: true, json: async () => ({ data: [] }) };
    }) as unknown as typeof fetch;

    const state = new URL(await generateOAuthURL()).searchParams.get('state');
    const callbackUrl = `${getRedirectUri()}?code=auth-code&state=${state}`;

    let thrown: unknown = null;
    try {
        await completeOAuthLogin(callbackUrl, { initApi: async () => undefined });
    } catch (error) {
        thrown = error;
    }
    return { calls, thrown };
};

describe('a first-time user with no Options account', () => {
    it('opens a demo account rather than stopping at an empty list', async () => {
        const { calls, thrown } = await signInWithNoExistingAccounts({
            ok: true,
            status: 201,
            payload: { data: [DEMO_ACCOUNT] },
        });

        expect(thrown).toBeNull();

        const created = calls.find(call => call.method === 'POST' && call.url.endsWith('/accounts'));
        expect(created).toBeDefined();
        expect(created?.headers['Deriv-App-ID']).toBe('test-app-id');
        expect(created?.headers.Authorization).toBe('Bearer access-token');
        expect(JSON.parse(String(created?.body))).toEqual({
            currency: 'USD',
            group: 'row',
            account_type: 'demo',
        });

        // And the session runs on it.
        expect(localStorage.getItem('active_loginid')).toBe('DOT90004580');
        expect(localStorage.getItem('account_type')).toBe('demo');
    });

    it('accepts the 200 shape, where the account already existed', async () => {
        const { thrown } = await signInWithNoExistingAccounts({
            ok: true,
            status: 200,
            // 200 returns a single object where 201 returns an array of one.
            payload: { data: DEMO_ACCOUNT },
        });

        expect(thrown).toBeNull();
        expect(localStorage.getItem('active_loginid')).toBe('DOT90004580');
    });

    it('reports what Deriv said when it will not create one', async () => {
        const { thrown } = await signInWithNoExistingAccounts({
            ok: false,
            status: 403,
            payload: {
                errors: [{ status: 403, code: 'AccessDenied', detail: { message: 'You do not have permission' } }],
            },
        });

        // A missing account_manage scope is fixed on the application, not by
        // retrying, so the reason has to reach the person reading the screen.
        expect(thrown).toBeInstanceOf(NoAccountsError);
        expect((thrown as Error).message).toContain('You do not have permission');
        expect(localStorage.getItem('active_loginid')).toBeNull();
    });
});
