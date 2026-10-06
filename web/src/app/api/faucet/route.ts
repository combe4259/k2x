import { NextResponse } from "next/server";
import { formatEther, isAddress, parseEther } from "viem";
import { mockAusdAbi } from "@k2x/relayer";
import { deployment, operatorClients } from "@/lib/server";

export const dynamic = "force-dynamic";

const GAS_DRIP = parseEther("0.3");
const recent = new Map<string, number>();

/** Gives a wallet enough testnet MON for a few transactions and 10,000 mock AUSD. */
export async function POST(req: Request) {
  const { address } = (await req.json().catch(() => ({}))) as { address?: string };
  if (!address || !isAddress(address)) return NextResponse.json({ error: "Send a valid address" }, { status: 400 });
  const last = recent.get(address.toLowerCase()) ?? 0;
  if (Date.now() - last < 60_000) return NextResponse.json({ error: "Already funded a minute ago" }, { status: 429 });
  recent.set(address.toLowerCase(), Date.now());

  try {
    const { publicClient, walletClient } = operatorClients();
    const notes: string[] = [];
    const balance = await publicClient.getBalance({ address });
    if (balance < GAS_DRIP / 2n) {
      const hash = await walletClient.sendTransaction({ to: address, value: GAS_DRIP });
      await publicClient.waitForTransactionReceipt({ hash });
      notes.push(`${formatEther(GAS_DRIP)} MON for gas`);
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
      notes.push("AUSD already claimed today");
    }
    return NextResponse.json({ message: `Sent ${notes.join(" and ")}.` });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message.split("\n")[0] }, { status: 500 });
  }
}
