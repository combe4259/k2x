"""Build the replay and sandbox datasets that the relayer posts to KMarkEngine.

Outputs (all deterministic):
  data/replays/<scenario>.ticks.csv     trade-level tape (incident scenarios)
  data/replays/<scenario>.json          per-window reports + metadata
  data/sandbox/<day>_<code>.json        per-minute reports for the sandbox market

Provenance is recorded per scenario in the JSON "sources" field. Anything that is not
an observed fact (e.g. the pre-market path between the reported prints) is marked
"reconstructed".
"""

from __future__ import annotations

import csv
import datetime as dt
import json
import math
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
KST = dt.timezone(dt.timedelta(hours=9))

VENUE_KRX, VENUE_NXT = 1, 2
KIND_CONT, KIND_OPEN, KIND_CLOSE = 0, 1, 2


def kst_ts(s: str) -> int:
    return int(dt.datetime.fromisoformat(s).replace(tzinfo=KST).timestamp())


def kst_day(ts: int) -> int:
    return (ts + 9 * 3600) // 86400


def tick_size(px: float) -> int:
    """KRX tick size (2023 schedule) for prices >= 200,000 KRW."""
    if px >= 500_000:
        return 1_000
    if px >= 200_000:
        return 500
    return 100


def round_tick(px: float) -> int:
    t = tick_size(px)
    return int(round(px / t) * t)


# ─────────────────────────── incident tapes ───────────────────────────


def build_pre_market_tape(
    rng: random.Random,
    start: int,
    bad_print: tuple[int, int],
    path_start: float,
    path_end: float,
    end: int,
) -> list[dict]:
    """Bad print first, then a reconstructed NXT pre-market tape drifting from path_start to path_end."""
    bad_px, bad_qty = bad_print
    ticks = [{"ts_ms": start * 1000 + 50, "venue": VENUE_NXT, "px": bad_px, "qty": bad_qty, "src": "reported"}]
    t_ms = start * 1000 + 1000  # the reported print stands alone in the first second
    end_ms = end * 1000
    px = path_start
    while t_ms < end_ms:
        elapsed = (t_ms - start * 1000) / 1000
        rate = 1.5 + 5.0 * math.exp(-elapsed / 90)  # trades per second, busier right after the open
        t_ms += int(rng.expovariate(rate) * 1000) + 1
        if t_ms >= end_ms:
            break
        frac = elapsed / (end - start)
        drift = path_start + (path_end - path_start) * frac
        px = 0.85 * px + 0.15 * drift + rng.gauss(0, path_start * 0.0012)
        qty = max(1, int(rng.lognormvariate(math.log(18), 0.9)))
        ticks.append({"ts_ms": t_ms, "venue": VENUE_NXT, "px": round_tick(px), "qty": qty, "src": "reconstructed"})
    return ticks


def window_schedule(start: int, end: int) -> list[tuple[int, int]]:
    """1s windows for the first 15s (where the incident happens), 5s until +1min, 30s until +5min,
    then 5min. Each window is one on-chain report, so the schedule also sets the testnet gas bill."""
    out, t = [], start
    while t < end:
        size = 1 if t < start + 15 else 5 if t < start + 60 else 30 if t < start + 300 else 300
        out.append((t, min(t + size, end)))
        t += size
    return out


def aggregate(ticks: list[dict], windows: list[tuple[int, int]], venue: int, kind: int, market: str) -> list[dict]:
    reports, i = [], 0
    ticks = sorted(ticks, key=lambda x: x["ts_ms"])
    for ws, we in windows:
        bucket = []
        while i < len(ticks) and ticks[i]["ts_ms"] < we * 1000:
            if ticks[i]["ts_ms"] >= ws * 1000:
                bucket.append(ticks[i])
            i += 1
        if not bucket:
            continue
        vol = sum(t["qty"] for t in bucket)
        notional = sum(t["qty"] * t["px"] for t in bucket)
        reports.append(
            {
                "market": market,
                "venue": venue,
                "kind": kind,
                "windowStart": ws,
                "windowEnd": we,
                "trades": len(bucket),
                "volume": vol,
                "notional": notional,
                "firstPx": bucket[0]["px"],
                "lastPx": bucket[-1]["px"],
                "highPx": max(t["px"] for t in bucket),
                "lowPx": min(t["px"] for t in bucket),
                "vwapPx": round(notional / vol),
                "flags": 0,
            }
        )
    return reports


def auction_report(market: str, kind: int, at: int, px: int, volume: int) -> dict:
    return {
        "market": market,
        "venue": VENUE_KRX,
        "kind": kind,
        "windowStart": at - 1,
        "windowEnd": at,
        "trades": max(1, volume // 25),
        "volume": volume,
        "notional": volume * px,
        "firstPx": px,
        "lastPx": px,
        "highPx": px,
        "lowPx": px,
        "vwapPx": px,
        "flags": 0,
    }


def build_incident(name: str, cfg: dict) -> None:
    rng = random.Random(cfg["seed"])
    start = kst_ts(cfg["date"] + "T08:00:00")
    end = kst_ts(cfg["date"] + "T08:50:00")
    ticks = build_pre_market_tape(rng, start, cfg["bad_print"], cfg["path_start"], cfg["path_end"], end)
    reports = aggregate(ticks, window_schedule(start, end), VENUE_NXT, KIND_CONT, cfg["code"])
    open_at = kst_ts(cfg["date"] + "T09:00:00")
    reports.append(auction_report(cfg["code"], KIND_OPEN, open_at, cfg["krx_open"], cfg["open_volume"]))

    out = ROOT / "replays"
    with open(out / f"{name}.ticks.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["ts_ms", "venue", "px", "qty", "src"])
        w.writeheader()
        w.writerows(ticks)
    meta = {
        "scenario": name,
        "title": cfg["title"],
        "code": cfg["code"],
        "seedClose": {"day": kst_day(kst_ts(cfg["prev_date"] + "T15:30:00")), "px": cfg["prev_close"]},
        "sources": cfg["sources"],
        "notes": cfg["notes"],
        "count": len(reports),
        "reports": reports,
    }
    (out / f"{name}.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1))
    print(f"{name}: {len(ticks)} ticks -> {len(reports)} reports")


INCIDENTS = {
    "2026-07-28_000660": {
        "title": "7/28 08:00 NXT pre-market: 1 share at the lower limit",
        "code": "000660",
        "date": "2026-07-28",
        "prev_date": "2026-07-27",
        "prev_close": 1_816_000,
        "bad_print": (1_272_000, 1),
        "path_start": 1_705_000,
        "path_end": 1_668_000,
        "krx_open": 1_662_000,
        "open_volume": 180_000,
        "seed": 728,
        "sources": {
            "bad_print": "reported: 1 share at 1,272,000 KRW at 08:00 on NXT (Newsis 2026-07-30, Financefeeds)",
            "prev_close": "observed: KRX close 2026-07-27 = 1,816,000 (Yahoo Finance daily)",
            "krx_open": "observed: KRX open 2026-07-28 = 1,662,000 (Yahoo Finance daily)",
            "pre_market_path": "reconstructed: news says trading recovered to the 1.7M-won range; path drifts to the KRX open",
            "open_volume": "estimate",
        },
        "notes": "Ticks after the bad print and auction volume are reconstructed and labelled as such.",
    },
    "2026-08-06_000660": {
        "title": "8/6 08:00 NXT pre-market: 11 shares at the lower limit",
        "code": "000660",
        "date": "2026-08-06",
        "prev_date": "2026-08-05",
        "prev_close": 1_668_000,
        "bad_print": (1_168_000, 11),
        "path_start": 1_612_000,
        "path_end": 1_602_000,
        "krx_open": 1_600_000,
        "open_volume": 120_000,
        "seed": 806,
        "sources": {
            "bad_print": "reported: 11 shares at 1,168,000 KRW at 08:00 on NXT (BigGo Finance)",
            "prev_close": "observed: KRX close 2026-08-05 = 1,668,000 (Yahoo Finance daily)",
            "krx_open": "observed: KRX open 2026-08-06 = 1,600,000 (Yahoo Finance daily)",
            "pre_market_path": "reconstructed",
            "open_volume": "estimate",
        },
        "notes": "Ticks after the bad print and auction volume are reconstructed and labelled as such.",
    },
}

# ─────────────────────────── sandbox day ───────────────────────────


def load_daily(code: str) -> dict[dt.date, dict]:
    d = json.loads((ROOT / "sandbox" / f"raw_{code}_1d.json").read_text())["chart"]["result"][0]
    q = d["indicators"]["quote"][0]
    out = {}
    for a, o, h, lo, c, v in zip(d["timestamp"], q["open"], q["high"], q["low"], q["close"], q["volume"]):
        if c:
            out[dt.datetime.fromtimestamp(a, KST).date()] = {"o": o, "h": h, "l": lo, "c": c, "v": v}
    return out


def build_sandbox(code: str, day: str) -> None:
    raw = json.loads((ROOT / "sandbox" / f"raw_{code}_1m.json").read_text())["chart"]["result"][0]
    q = raw["indicators"]["quote"][0]
    target = dt.date.fromisoformat(day)
    daily = load_daily(code)
    prev_day = max(d for d in daily if d < target)

    bars = []
    for a, o, h, lo, c, v in zip(raw["timestamp"], q["open"], q["high"], q["low"], q["close"], q["volume"]):
        t = dt.datetime.fromtimestamp(a, KST)
        if t.date() != target or o is None or not v:
            continue
        if t.hour * 60 + t.minute >= 15 * 60 + 20:
            continue  # closing call auction: no continuous trading
        bars.append((a, o, h, lo, c, int(v)))

    market = code
    reports = []
    open_at = kst_ts(day + "T09:00:00")
    first = bars[0]
    reports.append(auction_report(market, KIND_OPEN, open_at, round_tick(daily[target]["o"]), max(first[5], 20_000)))
    for a, o, h, lo, c, v in bars:
        if a < open_at:
            continue
        ws, we = max(a, open_at + 1), a + 60
        vwap = round((o + h + lo + c) / 4)
        reports.append(
            {
                "market": market,
                "venue": VENUE_KRX,
                "kind": KIND_CONT,
                "windowStart": ws,
                "windowEnd": we,
                "trades": max(1, v // 20),
                "volume": v,
                "notional": v * vwap,
                "firstPx": round_tick(o),
                "lastPx": round_tick(c),
                "highPx": round_tick(h),
                "lowPx": round_tick(lo),
                "vwapPx": vwap,
                "flags": 0,
            }
        )
    close_at = kst_ts(day + "T15:30:00")
    reports.append(
        auction_report(market, KIND_CLOSE, close_at, round_tick(daily[target]["c"]), int(daily[target]["v"] * 0.03))
    )
    meta = {
        "scenario": f"sandbox_{day}_{code}",
        "title": f"Sandbox: KRX regular session {day} ({code}) replayed minute by minute",
        "code": code,
        "day": day,
        "seedClose": {"day": kst_day(kst_ts(prev_day.isoformat() + "T15:30:00")), "px": round_tick(daily[prev_day]["c"])},
        "sources": {
            "bars": "observed: Yahoo Finance 1-minute bars (KRX regular session)",
            "open_close": "observed: Yahoo Finance daily open/close",
            "vwap_trades": "estimate: VWAP = OHLC average, trades = volume / 20",
        },
        "count": len(reports),
        "reports": reports,
    }
    out = ROOT / "sandbox" / f"{day}_{code}.json"
    out.write_text(json.dumps(meta, ensure_ascii=False, indent=1))
    print(f"sandbox {code} {day}: {len(reports)} reports, seed close {meta['seedClose']}")


if __name__ == "__main__":
    for name, cfg in INCIDENTS.items():
        build_incident(name, cfg)
    for code in ("000660", "005930"):
        build_sandbox(code, "2026-10-02")
