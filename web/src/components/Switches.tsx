"use client";

import { ASSETS, INSTANCES, type AssetKey, type InstanceKey } from "@/lib/config";

export function InstanceSwitch({ value, onChange }: { value: InstanceKey; onChange: (v: InstanceKey) => void }) {
  const options = (["live", "sandbox"] as InstanceKey[]).filter((k) => INSTANCES[k]);
  return (
    <div className="inline-flex rounded-md border border-rule p-0.5 text-sm" role="tablist">
      {options.map((k) => (
        <button
          key={k}
          role="tab"
          aria-selected={value === k}
          onClick={() => onChange(k)}
          className={`rounded px-3 py-1 ${value === k ? "bg-ink text-sheet" : "text-ink-2"}`}
        >
          {k === "live" ? "Live market" : "Sandbox (replayed day)"}
        </button>
      ))}
    </div>
  );
}

export function AssetSwitch({ value, onChange }: { value: AssetKey; onChange: (v: AssetKey) => void }) {
  return (
    <div className="inline-flex rounded-md border border-rule p-0.5 text-sm" role="tablist">
      {(Object.keys(ASSETS) as AssetKey[]).map((k) => (
        <button
          key={k}
          role="tab"
          aria-selected={value === k}
          onClick={() => onChange(k)}
          className={`rounded px-3 py-1 ${value === k ? "bg-ink text-sheet" : "text-ink-2"}`}
        >
          {ASSETS[k].symbol}
        </button>
      ))}
    </div>
  );
}
