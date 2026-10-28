import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleHelp,
  Coins,
  Download,
  Info,
  Leaf,
  LockKeyhole,
  ShieldCheck,
  Sprout,
  TrendingUp,
} from "lucide-react";
import { Button } from "./components/ui/button";
import { Dialog } from "./components/ui/dialog";
import { Disclosure, PageIntro } from "./components/Layout";
import { Assumptions, Simulator } from "./components/Simulator";
import { useJourney } from "./lib/journey";
import { eligibleProducts, money, pct, products, project } from "./lib/finance";
import type { Product } from "./lib/finance";

function RiskScale({ value }: { value: number }) {
  return (
    <div className="risk-scale">
      <span>Risk level</span>
      <div aria-label={`Illustrative risk ${value} out of 7`} role="img">
        {Array.from({ length: 7 }, (_, i) => (
          <i key={i} className={i < value ? "filled" : ""} />
        ))}
      </div>
      <strong>
        {value}
        <small>/7</small>
      </strong>
    </div>
  );
}
function ProductDetails({ product }: { product: Product }) {
  return (
    <Dialog
      title={product.name}
      description="An example fund created for this prototype, not a real investment product."
      trigger={
        <button className="text-button">
          Explore fund details <ArrowUpRight size={14} />
        </button>
      }
    >
      <p>{product.description}</p>
      <dl className="detail-list">
        <div>
          <dt>Illustrative allocation</dt>
          <dd>{product.allocation}</dd>
        </div>
        <div>
          <dt>Minimum example horizon</dt>
          <dd>{product.minimumYears} years</dd>
        </div>
        <div>
          <dt>Gross annual return assumption</dt>
          <dd>{pct(product.grossReturn)}</dd>
        </div>
        <div>
          <dt>Annual fee assumption</dt>
          <dd>{pct(product.fee)}</dd>
        </div>
        <div>
          <dt>Withdrawals</dt>
          <dd>3–5 business days, illustrative</dd>
        </div>
      </dl>
      <RiskScale value={product.riskScore} />
      <p>
        Neither the risk score nor the example horizon guarantees safety or an
        outcome. Both bonds and equities can fall in value. Withdrawal timing,
        charges, eligibility, and risks would be set out in real product
        documents.
      </p>
      <p>
        The example risk score is not an official regulatory rating. No real
        product documents or suitability checks are provided by this demo.
      </p>
    </Dialog>
  );
}
export default function Invest() {
  const { state, update } = useJourney();
  const [filter, setFilter] = useState("all");
  const eligible = eligibleProducts(state.years);
  const selected =
    eligible.find((p) => p.id === state.productId) ?? eligible[0];
  useEffect(() => {
    if (selected.id !== state.productId) update({ productId: selected.id });
  }, [selected.id, state.productId, update]);
  if (!state.authenticated) return <Navigate to="/onboarding" replace />;
  const filtered =
    filter === "all" ? products : products.filter((p) => p.id === filter);
  return (
    <main className="container flow-page">
      <Link className="back-link" to="/coach">
        <ChevronLeft size={16} /> Revisit my conversation
      </Link>
      <div className="invest-heading">
        <PageIntro
          eyebrow={`A NEXT STEP FOR ${state.name.toUpperCase()}`}
          title="Find your kind of starting point."
        >
          Different funds, different journeys. Explore these fictional examples
          and see what fits the scenario you’ve created.
        </PageIntro>
        <span className="profile-saved">
          <Check size={15} /> Your journey came with you
        </span>
      </div>
      <div className="investment-summary-bar">
        <div>
          <span className="icon-tile">
            <Coins size={19} />
          </span>
          <span>
            Your monthly habit<strong>{money(state.monthly)} lei</strong>
          </span>
        </div>
        <div>
          <span className="icon-tile">
            <CalendarDays size={19} />
          </span>
          <span>
            Your horizon<strong>{state.years} years</strong>
          </span>
        </div>
        <div>
          <span className="icon-tile">
            <Leaf size={19} />
          </span>
          <span>
            Your comfort with risk
            <strong>
              {state.risk === "steady"
                ? "A steadier ride"
                : state.risk === "balanced"
                  ? "Some ups and downs"
                  : "A longer view"}
            </strong>
          </span>
        </div>
        <Link to="/coach">
          Adjust my scenario <ArrowUpRight size={15} />
        </Link>
      </div>
      <div className="product-filter-row">
        <div
          className="filter-tabs"
          role="group"
          aria-label="Filter example funds"
        >
          {[
            { id: "all", label: "All example funds" },
            { id: "steady", label: "Bond-focused" },
            { id: "balanced", label: "Multi-asset" },
            { id: "growth", label: "Equity-focused" },
          ].map((f) => (
            <button
              key={f.id}
              aria-pressed={filter === f.id}
              className={filter === f.id ? "active" : ""}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="fine-print">
          <Info size={13} /> Illustrative products, not recommendations
        </span>
      </div>
      <div className={`product-grid ${filtered.length === 1 ? "single" : ""}`}>
        {filtered.map((product) => {
          const available = product.minimumYears <= state.years;
          const isSelected = selected.id === product.id;
          return (
            <article
              key={product.id}
              className={`product-card ${isSelected ? "selected" : ""} ${!available ? "ineligible" : ""}`}
            >
              <div className="product-card-top">
                <span
                  className="fund-illustration"
                  style={{
                    background: `conic-gradient(${product.color} ${(product.riskScore / 7) * 100}%, #edeee7 0)`,
                  }}
                >
                  <Sprout size={22} />
                </span>
                {isSelected ? (
                  <span className="selected-tag">
                    <Check size={12} /> Your selection
                  </span>
                ) : (
                  <span className="product-horizon">
                    {product.minimumYears}+ years
                  </span>
                )}
              </div>
              <div className="eyebrow">{product.type}</div>
              <h2>{product.name}</h2>
              <p className="product-description">{product.description}</p>
              <span className="allocation">{product.allocation}</span>
              <RiskScale value={product.riskScore} />
              <div className="product-numbers">
                <div>
                  <span>Gross return assumption</span>
                  <strong>
                    {pct(product.grossReturn)}
                    <small> / year</small>
                  </strong>
                </div>
                <div>
                  <span>Annual fee</span>
                  <strong>{pct(product.fee)}</strong>
                </div>
              </div>
              <p className="product-liquidity">
                <ArrowDownToLine size={14} /> 3–5 business days to withdraw*
              </p>
              <ProductDetails product={product} />
              <Button
                variant={isSelected ? "dark" : "secondary"}
                className="full-width"
                disabled={!available}
                onClick={() => update({ productId: product.id })}
              >
                {!available ? (
                  `Requires a ${product.minimumYears}+ year horizon`
                ) : isSelected ? (
                  <>
                    <Check size={16} /> Selected for my demo
                  </>
                ) : (
                  <>
                    Explore this starting point <ArrowRight size={16} />
                  </>
                )}
              </Button>
              {!available && (
                <Link to="/coach" className="horizon-adjust">
                  Adjust your time horizon <ArrowUpRight size={12} />
                </Link>
              )}
            </article>
          );
        })}
      </div>
      <div className="investment-continue">
        <div>
          <span className="icon-tile">
            <ShieldCheck size={22} />
          </span>
          <span>
            <strong>Just exploring? You’re in the right place.</strong>
            <small>
              Nothing is invested. The next step is a review of your demo plan.
            </small>
          </span>
        </div>
        <Button asChild>
          <Link to="/account/plan">
            Review my {selected.name} plan <ArrowRight size={17} />
          </Link>
        </Button>
      </div>
      <p className="fine-print product-disclaimer">
        *Withdrawal conditions are fictional examples. Real products may have
        restrictions, fees, and different settlement times. Investment values
        can fall. Keep an emergency cash buffer separate.
      </p>
      <Disclosure />
    </main>
  );
}
export function Plan() {
  const { state, update } = useJourney();
  const navigate = useNavigate();
  const [understood, setUnderstood] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const product = products.find((p) => p.id === state.productId)!;
  if (!state.authenticated) return <Navigate to="/onboarding" replace />;
  if (product.minimumYears > state.years)
    return <Navigate to="/account/invest" replace />;
  if (state.activated) return <Navigate to="/account/success" replace />;
  async function activate() {
    if (!understood) {
      setError(
        "Please confirm that you understand the risks and the demo nature of this plan.",
      );
      return;
    }
    setSubmitting(true);
    await new Promise((resolve) => setTimeout(resolve, 500));
    update({ activated: true, activatedAt: new Date().toISOString() });
    navigate("/account/success");
  }
  return (
    <main className="container flow-page">
      <Link className="back-link" to="/account/invest">
        <ChevronLeft size={16} /> Back to example funds
      </Link>
      <PageIntro
        eyebrow="A LITTLE HABIT, THOUGHTFULLY CHOSEN"
        title="Your plan. At a glance."
      >
        Take a moment to check the details. This is a simulation; no money moves
        when you continue.
      </PageIntro>
      <div className="plan-grid">
        <section className="plan-review">
          <div className="plan-fund-header">
            <span className="icon-tile yellow">
              <Sprout size={24} />
            </span>
            <div>
              <span className="eyebrow">YOUR EXAMPLE FUND</span>
              <h2>{product.name}</h2>
              <p>{product.allocation}</p>
            </div>
            <Link to="/account/invest">
              Change <ArrowUpRight size={14} />
            </Link>
          </div>
          <dl className="plan-details">
            <div>
              <dt>Monthly contribution</dt>
              <dd>
                {money(state.monthly)} <small>lei</small>
              </dd>
            </div>
            <div>
              <dt>Your time horizon</dt>
              <dd>{state.years} years</dd>
            </div>
            <div>
              <dt>Gross annual return assumption</dt>
              <dd>{pct(product.grossReturn)}</dd>
            </div>
            <div>
              <dt>Annual fee assumption</dt>
              <dd>{pct(product.fee)}</dd>
            </div>
          </dl>
          <div className="plan-schedule">
            <label htmlFor="plan-day">
              <CalendarDays size={18} /> Make it a monthly habit
            </label>
            <p>
              Choose an illustrative contribution day. No payment is scheduled.
            </p>
            <select
              className="text-input"
              id="plan-day"
              value={state.planDay}
              onChange={(e) => update({ planDay: Number(e.target.value) })}
            >
              <option value="1">1st of every month</option>
              <option value="15">15th of every month</option>
              <option value="28">28th of every month</option>
            </select>
          </div>
          <div className="risk-notice">
            <ShieldCheck size={21} />
            <div>
              <strong>A clear-eyed start is a good start.</strong>
              <p>
                Returns aren’t guaranteed. Your investment could fall in value,
                and you may get back less than you put in. These fictional funds
                are not personal recommendations.
              </p>
            </div>
          </div>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={understood}
              onChange={(e) => {
                setUnderstood(e.target.checked);
                setError("");
              }}
            />
            <span>
              I understand that values can fall and that this demo does not
              create a real account, schedule a payment, or execute an
              investment.
            </span>
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <Button
            className="full-width"
            disabled={submitting}
            onClick={activate}
          >
            {submitting
              ? "Preparing your demo plan…"
              : "Simulate activating my monthly plan"}{" "}
            {!submitting && <ArrowRight size={18} />}
          </Button>
          <p className="activation-note">
            <LockKeyhole size={12} /> Simulation only · No money will move
          </p>
        </section>
        <aside>
          <Simulator controls={false} productId={product.id} />
          <div className="plan-question">
            <CircleHelp size={18} />
            <span>
              Something you’d like to understand?
              <Link to="/coach">
                Ask your coach <ArrowRight size={14} />
              </Link>
            </span>
          </div>
        </aside>
      </div>
    </main>
  );
}
export function Success() {
  const { state, update } = useJourney();
  const [downloaded, setDownloaded] = useState(false);
  const product = products.find((p) => p.id === state.productId)!;
  if (!state.authenticated) return <Navigate to="/onboarding" replace />;
  if (!state.activated) return <Navigate to="/account/plan" replace />;
  const projection = project(
    state.monthly,
    state.years,
    product.grossReturn,
    product.fee,
  );
  function download() {
    const content = `INVESTMENT COACH — DEMO PLAN\n\nThis is a simulation. No account, payment, or investment has been created.\n\nExample fund: ${product.name}\nMonthly contribution: ${money(state.monthly)} lei\nIllustrative contribution day: ${state.planDay}\nTime horizon: ${state.years} years\nGross annual return assumption: ${pct(product.grossReturn)}\nAnnual fee assumption: ${pct(product.fee)}\nInflation assumption: 5.5%\nTotal contributions: ${money(projection.contributed)} lei\nIllustrative future value after fees: ${money(projection.balance)} lei\nIllustrative buying power in today's money: ${money(projection.real)} lei\n\nConstant assumed returns; monthly end-of-period contributions. Fees approximated as an annual return reduction. Excludes taxes and other charges. Returns are not guaranteed. Capital is at risk. Fictional fund, not a personal recommendation.\n`;
    const url = URL.createObjectURL(
      new Blob([content], { type: "text/plain" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "my-demo-investment-plan.txt";
    a.click();
    URL.revokeObjectURL(url);
    setDownloaded(true);
  }
  return (
    <main className="container success-page">
      <div className="success-heading">
        <span className="success-icon">
          <Check size={36} strokeWidth={2} />
        </span>
        <div className="eyebrow">A SMALL STEP. A MEANINGFUL BEGINNING.</div>
        <h1>Here’s to your future, {state.name}.</h1>
        <p>
          Your demo monthly plan is ready. You’ve turned a “what if”
          <br className="desktop-break" /> into a starting point you understand.
        </p>
        <span className="success-demo">
          <ShieldCheck size={14} /> Simulated activation · No real investment
          executed
        </span>
      </div>
      <div className="success-plan">
        <div className="success-plan-head">
          <div>
            <span className="eyebrow">YOUR MONTHLY DEMO PLAN</span>
            <h2>{product.name}</h2>
          </div>
          <span className="demo-active">
            <i className="green-dot" /> Demo plan active
          </span>
        </div>
        <div className="success-metrics">
          <div>
            <span>Monthly contribution</span>
            <strong>
              {money(state.monthly)}
              <small> lei</small>
            </strong>
          </div>
          <div>
            <span>Time to grow</span>
            <strong>
              {state.years}
              <small> years</small>
            </strong>
          </div>
          <div>
            <span>Illustrative contribution day</span>
            <strong>
              {state.planDay}
              <small> each month</small>
            </strong>
          </div>
        </div>
        <div className="success-plan-bottom">
          <span>
            <CalendarDays size={16} /> A habit for the future you’re imagining.
          </span>
          <Button variant="ghost" size="small" onClick={download}>
            <Download size={15} />
            {downloaded ? "Download again" : "Save my demo plan"}
          </Button>
        </div>
        {downloaded && (
          <p role="status" className="download-note">
            <CircleCheck size={14} /> Your demo plan is ready to save.
          </p>
        )}
      </div>
      <div className="next-heading">
        <h2>Keep the good habit going.</h2>
        <p>A few small ideas for the road ahead.</p>
      </div>
      <div className="next-cards">
        <article>
          <span className="next-number">01</span>
          <span className="icon-tile">
            <ShieldCheck size={22} />
          </span>
          <h3>Keep a cash cushion</h3>
          <p>
            Emergency savings help you leave your investment alone when life
            surprises you.
          </p>
          <Dialog
            title="A buffer for everyday life"
            description="Cash savings and investments serve different needs."
            trigger={
              <button className="text-link">
                Why a buffer matters <ArrowUpRight size={15} />
              </button>
            }
          >
            <p>
              Accessible emergency savings can help cover unexpected bills
              without selling investments during a market fall. The right amount
              depends on your circumstances, expenses, and income stability.
            </p>
            <p>
              This is general education, not a recommendation for a specific
              amount.
            </p>
          </Dialog>
        </article>
        <article>
          <span className="next-number">02</span>
          <span className="icon-tile">
            <TrendingUp size={22} />
          </span>
          <h3>Think in years, not days</h3>
          <p>
            Markets move. Revisit your horizon and risk comfort when your goals
            change.
          </p>
          <Link className="text-link" to="/coach">
            Revisit the bigger picture <ArrowUpRight size={15} />
          </Link>
        </article>
        <article>
          <span className="next-number">03</span>
          <span className="icon-tile">
            <Sprout size={22} />
          </span>
          <h3>Stay curious</h3>
          <p>
            Ask questions along the way. Understanding is a habit worth
            building, too.
          </p>
          <Link className="text-link" to="/coach">
            Have a chat with your coach <ArrowUpRight size={15} />
          </Link>
        </article>
      </div>
      <div className="success-bottom">
        <Assumptions productId={product.id} />
        <Link
          className="text-button"
          to="/account/invest"
          onClick={() => update({ activated: false, activatedAt: null })}
        >
          Explore another demo plan <ChevronRight size={14} />
        </Link>
      </div>
      <Disclosure />
    </main>
  );
}
