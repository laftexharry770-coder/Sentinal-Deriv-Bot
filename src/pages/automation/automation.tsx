import { useEffect, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useApiBase } from '@/hooks/useApiBase';
import { useAutomation } from '@/hooks/useAutomation';
import { useStore } from '@/hooks/useStore';
import {
    AutomationService,
    type ActiveSymbol,
    type AutoRun,
    type AutoStrategy,
    type ContractCategory,
    type ContractTemplate,
} from '@/services/automation.service';
import { getAuthInfo } from '@/external/deriv-core';
import { DerivWSAccountsService } from '@/services/derivws-accounts.service';
import { isDemoAccount } from '@/utils/account-helpers';
import { formatLocalDateTime, formatLocalTime } from '@/utils/local-time';
import { Localize, localize } from '@deriv-com/translations';
import './automation.scss';

/** Contract types that need a barrier — a digit prediction or a threshold. */
const BARRIER_TYPES = new Set(['DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER', 'ONETOUCH', 'NOTOUCH']);

/** Contract types priced by multiplier rather than duration. */
const MULTIPLIER_TYPES = new Set(['MULTUP', 'MULTDOWN']);

const DURATION_UNITS: Array<{ value: NonNullable<ContractTemplate['duration_unit']>; label: string }> = [
    { value: 't', label: 'ticks' },
    { value: 's', label: 'seconds' },
    { value: 'm', label: 'minutes' },
    { value: 'h', label: 'hours' },
    { value: 'd', label: 'days' },
];

const money = (value: number | undefined, currency: string) =>
    typeof value === 'number' ? `${value.toFixed(2)} ${currency}` : '—';

/** The result so far: what came back minus what went in. */
const netOf = (run: AutoRun) => (run.total_payout ?? 0) - (run.total_stake ?? 0);

const Automation = observer(() => {
    const { isAuthorized } = useApiBase();
    const { client } = useStore();
    const automation = useAutomation(isAuthorized);
    const { strategies, runs, activeRun, loading, busy, error } = automation;

    const [symbols, setSymbols] = useState<ActiveSymbol[]>([]);
    const [categories, setCategories] = useState<ContractCategory[]>([]);
    const [strategyId, setStrategyId] = useState('');
    const [symbol, setSymbol] = useState('');
    const [contractType, setContractType] = useState('');
    const [amount, setAmount] = useState('1');
    const [basis, setBasis] = useState<'stake' | 'payout'>('stake');
    const [duration, setDuration] = useState('1');
    const [durationUnit, setDurationUnit] = useState<NonNullable<ContractTemplate['duration_unit']>>('t');
    const [barrier, setBarrier] = useState('');
    const [multiplier, setMultiplier] = useState('100');
    const [parameters, setParameters] = useState<Record<string, string>>({});
    const [confirmingReal, setConfirmingReal] = useState(false);
    const [resetting, setResetting] = useState(false);
    const [resetNote, setResetNote] = useState<string | null>(null);

    const currency = client?.currency || 'USD';
    const loginid = client?.loginid || '';
    const isDemo = loginid ? isDemoAccount(loginid) : true;

    // The market data both pickers are built from. Neither needs auth, but
    // there is no point asking before there is a socket.
    useEffect(() => {
        if (!isAuthorized) return;
        let cancelled = false;
        void (async () => {
            try {
                const [activeSymbols, contractCategories] = await Promise.all([
                    AutomationService.listSymbols(),
                    AutomationService.listContractCategories(),
                ]);
                if (cancelled) return;
                setSymbols(activeSymbols);
                setCategories(contractCategories);
            } catch {
                // The form falls back to free entry; the run's own errors are
                // what matter, and they surface on the panel.
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [isAuthorized]);

    const strategy: AutoStrategy | undefined = useMemo(
        () => strategies.find(item => item.strategy_id === strategyId),
        [strategies, strategyId]
    );

    // Deriv names contract types by category; showing "Up/Down — CALL" beats
    // expecting someone to recognise the code.
    const typeLabels = useMemo(() => {
        const labels = new Map<string, string>();
        categories.forEach(category => {
            category.contract_types.forEach(type => labels.set(type, category.display_name));
        });
        return labels;
    }, [categories]);

    // Pick the first strategy as soon as the list arrives, and reset the
    // contract type whenever the strategy changes — a strategy only supports
    // some of them, and a stale choice would be refused at start.
    useEffect(() => {
        if (!strategyId && strategies.length > 0) setStrategyId(strategies[0].strategy_id);
    }, [strategies, strategyId]);

    useEffect(() => {
        if (!strategy) return;
        setContractType(previous =>
            strategy.supported_contract_types.includes(previous) ? previous : (strategy.supported_contract_types[0] ?? '')
        );
        setParameters(previous => {
            const next: Record<string, string> = {};
            Object.keys(strategy.parameters ?? {}).forEach(key => {
                next[key] = previous[key] ?? '';
            });
            return next;
        });
    }, [strategy]);

    useEffect(() => {
        if (!symbol && symbols.length > 0) {
            // Synthetics run around the clock, so they are the sane default.
            const synthetic = symbols.find(item => item.market === 'synthetic_index');
            setSymbol((synthetic ?? symbols[0]).underlying_symbol);
        }
    }, [symbols, symbol]);

    const needsBarrier = BARRIER_TYPES.has(contractType);
    const isMultiplier = MULTIPLIER_TYPES.has(contractType);
    const canStart =
        Boolean(strategyId && symbol && contractType && Number(amount) > 0) &&
        !busy &&
        (!needsBarrier || barrier.trim().length > 0);

    const buildTemplate = (): ContractTemplate => {
        const template: ContractTemplate = {
            contract_type: contractType,
            currency,
            underlying_symbol: symbol,
            amount: Number(amount),
            basis,
        };
        if (needsBarrier) template.barrier = barrier.trim();
        if (isMultiplier) template.multiplier = Number(multiplier);
        else {
            template.duration = Number(duration);
            template.duration_unit = durationUnit;
        }
        return template;
    };

    /** Strings from the form become numbers where the schema says number. */
    const buildParameters = (): Record<string, unknown> => {
        const schema = strategy?.parameters ?? {};
        const built: Record<string, unknown> = {};
        Object.entries(parameters).forEach(([key, value]) => {
            if (value === '') return;
            built[key] = schema[key]?.type === 'number' ? Number(value) : value;
        });
        return built;
    };

    /**
     * Puts the practice balance back to Deriv's starting amount.
     *
     * Testing a strategy is the quickest way to empty a demo account, and
     * without this the only way back is Deriv's own site. Demo only — the
     * button does not exist on a real account, where there is nothing to reset.
     */
    const handleResetDemoBalance = async () => {
        setResetting(true);
        setResetNote(null);
        try {
            const authInfo = getAuthInfo();
            if (!authInfo?.access_token) throw new Error(localize('Not signed in.'));
            await DerivWSAccountsService.resetDemoBalance(authInfo.access_token, loginid);
            setResetNote(localize('Demo balance reset.'));
        } catch (caught) {
            setResetNote(caught instanceof Error ? caught.message : String(caught));
        } finally {
            setResetting(false);
        }
    };

    const handleStart = async () => {
        // A real account stakes real money on every purchase this makes, and
        // the run continues after the tab is closed. One deliberate second
        // click, every time.
        if (!isDemo && !confirmingReal) {
            setConfirmingReal(true);
            return;
        }
        setConfirmingReal(false);
        await automation.start({
            contract_template: buildTemplate(),
            strategy_id: strategyId,
            strategy_parameters: buildParameters(),
        });
    };

    if (!isAuthorized) {
        return (
            <div className='automation'>
                <div className='automation__empty'>
                    <Localize i18n_default_text='Log in to run an automated strategy.' />
                </div>
            </div>
        );
    }

    return (
        <div className='automation'>
            <header className='automation__header'>
                <h2 className='automation__title'>
                    <Localize i18n_default_text='Automation' />
                </h2>
                <p className='automation__subtitle'>
                    <Localize i18n_default_text='Deriv runs the strategy on its own servers. It keeps buying contracts after this page is closed — stopping it is done here, not by closing the tab.' />
                </p>
                <span className={`automation__account automation__account--${isDemo ? 'demo' : 'real'}`}>
                    {isDemo ? (
                        <Localize i18n_default_text='Demo account — practice money' />
                    ) : (
                        <Localize i18n_default_text='Real account — real money' />
                    )}
                    {loginid ? ` · ${loginid}` : ''}
                </span>
                {isDemo && loginid && (
                    <div className='automation__reset'>
                        <button type='button' disabled={resetting} onClick={() => void handleResetDemoBalance()}>
                            {resetting ? (
                                <Localize i18n_default_text='Resetting…' />
                            ) : (
                                <Localize i18n_default_text='Reset demo balance' />
                            )}
                        </button>
                        {resetNote && <span className='automation__hint'>{resetNote}</span>}
                    </div>
                )}
            </header>

            {error && (
                <div className='automation__error' role='alert'>
                    <span>{error}</span>
                    <button type='button' onClick={automation.clearError}>
                        <Localize i18n_default_text='Dismiss' />
                    </button>
                </div>
            )}

            <section className='automation__panel'>
                <h3>
                    <Localize i18n_default_text='Start a run' />
                </h3>

                {loading && strategies.length === 0 ? (
                    <p className='automation__muted'>
                        <Localize i18n_default_text='Loading strategies…' />
                    </p>
                ) : strategies.length === 0 ? (
                    <p className='automation__muted'>
                        <Localize i18n_default_text='Deriv listed no strategies for this account.' />
                    </p>
                ) : (
                    <>
                        <div className='automation__field'>
                            <label htmlFor='automation-strategy'>
                                <Localize i18n_default_text='Strategy' />
                            </label>
                            <select
                                id='automation-strategy'
                                value={strategyId}
                                onChange={event => setStrategyId(event.target.value)}
                            >
                                {strategies.map(item => (
                                    <option key={item.strategy_id} value={item.strategy_id}>
                                        {item.display_name}
                                    </option>
                                ))}
                            </select>
                            {strategy?.description && <p className='automation__hint'>{strategy.description}</p>}
                        </div>

                        <div className='automation__row'>
                            <div className='automation__field'>
                                <label htmlFor='automation-symbol'>
                                    <Localize i18n_default_text='Market' />
                                </label>
                                <select
                                    id='automation-symbol'
                                    value={symbol}
                                    onChange={event => setSymbol(event.target.value)}
                                >
                                    {symbols.map(item => (
                                        <option key={item.underlying_symbol} value={item.underlying_symbol}>
                                            {item.underlying_symbol_name}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className='automation__field'>
                                <label htmlFor='automation-contract-type'>
                                    <Localize i18n_default_text='Contract type' />
                                </label>
                                <select
                                    id='automation-contract-type'
                                    value={contractType}
                                    onChange={event => setContractType(event.target.value)}
                                >
                                    {(strategy?.supported_contract_types ?? []).map(type => (
                                        <option key={type} value={type}>
                                            {typeLabels.has(type) ? `${typeLabels.get(type)} — ${type}` : type}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className='automation__row'>
                            <div className='automation__field'>
                                <label htmlFor='automation-amount'>
                                    <Localize i18n_default_text='Amount' />
                                </label>
                                <input
                                    id='automation-amount'
                                    type='number'
                                    min='0'
                                    step='0.01'
                                    value={amount}
                                    onChange={event => setAmount(event.target.value)}
                                />
                                <p className='automation__hint'>{currency}</p>
                            </div>

                            <div className='automation__field'>
                                <label htmlFor='automation-basis'>
                                    <Localize i18n_default_text='Amount is' />
                                </label>
                                <select
                                    id='automation-basis'
                                    value={basis}
                                    onChange={event => setBasis(event.target.value as 'stake' | 'payout')}
                                >
                                    <option value='stake'>{localize('Stake')}</option>
                                    <option value='payout'>{localize('Payout')}</option>
                                </select>
                            </div>
                        </div>

                        {isMultiplier ? (
                            <div className='automation__field'>
                                <label htmlFor='automation-multiplier'>
                                    <Localize i18n_default_text='Multiplier' />
                                </label>
                                <input
                                    id='automation-multiplier'
                                    type='number'
                                    min='0'
                                    value={multiplier}
                                    onChange={event => setMultiplier(event.target.value)}
                                />
                            </div>
                        ) : (
                            <div className='automation__row'>
                                <div className='automation__field'>
                                    <label htmlFor='automation-duration'>
                                        <Localize i18n_default_text='Duration' />
                                    </label>
                                    <input
                                        id='automation-duration'
                                        type='number'
                                        min='1'
                                        value={duration}
                                        onChange={event => setDuration(event.target.value)}
                                    />
                                </div>
                                <div className='automation__field'>
                                    <label htmlFor='automation-duration-unit'>
                                        <Localize i18n_default_text='Duration unit' />
                                    </label>
                                    <select
                                        id='automation-duration-unit'
                                        value={durationUnit}
                                        onChange={event =>
                                            setDurationUnit(
                                                event.target.value as NonNullable<ContractTemplate['duration_unit']>
                                            )
                                        }
                                    >
                                        {DURATION_UNITS.map(unit => (
                                            <option key={unit.value} value={unit.value}>
                                                {unit.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        )}

                        {needsBarrier && (
                            <div className='automation__field'>
                                <label htmlFor='automation-barrier'>
                                    <Localize i18n_default_text='Barrier' />
                                </label>
                                <input
                                    id='automation-barrier'
                                    value={barrier}
                                    onChange={event => setBarrier(event.target.value)}
                                    placeholder='0'
                                />
                                <p className='automation__hint'>
                                    <Localize i18n_default_text='For digit contracts this is the predicted digit.' />
                                </p>
                            </div>
                        )}

                        {strategy && Object.keys(strategy.parameters ?? {}).length > 0 && (
                            <div className='automation__parameters'>
                                <h4>
                                    <Localize i18n_default_text='Strategy parameters' />
                                </h4>
                                {Object.entries(strategy.parameters).map(([key, schema]) => (
                                    <div className='automation__field' key={key}>
                                        <label htmlFor={`automation-param-${key}`}>{key.replace(/_/g, ' ')}</label>
                                        <input
                                            id={`automation-param-${key}`}
                                            type={schema?.type === 'number' ? 'number' : 'text'}
                                            step='any'
                                            value={parameters[key] ?? ''}
                                            onChange={event =>
                                                setParameters(previous => ({
                                                    ...previous,
                                                    [key]: event.target.value,
                                                }))
                                            }
                                        />
                                    </div>
                                ))}
                            </div>
                        )}

                        {confirmingReal && (
                            <p className='automation__warning' role='alert'>
                                <Localize i18n_default_text='This will buy contracts with real money on this account, repeatedly, until you stop it. Press Start again to confirm.' />
                            </p>
                        )}

                        <button
                            type='button'
                            className='automation__start'
                            disabled={!canStart}
                            onClick={() => void handleStart()}
                        >
                            {busy ? (
                                <Localize i18n_default_text='Working…' />
                            ) : confirmingReal ? (
                                <Localize i18n_default_text='Start with real money' />
                            ) : (
                                <Localize i18n_default_text='Start run' />
                            )}
                        </button>
                    </>
                )}
            </section>

            {activeRun && (
                <section className='automation__panel'>
                    <h3>
                        <Localize i18n_default_text='Current run' />
                    </h3>
                    <RunView run={activeRun} currency={currency} />
                    <div className='automation__controls'>
                        {activeRun.status === 'running' && (
                            <button type='button' disabled={busy} onClick={() => void automation.pause(activeRun.run_id)}>
                                <Localize i18n_default_text='Pause' />
                            </button>
                        )}
                        {activeRun.status === 'paused' && (
                            <button
                                type='button'
                                disabled={busy}
                                onClick={() => void automation.resume(activeRun.run_id)}
                            >
                                <Localize i18n_default_text='Resume' />
                            </button>
                        )}
                        {activeRun.status !== 'stopped' && (
                            <button
                                type='button'
                                className='automation__stop'
                                disabled={busy}
                                onClick={() => void automation.stop(activeRun.run_id)}
                            >
                                <Localize i18n_default_text='Stop' />
                            </button>
                        )}
                        <button type='button' disabled={busy || loading} onClick={() => void automation.refresh()}>
                            <Localize i18n_default_text='Refresh' />
                        </button>
                    </div>
                    {activeRun.status !== 'stopped' && (
                        <p className='automation__hint'>
                            <Localize i18n_default_text='Stopping ends the run. Contracts already open carry on to settlement.' />
                        </p>
                    )}
                </section>
            )}

            {runs.length > 0 && (
                <section className='automation__panel'>
                    <h3>
                        <Localize i18n_default_text='Runs on this account' />
                    </h3>
                    <table className='automation__table'>
                        <thead>
                            <tr>
                                <th>{localize('Started')}</th>
                                <th>{localize('Strategy')}</th>
                                <th>{localize('Status')}</th>
                                <th>{localize('Result')}</th>
                                <th />
                            </tr>
                        </thead>
                        <tbody>
                            {runs.map(run => (
                                <tr key={run.run_id}>
                                    <td>{formatLocalDateTime(run.start_time)}</td>
                                    <td>{run.strategy_id}</td>
                                    <td>{run.status}</td>
                                    <td className={netOf(run) >= 0 ? 'automation__profit' : 'automation__loss'}>
                                        {money(netOf(run), currency)}
                                    </td>
                                    <td>
                                        {run.run_id !== activeRun?.run_id && (
                                            <button
                                                type='button'
                                                disabled={busy}
                                                onClick={() => void automation.attach(run.run_id)}
                                            >
                                                <Localize i18n_default_text='Open' />
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </section>
            )}
        </div>
    );
});

const RunView = ({ run, currency }: { run: AutoRun; currency: string }) => {
    const net = netOf(run);
    return (
        <>
            <dl className='automation__summary'>
                <div>
                    <dt>{localize('Status')}</dt>
                    <dd className={`automation__status automation__status--${run.status}`}>{run.status}</dd>
                </div>
                <div>
                    <dt>{localize('Started')}</dt>
                    <dd>{formatLocalDateTime(run.start_time)}</dd>
                </div>
                <div>
                    <dt>{localize('Staked')}</dt>
                    <dd>{money(run.total_stake, currency)}</dd>
                </div>
                <div>
                    <dt>{localize('Returned')}</dt>
                    <dd>{money(run.total_payout, currency)}</dd>
                </div>
                <div>
                    <dt>{localize('Net')}</dt>
                    <dd className={net >= 0 ? 'automation__profit' : 'automation__loss'}>{money(net, currency)}</dd>
                </div>
            </dl>

            {run.status === 'stopped' && run.stop_reason && (
                <p className='automation__hint'>
                    {localize('Stopped')}: {run.stop_reason}
                    {run.stop_reason_code ? ` (${run.stop_reason_code})` : ''}
                    {run.stop_time ? ` · ${formatLocalDateTime(run.stop_time)}` : ''}
                </p>
            )}

            {run.contracts && run.contracts.length > 0 && (
                <table className='automation__table'>
                    <thead>
                        <tr>
                            <th>{localize('Bought')}</th>
                            <th>{localize('Stake')}</th>
                            <th>{localize('Result')}</th>
                            <th>{localize('Returned')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {run.contracts.map(contract => (
                            <tr key={contract.contract_id}>
                                <td>{formatLocalTime(contract.purchase_time)}</td>
                                <td>{money(contract.buy_price, currency)}</td>
                                <td>{contract.contract_status ?? 'open'}</td>
                                <td>{money(contract.sell_price, currency)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </>
    );
};

export default Automation;
