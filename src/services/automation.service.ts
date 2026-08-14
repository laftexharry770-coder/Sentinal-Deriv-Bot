/**
 * Deriv's Automation API: server-side strategy runs.
 *
 * The run lives on Deriv, not in this tab. That is the whole point of it — it
 * keeps buying contracts whether or not the browser is open — and it is also
 * the thing to be careful about: closing the page stops the updates, not the
 * trading. Every control here maps to one documented message, and stopping is
 * always reachable from a run id alone.
 *
 * Message family (all share one envelope: `{ auto_x: 1, ...args }` in,
 * `{ auto_x: <run>, msg_type: 'auto_x' }` back):
 *   auto_list_strategies — what can be run (the only one needing no auth)
 *   auto_start           — begin a run, optionally subscribing to updates
 *   auto_get             — read one run, optionally subscribing
 *   auto_list            — every run on this account
 *   auto_pause/auto_resume/auto_stop — control a run
 */

export type AutoRunStatus = 'running' | 'paused' | 'stopped';
export type AutoContractStatus = 'open' | 'won' | 'lost';
export type AutoStopReason = 'error' | 'user_stopped' | 'condition_triggered';

export interface AutoContract {
    contract_id: number;
    buy_price: number;
    purchase_time: number;
    contract_status?: AutoContractStatus;
    sell_price?: number;
    sell_time?: number;
}

export interface ContractTemplate {
    contract_type: string;
    currency: string;
    underlying_symbol: string;
    amount?: number;
    basis?: 'payout' | 'stake';
    duration?: number;
    duration_unit?: 'd' | 'h' | 'm' | 's' | 't';
    barrier?: string;
    barrier2?: string;
    multiplier?: number;
    growth_rate?: number;
    selected_tick?: number;
    limit_order?: { stop_loss?: number; take_profit?: number };
}

export interface AutoRun {
    run_id: string;
    status: AutoRunStatus;
    strategy_id: string;
    strategy_parameters: Record<string, unknown>;
    contract_template: ContractTemplate;
    start_time: number;
    contracts?: AutoContract[];
    total_stake?: number;
    total_payout?: number;
    stop_reason?: AutoStopReason;
    stop_reason_code?: string;
    stop_time?: number;
}

/** A strategy's parameter schema, as Deriv describes it: `{ multiplier: { type: 'number' } }`. */
export interface AutoStrategyParameter {
    type?: string;
    [key: string]: unknown;
}

export interface AutoStrategy {
    strategy_id: string;
    display_name: string;
    description?: string;
    parameters: Record<string, AutoStrategyParameter>;
    supported_contract_types: string[];
}

/**
 * The socket, as this service needs it. Narrow on purpose: it keeps the whole
 * bot-skeleton bundle out of anything that only wants to talk to the API, and
 * lets tests drive the exchange without a WebSocket.
 */
export interface AutomationTransport {
    send: <T>(request: Record<string, unknown>) => Promise<T>;
    /** Registers a handler for pushed messages; returns an unsubscribe function. */
    onMessage: (handler: (data: Record<string, unknown>) => void) => () => void;
}

let injectedTransport: AutomationTransport | null = null;

/** Tests replace the socket with this; production leaves it alone. */
export const setAutomationTransport = (transport: AutomationTransport | null): void => {
    injectedTransport = transport;
};

const apiBaseTransport: AutomationTransport = {
    send: async <T>(request: Record<string, unknown>): Promise<T> => {
        const { api_base } = await import('@/external/bot-skeleton');
        if (!api_base?.api) throw new Error('Not connected to Deriv.');
        // The vendored type declares send() as void; deriv-api actually returns
        // a promise of the response, which is what every caller in the codebase
        // relies on.
        return api_base.api.send(request) as unknown as Promise<T>;
    },
    onMessage: handler => {
        let subscription: { unsubscribe: () => void } | null = null;
        let cancelled = false;

        void (async () => {
            const { api_base } = await import('@/external/bot-skeleton');
            if (cancelled || !api_base?.api) return;
            subscription = api_base.api.onMessage().subscribe(({ data }: { data: Record<string, unknown> }) => {
                handler(data);
            });
        })();

        return () => {
            cancelled = true;
            subscription?.unsubscribe();
        };
    },
};

const transport = (): AutomationTransport => injectedTransport ?? apiBaseTransport;

/**
 * Deriv reports failures either by rejecting or by answering with an `error`
 * field, depending on the layer that caught it. Both end up here as an Error
 * carrying Deriv's own message, because the wording is the diagnosis — an
 * unsupported strategy and an insufficient balance need different things done.
 */
const unwrap = <T>(response: unknown, key: string): T => {
    const body = response as Record<string, unknown> | null;
    const error = body?.error as { message?: string; code?: string } | undefined;
    if (error) throw new Error(error.message || error.code || 'Deriv refused the request.');

    const payload = body?.[key];
    if (payload === undefined) throw new Error(`Deriv answered without ${key}.`);
    return payload as T;
};

const request = async <T>(payload: Record<string, unknown>, key: string): Promise<T> => {
    try {
        const response = await transport().send<Record<string, unknown>>(payload);
        return unwrap<T>(response, key);
    } catch (caught) {
        // A rejection from deriv-api carries the same envelope as a resolved
        // error response, so it is unwrapped the same way rather than reported
        // as a bare "request failed".
        const body = caught as Record<string, unknown> | null;
        const error = body?.error as { message?: string; code?: string } | undefined;
        if (error) throw new Error(error.message || error.code || 'Deriv refused the request.');
        throw caught instanceof Error ? caught : new Error(String(caught));
    }
};

export interface StartRunInput {
    contract_template: ContractTemplate;
    strategy_id: string;
    strategy_parameters: Record<string, unknown>;
    /** Stream run updates until the run ends or the subscription is forgotten. */
    subscribe?: boolean;
}

export interface ActiveSymbol {
    underlying_symbol: string;
    underlying_symbol_name: string;
    market: string;
    submarket: string;
    exchange_is_open: 0 | 1;
    is_trading_suspended: 0 | 1;
    pip_size: number;
}

export interface ContractCategory {
    contract_category: string;
    contract_types: string[];
    display_name: string;
}

export const AutomationService = {
    /**
     * Contract categories and the types in each — "Up/Down" for CALL and PUT.
     * Used to label the contract picker with the names Deriv itself uses,
     * rather than making people recognise DIGITDIFF on sight.
     */
    async listContractCategories(): Promise<ContractCategory[]> {
        return request<ContractCategory[]>({ contracts_list: 1 }, 'contracts_list');
    },

    /**
     * Symbols a contract can be bought on right now.
     *
     * The picker offers these rather than a free-text field: a run started on a
     * suspended or closed market fails on its first purchase, which is a slow
     * and confusing way to find out you mistyped a symbol code.
     */
    async listSymbols(): Promise<ActiveSymbol[]> {
        const symbols = await request<ActiveSymbol[]>({ active_symbols: 'brief' }, 'active_symbols');
        return symbols.filter(symbol => symbol.exchange_is_open === 1 && symbol.is_trading_suspended === 0);
    },

    /** Every strategy Deriv will run, with the parameters each one takes. */
    async listStrategies(): Promise<AutoStrategy[]> {
        const result = await request<{ strategies: AutoStrategy[] }>(
            { auto_list_strategies: 1 },
            'auto_list_strategies'
        );
        return result.strategies ?? [];
    },

    /** Every run on this account, finished ones included. */
    async listRuns(): Promise<AutoRun[]> {
        const result = await request<{ runs: AutoRun[] }>({ auto_list: 1 }, 'auto_list');
        return result.runs ?? [];
    },

    /** Begins a run. Contracts start being bought immediately. */
    async start({ contract_template, strategy_id, strategy_parameters, subscribe }: StartRunInput): Promise<AutoRun> {
        return request<AutoRun>(
            {
                auto_start: 1,
                contract_template,
                strategy_id,
                strategy_parameters,
                ...(subscribe ? { subscribe: 1 } : {}),
            },
            'auto_start'
        );
    },

    /** Reads one run — used to re-attach after a reload. */
    async get(run_id: string, subscribe = false): Promise<AutoRun> {
        return request<AutoRun>({ auto_get: 1, run_id, ...(subscribe ? { subscribe: 1 } : {}) }, 'auto_get');
    },

    /** Stops buying until resumed. Open contracts are unaffected. */
    async pause(run_id: string): Promise<AutoRun> {
        return request<AutoRun>({ auto_pause: 1, run_id }, 'auto_pause');
    },

    async resume(run_id: string): Promise<AutoRun> {
        return request<AutoRun>({ auto_resume: 1, run_id }, 'auto_resume');
    },

    /** Ends the run. Contracts already open keep running to settlement. */
    async stop(run_id: string): Promise<AutoRun> {
        return request<AutoRun>({ auto_stop: 1, run_id }, 'auto_stop');
    },

    /** Drops a stream. The run itself carries on — use stop() for that. */
    async forget(subscription_id: string): Promise<void> {
        await transport().send({ forget: subscription_id });
    },

    /**
     * Watches for pushed updates to a run.
     *
     * Updates arrive under whichever message opened the stream (auto_start or
     * auto_get), so both are accepted and filtered by run id — the connection
     * carries every subscription this account has.
     */
    watch(run_id: string, onUpdate: (run: AutoRun) => void): () => void {
        return transport().onMessage(data => {
            const msg_type = data?.msg_type as string | undefined;
            if (msg_type !== 'auto_start' && msg_type !== 'auto_get') return;

            const run = data[msg_type] as AutoRun | undefined;
            if (run?.run_id === run_id) onUpdate(run);
        });
    },
};
