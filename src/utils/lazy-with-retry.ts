import { lazy, type ComponentType } from 'react';

/**
 * `React.lazy` that survives a chunk that will not load.
 *
 * Every tab in this app is a separate chunk fetched on first use. The chunk
 * filenames carry a content hash, so a deploy renames them — and a browser
 * still holding the previous index.html asks for names the server no longer
 * has. The import rejects, React.lazy caches that rejection forever, and the
 * tab is dead for the life of the page: clicking Charts, Tutorials or
 * Automation does nothing until the page is reloaded by hand, which is exactly
 * the reload that "fixes" it, because it fetches the current index.html.
 *
 * So: retry once in case it was a blip, and if the chunk still will not load,
 * reload the page automatically — once. The sessionStorage flag is what makes
 * it once: without it a genuinely missing chunk would reload forever.
 */
const RELOAD_FLAG = 'chunk_reload_attempted';

export function lazyWithRetry<T extends ComponentType<never>>(factory: () => Promise<{ default: T }>) {
    return lazy(async () => {
        try {
            const module = await factory();
            // Loaded fine — let a future stale-chunk failure reload again.
            try {
                sessionStorage.removeItem(RELOAD_FLAG);
            } catch {
                // Private browsing; the retry above still applies.
            }
            return module;
        } catch (error) {
            // One immediate retry: a dropped connection costs a reload otherwise.
            try {
                return await factory();
            } catch {
                let alreadyReloaded = false;
                try {
                    alreadyReloaded = sessionStorage.getItem(RELOAD_FLAG) === 'true';
                    sessionStorage.setItem(RELOAD_FLAG, 'true');
                } catch {
                    alreadyReloaded = false;
                }

                if (!alreadyReloaded) {
                    window.location.reload();
                    // Never settles; the page is going away.
                    return new Promise<{ default: T }>(() => undefined);
                }

                // Reloading did not help, so the chunk is genuinely gone.
                // Surfacing the error beats a second reload loop.
                throw error;
            }
        }
    });
}

export default lazyWithRetry;
