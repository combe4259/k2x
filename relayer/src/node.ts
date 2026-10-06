// Node-only helpers for the CLIs (file system, env, clients).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { nonceManager, privateKeyToAccount } from "viem/accounts";
import { chainFor } from "./chains.ts";
import type { Clients } from "./engine.ts";
import type { Dataset, Deployment } from "./types.ts";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function loadEnv() {
  const file = join(ROOT, ".env");
  if (existsSync(file)) process.loadEnvFile(file);
}

export function loadDeployment(chainId: number): Deployment {
  return JSON.parse(readFileSync(join(ROOT, "deployments", `${chainId}.json`), "utf8"));
}

export function loadDataset(rel: string): Dataset {
  return JSON.parse(readFileSync(join(ROOT, "data", rel), "utf8"));
}

export const ANVIL_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

/**
 * `local` → anvil with its default key; `testnet` → Monad testnet with the key named by `keyEnv`.
 * Each role has its own key (owner/operator, live relayer, web server), so no two processes
 * ever share a nonce.
 */
export function makeClients(network: string, keyEnv = "OPERATOR_PRIVATE_KEY"): { clients: Clients; chainId: number } {
  loadEnv();
  const chainId = network === "testnet" ? 10143 : 31337;
  const chain = chainFor(chainId);
  const rpc = network === "testnet" ? (process.env.MONAD_TESTNET_RPC ?? chain.rpcUrls.default.http[0]) : chain.rpcUrls.default.http[0];
  const key = (network === "testnet" ? process.env[keyEnv] : ANVIL_KEY) as Hex | undefined;
  if (!key) throw new Error(`${keyEnv} missing in .env`);
  const account = privateKeyToAccount(key, { nonceManager });
  const publicClient = createPublicClient({ chain, transport: http(rpc), pollingInterval: 250 });
  const walletClient = createWalletClient({ chain, transport: http(rpc), account });
  return { clients: { publicClient, walletClient } as unknown as Clients, chainId };
}
