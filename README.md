# Sentinal Deriv Bot

A digit-contract desk for Deriv's synthetic indices. It streams the volatility
indices, measures what the tape actually did, and prices each contract against
what Deriv pays — matches, differs, even, odd, over, under.

It runs entirely in the browser. There is no server, and the access token never
leaves the tab it is typed into.

```
src/deriv/     Deriv Options API client — REST session exchange, WebSocket, contracts
src/digits.ts  The digit maths: distribution, parity, chi-squared, payout arithmetic
src/screens/   The gate and the desk
src/components/ Design system and the app shell
```

## What it does not do

Deriv's volatility indices are produced by a random number generator, audited
and published as such. Every tick's last digit is an independent draw from 0–9.

Nothing in a past sequence carries information about the next one. A digit that
has come up nine times in a hundred, or an eight-long run of evens, is a fact
about the window you are looking at and no more. So this desk **measures and
never forecasts**, and there is no signal, alert or entry recommendation
anywhere in it — building one would mean inventing information the series
cannot contain.

What can be told honestly is the price, and that is what the ticket shows:

| | Chance | Deriv pays | Break-even | Expected return |
| --- | --- | --- | --- | --- |
| Even / Odd | 50% | 1.95× | 2.00× | **−2.5%** |
| Matches | 10% | 9.00× | 10.00× | **−10.0%** |
| Over 5 | 40% | — | 2.50× | asked per ticket |

Every contract carries a negative expected return. That is the house margin,
it is not moved by entry timing, and the desk states it beside the buy button
rather than in a footnote.

## Signing in

Deriv's current scheme exchanges an access token for an authenticated socket:

1. `POST /trading/v1/options/accounts/{accountId}/otp` with
   `Authorization: Bearer <token>` and a `Deriv-App-ID` header.
2. Deriv replies with a WebSocket URL that is already authenticated — the OTP
   is valid for two minutes and single use.
3. The socket carries market data and contracts; nothing is authorised over it.

You need an access token with the **Trade** scope, the app id it was issued
under, and the Options account id. Account ids name their own kind: `DOT…` is
demo, `ROT…` is real, and the desk says which it is reading before you connect.

## Development

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # the digit maths
npm run typecheck
```

## Publishing

```bash
npm run build:standalone   # one self-contained page in dist-standalone/
npm run publish:local      # the same page, into the repository root for Pages
```

The standalone build inlines every asset, so the result is a single HTML file
that runs from a file:// path, a static host or a phone home screen.
