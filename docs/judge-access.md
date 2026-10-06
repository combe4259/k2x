# K2X: judge access

- **Live product:** https://k2x-delta.vercel.app (Monad testnet, chain 10143)
- **Source:** https://github.com/combe4259/k2x
- **Demo video:** https://youtu.be/zRYDrUbkSqY

## No login needed

There is no account or sign-up. Press **Get test money** (top right). It creates a wallet in your browser and sends test MON for gas and 10,000 test AUSD. No extension needed; the test money has no value. The button then shows your short address marked `demo`; click it for **Get test MON + 10,000 AUSD** or **Disconnect**.

To use your own wallet instead, press **Browser wallet** (it adds Monad testnet if missing), then **Get test MON + 10,000 AUSD** from the address menu.

## The 4-step path (works at any hour)

Press **Start the 4-step demo** on the home page. A bar under the header walks you through it (**Go to step N**, **Next**, **Exit**) and keeps the site on the replay day. Or do the same by hand; the links below open the replay day (`?mode=replay`):

| # | Where | Do | What to look for |
| --- | --- | --- | --- |
| 1 | [The 7/28 print](https://k2x-delta.vercel.app/replay?mode=replay) | Press **Play** | At 08:00:01 one share prints 30% down (1,272,000 KRW). K-Mark holds it, then rejects it (the stamp has a `tx` link). The card **An oracle that takes every trade** shows what passing it through does; the **K-Mark** card shows the real −6% gap trusted six seconds later. |
| 2 | Top right | Press **Get test money** | A message such as "Sent 0.1 MON for gas and 10,000 test AUSD." |
| 3 | [Mint & redeem](https://k2x-delta.vercel.app/trade?mode=replay) | Keep HYNIX2X and 1000 AUSD, press **Request mint** | The first time, it approves AUSD. Then the replay day moves a minute and the result reads "You asked while price #N was the latest. You got price #M: … set after you asked" (#M is a later price than #N), with **view tx**. **Your requests** lists it as Settled. |
| 4 | [Pool](https://k2x-delta.vercel.app/pool?mode=replay) | Read | **Owed to holders** shows how much of it is yours; **Loss at today's limit, against the mint cap** shows what a +30% day would cost the LPs. |

Also: [Price log](https://k2x-delta.vercel.app/engine?mode=replay) (filter **Rejected**, or open **28 Jul open (recorded)**) and [What 2x does](https://k2x-delta.vercel.app/simulator?mode=replay). To run everything locally, see [Run it locally](../README.md#run-it-locally).

## Stay on the replay day

The **Showing** switch (top right, in the strip under the header) picks which copy of the contracts the pages show. This guide uses **Replay day**: the real 2 Oct 2026 KRX session, replayed minute by minute on its own copy of the same contracts, so it works at any hour.

The site always opens on the **replay day**. The **Live Korea** switch shows a separate live copy of the contracts; it is not part of this demo.

## Things you may notice

- **The replay day moves at most once every 15 s, for everyone.** It moves one minute when someone sends a request, and up to three when you press **Move the replay day 3 minutes**. If someone else just moved it, the site waits and tries once more; if your request still says "Waiting for the next trusted price", move the replay day again.
- **The demo faucet sends gas only to fresh wallets** (never sent a transaction, no MON) and keeps a reserve for moving the replay day. If it is empty it says so; then use the Monad testnet faucet. AUSD is 10,000 per wallet per day.
- **Explorer:** every `tx` / **view tx** and address link opens [MonadVision](https://testnet.monadvision.com).
- **Testnet only.** AUSD is a mock token with no value. The demo wallet's key lives only in this browser.
- **Colours follow the Korean convention:** red rises, blue falls.

## What the contracts refuse, on Monad testnet

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

Reproduce with `cd relayer && npx tsx src/cli/proof.ts testnet run` (results in [`data/proof/10143.json`](../data/proof/10143.json)).

## Contract addresses (Monad testnet, chain 10143)

| Contract | Replay day (sandbox, used by the demo) | Live (not part of the demo) |
| --- | --- | --- |
| KMarkEngine | [`0xe3580d4c450408a0640fA6983092CF0F13E4a040`](https://testnet.monadvision.com/address/0xe3580d4c450408a0640fA6983092CF0F13E4a040) | [`0xF71f77f6F266ac946d18cc86fb495C2df2607718`](https://testnet.monadvision.com/address/0xF71f77f6F266ac946d18cc86fb495C2df2607718) |
| HYNIX2X pool | [`0x2a0fC515ec0550E349a82f33a3C80ac461cEC828`](https://testnet.monadvision.com/address/0x2a0fC515ec0550E349a82f33a3C80ac461cEC828) | [`0x564C6e2B8Fc23fca351E7201BD4eC992a07dD003`](https://testnet.monadvision.com/address/0x564C6e2B8Fc23fca351E7201BD4eC992a07dD003) |
| HYNIX2X token | [`0x3eC85e2345ac6fd3DC2abaB84252E52147d14bD9`](https://testnet.monadvision.com/address/0x3eC85e2345ac6fd3DC2abaB84252E52147d14bD9) | [`0x10779BB8B38fB5D7C6a59A14Bb50f654d7AF0F08`](https://testnet.monadvision.com/address/0x10779BB8B38fB5D7C6a59A14Bb50f654d7AF0F08) |
| SMSN2X pool | [`0xa3060982B681A92E664db9897C99A69b4BA13c95`](https://testnet.monadvision.com/address/0xa3060982B681A92E664db9897C99A69b4BA13c95) | [`0x9cA5b76744A8f3D1D415868C9FC20B6CdC9f2493`](https://testnet.monadvision.com/address/0x9cA5b76744A8f3D1D415868C9FC20B6CdC9f2493) |
| SMSN2X token | [`0x450426e2a945be242371c487D5856e3C3c7Bc33d`](https://testnet.monadvision.com/address/0x450426e2a945be242371c487D5856e3C3c7Bc33d) | [`0xA0B5e90b8c3eb6120D3482a2AC4e2de7a4AE9533`](https://testnet.monadvision.com/address/0xA0B5e90b8c3eb6120D3482a2AC4e2de7a4AE9533) |

Shared by both: Mock AUSD [`0x32ed9B1Df89bE3eaaDcEEF617217bc2d9Ad04C77`](https://testnet.monadvision.com/address/0x32ed9B1Df89bE3eaaDcEEF617217bc2d9Ad04C77). Incident replays (7/28, 8/6): KMarkEngine [`0x4B847a58ACfe0256505E9b1592dD7bb3F250221E`](https://testnet.monadvision.com/address/0x4B847a58ACfe0256505E9b1592dD7bb3F250221E).

Keys: operator (owner of every contract) [`0xc3880052864B6d9CCE2A39303772A0a7Fa5Ec752`](https://testnet.monadvision.com/address/0xc3880052864B6d9CCE2A39303772A0a7Fa5Ec752); live relayer (the only key that may post to the live engine) [`0x1bA5f3D09ddF1d06ca2713742E34f77d904855b5`](https://testnet.monadvision.com/address/0x1bA5f3D09ddF1d06ca2713742E34f77d904855b5); web signer (moves the replay day, runs the demo faucet) [`0x80E8C3a9bfa3101CF7406a40E2E15260860391C8`](https://testnet.monadvision.com/address/0x80E8C3a9bfa3101CF7406a40E2E15260860391C8). Machine-readable: [`deployments/10143.json`](../deployments/10143.json), [`deployments/10143.live.json`](../deployments/10143.live.json). Every contract's source is verified on Sourcify (shown by MonadVision), so the explorer decodes calls and events such as `PriceRejected`.

## Where the code lives

| Part | Code |
| --- | --- |
| Korean market rules, trusted price history, official close | [`contracts/src/KMarkEngine.sol`](../contracts/src/KMarkEngine.sol) |
| 2x token (daily reset) | [`contracts/src/K2XToken.sol`](../contracts/src/K2XToken.sol) |
| LP pool, forward-priced requests, exposure cap, funding | [`contracts/src/K2XPool.sol`](../contracts/src/K2XPool.sol) |
| Mock AUSD with faucet | [`contracts/src/MockAUSD.sol`](../contracts/src/MockAUSD.sol) |
| Foundry tests and deploy scripts | [`contracts/test/`](../contracts/test/), [`contracts/script/`](../contracts/script/) |
| Live relayer (Naver Finance quotes) and its schedule | [`relayer/src/live/`](../relayer/src/live/), [`.github/workflows/live-relayer.yml`](../.github/workflows/live-relayer.yml) |
| Incident replays, replay day, settlement keeper, proof script | [`relayer/src/cli/`](../relayer/src/cli/), [`relayer/src/sandbox.ts`](../relayer/src/sandbox.ts), [`relayer/src/keeper.ts`](../relayer/src/keeper.ts) |
| Web pages | [`web/src/app/`](../web/src/app/) |
| Demo faucet and replay-day pacing | [`web/src/app/api/faucet/route.ts`](../web/src/app/api/faucet/route.ts), [`web/src/app/api/sandbox/step/route.ts`](../web/src/app/api/sandbox/step/route.ts) |
| Browser demo wallet, Replay/Live switch, guided demo | [`web/src/lib/wallet.tsx`](../web/src/lib/wallet.tsx), [`web/src/lib/mode.tsx`](../web/src/lib/mode.tsx), [`web/src/components/DemoGuide.tsx`](../web/src/components/DemoGuide.tsx) |
| Datasets and provenance (reconstructed parts labelled) | [`data/README.md`](../data/README.md), recorded events in [`data/onchain/10143/`](../data/onchain/10143/) |
