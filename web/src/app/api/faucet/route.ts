import { NextResponse } from "next/server";
import { formatEther, isAddress, parseEther } from "viem";
import { mockAusdAbi } from "@k2x/relayer";
import { deployment, signerClients } from "@/lib/server";

export const dynamic = "force-dynamic";

const GAS_DRIP = parseEther("0.1");
const RESERVE = parseEther("1"); // kept for sandbox steps; the gas faucet stops below it
const recent = new Map<string, number>();

function limited(key: string, ms: number): boolean {
  const last = recent.get(key) ?? 0;
  if (Date.now() - last < ms) return true;
  recent.set(key, Date.now());
  return false;
}

/**
 * Gives a new wallet enough testnet MON for a few transactions, and any wallet 10,000 mock AUSD a day.
 * Gas goes only to wallets that have never sent a transaction and hold no MON, and never below
 * the server's reserve, so a script cycling fresh addresses cannot drain it.
 */
export async function POST(req: Request) {
  const { address } = (await req.json().catch(() => ({}))) as { address?: string };
  if (!address || !isAddress(address)) return NextResponse.json({ error: "Send a valid address" }, { status: 400 });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (limited(`a:${address.toLowerCase()}`, 60_000) || limited(`ip:${ip}`, 20_000)) {
    return NextResponse.json({ error: "Funded a moment ago. Try again in a minute." }, { status: 429 });
  }

  try {
    const { publicClient, walletClient } = signerClients();
    const notes: string[] = [];
    const [balance, nonce, ours] = await Promise.all([
      publicClient.getBalance({ address }),
      publicClient.getTransactionCount({ address }),
      publicClient.getBalance({ address: walletClient.account.address }),
    ]);
    if (balance === 0n && nonce === 0) {
      if (ours - GAS_DRIP > RESERVE) {
        const hash = await walletClient.sendTransaction({ to: address, value: GAS_DRIP });
        await publicClient.waitForTransactionReceipt({ hash });
        notes.push(`${formatEther(GAS_DRIP)} MON for gas`);
      } else {
        notes.push("no MON (the demo gas faucet is empty; use the Monad testnet faucet)");
      }
    }
    try {
      const hash = await walletClient.writeContract({
        address: deployment.ausd,
        abi: mockAusdAbi,
        functionName: "faucetTo",
        args: [address],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      notes.push("10,000 test AUSD");
    } catch {
      notes.push("no AUSD (already claimed today)");
    }
    return NextResponse.json({ message: `Sent ${notes.join(" and ")}.` });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message.split("\n")[0] }, { status: 500 });
  }
}
