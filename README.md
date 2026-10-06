# K2X

**No-liquidation 2x tokens on SK hynix and Samsung Electronics, priced by an on-chain engine that understands Korean market structure.**

Built for Monad Metropolis, Track 1 (Onchain Finance & Trading).

> 한국 장 구조를 아는 온체인 가격 엔진(K-Mark) 위에서, SK하이닉스·삼성전자 2배 토큰을 청산 없이 발행·환매합니다.

- **Live app:** https://k2x-delta.vercel.app (Monad testnet, chain 10143)
- **Try it in one minute:** press **Use demo wallet**, then **Get test MON + 10,000 AUSD** in the wallet menu, then go to **Mint & redeem**. No extension or sign-up needed. The demo wallet's key is generated in your browser and never leaves it.

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

## What to look at

| Page | What it shows |
| --- | --- |
| [Replay 7/28](https://k2x-delta.vercel.app/replay) | The 7/28 pre-market replayed through K-Mark **on Monad testnet**. The 1-share print at 1,272,000 is held, then rejected (`JUMP_UNCONFIRMED`), while the real −6% gap is accepted six seconds later, once ₩300M and 20 trades confirm it. Every verdict links to its transaction. |
| [Live](https://k2x-delta.vercel.app) | Real SK hynix and Samsung trades from KRX and NXT, judged on-chain during Korean hours (08:00–20:00 KST, weekdays). Outside those hours the home page shows the sandbox. |
| [Mint & redeem](https://k2x-delta.vercel.app/trade) | Request, wait for the next trusted price, settle. The sandbox instance replays the real KRX session of 2026-10-02 minute by minute so this works at any hour. |
| [LP pool](https://k2x-delta.vercel.app/pool) | Pool equity, holder liabilities, exposure cap, utilisation and funding. |
| [Engine](https://k2x-delta.vercel.app/engine) | Every engine decision with its reason code. |
| [Risk simulator](https://k2x-delta.vercel.app/simulator) | The 2x token against the stock across price paths, why it resets daily instead of on every print, and why requests wait overnight. |

## How K-Mark judges a print

The relayer posts trade windows (trades, volume, notional, first/last/high/low/VWAP) per market and venue. The engine decides on-chain:

| Rule | Check |
| --- | --- |
| R0 | Sequence, future timestamp (> 2 s ahead) and report age (> 60 s) |
| R1 | Session from the KST clock: NXT pre 08:00–08:50, KRX continuous 09:00–15:20, closing auction 15:20–15:30, NXT after 15:30–20:00; holidays and shifted days are configurable |
| R2 | Trading halt and VI (volatility interruption) flags |
| R3 | ±30% band around the day's base (the previous official close) |
| R4 | Warm-up after each open: at least ₩100M and 20 trades before a price is trusted |
| R5 | Jumps over 3% become candidates; confirmed only by ₩300M traded within 2% of the candidate, on the same side, across at least two windows within 60 s |
| R7 | Staleness (view): no trusted price for longer than `staleAfter` |
| R8 | Official close from the KRX closing auction (≥ ₩500M), which rebases the 2x tokens |

Each report emits `RawPrint` and one of `PriceAccepted`, `PriceHeld` or `PriceRejected` with a reason.

## Architecture

```
 KRX / NXT trades ──► relayer ──► KMarkEngine ──► trusted price history, official closes
 (Naver Finance       (GitHub      (rules R0–R8)            │
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
| `KMarkEngine` | KST session state machine, rules R0–R8, trusted price history, official closes |
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

## Limitations

- **One relayer.** Live reports come from a single relayer key. K-Mark limits what a bad or compromised relayer can do (no future-dated, out-of-band, malformed or unconfirmed prices, one official close a day; requests settle only at prices formed after them), but it does not yet verify the source data cryptographically. The owner key can record a missed official close, bounded by the ±30% band.
- **Public quote feed.** Live data comes from Naver Finance's public polling endpoint, aggregated into windows. A production version needs licensed KRX/NXT data.
- **Testnet only.** AUSD is a mock with a faucet. Nothing here is an offer to residents of Korea or the United States.

## Data

See [`data/README.md`](data/README.md). The 7/28 and 8/6 prints, previous closes and KRX opens are observed values; the pre-market path between them is reconstructed and labelled in the tick CSVs. The sandbox uses Yahoo Finance 1-minute bars.

## License

MIT, see [LICENSE](LICENSE). Uses [OpenZeppelin Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts) v5.4.0, [forge-std](https://github.com/foundry-rs/forge-std), [viem](https://viem.sh), [Next.js](https://nextjs.org) and [Tailwind CSS](https://tailwindcss.com). Market data from Naver Finance (live) and Yahoo Finance (sandbox) is used for demonstration only.
