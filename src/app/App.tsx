import { lazy, Suspense } from 'react';
import React from 'react';
import { createBrowserRouter, createRoutesFromElements, Route, RouterProvider, useRouteError } from 'react-router-dom';
import { cleanupUrl } from '@/external/deriv-core';
import ChunkLoader from '@/components/loader/chunk-loader';
import LocalStorageSyncWrapper from '@/components/localStorage-sync-wrapper';
import RoutePromptDialog from '@/components/route-prompt-dialog';
import { useAccountSwitching } from '@/hooks/useAccountSwitching';
import { useLanguageFromURL } from '@/hooks/useLanguageFromURL';
import { StoreProvider } from '@/hooks/useStore';
import { completeOAuthLogin } from '@/utils/complete-oauth-login';
import { isPreviewMode, PREVIEW_BASE_PATH } from '@/utils/is-preview-mode';
import { lazyWithRetry } from '@/utils/lazy-with-retry';
import { getRedirectUri } from '@/utils/redirect-uri';
import { localize, TranslationProvider } from '@deriv-com/translations';
import CoreStoreProvider from './CoreStoreProvider';
import i18nInstance from './i18n';
import './app-root.scss';

const Layout = lazyWithRetry(() => import('../components/layout'));
const AppRoot = lazyWithRetry(() => import('./app-root'));

/**
 * Component wrapper to handle language URL parameter
 * Uses the useLanguageFromURL hook to process language switching
 */
const LanguageHandler = ({ children }: { children: React.ReactNode }) => {
    useLanguageFromURL();
    return <>{children}</>;
};

// The static preview build is served under /bot/preview (see rsbuild.config.ts
// assetPrefix), so React Router must resolve routes under that prefix.
//
// A project site on GitHub Pages is served from /<repo>/ for the same reason,
// and PUBLIC_BASE_PATH carries it. Without this the router resolves every route
// against the domain root, matches none of them, and renders its own 404 over a
// bundle that loaded perfectly well. Root deploys leave it empty and get no
// basename, which is what react-router wants.
const publicBasePath = (process.env.PUBLIC_BASE_PATH ?? '').replace(/\/+$/, '');
const routerBasename = isPreviewMode() ? PREVIEW_BASE_PATH : publicBasePath || undefined;

/**
 * What the app shows when a route throws before it can render — in practice a
 * chunk that failed to arrive.
 *
 * React Router's default is a bare "Unexpected Application Error!" with a stack
 * trace, which tells the person looking at it nothing they can act on. A failed
 * chunk is usually a network that dropped mid-load, and reloading genuinely
 * fixes it, so say that and offer the button.
 */
const RouteError = () => {
    const error = useRouteError();
    const detail = error instanceof Error ? error.message : String(error ?? '');
    const isChunk = /chunk/i.test(detail);

    return (
        <div style={{ padding: '2rem', maxWidth: '34rem', margin: '0 auto', font: '400 0.9375rem/1.6 Inter, system-ui, sans-serif' }}>
            <h1 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '0.75rem' }}>
                {localize('The app could not finish loading.')}
            </h1>
            <p style={{ marginBottom: '1rem' }}>
                {isChunk
                    ? localize('Part of the app failed to download. This is usually a dropped connection — reloading normally fixes it.')
                    : localize('Something went wrong while starting up.')}
            </p>
            <button
                onClick={() => window.location.reload()}
                style={{ padding: '0.5rem 1rem', borderRadius: '0.375rem', cursor: 'pointer' }}
            >
                {localize('Reload')}
            </button>
            <pre style={{ marginTop: '1.5rem', fontSize: '0.75rem', opacity: 0.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {detail}
            </pre>
        </div>
    );
};

const router = createBrowserRouter(
    createRoutesFromElements(
        <Route
            path='/'
            errorElement={<RouteError />}
            element={
                <Suspense
                    fallback={<ChunkLoader message={localize('Please wait while we connect to the server...')} />}
                >
                    <TranslationProvider defaultLang='EN' i18nInstance={i18nInstance}>
                        <LanguageHandler>
                            <StoreProvider>
                                <LocalStorageSyncWrapper>
                                    <RoutePromptDialog />
                                    <CoreStoreProvider>
                                        <Layout />
                                    </CoreStoreProvider>
                                </LocalStorageSyncWrapper>
                            </StoreProvider>
                        </LanguageHandler>
                    </TranslationProvider>
                </Suspense>
            }
        >
            {/* All child routes will be passed as children to Layout */}
            <Route index element={<AppRoot />} />
            {/* App Builder embeds the template at /preview — render the same app shell */}
            <Route path='preview' element={<AppRoot />} />
        </Route>
    ),
    { basename: routerBasename }
);

/**
 * Reports a sign-in that did not complete.
 *
 * Styled inline rather than through the theme: this has to render in exactly
 * the situation where the app has failed to reach a usable state, so it should
 * not depend on anything that might also be broken.
 */
const AuthErrorBanner = ({ message, onDismiss }: { message: string; onDismiss: () => void }) => (
    <div
        role='alert'
        style={{
            position: 'fixed',
            insetInlineStart: 0,
            insetInlineEnd: 0,
            top: 0,
            zIndex: 9999,
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.75rem',
            padding: '0.75rem 1rem',
            background: '#3b0d0d',
            color: '#ffd9d9',
            borderBottom: '1px solid #7a2222',
            font: '400 0.8125rem/1.45 Inter, system-ui, sans-serif',
        }}
    >
        <span style={{ flex: 1, wordBreak: 'break-word' }}>
            {localize('Sign-in did not complete.')} {message}
        </span>
        <button
            onClick={onDismiss}
            aria-label={localize('Dismiss')}
            style={{
                background: 'transparent',
                border: '1px solid #7a2222',
                borderRadius: '0.25rem',
                color: 'inherit',
                cursor: 'pointer',
                padding: '0.125rem 0.5rem',
            }}
        >
            ✕
        </button>
    </div>
);

/**
 * Main App component
 *
 * Responsibilities:
 * 1. OAuth callback handling (via vendored deriv-core handleOAuthCallback)
 * 2. Account switching from URL (via useAccountSwitching hook)
 * 3. Router provider setup
 */
function App() {
    // A failed sign-in used to be invisible: the error went to the console and
    // the app rendered its signed-out state, which is exactly what it renders
    // when nobody has tried to sign in. This says what went wrong.
    const [authError, setAuthError] = React.useState<string | null>(null);

    // Handle account switching via URL parameter
    useAccountSwitching();

    React.useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        if (!urlParams.has('code')) return;

        const handleCallback = async () => {
            try {
                await completeOAuthLogin(window.location.href);
            } catch (error) {
                console.error('OAuth callback error:', error);
                setAuthError(error instanceof Error ? error.message : String(error));
            } finally {
                // Strip code/state from the address bar either way: they are
                // single-use, and leaving them behind makes a reload look like
                // a fresh callback.
                cleanupUrl(getRedirectUri());
            }
        };

        handleCallback();
    }, []);

    return (
        <>
            {authError && <AuthErrorBanner message={authError} onDismiss={() => setAuthError(null)} />}
            <RouterProvider router={router} />
        </>
    );
}

export default App;
