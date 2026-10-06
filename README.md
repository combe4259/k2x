# K2X

**No-liquidation 2x tokens on SK hynix and Samsung Electronics, priced by an on-chain engine that understands Korean market structure.**

Built for Monad Metropolis, Track 1 (Onchain Finance & Trading).

> 한국 장 구조를 아는 온체인 가격 엔진(K-Mark) 위에서, SK하이닉스·삼성전자 2배 토큰을 청산 없이 발행·환매합니다.

## Why

Korean equities are already a large on-chain market (13% of Hyperliquid HIP-3 volume on 2026-10-06), but the price layer underneath failed twice in July 2026:

- **2026-07-15 — Ostium.** A compromised oracle signer posted future-dated prices and opened/closed positions in one transaction; $18–22M left the LP vault.
- **2026-07-28 — trade.xyz.** At 08:00 KST a single SK hynix share printed at the lower limit on the NXT pre-market (−29.99%). The oracle passed it through, the mark fell 18.7%, and about $57M of longs were liquidated.

K2X answers both with structure, not patches:

| Problem | K2X |
| --- | --- |
| A thin print becomes the oracle price | **K-Mark** judges every price on-chain by Korean market state: session, ±30% limit band, warm-up after each open or VI, volume-confirmed jumps. Every decision emits a reason code. |
| Oracle compromise / same-transaction games | Mint and redeem settle at the **first trusted price after the request** (forward pricing). Future-dated reports are rejected; prices outside the daily ±30% band can never be accepted. |
| Stale prices outside market hours | Requests made while Korea is closed **queue** and settle at the next session's first trusted price. |
| Liquidations | Holders are never liquidated. Leverage resets once a day at the KRX official close, and the ±30% limit means a 2x token cannot go below zero in a day. |
| Counterparty risk | An AUSD LP pool takes the other side with an exposure cap (≤ 50% of LP equity) and a funding rate re-priced from utilisation on every interaction. |

## Repository

```
contracts/   Foundry — KMarkEngine, K2XToken, K2XPool, MockAUSD + tests
relayer/     TypeScript — replays exchange data into the engine, keeper for settlement
web/         Next.js app — incident replay, engine log, mint/redeem, LP, simulator
data/        Replay datasets (reconstructed segments are labelled)
docs/        Design notes
```

## Contracts

| Contract | Role |
| --- | --- |
| `KMarkEngine` | Session state machine (KST), rules R0–R8, trusted price history, official closes |
| `K2XToken` | ERC-20 constant-leverage token; NAV = navBase × (1 + L × (P/P0 − 1)) × funding |
| `K2XPool` | AUSD pool, LP shares, forward-priced mint/redeem/deposit/withdraw, caps, funding |
| `MockAUSD` | Testnet stand-in for Agora AUSD (6 decimals) with a faucet |

```bash
cd contracts
forge test
```

## Status

Work in progress during the Metropolis build window (2026-09-01 → 2026-10-13). See `docs/` for the design.

## License

MIT. Uses [OpenZeppelin Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts) v5.4.0 and [forge-std](https://github.com/foundry-rs/forge-std).
