# K2X

**2x SK hynix and Samsung Electronics, with no liquidations. Mint and redeem settle at the next price a contract on Monad accepts under Korean market rules.**

> SK하이닉스·삼성전자 2배 토큰. 청산이 없고, 발행·환매는 한국 장 규칙으로 걸러낸 다음 가격에 체결됩니다.

Built for Monad Metropolis, Track 1 (Onchain Finance & Trading). Live on Monad testnet: **https://k2x-delta.vercel.app**

## Try it in four steps (works at any hour)

Korea trades 08:00–20:00 KST on weekdays, which is 19:00–07:00 ET. Outside those hours the site shows the **replay day**: the real 2 Oct 2026 KRX session, replayed minute by minute on its own copy of the same contracts. Press **Start the 4-step demo** on the home page, or:

1. **Watch the bad print get rejected** — [The 7/28 print](https://k2x-delta.vercel.app/replay). Press Play. At 08:00:01 one share prints 30% down; K-Mark holds it, then rejects it, and trusts the real −6% gap six seconds later.
2. **Get test money** — press **Get test money** (top right). It creates a wallet in your browser and sends test MON and 10,000 test AUSD. No extension, no sign-up; the test money has no value.
3. **Mint HYNIX2X** — [Mint & redeem](https://k2x-delta.vercel.app/trade). Request a mint; the replay day moves a minute and the result reads *"You asked while price #N was the latest. You got price #N+1, set after you asked."*
4. **See who is on the other side** — [Pool](https://k2x-delta.vercel.app/pool): your share of what the pool owes holders, and what a limit-up day would cost the LPs.

During Korean hours, switch **Showing** (top right) to **Live Korea** to see real KRX and NXT trades judged as they happen.

## Status

| Part | State |
| --- | --- |
| K-Mark engine, K2X token and pool | Deployed on Monad testnet (three copies: live, replay day, incident replays) |
| Live prices | Real SK hynix and Samsung quotes from a public feed, posted by one relayer (GitHub Actions, weekdays 07:30–20:10 KST) |
| 7/28 and 8/6 incidents | Replayed on testnet; the prints, previous closes and KRX opens are observed, the trades between them reconstructed |
| AUSD | Mock token with a faucet |
| Pool hedging | Not built; the pool is unhedged |
| Review | Internal: a five-angle adversarial review (34 confirmed findings, all fixed before this deployment). No external audit |
| Tests | 50 Foundry tests, including the 7/28 and 8/6 datasets and a full replay day |

## Why

Korean equities are already traded on-chain at scale (the two SK hynix perps alone were about 10% of Hyperliquid HIP-3 volume on 2026-10-06), but the price layer underneath failed twice in July 2026:

- **2026-07-15, Ostium.** A compromised oracle signer posted future-dated prices and opened and closed positions in one transaction; $18–22M left the LP vault.
- **2026-07-28, trade.xyz.** At 08:00 KST a single SK hynix share printed at the lower limit on the NXT pre-market (−29.99%). The oracle passed it through, the mark fell 18.7%, and about $57M of longs were liquidated. The same-day fix ignored the first minutes after each open, which would also have ignored the real −6% gap that followed.

K2X answers both with market structure, not time windows:

| Problem | K2X |
| --- | --- |
| A thin print becomes the oracle price | **K-Mark** judges every report on-chain by Korean market state: session, ±30% daily limit, warm-up after each open, volume-confirmed jumps. Every decision emits a reason code. |
| Oracle compromise, same-transaction games | Mint and redeem settle at the **first trusted price after the request** (forward pricing). Future-dated and old reports are rejected; a price outside the ±30% band can never be accepted. |
| Stale prices outside market hours | Requests made while Korea is closed **queue** and settle at the next session's first trusted price. |
| Liquidations | Holders are never liquidated. Leverage resets once a day at the KRX official close, and the ±30% limit means a 2x token cannot go below zero in a day. |
| Counterparty risk | An AUSD LP pool takes the other side with an exposure cap (≤ 50% of LP equity) and a funding rate re-priced from utilisation on every interaction. Holder claims are senior to LP equity. |

## What the contracts refuse, on Monad testnet

Each row is a transaction. The refusals were sent on purpose, one of them by the live relayer key itself, to show what even a compromised relayer cannot do.

| What happened | What the chain did | Transaction |
| --- | --- | --- |
| 7/28 08:00:01, one share at 1,272,000 (−29.96%) | REJECTED · `JUMP_UNCONFIRMED` | [`0xf948016b…`](https://testnet.monadvision.com/tx/0xf948016baebe9a8e862783de87f906f7b651d6407e134f679159435686fcc74c) |
| 7/28 08:00:06, the real gap after ₩300M and 20 trades | TRUSTED · 1,701,943 (−6.3%) | [`0x87e44741…`](https://testnet.monadvision.com/tx/0x87e447418017d8be2f6dc64c8400648882d63abf769d7de6982b0a70bd6214bd) |
| A price outside the ±30% daily limit (2,400,000 vs 2,360,800) | REJECTED · `BAND` | [`0x795ed1ea…`](https://testnet.monadvision.com/tx/0x795ed1ea68b9af1fc8bbfcec4a65130c3fd89cf0a7533a2b15f754025d48cab3) |
| A closing auction whose official close (18,500,000) differs from its band-checked price | REJECTED · `MALFORMED` | [`0x3011b315…`](https://testnet.monadvision.com/tx/0x3011b31587ceb761802b68a6078dec1ddb7f34be3009c90dda1a781e3b78e170) |
| A report dated an hour in the future, signed by the live relayer key | REJECTED · `FUTURE_TIMESTAMP` | [`0x762a6760…`](https://testnet.monadvision.com/tx/0x762a67607b18747ce537abb7ae38b2d907cf16e0d9a21cf8bb45b3b64d437d3e) |
| A mint requested on the replay day while price #3 was the latest | REQUESTED · 1,000 AUSD | [`0xb9663c3c…`](https://testnet.monadvision.com/tx/0xb9663c3c8249c5d080a45f20928cf77a62c9ad7f0aa4fc0a9a2e8799e9ca0fbb) |
| …settled at the first price formed after the request | SETTLED · price #4 = 1,825,139 KRW | [`0x48454af4…`](https://testnet.monadvision.com/tx/0x48454af426e2cdd906c245fe480eed44bd6b748c02b57d343e1439d171981f76) |
| A mint asking for more tokens than the price allows | REFUNDED · `SLIPPAGE` | [`0x48454af4…`](https://testnet.monadvision.com/tx/0x48454af426e2cdd906c245fe480eed44bd6b748c02b57d343e1439d171981f76) |
| A mint requested while Korea is closed (live pool) | QUEUED until the next session | [`0xed7f5bb3…`](https://testnet.monadvision.com/tx/0xed7f5bb3d83059d3bae120dbd34ec26ce8fc5570735baf7e432a680bedf3a560) |

Reproduce with `cd relayer && npx tsx src/cli/proof.ts testnet run` (results in [`data/proof/10143.json`](data/proof/10143.json)).

## Why Monad

K-Mark judges every trade window in its own transaction and writes the reason on chain, so the price a request settles at can be checked by anyone. That only works as a live price if judging keeps pace with the market. On Monad testnet one judgement costs about 150k gas and blocks arrive every 0.31 s on average (measured over 2,000 blocks); the 7/28 pre-market took 42 transactions, one per second around the open. We don't claim this is impossible elsewhere, only that it is practical here.

## What we don't claim

- No users, LPs or partners. The pools are seeded by the team with mock AUSD, which has no value.
- No audit. Tests and internal review only.
- No claim that holders can't lose. A 2x token can lose about 60% in a day and more over several days. No liquidation means no forced close, not no loss.
- The 7/28 replay is not trade.xyz's feed: the 1-share print, previous close and KRX open are observed; the trades between them are reconstructed and labelled.
- The replay day uses Yahoo Finance 1-minute bars; volumes and trade counts are estimates.
- One relayer key reports trades from a public quote feed (Naver Finance). K-Mark limits what a bad report can do — no future-dated, out-of-band, malformed or unconfirmed prices, one official close a day, requests settle only at prices formed after them — but it does not verify the source. Production needs licensed KRX/NXT data.
- The pool is not hedged, so it is only safe at small size (SK hynix rose 408% in a year).
- Testnet only. Not an offer to residents of Korea or the United States.

## The rules

The relayer posts trade windows (trades, volume, notional, first/last/high/low/VWAP) per market and venue. The engine decides on-chain:

| Rule | What it checks |
| --- | --- |
| Sequence and clock | Sequence, future timestamp (> 2 s ahead), report age (> 60 s), and a well-formed report (prices inside their own low–high; an auction has one price) |
| Session | Session from the KST clock: NXT pre 08:00–08:50, KRX continuous 09:00–15:20, closing auction 15:20–15:30, NXT after 15:30–20:00; holidays and shifted days are configurable |
| Halts and VI | Trading halt and VI (volatility interruption) flags; trading that resumes after either starts a new warm-up |
| ±30% band | ±30% band around the day's base (the previous official close) |
| Warm-up | Warm-up after each open: at least ₩100M and 20 trades before a price is trusted |
| Confirmed jumps | Jumps over 3% become candidates; confirmed only by ₩300M traded within 2% of the candidate, on the same side, across at least two windows within 60 s (and 20 trades when the session has no trusted price yet). A thinner print elsewhere cannot overrule a pending candidate |
| Staleness | Staleness (view): no trusted price for longer than `staleAfter` |
| Official close | Official close from the KRX closing auction (≥ ₩500M), once a day, which rebases the 2x tokens; the owner can record a missed close inside the band |

Each report emits `RawPrint` and one of `PriceAccepted`, `PriceHeld` or `PriceRejected` with a reason.

## Architecture

```
 KRX / NXT trades ──► relayer ──► KMarkEngine ──► trusted price history, official closes
 (Naver Finance       (GitHub      (Korean rules)            │
  public feed)         Actions)                             ▼
                                   user ──request──► K2XPool ──settle at price seq+1──► K2XToken
                                                    (AUSD LP, cap, funding)          (2x, daily reset)
```

Three engine instances run on testnet:

- **Live:** `block.timestamp` clock, real quotes polled from Naver Finance (KRX and NXT) by a scheduled GitHub Actions job ([workflow](.github/workflows/live-relayer.yml)) on weekdays from 07:30 KST. It posts on every ≥ 1% move, every 10 s while a jump or warm-up is pending, immediately when requests are waiting, at the 09:00 open and 15:30 close auctions, and otherwise every 9 minutes.
- **Sandbox:** replay clock, the real 2026-10-02 KRX session looping with a 7-day shift, so mint and redeem can be tried at any hour.
- **Incident:** replay clock, holding the recorded 7/28 replay.

## Deployed contracts (Monad testnet, chain 10143)

| Contract | Address |
| --- | --- |
| Mock AUSD | [`0x32ed9B1Df89bE3eaaDcEEF617217bc2d9Ad04C77`](https://testnet.monadvision.com/address/0x32ed9B1Df89bE3eaaDcEEF617217bc2d9Ad04C77) |
| KMarkEngine (live) | [`0xF71f77f6F266ac946d18cc86fb495C2df2607718`](https://testnet.monadvision.com/address/0xF71f77f6F266ac946d18cc86fb495C2df2607718) |
| HYNIX2X pool / token (live) | [`0x564C6e2B8Fc23fca351E7201BD4eC992a07dD003`](https://testnet.monadvision.com/address/0x564C6e2B8Fc23fca351E7201BD4eC992a07dD003) / [`0x10779BB8B38fB5D7C6a59A14Bb50f654d7AF0F08`](https://testnet.monadvision.com/address/0x10779BB8B38fB5D7C6a59A14Bb50f654d7AF0F08) |
| SMSN2X pool / token (live) | [`0x9cA5b76744A8f3D1D415868C9FC20B6CdC9f2493`](https://testnet.monadvision.com/address/0x9cA5b76744A8f3D1D415868C9FC20B6CdC9f2493) / [`0xA0B5e90b8c3eb6120D3482a2AC4e2de7a4AE9533`](https://testnet.monadvision.com/address/0xA0B5e90b8c3eb6120D3482a2AC4e2de7a4AE9533) |
| KMarkEngine (sandbox) | [`0xe3580d4c450408a0640fA6983092CF0F13E4a040`](https://testnet.monadvision.com/address/0xe3580d4c450408a0640fA6983092CF0F13E4a040) |
| HYNIX2X pool / token (sandbox) | [`0x2a0fC515ec0550E349a82f33a3C80ac461cEC828`](https://testnet.monadvision.com/address/0x2a0fC515ec0550E349a82f33a3C80ac461cEC828) / [`0x3eC85e2345ac6fd3DC2abaB84252E52147d14bD9`](https://testnet.monadvision.com/address/0x3eC85e2345ac6fd3DC2abaB84252E52147d14bD9) |
| SMSN2X pool / token (sandbox) | [`0xa3060982B681A92E664db9897C99A69b4BA13c95`](https://testnet.monadvision.com/address/0xa3060982B681A92E664db9897C99A69b4BA13c95) / [`0x450426e2a945be242371c487D5856e3C3c7Bc33d`](https://testnet.monadvision.com/address/0x450426e2a945be242371c487D5856e3C3c7Bc33d) |
| KMarkEngine (incident replays) | [`0x4B847a58ACfe0256505E9b1592dD7bb3F250221E`](https://testnet.monadvision.com/address/0x4B847a58ACfe0256505E9b1592dD7bb3F250221E) |

| Key | Role | Address |
| --- | --- | --- |
| Operator | Owner of every contract; records the incident replays | [`0xc3880052864B6d9CCE2A39303772A0a7Fa5Ec752`](https://testnet.monadvision.com/address/0xc3880052864B6d9CCE2A39303772A0a7Fa5Ec752) |
| Live relayer | The only key that may post prices to the live engine (GitHub Actions) | [`0x1bA5f3D09ddF1d06ca2713742E34f77d904855b5`](https://testnet.monadvision.com/address/0x1bA5f3D09ddF1d06ca2713742E34f77d904855b5) |
| Web signer | Steps the sandbox and runs the demo faucet (Vercel) | [`0x80E8C3a9bfa3101CF7406a40E2E15260860391C8`](https://testnet.monadvision.com/address/0x80E8C3a9bfa3101CF7406a40E2E15260860391C8) |

Machine-readable copies: [`deployments/10143.json`](deployments/10143.json) and [`deployments/10143.live.json`](deployments/10143.live.json). Recorded replay events: [`data/onchain/10143/`](data/onchain/10143/).

## Repository

```
contracts/   Foundry: KMarkEngine, K2XToken, K2XPool, MockAUSD, tests, deploy scripts
relayer/     TypeScript (viem): live relayer, incident and sandbox replays, settlement keeper
web/         Next.js app: live tape, incident replay, mint/redeem, LP pool, engine log, simulator
data/        Replay and sandbox datasets with provenance (reconstructed segments are labelled)
scripts/     Local end-to-end and dev setup on anvil
```

| Contract | Role |
| --- | --- |
| `KMarkEngine` | KST session state machine, Korean market rules, trusted price history, official closes |
| `K2XToken` | ERC-20 constant-leverage token; NAV = navBase × (1 + L × (P/P0 − 1)) × funding |
| `K2XPool` | AUSD pool, LP shares, forward-priced mint/redeem/deposit/withdraw requests, exposure cap, funding |
| `MockAUSD` | Testnet stand-in for AUSD (6 decimals) with a faucet |

## Run it locally

Requirements: Node 24, [Foundry](https://getfoundry.sh), Python 3 (only to rebuild datasets).

```bash
npm install
cd contracts && forge test && cd ..
```

Full local run on anvil (deploy all instances, replay both incidents, sandbox steps, a simulated live day):

```bash
./scripts/local-e2e.sh
```

Web app against a local chain:

```bash
anvil --port 8545 --chain-id 31337 --gas-limit 150000000
./scripts/local-dev-setup.sh
NEXT_PUBLIC_CHAIN_ID=31337 npm run dev -w @k2x/web
```

Against testnet, copy `.env.example` to `.env` and fill in funded testnet keys. Each role has its own key, so the live relayer, the web server and the owner never share a nonce: `npm run live -w @k2x/relayer -- testnet --minutes 30` uses `LIVE_RELAYER_PRIVATE_KEY`.

## Data

See [`data/README.md`](data/README.md). The 7/28 and 8/6 prints, previous closes and KRX opens are observed values; the pre-market path between them is reconstructed and labelled in the tick CSVs. The sandbox uses Yahoo Finance 1-minute bars.

## License

MIT, see [LICENSE](LICENSE). Uses [OpenZeppelin Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts) v5.4.0, [forge-std](https://github.com/foundry-rs/forge-std), [viem](https://viem.sh), [Next.js](https://nextjs.org) and [Tailwind CSS](https://tailwindcss.com). Market data from Naver Finance (live) and Yahoo Finance (sandbox) is used for demonstration only.
