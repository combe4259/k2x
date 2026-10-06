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
| [Replay 7/28](https://k2x-delta.vercel.app/replay) | The 7/28 pre-market replayed through K-Mark **on Monad testnet**. The 1-share print at 1,272,000 is held, then rejected (`JUMP_UNCONFIRMED`), while the real −6% gap is accepted four seconds later. Every verdict links to its transaction. |
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
| Mock AUSD | [`0x416aeEC7F19fb613cECE986c3FB046D84BFa6451`](https://testnet.monadvision.com/address/0x416aeEC7F19fb613cECE986c3FB046D84BFa6451) |
| KMarkEngine (live) | [`0x9dB5972e01ca8F2170F7d0B2875F45C7e4f805D4`](https://testnet.monadvision.com/address/0x9dB5972e01ca8F2170F7d0B2875F45C7e4f805D4) |
| HYNIX2X pool / token (live) | [`0x061B562B7BFD0C070D33b7e7C6c7DDE2A3A8be00`](https://testnet.monadvision.com/address/0x061B562B7BFD0C070D33b7e7C6c7DDE2A3A8be00) / [`0xB37d02822534a44Ae0a59D0e2C769fb06e9Ba80C`](https://testnet.monadvision.com/address/0xB37d02822534a44Ae0a59D0e2C769fb06e9Ba80C) |
| SMSN2X pool / token (live) | [`0x39975d306Dd815C8153eA846862AFA6f544Fbfa9`](https://testnet.monadvision.com/address/0x39975d306Dd815C8153eA846862AFA6f544Fbfa9) / [`0x92d20eb4a76DCab66E687f8046a3b7F5daCDf08A`](https://testnet.monadvision.com/address/0x92d20eb4a76DCab66E687f8046a3b7F5daCDf08A) |
| KMarkEngine (sandbox) | [`0x31192F3dB6D0aFA2EFad7983123DC971dD94c982`](https://testnet.monadvision.com/address/0x31192F3dB6D0aFA2EFad7983123DC971dD94c982) |
| HYNIX2X pool / token (sandbox) | [`0x8Bbe486029E2303401C90D1C14bf6A904437ED02`](https://testnet.monadvision.com/address/0x8Bbe486029E2303401C90D1C14bf6A904437ED02) / [`0xa455d2DAbeA1cDDc44C0AE7536b6831f03510A12`](https://testnet.monadvision.com/address/0xa455d2DAbeA1cDDc44C0AE7536b6831f03510A12) |
| SMSN2X pool / token (sandbox) | [`0x9630b9c640AFF6B6D4845BbF974201ebB2EC1999`](https://testnet.monadvision.com/address/0x9630b9c640AFF6B6D4845BbF974201ebB2EC1999) / [`0x068B0579Ac434D8dBea3c9fd6774e853721fe2cd`](https://testnet.monadvision.com/address/0x068B0579Ac434D8dBea3c9fd6774e853721fe2cd) |
| KMarkEngine (incident replays) | [`0x34d3CeeA70b6B1e9B93a342A27a1C5c639454B93`](https://testnet.monadvision.com/address/0x34d3CeeA70b6B1e9B93a342A27a1C5c639454B93) |

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

Against testnet, set `OPERATOR_PRIVATE_KEY` (a funded testnet key) in `.env` and use the `testnet` network in the relayer CLIs, for example `npm run live -w @k2x/relayer -- testnet --minutes 30`.

## Limitations

- **One relayer.** Reports come from a single operator key. K-Mark limits what a bad or compromised relayer can do (no future-dated, out-of-band or unconfirmed prices; forward pricing removes same-transaction games), but it does not yet verify the source data cryptographically.
- **Public quote feed.** Live data comes from Naver Finance's public polling endpoint, aggregated into windows. A production version needs licensed KRX/NXT data.
- **Testnet only.** AUSD is a mock with a faucet. Nothing here is an offer to residents of Korea or the United States.

## Data

See [`data/README.md`](data/README.md). The 7/28 and 8/6 prints, previous closes and KRX opens are observed values; the pre-market path between them is reconstructed and labelled in the tick CSVs. The sandbox uses Yahoo Finance 1-minute bars.

## License

MIT, see [LICENSE](LICENSE). Uses [OpenZeppelin Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts) v5.4.0, [forge-std](https://github.com/foundry-rs/forge-std), [viem](https://viem.sh), [Next.js](https://nextjs.org) and [Tailwind CSS](https://tailwindcss.com). Market data from Naver Finance (live) and Yahoo Finance (sandbox) is used for demonstration only.
