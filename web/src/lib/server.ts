import "server-only";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { nonceManager, privateKeyToAccount } from "viem/accounts";
import type { Clients, Dataset, Deployment } from "@k2x/relayer";
import dep from "@/generated/deployment.json";
import sandbox from "@/generated/sandbox.json";
import { RPC_URL, chain } from "./config";

/**
 * The web server's own key: it steps the sandbox and runs the faucet. It is not the owner and not
 * the live relayer, so a busy demo can never collide with live prices or touch admin functions.
 */
export function signerClients(): Clients {
  const key = (process.env.WEB_SIGNER_PRIVATE_KEY ?? process.env.OPERATOR_PRIVATE_KEY) as Hex | undefined;
  if (!key) throw new Error("Server is missing WEB_SIGNER_PRIVATE_KEY");
  const account = privateKeyToAccount(key, { nonceManager });
  const publicClient = createPublicClient({ chain, transport: http(RPC_URL), pollingInterval: 250 });
  const walletClient = createWalletClient({ chain, transport: http(RPC_URL), account });
  return { publicClient, walletClient } as unknown as Clients;
}

export const deployment = dep.base as unknown as Deployment;
export const sandboxData = sandbox as unknown as Record<"000660" | "005930", Dataset>;
