import { useCallback, useEffect, useState } from 'react';
import { DerivClient, clearCredentials, saveCredentials, type DerivAccountInfo } from './deriv/client';
import { DerivProvider } from './deriv/session';
import { Shell } from './components/Shell';
import { DigitsDesk } from './screens/DigitsDesk';
import { SignIn } from './screens/SignIn';

export type Session =
  | { status: 'locked'; error: string | null }
  | { status: 'connecting' }
  | { status: 'live'; client: DerivClient; account: DerivAccountInfo };

/**
 * The bot's gate.
 *
 * Nothing streams until a Deriv session exists: no markets, no digits, no
 * balance. Signing out closes the socket rather than hiding the screen, so
 * Deriv stops sending ticks the moment they stop being read.
 */
export function App() {
  const [session, setSession] = useState<Session>({ status: 'locked', error: null });

  const connect = useCallback(
    async (input: { token: string; appId: string; accountId: string; remember: boolean }) => {
      setSession({ status: 'connecting' });
      const credentials = {
        token: input.token.trim(),
        appId: input.appId.trim(),
        accountId: input.accountId.trim(),
      };
      const client = new DerivClient(credentials);
      try {
        const account = await client.open((reason) => setSession({ status: 'locked', error: reason }));
        if (input.remember) saveCredentials(credentials);
        else clearCredentials();
        setSession({ status: 'live', client, account });
      } catch (err) {
        client.close();
        setSession({ status: 'locked', error: err instanceof Error ? err.message : 'Could not connect.' });
        throw err;
      }
    },
    [],
  );

  const signOut = useCallback(() => {
    setSession((current) => {
      if (current.status === 'live') current.client.close();
      return { status: 'locked', error: null };
    });
    clearCredentials();
  }, []);

  // A tab that goes away should not leave a socket behind.
  useEffect(() => {
    return () => {
      if (session.status === 'live') session.client.close();
    };
  }, [session]);

  if (session.status !== 'live') {
    return <SignIn session={session} onConnect={connect} />;
  }

  return (
    <DerivProvider client={session.client} account={session.account}>
      <Shell account={session.account} onSignOut={signOut}>
        <DigitsDesk />
      </Shell>
    </DerivProvider>
  );
}
