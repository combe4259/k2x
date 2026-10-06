import { defineChain, keccak256, toBytes, type Hex } from "viem";

export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } },
  blockExplorers: { default: { name: "MonadVision", url: "https://testnet.monadvision.com" } },
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
  testnet: true,
});

export const localAnvil = defineChain({
  id: 31337,
  name: "Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
  testnet: true,
});

export function chainFor(chainId: number) {
  if (chainId === monadTestnet.id) return monadTestnet;
  if (chainId === localAnvil.id) return localAnvil;
  throw new Error(`unsupported chain ${chainId}`);
}

export function explorerTx(chainId: number, hash: Hex): string | undefined {
  return chainId === monadTestnet.id ? `${monadTestnet.blockExplorers.default.url}/tx/${hash}` : undefined;
}

export function explorerAddress(chainId: number, address: string): string | undefined {
  return chainId === monadTestnet.id ? `${monadTestnet.blockExplorers.default.url}/address/${address}` : undefined;
}

/** Market ids used on-chain. Sandbox markets use the plain KRX code; incident replays add the date. */
export const MARKETS = {
  hynix: keccak256(toBytes("000660")),
  smsn: keccak256(toBytes("005930")),
  incident0728: keccak256(toBytes("000660@2026-07-28")),
  incident0806: keccak256(toBytes("000660@2026-08-06")),
} as const satisfies Record<string, Hex>;
