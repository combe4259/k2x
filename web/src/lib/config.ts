import { MARKETS, localAnvil, monadTestnet } from "@k2x/relayer";
import type { Address, Hex } from "viem";
import dep from "@/generated/deployment.json";

export const CHAIN_ID: number = dep.chainId;
export const chain = CHAIN_ID === monadTestnet.id ? monadTestnet : localAnvil;
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || chain.rpcUrls.default.http[0];
export const EXPLORER = CHAIN_ID === monadTestnet.id ? monadTestnet.blockExplorers.default.url : undefined;

export type AssetKey = "hynix" | "smsn";
export type InstanceKey = "live" | "sandbox";

export const ASSETS: Record<AssetKey, { code: string; name: string; ko: string; symbol: string; market: Hex }> = {
  hynix: { code: "000660", name: "SK hynix", ko: "SK하이닉스", symbol: "HYNIX2X", market: MARKETS.hynix },
  smsn: { code: "005930", name: "Samsung Electronics", ko: "삼성전자", symbol: "SMSN2X", market: MARKETS.smsn },
};

type Instance = {
  key: InstanceKey;
  label: string;
  engine: Address;
  pools: Record<AssetKey, Address>;
  tokens: Record<AssetKey, Address>;
  startBlock: number;
};

const base = dep.base as Record<string, any> | null;
const live = dep.live as Record<string, any> | null;

export const INSTANCES: Partial<Record<InstanceKey, Instance>> = {
  ...(live
    ? {
        live: {
          key: "live",
          label: "Live",
          engine: live.liveEngine,
          pools: { hynix: live.hynixPool, smsn: live.smsnPool },
          tokens: { hynix: live.hynixToken, smsn: live.smsnToken },
          startBlock: live.startBlock,
        },
      }
    : {}),
  ...(base
    ? {
        sandbox: {
          key: "sandbox",
          label: "Sandbox",
          engine: base.sandboxEngine,
          pools: { hynix: base.hynixPool, smsn: base.smsnPool },
          tokens: { hynix: base.hynixToken, smsn: base.smsnToken },
          startBlock: base.startBlock,
        },
      }
    : {}),
};

export const AUSD: Address = base?.ausd;
export const INCIDENT_ENGINE: Address = base?.incidentEngine;

export function txUrl(hash: string) {
  return EXPLORER ? `${EXPLORER}/tx/${hash}` : undefined;
}

export function addressUrl(address: string) {
  return EXPLORER ? `${EXPLORER}/address/${address}` : undefined;
}
