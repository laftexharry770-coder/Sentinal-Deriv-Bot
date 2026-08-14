import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setAutomationTransport, type AutomationTransport } from '@/services/automation.service';
import { DerivWSAccountsService } from '@/services/derivws-accounts.service';
import Automation from '../automation';

const STRATEGY = {
    strategy_id: 'martingale',
    display_name: 'Martingale',
    description: 'Doubles the stake after each losing contract.',
    parameters: { multiplier: { type: 'number' } },
    supported_contract_types: ['CALL', 'PUT'],
};

const SYMBOL = {
    underlying_symbol: 'R_100',
    underlying_symbol_name: 'Volatility 100 Index',
    market: 'synthetic_index',
    submarket: 'random_index',
    exchange_is_open: 1,
    is_trading_suspended: 0,
    pip_size: 2,
};

const RUN = {
    run_id: 'atr_test_run',
    status: 'running',
    strategy_id: 'martingale',
    strategy_parameters: { multiplier: 2 },
    contract_template: { contract_type: 'CALL', currency: 'USD', underlying_symbol: 'R_100' },
    start_time: 1717488000,
    contracts: [],
    total_stake: 0,
    total_payout: 0,
};

let isAuthorized = true;
let loginid = 'DOT12345678';

jest.mock('@/hooks/useApiBase', () => ({
    useApiBase: () => ({ isAuthorized }),
}));

jest.mock('@/hooks/useStore', () => ({
    useStore: () => ({ client: { loginid, currency: 'USD' } }),
}));

jest.mock('@/external/deriv-core', () => ({
    ...jest.requireActual('@/external/deriv-core'),
    getAuthInfo: () => ({ access_token: 'access-token' }),
}));

// Accounts are REST, not the socket the rest of this talks to.
const DEMO_ACCOUNT = {
    account_id: 'DOT12345678',
    balance: '10000.00',
    currency: 'USD',
    group: 'row',
    status: 'active',
    account_type: 'demo',
};
const REAL_ACCOUNT = { ...DEMO_ACCOUNT, account_id: 'ROT12345678', balance: '250.00', account_type: 'real' };

let accountsOnFile = [DEMO_ACCOUNT];

const restCalls: Array<{ url: string; method: string; body: unknown }> = [];
global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    restCalls.push({ url: String(url), method, body: init?.body ? JSON.parse(String(init.body)) : undefined });

    if (String(url).endsWith('/accounts') && method === 'POST') {
        return { ok: true, status: 201, json: async () => ({ data: [REAL_ACCOUNT] }) };
    }
    if (String(url).endsWith('/accounts')) {
        return { ok: true, status: 200, json: async () => ({ data: accountsOnFile }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
}) as unknown as typeof fetch;

const sent: Array<Record<string, unknown>> = [];

const transport: AutomationTransport = {
    send: async <T,>(request: Record<string, unknown>): Promise<T> => {
        sent.push(request);
        const key = Object.keys(request)[0];
        const answers: Record<string, unknown> = {
            auto_list_strategies: { auto_list_strategies: { strategies: [STRATEGY] } },
            auto_list: { auto_list: { runs: [] } },
            active_symbols: { active_symbols: [SYMBOL] },
            contracts_list: { contracts_list: [{ contract_category: 'callput', contract_types: ['CALL', 'PUT'], display_name: 'Up/Down' }] },
            auto_start: { auto_start: RUN, subscription: { id: 'sub-1' } },
            auto_stop: { auto_stop: { ...RUN, status: 'stopped', stop_reason: 'user_stopped', stop_time: 1717488600 } },
            forget: { forget: 1 },
        };
        return answers[key] as T;
    },
    onMessage: () => () => undefined,
};

beforeEach(() => {
    sent.length = 0;
    restCalls.length = 0;
    accountsOnFile = [DEMO_ACCOUNT];
    // The service caches its in-flight fetch and stores the result; without
    // this a test reads the previous test's accounts.
    DerivWSAccountsService.clearCache();
    DerivWSAccountsService.clearStoredAccounts();
    sessionStorage.clear();
    isAuthorized = true;
    loginid = 'DOT12345678';
    localStorage.clear();
    setAutomationTransport(transport);
});

afterEach(() => setAutomationTransport(null));

const startsSent = () => sent.filter(request => 'auto_start' in request);

describe('the automation panel', () => {
    it('asks for a login before showing anything that trades', () => {
        isAuthorized = false;
        render(<Automation />);
        expect(screen.getByText(/Log in to run an automated strategy/i)).toBeInTheDocument();
    });

    it('offers the strategies Deriv listed, and says which account is being traded', async () => {
        render(<Automation />);

        expect(await screen.findByText('Martingale')).toBeInTheDocument();
        expect(screen.getByText(/Demo account/i)).toBeInTheDocument();
        expect(screen.getByText(/Doubles the stake after each losing contract/i)).toBeInTheDocument();
    });

    it('starts a run on a demo account on the first press', async () => {
        const user = userEvent.setup();
        render(<Automation />);
        await screen.findByText('Martingale');

        await user.click(screen.getByRole('button', { name: /Start run/i }));

        await waitFor(() => expect(startsSent()).toHaveLength(1));
        const request = startsSent()[0] as { contract_template: Record<string, unknown>; strategy_id: string };
        expect(request.strategy_id).toBe('martingale');
        expect(request.contract_template.underlying_symbol).toBe('R_100');
        expect(request.contract_template.currency).toBe('USD');
    });

    it('will not stake real money on a single press', async () => {
        // The account label is the only thing that changes here; the run this
        // starts buys contracts repeatedly until stopped, so one stray click
        // must not be enough.
        loginid = 'ROT12345678';
        const user = userEvent.setup();
        render(<Automation />);
        await screen.findByText('Martingale');

        // The kind is stated in more than one place now (the header badge and
        // the accounts list), which is the point — it should be hard to miss.
        expect(screen.getAllByText(/Real account/i).length).toBeGreaterThan(0);

        await user.click(screen.getByRole('button', { name: /Start run/i }));

        expect(startsSent()).toHaveLength(0);
        expect(screen.getByText(/real money on this account, repeatedly/i)).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /Start with real money/i }));
        await waitFor(() => expect(startsSent()).toHaveLength(1));
    });

    it('shows the run and offers a way to stop it once one is going', async () => {
        const user = userEvent.setup();
        render(<Automation />);
        await screen.findByText('Martingale');

        await user.click(screen.getByRole('button', { name: /Start run/i }));

        expect(await screen.findByRole('button', { name: /^Stop$/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Pause/i })).toBeInTheDocument();
        // Closing the tab is not a way to stop it, and the panel says so.
        expect(screen.getByText(/Stopping ends the run/i)).toBeInTheDocument();
    });

    it('releases the stream when the run is stopped', async () => {
        const user = userEvent.setup();
        const { unmount } = render(<Automation />);
        await screen.findByText('Martingale');

        await user.click(screen.getByRole('button', { name: /Start run/i }));
        await screen.findByRole('button', { name: /^Stop$/i });
        await user.click(screen.getByRole('button', { name: /^Stop$/i }));

        // Deriv keeps pushing to a stream until it is forgotten; a stopped run
        // will never send anything again.
        await waitFor(() => expect(sent.some(request => request.forget === 'sub-1')).toBe(true));
        unmount();
    });

    it('releases the stream when the screen goes away', async () => {
        const user = userEvent.setup();
        const { unmount } = render(<Automation />);
        await screen.findByText('Martingale');

        await user.click(screen.getByRole('button', { name: /Start run/i }));
        await screen.findByRole('button', { name: /^Stop$/i });

        unmount();

        await waitFor(() => expect(sent.some(request => request.forget === 'sub-1')).toBe(true));
        // Leaving the screen must not stop the run itself.
        expect(sent.some(request => 'auto_stop' in request)).toBe(false);
    });

    it('tops the practice balance back up from the accounts list', async () => {
        const user = userEvent.setup();
        const { unmount } = render(<Automation />);
        await screen.findByText('DOT12345678');

        await user.click(screen.getByRole('button', { name: /Reset balance/i }));

        await waitFor(() =>
            expect(
                restCalls.some(call => call.method === 'POST' && call.url.includes('/reset-demo-balance'))
            ).toBe(true)
        );
        unmount();
    });

    it('opens a real account, and does not switch to it by itself', async () => {
        const user = userEvent.setup();
        const { unmount } = render(<Automation />);
        await screen.findByText('DOT12345678');

        // Opening an account stakes nothing, but it is still deliberate.
        await user.click(screen.getByRole('button', { name: /Open a real account/i }));
        await user.click(screen.getByRole('button', { name: /Yes, open a real account/i }));

        await waitFor(() => {
            const created = restCalls.find(call => call.method === 'POST' && call.url.endsWith('/accounts'));
            expect(created?.body).toEqual({ currency: 'USD', group: 'row', account_type: 'real' });
        });

        // Trading it is a separate decision; the session stays where it was.
        expect(localStorage.getItem('active_loginid')).not.toBe('ROT12345678');
        unmount();
    });

    it('switches to a real account only when asked', async () => {
        accountsOnFile = [DEMO_ACCOUNT, REAL_ACCOUNT];
        const user = userEvent.setup();
        const { unmount } = render(<Automation />);
        await screen.findByText('ROT12345678');

        // Named for what it is, not a bare "switch".
        await user.click(screen.getByRole('button', { name: /Switch to real money/i }));

        expect(localStorage.getItem('active_loginid')).toBe('ROT12345678');
        expect(await screen.findByText(/real money/i)).toBeInTheDocument();
        unmount();
    });

    it('offers no balance reset for a real account', async () => {
        accountsOnFile = [REAL_ACCOUNT];
        render(<Automation />);
        await screen.findByText('ROT12345678');

        // Real balances cannot be reset, and offering it would suggest the
        // money on the account is not real.
        expect(screen.queryByRole('button', { name: /Reset balance/i })).not.toBeInTheDocument();
    });

    it('remembers the run so a reload can still stop it', async () => {
        const user = userEvent.setup();
        render(<Automation />);
        await screen.findByText('Martingale');

        await user.click(screen.getByRole('button', { name: /Start run/i }));

        await waitFor(() => expect(localStorage.getItem('automation_active_run_id')).toBe('atr_test_run'));
    });
});
