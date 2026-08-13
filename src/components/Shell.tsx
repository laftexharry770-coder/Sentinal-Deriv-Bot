import { useState, type ReactNode } from 'react';
import type { DerivAccountInfo } from '../deriv/client';
import { useDeriv } from '../deriv/session';

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-[var(--color-brass-bright)] to-[var(--color-brass-deep)] shadow-[0_10px_24px_-12px_rgba(192,139,60,0.75)]">
        <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
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
        <h1 className="text-sm font-extrabold tracking-tight text-ink">
          SENTINAL <span className="text-[var(--color-brass-bright)]">DERIV</span>
        </h1>
        <p className="text-[0.625rem] font-medium uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
          Digits Desk
        </p>
      </div>
    </div>
  );
}

/**
 * The frame: one fixed-height shell with one scrolling pane inside it.
 *
 * dvh rather than vh, because the browser chrome on a phone hides and shows
 * and vh does not follow it — that mismatch is what puts content under the
 * edge of the screen.
 */
export function Shell({
  account,
  onSignOut,
  children,
}: {
  account: DerivAccountInfo;
  onSignOut: () => void;
  children: ReactNode;
}) {
  const { balance } = useDeriv();
  const [confirming, setConfirming] = useState(false);
  const demo = account.isVirtual;

  return (
    <div className="app-shell flex flex-col bg-transparent">
      <header className="relative z-30 flex items-center justify-between gap-3 border-b border-[var(--color-line)] bg-[var(--color-base)]/85 px-4 py-2.5 backdrop-blur-md lg:px-6">
        <span aria-hidden className="brass-rule pointer-events-none absolute inset-x-0 bottom-[-1px] h-px" />
        <Logo />

        <div className="flex items-center gap-2.5">
          <div className="text-right leading-tight">
            <div className="tabular text-sm font-semibold text-ink">
              {balance.toLocaleString(undefined, { style: 'currency', currency: account.currency })}
            </div>
            <div className="tabular text-[0.625rem] text-[var(--color-ink-muted)]">
              {account.loginId} · {demo ? 'demo' : 'real'}
            </div>
          </div>
          {confirming ? (
            <div className="flex items-center gap-1">
              <button className="btn btn-sell px-2.5 py-1.5 text-xs" onClick={onSignOut}>
                Sign out
              </button>
              <button className="btn btn-ghost px-2 py-1.5 text-xs" onClick={() => setConfirming(false)}>
                Keep
              </button>
            </div>
          ) : (
            <button className="btn btn-ghost px-2.5 py-1.5 text-xs" onClick={() => setConfirming(true)}>
              Sign out
            </button>
          )}
        </div>
      </header>

      {/* A real account is worth saying so on every screen, not only at sign-in. */}
      {!demo && (
        <div className="border-b border-loss/30 bg-loss/10 px-4 py-1.5 text-center text-[0.6875rem] font-semibold text-loss">
          Real account — contracts bought here stake real money.
        </div>
      )}

      <main className="app-scroll min-h-0 flex-1 px-3 pb-6 pt-3 sm:px-4 lg:px-6">{children}</main>
    </div>
  );
}
