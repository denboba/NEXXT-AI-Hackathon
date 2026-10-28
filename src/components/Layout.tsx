import { useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowUpRight,
  ArrowRight,
  Check,
  ShieldCheck,
  RotateCcw,
  X,
  Menu,
} from "lucide-react";
import { useState } from "react";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { useJourney } from "../lib/journey";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" className="brand" aria-label="Investment Coach home">
      <span className="brand-mark">
        <ArrowUpRight strokeWidth={3} />
      </span>
      <span className="brand-words">
        <strong>
          Raiffeisen<span className="concept">CONCEPT</span>
        </strong>
        {!compact && <span>AI Investment Coach</span>}
      </span>
    </Link>
  );
}
const steps = ["Discover", "Explore", "Continue", "Your investment"];
export function Header() {
  const { pathname } = useLocation();
  const { state } = useJourney();
  const [menu, setMenu] = useState(false);
  const stage =
    pathname === "/"
      ? 0
      : pathname === "/coach"
        ? 1
        : pathname.startsWith("/onboarding")
          ? 2
          : 3;
  useEffect(() => setMenu(false), [pathname]);
  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <Brand />
          {pathname === "/" ? (
            <nav className="desktop-nav" aria-label="Main navigation">
              <a href="#how-it-works">How it works</a>
              <a href="#your-questions">Your questions, answered</a>
              <Button asChild size="small">
                <Link to="/coach">
                  Let’s get started <ArrowUpRight size={16} />
                </Link>
              </Button>
            </nav>
          ) : (
            <nav className="journey-nav" aria-label="Your journey">
              {steps.map((step, i) => (
                <span
                  key={step}
                  className={
                    i === stage
                      ? "journey-step active"
                      : i < stage
                        ? "journey-step completed"
                        : "journey-step"
                  }
                  aria-current={i === stage ? "step" : undefined}
                >
                  <span className="step-number">
                    {i < stage ? <Check size={12} /> : `0${i + 1}`}
                  </span>
                  <span>{step}</span>
                  {i < 3 && <span className="step-line" />}
                </span>
              ))}
            </nav>
          )}
          <div className="header-actions">
            <span className="demo-badge">DEMO EXPERIENCE</span>
            {state.authenticated && (
              <span className="avatar" title={`Demo profile: ${state.name}`}>
                {state.name.charAt(0).toUpperCase()}
              </span>
            )}
            <button
              className="mobile-menu"
              aria-label={menu ? "Close menu" : "Open menu"}
              aria-expanded={menu}
              onClick={() => setMenu(!menu)}
            >
              {menu ? <X /> : <Menu />}
            </button>
          </div>
        </div>
        {menu && (
          <nav className="mobile-nav" aria-label="Mobile navigation">
            <Link to="/">Home</Link>
            <Link to="/coach">Investment coach</Link>
            {state.authenticated && (
              <Link to="/account/invest">Explore funds</Link>
            )}
            <a href="/#how-it-works">How it works</a>
          </nav>
        )}
      </header>
      {pathname !== "/" && (
        <div className="mobile-progress">
          Step {stage + 1} of 4 <span>— {steps[stage]}</span>
        </div>
      )}
    </>
  );
}
export function Footer() {
  const { reset } = useJourney();
  const navigate = useNavigate();
  return (
    <footer className="footer">
      <div>
        <Brand compact />
        <p>
          An independent concept prototype. Not an official Raiffeisen service.
        </p>
      </div>
      <div className="footer-links">
        <Dialog
          title="About this experience"
          description="A safe place to explore the ideas, without committing to an investment."
          trigger={<button>About this demo</button>}
        >
          <p>
            This prototype uses fictional funds and simulated account access. It
            does not create a bank account, verify identity, move money, or
            execute an investment.
          </p>
          <p>
            Your simulation and conversation are saved in this browser.
            Free-text questions may be sent to Amazon Bedrock when the live
            coach is available. Do not enter bank credentials or personal
            financial details.
          </p>
          <p>
            Forecasts use simplified assumptions and do not predict future
            performance. Capital is at risk.
          </p>
        </Dialog>
        <Dialog
          title="Start fresh?"
          description="This clears the conversation, simulation, and demo profile stored in this browser."
          trigger={
            <button>
              <RotateCcw size={13} /> Reset demo
            </button>
          }
        >
          <Button
            onClick={() => {
              reset();
              navigate("/");
              window.location.reload();
            }}
          >
            Reset my demo <ArrowRight size={16} />
          </Button>
        </Dialog>
      </div>
    </footer>
  );
}
export function Disclosure({ short = false }: { short?: boolean }) {
  return (
    <div className="disclosure">
      <ShieldCheck size={16} />
      <p>
        {short
          ? "Educational simulation. No real account or investment is created."
          : "For illustration, not a personal recommendation. Investment values can fall as well as rise. You may get back less than you invest."}
      </p>
    </div>
  );
}
export function PageIntro({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-intro">
      <div className="eyebrow">
        <span />
        {eyebrow}
      </div>
      <h1>{title}</h1>
      {children && <p>{children}</p>}
    </div>
  );
}
