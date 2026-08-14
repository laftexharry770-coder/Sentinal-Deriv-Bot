import AutomationBoundary from './boundary';
import AutomationPanel from './automation';

/**
 * The tab's entry point. The panel is wrapped so that a failure inside it
 * cannot reach the application's root error boundary, which would replace the
 * whole app with a refresh prompt.
 */
const Automation = () => (
    <AutomationBoundary>
        <AutomationPanel />
    </AutomationBoundary>
);

export default Automation;
