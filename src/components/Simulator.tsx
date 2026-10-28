import { useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowUpRight,
  Info,
  SlidersHorizontal,
  TrendingUp,
} from "lucide-react";
import { money, pct, products, project, INFLATION } from "../lib/finance";
import { useJourney } from "../lib/journey";
import { Dialog } from "./ui/dialog";
import { Slider } from "./ui/slider";
import { Button } from "./ui/button";
export function Assumptions({ productId }: { productId?: string }) {
  const { state } = useJourney();
  const product =
    products.find((p) => p.id === (productId ?? state.risk)) ?? products[1];
  return (
    <Dialog
      title="A clear look at the numbers"
      description="A simplified example, never a forecast or a guarantee."
      trigger={
        <button className="text-button">
          <Info size={14} /> How we calculate this
        </button>
      }
    >
      <dl className="detail-list">
        <div>
          <dt>Monthly contribution</dt>
          <dd>{money(state.monthly)} lei, at month-end</dd>
        </div>
        <div>
          <dt>Time horizon</dt>
          <dd>{state.years} years</dd>
        </div>
        <div>
          <dt>Illustrative gross annual return</dt>
          <dd>{pct(product.grossReturn)}</dd>
        </div>
        <div>
          <dt>Annual fund fee</dt>
          <dd>{pct(product.fee)}</dd>
        </div>
        <div>
          <dt>Net annual return used</dt>
          <dd>{pct(product.grossReturn - product.fee)}</dd>
        </div>
        <div>
          <dt>Annual inflation assumed</dt>
          <dd>{pct(INFLATION)}</dd>
        </div>
      </dl>
      <p>
        Each month, the previous balance grows by the equivalent monthly net
        rate, then your contribution is added. Monthly rate = (1 + gross annual
        return − annual fee)^(1/12) − 1.
      </p>
      <p>
        “Today’s money” divides the projected balance by (1 + inflation)^years.
        The inflation rate is an illustrative constant, not a prediction.
      </p>
      <p>
        Returns are modeled as constant, while real markets fluctuate. Fees are
        simplified as a reduction in annual return. Taxes, transaction costs,
        and other charges are excluded. Actual returns can be negative.
      </p>
    </Dialog>
  );
}
export function Simulator({
  controls = true,
  productId,
}: {
  controls?: boolean;
  productId?: string;
}) {
  const { state, update } = useJourney();
  const [real, setReal] = useState(false);
  const product =
    products.find((p) => p.id === (productId ?? state.risk)) ?? products[1];
  const result = project(
    state.monthly,
    state.years,
    product.grossReturn,
    product.fee,
  );
  const conservative = project(state.monthly, state.years, -0.02, product.fee);
  const strong = project(
    state.monthly,
    state.years,
    product.grossReturn + 0.03,
    product.fee,
  );
  return (
    <section className="simulator" aria-labelledby="simulator-title">
      <div className="section-topline">
        <span className="eyebrow" id="simulator-title">
          <TrendingUp size={14} /> YOUR MONEY, OVER TIME
        </span>
        <span className="live-tag">
          <span /> Live simulation
        </span>
      </div>
      <div className="sim-tabs" role="group" aria-label="Projection display">
        <button
          aria-pressed={!real}
          className={!real ? "active" : ""}
          onClick={() => setReal(false)}
        >
          Projected value
        </button>
        <button
          aria-pressed={real}
          className={real ? "active" : ""}
          onClick={() => setReal(true)}
        >
          In today’s money <Info size={12} />
        </button>
      </div>
      <div className="projection-number" aria-live="polite">
        {money(real ? result.real : result.balance)}
        <span> lei</span>
      </div>
      <p className="projection-caption">
        {real ? "Illustrative purchasing power" : "Illustrative value"} after{" "}
        {state.years} years
      </p>
      <div
        className="chart-wrap"
        role="img"
        aria-label={`After ${state.years} years: ${money(result.contributed)} lei contributed, ${money(real ? result.real : result.balance)} lei illustrative ${real ? "purchasing power" : "projected value"}.`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={result.points}
            margin={{ top: 15, right: 8, left: -24, bottom: 0 }}
          >
            <defs>
              <linearGradient id="projection-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#e6d900" stopOpacity={0.28} />
                <stop offset="100%" stopColor="#e6d900" stopOpacity={0.015} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 4"
              vertical={false}
              stroke="#e8e8e1"
            />
            <XAxis
              dataKey="year"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#66705a", fontSize: 11 }}
              tickFormatter={(v) => `${v} yr`}
              minTickGap={25}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#66705a", fontSize: 10 }}
              tickFormatter={(v) =>
                v >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`
              }
            />
            <Tooltip
              contentStyle={{
                borderRadius: 12,
                border: "1px solid #e5e5dc",
                fontSize: 12,
              }}
              formatter={(value, name) => [
                `${money(Number(value))} lei`,
                name === "contributed"
                  ? "Your contributions"
                  : real
                    ? "Purchasing power"
                    : "Illustrative value",
              ]}
              labelFormatter={(v) => `Year ${v}`}
            />
            <Area
              dataKey={real ? "real" : "projected"}
              type="monotone"
              fill="url(#projection-fill)"
              stroke="#8b861a"
              strokeWidth={3}
              isAnimationActive={false}
            />
            <Line
              dataKey="contributed"
              type="linear"
              stroke="#aaa99d"
              strokeWidth={1.5}
              strokeDasharray="4 5"
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="chart-legend">
        <span>
          <i className="legend-projected" />
          {real ? "Purchasing power" : "Illustrative value"}
        </span>
        <span>
          <i className="legend-contributed" />
          Your contributions
        </span>
      </div>
      <div className="projection-breakdown">
        <div>
          <span>You put in</span>
          <strong>
            {money(result.contributed)} <small>lei</small>
          </strong>
        </div>
        <div>
          <span>Illustrative growth, after fees</span>
          <strong className="green">
            +{money(result.growth)} <small>lei</small>{" "}
            <ArrowUpRight size={15} />
          </strong>
        </div>
      </div>
      {controls && (
        <div className="sim-controls">
          <div className="control-title">
            <label>Monthly investment</label>
            <strong>
              {money(state.monthly)} <span>lei</span>
            </strong>
          </div>
          <Slider
            value={state.monthly}
            onChange={(monthly) => update({ monthly })}
          />
          <div className="slider-labels">
            <span>100 lei</span>
            <span>2,000 lei</span>
          </div>
          <div className="horizon-control">
            <span>
              <SlidersHorizontal size={14} /> Time horizon
            </span>
            <div className="horizon-options">
              {[3, 5, 10, 15, 20].map((years) => (
                <button
                  key={years}
                  className={state.years === years ? "selected" : ""}
                  aria-pressed={state.years === years}
                  onClick={() => update({ years })}
                >
                  {years}y
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      <div className="sim-assumptions">
        <span>
          {pct(product.grossReturn)} assumed return · {pct(product.fee)} annual
          fee
        </span>
        <Assumptions productId={product.id} />
      </div>
      <div className="scenario-range">
        <span>Markets can perform differently.</span>
        <p>
          At −2% gross/year: <strong>{money(conservative.balance)} lei</strong>.
          At {pct(product.grossReturn + 0.03)}:{" "}
          <strong>{money(strong.balance)} lei</strong>.
        </p>
      </div>
      <p className="fine-print">
        Examples, not bounds or promises. Actual returns may be lower or higher.
        Capital is at risk.
      </p>
    </section>
  );
}
export function MonthlyControl({ onContinue }: { onContinue: () => void }) {
  const { state, update } = useJourney();
  return (
    <div className="question-control">
      <div className="monthly-display">
        {money(state.monthly)}
        <span> lei / month</span>
      </div>
      <Slider
        value={state.monthly}
        onChange={(monthly) => update({ monthly })}
      />
      <div className="slider-labels">
        <span>100 lei</span>
        <span>2,000 lei</span>
      </div>
      <div className="amount-chips">
        {[250, 500, 1000].map((monthly) => (
          <button
            key={monthly}
            aria-pressed={state.monthly === monthly}
            className={monthly === state.monthly ? "selected" : ""}
            onClick={() => update({ monthly })}
          >
            {money(monthly)} lei
          </button>
        ))}
      </div>
      <Button onClick={onContinue}>
        That feels comfortable <ArrowUpRight size={17} />
      </Button>
      <p className="fine-print">
        Start with an amount that leaves room for everyday life.
      </p>
    </div>
  );
}
