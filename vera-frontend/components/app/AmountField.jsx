"use client";

import { ASSETS } from "./useVera";
import { qty, usd } from "@/lib/vera";

const PRESETS = [0.25, 0.5, 0.75, 1];
const PRESET_LABEL = { 0.25: "25%", 0.5: "50%", 0.75: "75%", 1: "Max" };

/**
 * The reference's amount input: uppercase label, big serif figure with the
 * unit on the left and the available balance right-aligned, quick-fill chips
 * underneath.
 */
export default function AmountField({ label, symbol, value, onChange, max, dp }) {
  const a = ASSETS[symbol];
  const decimals = dp ?? a?.dp ?? 4;
  const usdValue = (Number(value) || 0) * (a?.price ?? 0);

  const set = (n) => onChange(Math.max(0, Math.min(Number(n.toFixed(decimals)), max)));

  return (
    <div className="amt">
      <span className="amt-label">{label}</span>

      <div className="amt-field">
        <span className="amt-unit">{symbol}</span>
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          max={max}
          value={value || ""}
          placeholder="0"
          aria-label={`${label} in ${symbol}`}
          onChange={(e) => {
            const v = Number(e.target.value);
            onChange(Number.isNaN(v) ? 0 : Math.max(0, Math.min(v, max)));
          }}
        />
        <span className="amt-of">
          of {qty(max, decimals)}
          <em>{usd(usdValue)}</em>
        </span>
      </div>

      <div className="amt-chips">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            className={
              max > 0 && Math.abs(value - max * p) < 1e-9 ? "amt-chip on" : "amt-chip"
            }
            onClick={() => set(max * p)}
            disabled={max <= 0}
          >
            {PRESET_LABEL[p]}
          </button>
        ))}
      </div>
    </div>
  );
}
