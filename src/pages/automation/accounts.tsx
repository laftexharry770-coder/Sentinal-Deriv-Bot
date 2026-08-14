import { useCallback, useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { getAuthInfo } from '@/external/deriv-core';
import { useStore } from '@/hooks/useStore';
import { DerivWSAccountsService, type DerivAccount } from '@/services/derivws-accounts.service';
import { Localize, localize } from '@deriv-com/translations';

/**
 * The Options accounts on this login, and what can be done with them.
 *
 * Deriv gives every new trader a demo Options account; a real one has to be
 * opened, and until now nothing in this app could do it, so a real account was
 * only reachable if it already existed. Opening one is a separate act from
 * trading on it — creating an account stakes nothing — but switching to it
 * puts every subsequent purchase on real money, so that stays a deliberate
 * choice and never happens on its own.
 */

const money = (balance: string | number, currency: string) => `${Number(balance ?? 0).toFixed(2)} ${currency}`;

export const Accounts = observer(({ onAccountsChanged }: { onAccountsChanged?: () => void }) => {
    const { client } = useStore() ?? {};
    const [accounts, setAccounts] = useState<DerivAccount[]>([]);
    const [activeId, setActiveId] = useState<string>('');
    const [busy, setBusy] = useState<string | null>(null);
    const [note, setNote] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [confirmingReal, setConfirmingReal] = useState(false);

    const readActive = () => {
        try {
            return localStorage.getItem('active_loginid') ?? '';
        } catch {
            return '';
        }
    };

    const load = useCallback(async () => {
        setError(null);
        try {
            const authInfo = getAuthInfo();
            if (!authInfo?.access_token) return;
            const list = await DerivWSAccountsService.fetchAccountsList(authInfo.access_token);
            setAccounts(list);
            setActiveId(readActive());
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : String(caught));
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const token = () => {
        const authInfo = getAuthInfo();
        if (!authInfo?.access_token) throw new Error(localize('Not signed in.'));
        return authInfo.access_token;
    };

    /** Opens a real Options account. Does not switch to it. */
    const openRealAccount = async () => {
        if (!confirmingReal) {
            setConfirmingReal(true);
            return;
        }
        setConfirmingReal(false);
        setBusy('create');
        setNote(null);
        setError(null);
        try {
            const created = await DerivWSAccountsService.createAccount(token(), 'real');
            await load();
            onAccountsChanged?.();
            setNote(
                localize('Real account {{id}} opened. It is not selected — switch to it when you mean to trade it.', {
                    id: created.account_id,
                })
            );
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : String(caught));
        } finally {
            setBusy(null);
        }
    };

    /**
     * Points the session at another account. The socket is opened per account
     * (Deriv issues the demo or real endpoint from the account id), so this
     * regenerates the connection rather than merely relabelling the header.
     */
    const switchTo = (account: DerivAccount) => {
        setBusy(account.account_id);
        setNote(null);
        try {
            localStorage.setItem('active_loginid', account.account_id);
            setActiveId(account.account_id);
            client?.checkAndRegenerateWebSocket();
            setNote(
                account.account_type === 'real'
                    ? localize('Switched to {{id}} — trades on this account use real money.', {
                          id: account.account_id,
                      })
                    : localize('Switched to {{id}} — practice money.', { id: account.account_id })
            );
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : String(caught));
        } finally {
            setBusy(null);
        }
    };

    const resetDemoBalance = async (account: DerivAccount) => {
        setBusy(account.account_id);
        setNote(null);
        setError(null);
        try {
            await DerivWSAccountsService.resetDemoBalance(token(), account.account_id);
            await load();
            setNote(localize('Demo balance reset.'));
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : String(caught));
        } finally {
            setBusy(null);
        }
    };

    const hasReal = accounts.some(account => account.account_type === 'real');

    return (
        <section className='automation__panel'>
            <h3>
                <Localize i18n_default_text='Accounts' />
            </h3>

            {error && (
                <div className='automation__error' role='alert'>
                    <span>{error}</span>
                    <button type='button' onClick={() => setError(null)}>
                        <Localize i18n_default_text='Dismiss' />
                    </button>
                </div>
            )}
            {note && <p className='automation__hint'>{note}</p>}

            {accounts.length === 0 ? (
                <p className='automation__muted'>
                    <Localize i18n_default_text='No Options accounts on this login yet.' />
                </p>
            ) : (
                <table className='automation__table'>
                    <thead>
                        <tr>
                            <th>{localize('Account')}</th>
                            <th>{localize('Type')}</th>
                            <th>{localize('Balance')}</th>
                            <th />
                        </tr>
                    </thead>
                    <tbody>
                        {accounts.map(account => {
                            const isActive = account.account_id === activeId;
                            const isDemo = account.account_type === 'demo';
                            return (
                                <tr key={account.account_id}>
                                    <td>{account.account_id}</td>
                                    <td className={isDemo ? '' : 'automation__loss'}>
                                        {isDemo ? localize('Demo') : localize('Real money')}
                                    </td>
                                    <td>{money(account.balance, account.currency)}</td>
                                    <td>
                                        {isActive ? (
                                            <span className='automation__hint'>{localize('In use')}</span>
                                        ) : (
                                            <button
                                                type='button'
                                                disabled={busy !== null}
                                                onClick={() => switchTo(account)}
                                            >
                                                {isDemo ? localize('Switch') : localize('Switch to real money')}
                                            </button>
                                        )}
                                        {isDemo && (
                                            <button
                                                type='button'
                                                disabled={busy !== null}
                                                onClick={() => void resetDemoBalance(account)}
                                            >
                                                {localize('Reset balance')}
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            )}

            {!hasReal && (
                <div className='automation__reset'>
                    <button type='button' disabled={busy === 'create'} onClick={() => void openRealAccount()}>
                        {busy === 'create' ? (
                            <Localize i18n_default_text='Opening…' />
                        ) : confirmingReal ? (
                            <Localize i18n_default_text='Yes, open a real account' />
                        ) : (
                            <Localize i18n_default_text='Open a real account' />
                        )}
                    </button>
                    {confirmingReal && (
                        <span className='automation__hint'>
                            <Localize i18n_default_text='Opens a real-money Options account on your Deriv login. Nothing is staked until you switch to it and trade.' />
                        </span>
                    )}
                </div>
            )}
        </section>
    );
});

export default Accounts;
