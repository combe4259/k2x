# Datasets

| File | What | Provenance |
| --- | --- | --- |
| `replays/2026-07-28_000660.*` | NXT pre-market 08:00–08:50 + KRX open, SK hynix | 1-share print at 1,272,000 KRW (reported), prev close 1,816,000 and KRX open 1,662,000 (observed). The pre-market path between them is **reconstructed** (`src` column in the tick CSV). |
| `replays/2026-08-06_000660.*` | Same for the 11-share print | 11 shares at 1,168,000 KRW (reported), prev close 1,668,000 and open 1,600,000 (observed), path **reconstructed**. |
| `sandbox/2026-10-02_<code>.json` | KRX regular session replayed minute by minute | Yahoo Finance 1-minute bars and daily open/close (observed); VWAP and trade counts are estimates. |
| `sandbox/raw_*` | Raw Yahoo Finance responses used above | — |

Rebuild with `python3 data/scripts/build_datasets.py`. Output is deterministic.
