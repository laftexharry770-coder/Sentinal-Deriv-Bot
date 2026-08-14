import { useCallback, useEffect, useRef, useState } from 'react';
import { AutomationService, type AutoRun, type AutoStrategy, type StartRunInput } from '@/services/automation.service';

/**
 * The run id is kept across reloads.
 *
 * A run keeps buying contracts on Deriv's side after the tab closes, so the
 * worst thing this screen could do is forget about one. On the next load it
 * re-reads the run and re-subscribes, which is also what makes Stop reachable
 * after a refresh.
 */
const ACTIVE_RUN_KEY = 'automation_active_run_id';

export interface AutomationState {
    strategies: AutoStrategy[];
    runs: AutoRun[];
    activeRun: AutoRun | null;
    loading: boolean;
    busy: boolean;
    error: string | null;
}

export const useAutomation = (isAuthorised: boolean) => {
    const [strategies, setStrategies] = useState<AutoStrategy[]>([]);
    const [runs, setRuns] = useState<AutoRun[]>([]);
    const [activeRun, setActiveRun] = useState<AutoRun | null>(null);
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const unwatch = useRef<(() => void) | null>(null);

    const remember = (run: AutoRun | null) => {
        try {
            if (run && run.status !== 'stopped') localStorage.setItem(ACTIVE_RUN_KEY, run.run_id);
            else localStorage.removeItem(ACTIVE_RUN_KEY);
        } catch {
            // Private browsing; the run is still controllable from the list.
        }
    };

    /** Follows one run's pushed updates, replacing any previous watch. */
    const watch = useCallback((run: AutoRun) => {
        unwatch.current?.();
        unwatch.current = AutomationService.watch(run.run_id, updated => {
            setActiveRun(updated);
            remember(updated);
            setRuns(previous => previous.map(item => (item.run_id === updated.run_id ? updated : item)));
        });
    }, []);

    const adopt = useCallback(
        (run: AutoRun) => {
            setActiveRun(run);
            remember(run);
            setRuns(previous => {
                const without = previous.filter(item => item.run_id !== run.run_id);
                return [run, ...without];
            });
            watch(run);
        },
        [watch]
    );

    const refresh = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [available, existing] = await Promise.all([
                AutomationService.listStrategies(),
                AutomationService.listRuns(),
            ]);
            setStrategies(available);
            setRuns(existing);

            // Prefer the run this browser was last watching; otherwise adopt a
            // live one, since a running strategy is the thing most worth seeing.
            let remembered: string | null = null;
            try {
                remembered = localStorage.getItem(ACTIVE_RUN_KEY);
            } catch {
                remembered = null;
            }
            const candidate =
                existing.find(run => run.run_id === remembered && run.status !== 'stopped') ??
                existing.find(run => run.status === 'running' || run.status === 'paused');

            if (candidate) {
                const detailed = await AutomationService.get(candidate.run_id, true);
                adopt(detailed);
            } else {
                remember(null);
            }
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : String(caught));
        } finally {
            setLoading(false);
        }
    }, [adopt]);

    useEffect(() => {
        if (!isAuthorised) return;
        void refresh();
    }, [isAuthorised, refresh]);

    // Dropping the stream on unmount does not stop the run — nothing here
    // should quietly stop one.
    useEffect(() => () => unwatch.current?.(), []);

    /** Wraps a control so one failure cannot leave the panel stuck on "busy". */
    const control = useCallback(
        async (action: () => Promise<AutoRun>) => {
            setBusy(true);
            setError(null);
            try {
                const run = await action();
                adopt(run);
                return run;
            } catch (caught) {
                setError(caught instanceof Error ? caught.message : String(caught));
                return null;
            } finally {
                setBusy(false);
            }
        },
        [adopt]
    );

    return {
        strategies,
        runs,
        activeRun,
        loading,
        busy,
        error,
        refresh,
        clearError: () => setError(null),
        start: (input: Omit<StartRunInput, 'subscribe'>) =>
            control(() => AutomationService.start({ ...input, subscribe: true })),
        pause: (run_id: string) => control(() => AutomationService.pause(run_id)),
        resume: (run_id: string) => control(() => AutomationService.resume(run_id)),
        stop: (run_id: string) => control(() => AutomationService.stop(run_id)),
        attach: (run_id: string) => control(() => AutomationService.get(run_id, true)),
    };
};
