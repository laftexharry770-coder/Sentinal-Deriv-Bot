import {
    AutomationService,
    setAutomationTransport,
    type AutomationTransport,
    type AutoRun,
} from '../automation.service';

const RUN: AutoRun = {
    run_id: 'atr_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
    status: 'running',
    strategy_id: 'martingale',
    strategy_parameters: { multiplier: 2, max_stake: 40 },
    contract_template: {
        contract_type: 'CALL',
        currency: 'USD',
        underlying_symbol: 'R_100',
        amount: 10,
        basis: 'stake',
        duration: 1,
        duration_unit: 'm',
    },
    start_time: 1717488000,
    contracts: [],
    total_stake: 0,
    total_payout: 0,
};

interface Stub {
    sent: Array<Record<string, unknown>>;
    push: (data: Record<string, unknown>) => void;
    handlers: Array<(data: Record<string, unknown>) => void>;
    unsubscribed: number;
}

/** A socket that answers from a lookup table and can push messages back. */
const stubTransport = (responses: Record<string, unknown>): Stub => {
    const stub: Stub = { sent: [], push: () => undefined, handlers: [], unsubscribed: 0 };

    const transport: AutomationTransport = {
        send: async <T>(request: Record<string, unknown>): Promise<T> => {
            stub.sent.push(request);
            const key = Object.keys(request)[0];
            const answer = responses[key];
            if (answer === undefined) throw new Error(`stub has no answer for ${key}`);
            return answer as T;
        },
        onMessage: handler => {
            stub.handlers.push(handler);
            return () => {
                stub.unsubscribed += 1;
            };
        },
    };

    stub.push = data => stub.handlers.forEach(handler => handler(data));
    setAutomationTransport(transport);
    return stub;
};

afterEach(() => setAutomationTransport(null));

describe('starting a run', () => {
    it('sends the template, the strategy and its parameters, and subscribes', async () => {
        const stub = stubTransport({
            auto_start: { auto_start: RUN, msg_type: 'auto_start', subscription: { id: 'sub-1' } },
        });

        const { run, subscriptionId } = await AutomationService.start({
            contract_template: RUN.contract_template,
            strategy_id: 'martingale',
            strategy_parameters: { multiplier: 2 },
            subscribe: true,
        });

        expect(stub.sent[0]).toEqual({
            auto_start: 1,
            contract_template: RUN.contract_template,
            strategy_id: 'martingale',
            strategy_parameters: { multiplier: 2 },
            subscribe: 1,
        });
        expect(run.run_id).toBe(RUN.run_id);
        // Kept so the stream can be released later; dropping it leaks a
        // subscription for the life of the connection.
        expect(subscriptionId).toBe('sub-1');
    });

    it('omits subscribe when it was not asked for', async () => {
        const stub = stubTransport({ auto_start: { auto_start: RUN, msg_type: 'auto_start' } });

        await AutomationService.start({
            contract_template: RUN.contract_template,
            strategy_id: 'martingale',
            strategy_parameters: {},
        });

        expect(stub.sent[0]).not.toHaveProperty('subscribe');
    });
});

describe('controlling a run', () => {
    it.each([
        ['pause', 'auto_pause', 'paused'],
        ['resume', 'auto_resume', 'running'],
        ['stop', 'auto_stop', 'stopped'],
    ] as const)('%s sends %s with the run id', async (method, message, status) => {
        const stub = stubTransport({ [message]: { [message]: { ...RUN, status }, msg_type: message } });

        const run = await AutomationService[method](RUN.run_id);

        expect(stub.sent[0]).toEqual({ [message]: 1, run_id: RUN.run_id });
        expect(run.status).toBe(status);
    });
});

describe('releasing streams', () => {
    it('forgets a subscription by id', async () => {
        const stub = stubTransport({ forget: { forget: 1, msg_type: 'forget' } });
        await AutomationService.forget('sub-1');
        expect(stub.sent[0]).toEqual({ forget: 'sub-1' });
    });

    it('does not make a failed cleanup the caller´s problem', async () => {
        setAutomationTransport({
            send: async () => {
                throw new Error('socket closed');
            },
            onMessage: () => () => undefined,
        });
        // Navigating away from a dead connection is not an error worth raising.
        await expect(AutomationService.forget('sub-1')).resolves.toBeUndefined();
    });
});

describe('reading runs', () => {
    it('lists every run on the account', async () => {
        stubTransport({ auto_list: { auto_list: { runs: [RUN] }, msg_type: 'auto_list' } });
        await expect(AutomationService.listRuns()).resolves.toEqual([RUN]);
    });

    it('lists the strategies that can be run', async () => {
        const strategy = {
            strategy_id: 'martingale',
            display_name: 'Martingale',
            parameters: { multiplier: { type: 'number' } },
            supported_contract_types: ['CALL', 'PUT'],
        };
        stubTransport({
            auto_list_strategies: { auto_list_strategies: { strategies: [strategy] }, msg_type: 'auto_list_strategies' },
        });
        await expect(AutomationService.listStrategies()).resolves.toEqual([strategy]);
    });

    it('re-reads one run and can subscribe to it', async () => {
        const stub = stubTransport({ auto_get: { auto_get: RUN, msg_type: 'auto_get' } });
        await AutomationService.get(RUN.run_id, true);
        expect(stub.sent[0]).toEqual({ auto_get: 1, run_id: RUN.run_id, subscribe: 1 });
    });

    it('offers only symbols that can actually be traded right now', async () => {
        const open = {
            underlying_symbol: 'R_100',
            underlying_symbol_name: 'Volatility 100 Index',
            market: 'synthetic_index',
            submarket: 'random_index',
            exchange_is_open: 1,
            is_trading_suspended: 0,
            pip_size: 2,
        };
        stubTransport({
            active_symbols: {
                active_symbols: [
                    open,
                    { ...open, underlying_symbol: 'CLOSED', exchange_is_open: 0 },
                    { ...open, underlying_symbol: 'SUSPENDED', is_trading_suspended: 1 },
                ],
                msg_type: 'active_symbols',
            },
        });

        const symbols = await AutomationService.listSymbols();

        // A run started on a closed market fails at its first purchase, which
        // is a slow way to learn the market was shut.
        expect(symbols.map(symbol => symbol.underlying_symbol)).toEqual(['R_100']);
    });
});

describe('watching a run', () => {
    it('passes on updates for that run, under either message that opens a stream', () => {
        const stub = stubTransport({});
        const seen: AutoRun[] = [];
        AutomationService.watch(RUN.run_id, run => seen.push(run));

        stub.push({ msg_type: 'auto_start', auto_start: { ...RUN, total_stake: 10 } });
        stub.push({ msg_type: 'auto_get', auto_get: { ...RUN, total_stake: 20 } });

        expect(seen.map(run => run.total_stake)).toEqual([10, 20]);
    });

    it('ignores other runs and unrelated traffic', () => {
        const stub = stubTransport({});
        const seen: AutoRun[] = [];
        AutomationService.watch(RUN.run_id, run => seen.push(run));

        stub.push({ msg_type: 'auto_get', auto_get: { ...RUN, run_id: 'atr_someone_elses_run' } });
        stub.push({ msg_type: 'tick', tick: { quote: 1234 } });
        stub.push({ msg_type: 'balance', balance: { balance: 10 } });

        expect(seen).toEqual([]);
    });

    it('stops listening when told to', () => {
        const stub = stubTransport({});
        const stopWatching = AutomationService.watch(RUN.run_id, () => undefined);
        stopWatching();
        expect(stub.unsubscribed).toBe(1);
    });
});

describe('when Deriv refuses', () => {
    it('reports Deriv´s own wording from an error response', async () => {
        stubTransport({ auto_start: { error: { code: 'InsufficientBalance', message: 'Your balance is too low.' } } });

        await expect(
            AutomationService.start({
                contract_template: RUN.contract_template,
                strategy_id: 'martingale',
                strategy_parameters: {},
            })
        ).rejects.toThrow('Your balance is too low.');
    });

    it('reports it just the same when the call rejects instead', async () => {
        setAutomationTransport({
            send: async () => {
                // deriv-api rejects with the envelope rather than an Error.
                throw { error: { code: 'InvalidStrategy', message: 'Unknown strategy.' } };
            },
            onMessage: () => () => undefined,
        });

        await expect(AutomationService.stop(RUN.run_id)).rejects.toThrow('Unknown strategy.');
    });

    it('does not pass off a malformed answer as a run', async () => {
        stubTransport({ auto_stop: { msg_type: 'auto_stop' } });
        await expect(AutomationService.stop(RUN.run_id)).rejects.toThrow('auto_stop');
    });
});
