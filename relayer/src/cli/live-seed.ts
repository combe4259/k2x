// Print the seed closes DeployLive.s.sol needs, from real-time quotes.
// usage: eval "$(npx tsx src/cli/live-seed.ts)"
import { fetchQuote } from "../live/naver.ts";

const KST = 9 * 3600;
const nowKst = Math.floor(Date.now() / 1000) + KST;
const today = Math.floor(nowKst / 86_400);
const sod = nowKst % 86_400;
const holidays = new Set([20735, 20812, 20818, 20819]);
const isTradingDay = (d: number) => (d + 3) % 7 < 5 && !holidays.has(d);
const prevTradingDay = (d: number) => {
  let x = d - 1;
  while (!isTradingDay(x)) x--;
  return x;
};

for (const [label, code] of [["HYNIX", "000660"], ["SMSN", "005930"]] as const) {
  const q = await fetchQuote(code);
  let day: number;
  let px: number;
  if (isTradingDay(today) && sod >= 15 * 3600 + 30 * 60) {
    day = today; // today's official close is final
    px = q.krx.price;
  } else if (isTradingDay(today) && sod >= 9 * 3600) {
    day = prevTradingDay(today); // session in progress: seed with yesterday's close
    px = q.krx.prevClose;
  } else {
    day = isTradingDay(today) ? prevTradingDay(today) : prevTradingDay(today + 1);
    px = q.krx.price; // before the open (or a closed day) the quote shows the last close
  }
  console.log(`export LIVE_${label}_DAY=${day}`);
  console.log(`export LIVE_${label}_PX=${px}`);
}
