import { handleOAuthCallback } from '@/external/deriv-core';
import { isDemoAccount } from './account-helpers';
import { getOAuthScopes, getRedirectUri } from './redirect-uri';

/**
 * Deriv authenticated the user but reports no account this app may trade.
 * Separate from a failed exchange because nothing about it is retryable.
 */
export class NoAccountsError extends Error {
    constructor(reason?: string) {
        super(
            reason
                ? `Signed in, but this account has no Options account and one could not be opened. ${reason}`
                : 'Signed in, but Deriv returned no accounts for this app. Nothing can be traded yet.'
        );
        this.name = 'NoAccountsError';
    }
}

export interface CompleteOAuthLoginOptions {
    /**
     * Brings up the bot's API connection once the tokens are stored. Injectable
     * only so tests need not pull in the whole bot-skeleton bundle; production
     * uses the default.
     */
    initApi?: () => Promise<void>;
}

const defaultInitApi = async () => {
    const { api_base } = await import('@/external/bot-skeleton');
    await api_base.init(true);
};

/**
 * Finishes the OAuth redirect: validate the callback, exchange the code for
 * tokens, select an account, and connect.
 *
 * Lives outside the component so it can be tested. The bug that made it worth
 * extracting was invisible from the UI — the exchange sent a different
 * redirect_uri than the authorization request, so Deriv accepted the login and
 * then refused the token, and the app rendered its ordinary signed-out state.
 *
 * Throws on failure; the caller is expected to show the message rather than
 * swallow it.
 */
export async function completeOAuthLogin(
    callbackUrl: string,
    options: CompleteOAuthLoginOptions = {}
): Promise<void> {
    // The same string the authorization request sent. OAuth compares them
    // exactly, so both legs read it from one place.
    const redirectUri = getRedirectUri();

    const authInfo = await handleOAuthCallback(callbackUrl, {
        clientId: process.env.NEXT_PUBLIC_DERIV_APP_ID || '',
        redirectUri,
        scopes: getOAuthScopes(),
    });

    const { DerivWSAccountsService } = await import('@/services/derivws-accounts.service');
    let accounts = await DerivWSAccountsService.fetchAccountsList(authInfo.access_token);

    // A Deriv account is not the same thing as an Options account, and someone
    // arriving here for the first time may well have the former and not the
    // latter. Rather than stopping at an empty list, open the demo one Deriv
    // gives every new trader; the endpoint returns the existing account if
    // there already is one, so this is safe to attempt.
    if (!accounts || accounts.length === 0) {
        try {
            const created = await DerivWSAccountsService.createAccount(authInfo.access_token, 'demo');
            accounts = [created];
        } catch (error) {
            throw new NoAccountsError(error instanceof Error ? error.message : undefined);
        }
    }

    DerivWSAccountsService.storeAccounts(accounts);

    const firstAccount = accounts[0];
    localStorage.setItem('active_loginid', firstAccount.account_id);

    // Deriv states the kind outright on each account, so use it. The prefix
    // guess this replaced tested for VRT only, which reads a DOT… demo account
    // as real — the wrong half of the one distinction that decides whether
    // losses are real money.
    const isDemo = firstAccount.account_type
        ? firstAccount.account_type === 'demo'
        : isDemoAccount(firstAccount.account_id);
    localStorage.setItem('account_type', isDemo ? 'demo' : 'real');

    const initApi = options.initApi ?? defaultInitApi;
    await initApi();
}
