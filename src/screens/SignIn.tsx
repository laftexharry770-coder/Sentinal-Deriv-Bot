import { useRef, useState } from 'react';
import {
  DEFAULT_APP_ID,
  isDemoAccountId,
  isValidAppId,
  loadCredentials,
  tokenShapeWarning,
} from '../deriv/client';
import { TextField, Toggle } from '../components/ui';
import type { Session } from '../App';

/**
 * The gate. Until a Deriv session exists the bot shows no markets, no digits
 * and no balance — only this screen.
 */
export function SignIn({
  session,
  onConnect,
}: {
  session: Session;
  onConnect: (input: { token: string; appId: string; accountId: string; remember: boolean }) => Promise<void>;
}) {
  const saved = loadCredentials();
  const [token, setToken] = useState(saved?.token ?? '');
  const [appId, setAppId] = useState(saved?.appId ?? DEFAULT_APP_ID);
  const [accountId, setAccountId] = useState(saved?.accountId ?? '');
  const [remember, setRemember] = useState(Boolean(saved));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef<HTMLInputElement>(null);

  const connecting = session.status === 'connecting' || busy;
  const shown = error ?? (session.status === 'locked' ? session.error : null);

  const appIdError =
    appId.trim().length > 0 && !isValidAppId(appId)
      ? 'An app id has no spaces or punctuation. Copy it from your app on developers.deriv.com.'
      : null;
  const tokenWarning = tokenShapeWarning(token);
  const accountKind = accountId.trim().length === 0 ? null : isDemoAccountId(accountId) ? 'demo' : 'real';
  const ready = token.trim().length > 0 && accountId.trim().length > 0 && appIdError === null;

  /** A rejected token is fixed at the field, which the error has scrolled past. */
  const resetToken = () => {
    setToken('');
    setError(null);
    tokenRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    tokenRef.current?.focus({ preventScroll: true });
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConnect({ token, appId, accountId, remember });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col justify-center gap-5 px-5 py-10">
      <header className="flex items-center gap-3">
        <div className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-[var(--color-brass-bright)] to-[var(--color-brass-deep)] shadow-[0_10px_24px_-12px_rgba(192,139,60,0.75)]">
          <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" aria-hidden="true">
            <path
              d="M12 2.8 4.8 5.6v6.1c0 4.3 2.9 8.3 7.2 9.5 4.3-1.2 7.2-5.2 7.2-9.5V5.6L12 2.8Z"
              stroke="white"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
            <path
              d="M9 12.2l2.2 2.3L15.4 10"
              stroke="white"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div className="leading-tight">
          <h1 className="text-lg font-extrabold tracking-tight text-ink">
            SENTINAL <span className="text-[var(--color-brass-bright)]">DERIV</span>
          </h1>
          <p className="text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
            Digits Desk
          </p>
        </div>
      </header>

      <section className="card p-5">
        <h2 className="text-sm font-semibold text-ink">Connect Deriv</h2>
        <p className="mt-1 text-xs leading-relaxed text-[var(--color-ink-muted)]">
          Take the access token and the app id from your application on{' '}
          <span className="text-ink">developers.deriv.com</span>, and the account id from the Options account
          you want to trade. The token needs the <span className="text-ink">Trade</span> scope.
        </p>

        <div className="mt-4 space-y-3">
          <TextField
            label="Deriv API token"
            secret
            showCount
            inputRef={tokenRef}
            value={token}
            onChange={setToken}
            placeholder="a1b2c3d4e5f6g7h8"
            error={tokenWarning}
            hint="Stays in this browser. Sent only to Deriv, never anywhere else."
          />
          <TextField
            label="Account id"
            value={accountId}
            onChange={setAccountId}
            placeholder="DOT93898941"
            hint={
              accountKind === 'demo'
                ? 'Reads as a demo account — practice money.'
                : accountKind === 'real'
                  ? 'Reads as a real account — real money.'
                  : 'The Options account to trade: DOT… is demo, ROT… is real.'
            }
          />
          <TextField
            label="App id"
            value={appId}
            onChange={setAppId}
            placeholder={DEFAULT_APP_ID}
            showCount
            error={appIdError}
            hint={`Your own app's id from developers.deriv.com, or leave Deriv's shared id ${DEFAULT_APP_ID}.`}
          />
          <Toggle
            label="Stay signed in on this device"
            hint="Keeps the token in this browser's storage so the bot reconnects itself."
            checked={remember}
            onChange={setRemember}
          />
        </div>

        {accountKind === 'real' && (
          <p className="mt-3 rounded-lg border border-loss/40 bg-loss/10 px-3 py-2 text-xs leading-relaxed text-loss">
            {accountId.trim()} is a real account. Every contract bought here stakes real money, and each one
            carries a negative expected return — that is the house margin on these products, and no entry
            timing changes it.
          </p>
        )}

        {shown && (
          <div className="mt-3 rounded-lg border border-loss/40 bg-loss/10 px-3 py-2 text-xs leading-relaxed text-loss">
            <p>{shown}</p>
            {token.trim().length > 0 && (
              <button className="btn btn-ghost mt-2 w-full py-1.5 text-xs" onClick={resetToken}>
                Clear the token field ({token.trim().length} characters) and start again
              </button>
            )}
          </div>
        )}

        <button
          className="btn btn-primary mt-4 w-full py-2.5"
          disabled={!ready || connecting}
          onClick={() => void submit()}
        >
          {connecting ? 'Connecting…' : 'Connect and open the desk'}
        </button>
      </section>

      <p className="px-1 text-center text-[0.6875rem] leading-relaxed text-[var(--color-ink-muted)]">
        Deriv's synthetic indices come from an audited random number generator. This desk measures the tape
        and prices the contract; it does not predict the next digit, because nothing can.
      </p>
    </div>
  );
}
