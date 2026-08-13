/**
 * Deriv Options API client.
 *
 * The bot has no server of its own, so it speaks Deriv's protocol directly
 * with the operator's own access token. The token is exchanged over REST for a
 * WebSocket that Deriv has already authenticated, and never leaves this tab.
 *
 * It trades digit contracts on the synthetic indices. Those indices come from
 * an audited random number generator, so this client reports what Deriv pays
 * and never claims to know what the next digit will be.
 */

/** Deriv's shared app id. Register your own at developers.deriv.com. */
export const DEFAULT_APP_ID = '1089';

/** Where a token is exchanged for an authenticated socket. */
export const DERIV_REST_BASE = 'https://api.derivws.com';

/**
 * An app id travels in a header and a URL, so only characters that cannot
 * survive either are rejected. Deriv issues both integer and alphanumeric app
 * ids, and a stricter rule invented here would reject a real one.
 */
export function isValidAppId(appId: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(appId.trim());
}

/**
 * Whether an account id names a demo account. Deriv prefixes them by kind:
 * DOT for demo, ROT for real. Anything unrecognised counts as real, which is
 * the safe way to be wrong next to a control that stakes money.
 */
export function isDemoAccountId(accountId: string): boolean {
  const id = accountId.trim().toUpperCase();
  return id.startsWith('D') || id.startsWith('VR');
}

/** Flags a token whose text is plainly not a token. Length is never judged. */
export function tokenShapeWarning(token: string): string | null {
  const trimmed = token.trim();
  if (trimmed.length === 0) return null;
  if (/\s/.test(trimmed)) return 'This token has a space or line break inside it — copy it again.';
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    return 'This token has punctuation in it, so something other than the token was copied.';
  }
  return null;
}

export interface DerivCredentials {
  token: string;
  appId: string;
  /** The Options trading account, e.g. DOT93898941 (demo) or ROT92291419. */
  accountId: string;
}

export interface DerivAccountInfo {
  loginId: string;
  currency: string;
  balance: number;
  isVirtual: boolean;
}

export interface DerivSymbolInfo {
  symbol: string;
  displayName: string;
  pip: number;
  market: string;
  open: boolean;
}

export type DerivDigitContract =
  | 'DIGITMATCH'
  | 'DIGITDIFF'
  | 'DIGITEVEN'
  | 'DIGITODD'
  | 'DIGITOVER'
  | 'DIGITUNDER';

/** Only these carry a barrier; sending one with the others is rejected. */
const NEEDS_BARRIER = new Set<DerivDigitContract>(['DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER']);

/** Maps this app's contract vocabulary onto Deriv's. */
export const DIGIT_CONTRACT_NAMES: Record<string, DerivDigitContract> = {
  matches: 'DIGITMATCH',
  differs: 'DIGITDIFF',
  even: 'DIGITEVEN',
  odd: 'DIGITODD',
  over: 'DIGITOVER',
  under: 'DIGITUNDER',
};

export interface DigitOrder {
  symbol: string;
  contract: DerivDigitContract;
  barrier: number;
  stake: number;
  ticks: number;
  currency: string;
}

export class BrokerError extends Error {
  readonly code: string;
  constructor(message: string, code = 'error') {
    super(message);
    this.name = 'BrokerError';
    this.code = code;
  }
}

interface Envelope {
  msg_type?: string;
  req_id?: number;
  error?: { code?: string; message?: string };
  [key: string]: unknown;
}

type StreamHandler = (message: Envelope) => void;

function num(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Deriv's own message is always kept, because it separates a token that is
 * malformed from one that is valid for another account — and no guess made
 * here can tell those apart. Advice follows it, never replaces it.
 */
function describe(code: string, message: string): string {
  const said = message ? `Deriv said: “${message}”` : `Deriv returned ${code || 'an error'}.`;

  switch (code) {
    case 'InvalidToken':
    case 'AuthorizationRequired':
      return `${said} Check the whole token was copied, and that it was issued for this account with the Trade scope.`;
    case 'PermissionDenied':
      return `${said} The token is valid but lacks the scope for that call — Trade is the one that places contracts.`;
    case 'RateLimit':
      return `${said} Wait a moment; your own app id raises the limit.`;
    case 'MarketIsClosed':
      return `${said} That market is closed right now.`;
    case 'UnrecognisedRequest':
      return `${said} This Deriv session does not offer that call.`;
    default:
      return message ? `${said} (${code})` : `Deriv request failed (${code}).`;
  }
}

export class DerivClient {
  private socket: WebSocket | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: Envelope) => void; reject: (e: Error) => void }>();
  private readonly streams = new Map<number, StreamHandler>();
  private closedByUs = false;
  private onDrop: ((reason: string) => void) | null = null;

  constructor(private readonly credentials: DerivCredentials) {}

  /* ------------------------------------------------------------------ */
  /* Transport                                                           */
  /* ------------------------------------------------------------------ */

  private dialUrl(url: string, host: string): Promise<WebSocket> {
    return new Promise<WebSocket>((resolve, reject) => {
      let socket: WebSocket;
      try {
        socket = new WebSocket(url);
      } catch (err) {
        reject(
          new BrokerError(
            `${host} could not be dialled (${err instanceof Error ? err.message : 'error'}).`,
            'NetworkError',
          ),
        );
        return;
      }

      let settled = false;
      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        socket.onopen = null;
        socket.onerror = null;
        socket.onclose = null;
        fn();
      };

      const timer = window.setTimeout(
        () =>
          finish(() => {
            socket.close();
            reject(new BrokerError(`${host} did not answer.`, 'Timeout'));
          }),
        10_000,
      );

      socket.onopen = () => finish(() => resolve(socket));
      socket.onerror = () => finish(() => reject(new BrokerError(`${host} refused the connection.`, 'NetworkError')));
      socket.onclose = (event) =>
        finish(() =>
          reject(new BrokerError(`${host} closed the connection before it opened (${event.code}).`, 'Rejected')),
        );
    });
  }

  /**
   * Exchanges the access token for a WebSocket URL Deriv has already
   * authenticated. The OTP is valid for two minutes and single use, so the
   * socket is opened immediately after.
   */
  private async authenticatedUrl(): Promise<string> {
    const accountId = this.credentials.accountId.trim();
    const appId = this.credentials.appId.trim() || DEFAULT_APP_ID;
    const endpoint = `${DERIV_REST_BASE}/trading/v1/options/accounts/${encodeURIComponent(accountId)}/otp`;

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.credentials.token.trim()}`, 'Deriv-App-ID': appId },
      });
    } catch (err) {
      throw new BrokerError(
        `Could not reach Deriv to open a session (${err instanceof Error ? err.message : 'network error'}). ` +
          'Some mobile networks, ISPs and countries block Deriv; check whether deriv.com loads here.',
        'NetworkError',
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new BrokerError(
        `Deriv rejected the credentials (${response.status}). The token needs the Trade scope, and app id ${appId} ` +
          'must be the one it was issued under.',
        'InvalidToken',
      );
    }
    if (response.status === 404) {
      throw new BrokerError(
        `Deriv does not recognise account ${accountId}. Use the id shown against the account — a demo one begins ` +
          'DOT, a real one ROT.',
        'UnknownAccount',
      );
    }
    if (!response.ok) {
      // Deriv's REST errors carry their own reason, which beats a status code.
      const body = await response.text().catch(() => '');
      let reason = body.trim().slice(0, 200);
      try {
        const parsed = JSON.parse(body) as { errors?: { message?: string; code?: string }[] };
        const first = parsed.errors?.[0];
        if (first?.message) reason = `${first.message}${first.code ? ` (${first.code})` : ''}`;
      } catch {
        /* not JSON; the raw body already stands in */
      }
      throw new BrokerError(
        `Deriv refused to open a session (${response.status})${reason ? `: ${reason}` : '.'}`,
        'SessionRefused',
      );
    }

    const body = (await response.json().catch(() => null)) as { data?: { url?: string } } | null;
    const url = body?.data?.url;
    if (!url) throw new BrokerError('Deriv opened a session but returned no socket address for it.', 'SessionRefused');
    return url;
  }

  /** Opens an authenticated session and reads the account from its balance. */
  async open(onDrop?: (reason: string) => void): Promise<DerivAccountInfo> {
    this.onDrop = onDrop ?? null;

    const accountId = this.credentials.accountId.trim();
    if (!accountId) {
      throw new BrokerError('An Options account id is required — DOT… for demo, ROT… for real.', 'NoAccount');
    }
    if (!isValidAppId(this.credentials.appId.trim() || DEFAULT_APP_ID)) {
      throw new BrokerError(
        'That app id has a space or punctuation in it. Copy it from developers.deriv.com.',
        'InvalidAppId',
      );
    }

    const url = await this.authenticatedUrl();
    const host = (() => {
      try {
        return new URL(url).host;
      } catch {
        return 'the address Deriv returned';
      }
    })();

    const socket = await this.dialUrl(url, host);
    this.socket = socket;
    socket.onmessage = (event) => this.receive(event.data);
    socket.onclose = () => {
      this.failPending('The Deriv connection dropped.');
      if (!this.closedByUs) this.onDrop?.('The Deriv connection dropped.');
    };

    const reply = await this.send({ balance: 1 });
    const balance = (reply.balance ?? {}) as Record<string, unknown>;
    const loginId = String(balance.loginid ?? accountId);

    return {
      loginId,
      currency: String(balance.currency ?? 'USD'),
      balance: num(balance.balance),
      isVirtual: isDemoAccountId(loginId),
    };
  }

  close(): void {
    this.closedByUs = true;
    this.streams.clear();
    this.socket?.close();
    this.socket = null;
  }

  private receive(data: unknown): void {
    if (typeof data !== 'string') return;
    let message: Envelope;
    try {
      message = JSON.parse(data) as Envelope;
    } catch {
      return;
    }

    const reqId = typeof message.req_id === 'number' ? message.req_id : undefined;
    if (reqId === undefined) return;

    const waiter = this.pending.get(reqId);
    if (waiter) {
      this.pending.delete(reqId);
      if (message.error) {
        waiter.reject(
          new BrokerError(
            describe(message.error.code ?? '', message.error.message ?? ''),
            message.error.code ?? 'error',
          ),
        );
      } else {
        waiter.resolve(message);
      }
      // A subscription's first payload is also its reply; later ones fall
      // through to the handler below.
      const handler = this.streams.get(reqId);
      if (handler && !message.error) handler(message);
      return;
    }

    this.streams.get(reqId)?.(message);
  }

  private failPending(reason: string): void {
    for (const [, waiter] of this.pending) waiter.reject(new BrokerError(reason, 'Disconnected'));
    this.pending.clear();
  }

  private send(payload: Record<string, unknown>, stream?: StreamHandler): Promise<Envelope> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new BrokerError('Not connected to Deriv.', 'Disconnected'));
    }
    const reqId = this.nextId++;
    if (stream) this.streams.set(reqId, stream);

    return new Promise<Envelope>((resolve, reject) => {
      this.pending.set(reqId, { resolve, reject });
      socket.send(JSON.stringify({ ...payload, req_id: reqId }));
      window.setTimeout(() => {
        if (!this.pending.delete(reqId)) return;
        reject(new BrokerError('Deriv did not answer in time.', 'Timeout'));
      }, 20_000);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Account and market data                                             */
  /* ------------------------------------------------------------------ */

  /** Live balance, so the figure on screen is Deriv's and not a local copy. */
  async subscribeBalance(handler: (balance: number) => void): Promise<void> {
    await this.send({ balance: 1, subscribe: 1 }, (message) => {
      const balance = message.balance as { balance?: unknown } | undefined;
      if (balance && balance.balance !== undefined) handler(num(balance.balance));
    });
  }

  async activeSymbols(): Promise<DerivSymbolInfo[]> {
    const reply = await this.send({ active_symbols: 'brief', product_type: 'basic' });
    const list = reply.active_symbols;
    if (!Array.isArray(list)) return [];
    return list.map((raw) => {
      const entry = raw as Record<string, unknown>;
      return {
        symbol: String(entry.symbol ?? ''),
        displayName: String(entry.display_name ?? entry.symbol ?? ''),
        pip: num(entry.pip, 0.01),
        market: String(entry.market ?? ''),
        open: Number(entry.exchange_is_open ?? 1) === 1,
      };
    });
  }

  /**
   * The synthetic indices digit contracts trade on. Deriv generates these
   * rather than sourcing them, which is why they run around the clock.
   */
  async digitSymbols(): Promise<DerivSymbolInfo[]> {
    const symbols = await this.activeSymbols();
    return symbols.filter(
      (entry) => /synthetic|volatility/i.test(entry.market) || /^(R_|1HZ|BOOM|CRASH|JD)/i.test(entry.symbol),
    );
  }

  /**
   * Streams one symbol's ticks, and hands back the way to stop.
   *
   * The desk watches many symbols at once, so each subscription has to be
   * individually closeable — otherwise turning a market off leaves Deriv
   * pushing ticks nobody reads, against a per-connection limit.
   */
  async streamSymbol(symbol: string, handler: (quote: number, epoch: number) => void): Promise<() => void> {
    const reply = await this.send({ ticks: symbol, subscribe: 1 }, (message) => {
      const tick = message.tick as Record<string, unknown> | undefined;
      if (!tick) return;
      const quote = num(tick.quote);
      if (quote > 0) handler(quote, num(tick.epoch) * 1000 || Date.now());
    });

    const id = (reply.subscription as { id?: string } | undefined)?.id;
    return () => {
      if (id) this.send({ forget: id }).catch(() => undefined);
    };
  }

  /* ------------------------------------------------------------------ */
  /* Contracts                                                           */
  /* ------------------------------------------------------------------ */

  private parameters(order: DigitOrder): Record<string, unknown> {
    return {
      amount: order.stake,
      basis: 'stake',
      contract_type: order.contract,
      currency: order.currency,
      duration: order.ticks,
      duration_unit: 't',
      symbol: order.symbol,
      ...(NEEDS_BARRIER.has(order.contract) ? { barrier: String(order.barrier) } : {}),
    };
  }

  /**
   * Asks what a contract would pay without buying it.
   *
   * The payout is the only honest input to whether a contract is worth taking,
   * so it comes from Deriv rather than from an assumption here.
   */
  async proposal(order: DigitOrder): Promise<{ payout: number; askPrice: number; longcode: string }> {
    const reply = await this.send({ proposal: 1, ...this.parameters(order) });
    const proposal = reply.proposal as Record<string, unknown> | undefined;
    return {
      payout: num(proposal?.payout),
      askPrice: num(proposal?.ask_price, order.stake),
      longcode: String(proposal?.longcode ?? ''),
    };
  }

  /** Buys a digit contract. */
  async buy(order: DigitOrder): Promise<{ contractId: string; buyPrice: number; payout: number; longcode: string }> {
    const reply = await this.send({ buy: '1', price: order.stake, parameters: this.parameters(order) });
    const result = reply.buy as Record<string, unknown> | undefined;
    const contractId = result ? String(result.contract_id ?? '') : '';
    if (!contractId) throw new BrokerError('Deriv accepted the request but returned no contract.', 'NoContract');
    return {
      contractId,
      buyPrice: num(result?.buy_price, order.stake),
      payout: num(result?.payout),
      longcode: String(result?.longcode ?? ''),
    };
  }

  /** Streams settlement for open contracts, so results land without polling. */
  async subscribeContracts(
    handler: (update: { contractId: string; isSold: boolean; profit: number; longcode: string }) => void,
  ): Promise<void> {
    await this.send({ proposal_open_contract: 1, subscribe: 1 }, (message) => {
      const raw = message.proposal_open_contract as Record<string, unknown> | undefined;
      if (!raw || !raw.contract_id) return;
      handler({
        contractId: String(raw.contract_id),
        isSold: Number(raw.is_sold ?? 0) === 1,
        profit: num(raw.profit),
        longcode: String(raw.longcode ?? ''),
      });
    });
  }
}

/* ------------------------------------------------------------------ */
/* Credential storage                                                  */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = 'sentinal.deriv.bot.credentials';

/** Credentials are only persisted when the operator asks for it. */
export function saveCredentials(credentials: DerivCredentials): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(credentials));
  } catch {
    /* private browsing or a full quota — this session still works */
  }
}

export function loadCredentials(): DerivCredentials | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DerivCredentials>;
    if (!parsed.token) return null;
    return {
      token: parsed.token,
      appId: parsed.appId ?? DEFAULT_APP_ID,
      accountId: parsed.accountId ?? '',
    };
  } catch {
    return null;
  }
}

export function clearCredentials(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to clear */
  }
}
