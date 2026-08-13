import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from 'react';
import type { DerivAccountInfo, DerivClient } from './client';

interface SessionValue {
  client: DerivClient;
  account: DerivAccountInfo;
  /** Deriv's own balance, kept current by its balance stream. */
  balance: number;
}

const Context = createContext<SessionValue | null>(null);

/**
 * Holds the open session for the screens.
 *
 * The balance comes from Deriv's stream rather than being tracked locally,
 * because a contract settling elsewhere — the Deriv app, another tab — moves
 * it just as surely as one bought here.
 */
export function DerivProvider({
  client,
  account,
  children,
}: {
  client: DerivClient;
  account: DerivAccountInfo;
  children: ReactNode;
}) {
  const [balance, setBalance] = useState(account.balance);

  useEffect(() => {
    setBalance(account.balance);
    void client.subscribeBalance(setBalance).catch(() => {
      /* the figure simply stops updating; nothing else depends on it */
    });
  }, [client, account]);

  return createElement(Context.Provider, { value: { client, account, balance } }, children);
}

export function useDeriv(): SessionValue {
  const value = useContext(Context);
  if (!value) throw new Error('useDeriv used outside a Deriv session');
  return value;
}
