import { NextResponse } from "next/server";
import { fetchQuote } from "@k2x/relayer/live";

export const dynamic = "force-dynamic";

/** Real-time KRX/NXT quotes for the two underlyings (proxied to avoid CORS). */
export async function GET() {
  try {
    const [h, s] = await Promise.all([fetchQuote("000660"), fetchQuote("005930")]);
    const slim = (q: Awaited<ReturnType<typeof fetchQuote>>) => ({
      code: q.code,
      krx: { price: q.krx.price, prevClose: q.krx.prevClose, status: q.krx.status },
      nxt: q.nxt ? { price: q.nxt.price, status: q.nxt.status, session: q.nxt.session } : null,
    });
    return NextResponse.json({ hynix: slim(h), smsn: slim(s) }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
