// Registry of named deterministic tools that agents call through
// StageContext.callTool(). The engine counts every call against
// limits.maxToolCalls and records it in the sanitized trace as a `tool` event
// with a numbers-only summary of the arguments and the result. Tools are pure
// functions of their arguments, so fingerprint-based stage reuse stays valid.
import { projectGoal, stressLoss } from "../domain/calculations.ts";
import type { GoalProjection, ProjectionInput } from "../domain/calculations.ts";
import { simulateGoal, solveLevers } from "../domain/simulation.ts";
import type { SimulationInput, SimulationResult, SolverInput, SolverResult } from "../domain/simulation.ts";
import type { AssetClass } from "../domain/types.ts";

export type StressLossArgs = { mix: Record<AssetClass, number>; drawdowns: Record<AssetClass, number> };

export type ToolArgs = {
  "project-goal": ProjectionInput;
  "stress-loss": StressLossArgs;
  "simulate-outcomes": SimulationInput;
  "solve-levers": SolverInput;
};
export type ToolResults = {
  "project-goal": GoalProjection;
  "stress-loss": number;
  "simulate-outcomes": SimulationResult;
  "solve-levers": SolverResult;
};
export type ToolName = keyof ToolArgs;

type NumberSummary = Record<string, number>;
type ToolSpec<N extends ToolName> = {
  description: string;
  run(args: ToolArgs[N]): ToolResults[N];
  /** Numbers only: no labels or free text ever reach the trace. */
  summarizeArgs(args: ToolArgs[N]): NumberSummary;
  summarizeResult(result: ToolResults[N]): NumberSummary;
};

const r2 = (x: number) => Math.round(x * 100) / 100;
const r4 = (x: number) => Math.round(x * 10000) / 10000;

const simulationArgs = (a: SimulationInput): NumberSummary => ({
  initial: r2(a.initial),
  monthly: r2(a.monthly),
  years: a.years,
  equityShare: r4(a.assetMix.equity),
  fee: r4(a.fee),
  target: r2(a.target),
  withdrawals: (a.withdrawals ?? []).length,
  ...(a.paths !== undefined ? { paths: a.paths } : {}),
  ...(a.seed !== undefined ? { seed: a.seed } : {}),
});

export const TOOLS: { [N in ToolName]: ToolSpec<N> } = {
  "project-goal": {
    description: "Deterministic base-case projection (calculations.projectGoal)",
    run: projectGoal,
    summarizeArgs: (a) => ({ initial: r2(a.initial), monthly: r2(a.monthly), years: a.years, grossReturn: r4(a.grossReturn), fee: r4(a.fee), withdrawals: (a.withdrawals ?? []).length }),
    summarizeResult: (r) => ({ nominal: r2(r.nominal), real: r2(r.real) }),
  },
  "stress-loss": {
    description: "Portfolio loss for given asset-class drawdowns (calculations.stressLoss)",
    run: (a) => stressLoss(a.mix, a.drawdowns),
    summarizeArgs: (a) => ({ equityShare: r4(a.mix.equity), equityDrawdown: a.drawdowns.equity, bondDrawdown: a.drawdowns.bond }),
    summarizeResult: (r) => ({ lossPct: r4(r) }),
  },
  "simulate-outcomes": {
    description: "Seeded synthetic Monte Carlo range of outcomes (simulation.simulateGoal)",
    run: simulateGoal,
    summarizeArgs: simulationArgs,
    summarizeResult: (r) => ({ paths: r.paths, seed: r.seed, p10: r2(r.p10), p50: r2(r.p50), p90: r2(r.p90), reachShare: r4(r.reachShare) }),
  },
  "solve-levers": {
    description: "Goal-seek over the seeded simulation for target reach shares (simulation.solveLevers)",
    run: solveLevers,
    summarizeArgs: (a) => ({ ...simulationArgs(a), thresholds: (a.thresholds ?? []).length }),
    summarizeResult: (r) => {
      const out: NumberSummary = { currentReachShare: r4(r.currentReachShare), evaluations: r.evaluations };
      for (const s of r.solutions) {
        const key = Math.round(s.threshold * 100);
        if (s.monthlyLei !== null) out[`monthlyLeiAt${key}`] = r2(s.monthlyLei);
        if (s.extraYears !== null) out[`extraYearsAt${key}`] = s.extraYears;
      }
      return out;
    },
  },
};

export const TOOL_NAMES = Object.keys(TOOLS) as ToolName[];

/** Runs a tool directly (no budget, no trace). The engine wraps this with both. */
export function runTool<N extends ToolName>(name: N, args: ToolArgs[N]): ToolResults[N] {
  const spec = TOOLS[name] as ToolSpec<N> | undefined;
  if (!spec) throw new RangeError(`Unknown tool ${String(name)}`);
  return spec.run(args);
}

export function summarizeToolCall<N extends ToolName>(name: N, args: ToolArgs[N], result: ToolResults[N]) {
  const spec = TOOLS[name] as ToolSpec<N>;
  return { args: spec.summarizeArgs(args), result: spec.summarizeResult(result) };
}
