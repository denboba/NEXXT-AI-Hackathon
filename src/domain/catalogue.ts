// Fictional strategy building blocks. They reuse the three fictional demo
// funds from src/lib/finance.ts (allocation, fee, recommended minimum years)
// plus an illustrative cash reserve block. Nothing here is a real product.
import { products } from "../lib/finance.ts";
import type { AssetClass } from "./types.ts";

export type BuildingBlock = {
  id: string;
  name: string;
  productId?: string;
  equityShare: number;
  assetMix: Record<AssetClass, number>;
  /** Annual fee as a decimal return reduction. */
  fee: number;
  /** Recommended minimum holding period in years. */
  minimumYears: number;
  lockUp: boolean;
  source: "fictional-demo-catalogue";
};

// Equity shares follow the allocation labels of the demo products
// ("80% bonds · 20% equities", etc.).
const EQUITY_SHARE: Record<string, number> = { steady: 0.2, balanced: 0.5, growth: 0.9 };

export const CASH_BLOCK_ID = "cash-reserve";

export const catalogue: BuildingBlock[] = [
  {
    id: CASH_BLOCK_ID,
    name: "Cash reserve (illustrative deposit)",
    equityShare: 0,
    assetMix: { equity: 0, bond: 0, cash: 1 },
    fee: 0,
    minimumYears: 0,
    lockUp: false,
    source: "fictional-demo-catalogue",
  },
  ...products.map((p): BuildingBlock => {
    const equity = EQUITY_SHARE[p.id];
    return {
      id: p.id,
      name: p.name,
      productId: p.id,
      equityShare: equity,
      assetMix: { equity, bond: +(1 - equity).toFixed(10), cash: 0 },
      fee: p.fee,
      minimumYears: p.minimumYears,
      lockUp: false,
      source: "fictional-demo-catalogue",
    };
  }),
];

export const blockById = (id: string) => catalogue.find((b) => b.id === id);

/** Blocks whose recommended minimum holding period fits the horizon. */
export const eligibleBlocks = (horizonYears: number) =>
  catalogue.filter((b) => b.minimumYears <= horizonYears).sort((a, b) => a.equityShare - b.equityShare);

/**
 * Two-block mix that reaches at most `targetEquity`, using the eligible
 * blocks that bracket it. The riskier block's weight is floored to whole
 * percent so the result never exceeds the target. Weights sum to 1.
 */
export function mixForEquity(targetEquity: number, blocks: BuildingBlock[]): Record<string, number> {
  if (!Number.isFinite(targetEquity) || targetEquity < 0 || blocks.length === 0)
    throw new RangeError("Invalid equity target");
  const sorted = [...blocks].sort((a, b) => a.equityShare - b.equityShare);
  const top = sorted[sorted.length - 1];
  if (targetEquity >= top.equityShare) return { [top.id]: 1 };
  let lowIndex = -1;
  sorted.forEach((b, i) => {
    if (b.equityShare <= targetEquity) lowIndex = i;
  });
  if (lowIndex < 0) return { [sorted[0].id]: 1 };
  const low = sorted[lowIndex];
  const high = sorted[lowIndex + 1];
  const share = Math.floor(((targetEquity - low.equityShare) / (high.equityShare - low.equityShare)) * 100 + 1e-9) / 100;
  if (share <= 0) return { [low.id]: 1 };
  return { [low.id]: +(1 - share).toFixed(2), [high.id]: share };
}
