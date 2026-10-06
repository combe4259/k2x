import "server-only";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Clients, Dataset, Deployment } from "@k2x/relayer";
import dep from "@/generated/deployment.json";
import sandbox from "@/generated/sandbox.json";
import { RPC_URL, chain } from "./config";

export function operatorClients(): Clients {
  const key = process.env.OPERATOR_PRIVATE_KEY as Hex | undefined;
  if (!key) throw new Error("Server is missing OPERATOR_PRIVATE_KEY");
  const account = privateKeyToAccount(key);
  const publicClient = createPublicClient({ chain, transport: http(RPC_URL), pollingInterval: 250 });
  const walletClient = createWalletClient({ chain, transport: http(RPC_URL), account });
  return { publicClient, walletClient } as unknown as Clients;
}

export const deployment = dep.base as unknown as Deployment;
export const sandboxData = sandbox as unknown as Record<"000660" | "005930", Dataset>;
