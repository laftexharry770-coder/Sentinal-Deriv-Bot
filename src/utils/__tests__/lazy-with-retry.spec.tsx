import { Suspense } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { lazyWithRetry } from '../lazy-with-retry';

const Loaded = () => <div>tab content</div>;

const reload = jest.fn();

beforeAll(() => {
    Object.defineProperty(window, 'location', {
        value: { ...window.location, reload },
        writable: true,
    });
});

beforeEach(() => {
    reload.mockClear();
    sessionStorage.clear();
});

const renderLazy = (factory: () => Promise<{ default: typeof Loaded }>) => {
    const Lazy = lazyWithRetry(factory);
    return render(
        <Suspense fallback={<div>loading</div>}>
            <Lazy />
        </Suspense>
    );
};

describe('lazyWithRetry', () => {
    it('renders the chunk when it loads', async () => {
        renderLazy(async () => ({ default: Loaded }));
        expect(await screen.findByText('tab content')).toBeInTheDocument();
    });

    it('retries once before giving up on a dropped connection', async () => {
        let attempts = 0;
        renderLazy(async () => {
            attempts += 1;
            if (attempts === 1) throw new Error('Loading chunk 42 failed.');
            return { default: Loaded };
        });

        expect(await screen.findByText('tab content')).toBeInTheDocument();
        expect(attempts).toBe(2);
        expect(reload).not.toHaveBeenCalled();
    });

    it('reloads the page when the chunk is gone', async () => {
        // A deploy renames chunk files. A browser holding the previous
        // index.html asks for a name the server no longer has, and React caches
        // that rejection — the tab stays dead until the page is reloaded, which
        // is the manual reload this removes.
        renderLazy(async () => {
            throw new Error('Loading chunk 42 failed.');
        });

        await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    });

    it('reloads only once, so a genuinely missing chunk cannot loop', async () => {
        sessionStorage.setItem('chunk_reload_attempted', 'true');
        const failing = async (): Promise<{ default: typeof Loaded }> => {
            throw new Error('Loading chunk 42 failed.');
        };

        // The error surfaces instead; a reload loop is worse than an error.
        const Lazy = lazyWithRetry(failing);
        const swallow = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        render(
            <Suspense fallback={<div>loading</div>}>
                <Lazy />
            </Suspense>
        );

        await waitFor(() => expect(reload).not.toHaveBeenCalled());
        swallow.mockRestore();
    });

    it('clears the flag after a good load, so a later deploy can reload again', async () => {
        sessionStorage.setItem('chunk_reload_attempted', 'true');
        renderLazy(async () => ({ default: Loaded }));

        await screen.findByText('tab content');
        expect(sessionStorage.getItem('chunk_reload_attempted')).toBeNull();
    });
});
