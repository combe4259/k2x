import type { Address, Hex } from "viem";

export type Deployment = {
  chainId: number;
  startBlock: number;
  operator: Address;
  ausd: Address;
  incidentEngine: Address;
  sandboxEngine: Address;
  hynixPool: Address;
  hynixToken: Address;
  smsnPool: Address;
  smsnToken: Address;
};

/** One per-window trade summary, as stored in data/replays and data/sandbox. */
export type DatasetReport = {
  market: string;
  venue: number;
  kind: number;
  windowStart: number;
  windowEnd: number;
  trades: number;
  volume: number;
  notional: number;
  firstPx: number;
  lastPx: number;
  highPx: number;
  lowPx: number;
  vwapPx: number;
  flags: number;
};

export type Dataset = {
  scenario: string;
  title: string;
  code: string;
  seedClose: { day: number; px: number };
  sources: Record<string, string>;
  notes?: string;
  count: number;
  reports: DatasetReport[];
};

export const Decision = ["ACCEPTED", "HELD", "REJECTED"] as const;
export type DecisionName = (typeof Decision)[number];

export const Reason = [
  "NONE",
  "STALE_SEQUENCE",
  "FUTURE_TIMESTAMP",
  "TOO_OLD",
  "SESSION",
  "BAND",
  "WARMUP",
  "JUMP_PENDING",
  "JUMP_UNCONFIRMED",
  "VI_HOLD",
  "HALT",
  "THIN_AUCTION",
  "NO_BASE",
  "MALFORMED",
  "AUCTION_DONE",
] as const;
export type ReasonName = (typeof Reason)[number];

export const Session = ["CLOSED", "NXT_PRE", "AUCTION_WAIT", "CONTINUOUS", "CLOSE_AUCTION", "NXT_AFTER"] as const;
export type SessionName = (typeof Session)[number];

/** A decoded engine event tied to the transaction that produced it. */
export type EngineEvent =
  | {
      type: "raw";
      market: Hex;
      venue: number;
      kind: number;
      windowStart: number;
      windowEnd: number;
      lastPx: number;
      lowPx: number;
      highPx: number;
      vwapPx: number;
      volume: number;
      notional: number;
      trades: number;
      txHash: Hex;
      blockNumber: number;
    }
  | {
      type: "accepted";
      market: Hex;
      seq: number;
      px: number;
      at: number;
      venue: number;
      kind: number;
      txHash: Hex;
      blockNumber: number;
    }
  | {
      type: "held" | "rejected";
      market: Hex;
      reason: ReasonName;
      px: number;
      at: number;
      venue: number;
      txHash: Hex;
      blockNumber: number;
    }
  | { type: "close"; market: Hex; day: number; px: number; seq: number; txHash: Hex; blockNumber: number };
