"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import {
  createWalletClient,
  custom,
  http,
  type Abi,
  type Address,
  type ContractFunctionArgs,
  type ContractFunctionName,
  type TransactionReceipt,
  type WalletClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { publicClient } from "./client";
import { RPC_URL, chain } from "./config";

type Kind = "demo" | "injected";
type WalletState = { kind: Kind; address: Address; client: WalletClient } | null;

type WriteParams<abi extends Abi, fn extends ContractFunctionName<abi, "nonpayable" | "payable">> = {
  address: Address;
  abi: abi;
  functionName: fn;
  args?: ContractFunctionArgs<abi, "nonpayable" | "payable", fn>;
};

type Ctx = {
  wallet: WalletState;
  busy: boolean;
  connectDemo: () => Promise<Address>;
  connectInjected: () => Promise<void>;
  disconnect: () => void;
  write: <abi extends Abi, fn extends ContractFunctionName<abi, "nonpayable" | "payable">>(
    p: WriteParams<abi, fn>,
  ) => Promise<TransactionReceipt>;
  fund: () => Promise<string>;
  /** One click: create (or reuse) the demo wallet in this browser and send it test MON and AUSD. */
  startDemo: () => Promise<string>;
};

const WalletCtx = createContext<Ctx | null>(null);
const DEMO_KEY = "k2x.demoKey";

declare global {
  interface Window {
    ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<any> };
  }
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<WalletState>(null);
  const [busy, setBusy] = useState(false);

  const fundAddress = useCallback(async (address: Address) => {
    const res = await fetch("/api/faucet", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? "The faucet did not answer. Try again in a minute.");
    return body.message as string;
  }, []);

  const fund = useCallback(async () => {
    if (!wallet) throw new Error("Connect a wallet first");
    return fundAddress(wallet.address);
  }, [wallet, fundAddress]);

  const connectDemo = useCallback(async (): Promise<Address> => {
    let key: `0x${string}` | null = null;
    try {
      key = localStorage.getItem(DEMO_KEY) as `0x${string}` | null;
      if (!key) {
        key = generatePrivateKey();
        localStorage.setItem(DEMO_KEY, key);
      }
    } catch {
      key = generatePrivateKey();
    }
    const account = privateKeyToAccount(key);
    const client = createWalletClient({ account, chain, transport: http(RPC_URL) });
    setWallet({ kind: "demo", address: account.address, client });
    try {
      localStorage.setItem("k2x.wallet", "demo");
    } catch {}
    return account.address;
  }, []);

  const startDemo = useCallback(async () => {
    const address = wallet?.address ?? (await connectDemo());
    return fundAddress(address);
  }, [wallet, connectDemo, fundAddress]);

  const connectInjected = useCallback(async () => {
    const eth = window.ethereum;
    if (!eth) throw new Error("No browser wallet found. Use the demo wallet instead.");
    const [address] = (await eth.request({ method: "eth_requestAccounts" })) as Address[];
    const hexId = `0x${chain.id.toString(16)}`;
    try {
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
    } catch (e: any) {
      if (e?.code === 4902) {
        await eth.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: hexId,
              chainName: chain.name,
              nativeCurrency: chain.nativeCurrency,
              rpcUrls: [RPC_URL],
              blockExplorerUrls: chain.blockExplorers ? [chain.blockExplorers.default.url] : [],
            },
          ],
        });
      } else throw e;
    }
    const client = createWalletClient({ account: address, chain, transport: custom(eth) });
    setWallet({ kind: "injected", address, client });
    try {
      localStorage.setItem("k2x.wallet", "injected");
    } catch {}
  }, []);

  const disconnect = useCallback(() => {
    setWallet(null);
    try {
      localStorage.removeItem("k2x.wallet");
    } catch {}
  }, []);

  useEffect(() => {
    try {
      if (localStorage.getItem("k2x.wallet") === "demo") connectDemo();
    } catch {}
  }, [connectDemo]);

  const write: Ctx["write"] = useCallback(
    async (p) => {
      if (!wallet) throw new Error("Connect a wallet first");
      setBusy(true);
      try {
        const account = wallet.client.account ?? wallet.address;
        const gas = await publicClient.estimateContractGas({ ...(p as any), account });
        const hash = await wallet.client.writeContract({
          ...(p as any),
          account,
          chain,
          gas: (gas * 125n) / 100n,
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error("Transaction reverted");
        return receipt;
      } finally {
        setBusy(false);
      }
    },
    [wallet],
  );

  return (
    <WalletCtx.Provider value={{ wallet, busy, connectDemo, connectInjected, disconnect, write, fund, startDemo }}>
      {children}
    </WalletCtx.Provider>
  );
}

export function useWallet() {
  const ctx = useContext(WalletCtx);
  if (!ctx) throw new Error("useWallet outside WalletProvider");
  return ctx;
}
