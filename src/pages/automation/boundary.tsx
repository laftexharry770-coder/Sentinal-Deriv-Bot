import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Localize } from '@deriv-com/translations';

interface Props {
    children: ReactNode;
}

interface State {
    error: Error | null;
}

/**
 * Keeps a failure in this tab inside this tab.
 *
 * The app's own boundary sits at the root, so anything that throws while
 * rendering replaces the entire application with "Sorry for the interruption"
 * and a Refresh button — the dashboard, the bot builder and the charts all go
 * with it, and the message says nothing about which part failed. A tab that
 * talks to an API this build has never seen answer is exactly the sort of thing
 * that should not be able to do that.
 *
 * Anything that throws below here loses this panel and nothing else, and says
 * what went wrong.
 */
export class AutomationBoundary extends Component<Props, State> {
    state: State = { error: null };

    static getDerivedStateFromError(error: Error): State {
        return { error };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error('[Automation] panel failed to render', error, info.componentStack);
    }

    render() {
        if (!this.state.error) return this.props.children;

        return (
            <div className='automation'>
                <section className='automation__panel'>
                    <h3>
                        <Localize i18n_default_text='Automation is unavailable' />
                    </h3>
                    <p className='automation__hint'>
                        <Localize i18n_default_text='This panel failed to load. The rest of the app is unaffected, and any run already on Deriv keeps going — nothing here has stopped it.' />
                    </p>
                    <pre className='automation__hint' style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {this.state.error.message}
                    </pre>
                    <div className='automation__controls'>
                        <button type='button' onClick={() => this.setState({ error: null })}>
                            <Localize i18n_default_text='Try again' />
                        </button>
                    </div>
                </section>
            </div>
        );
    }
}

export default AutomationBoundary;
