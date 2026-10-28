import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronLeft,
  Fingerprint,
  Landmark,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Sprout,
  UserRound,
} from "lucide-react";
import { Button } from "./components/ui/button";
import { Disclosure, PageIntro } from "./components/Layout";
import { useJourney } from "./lib/journey";
import { money } from "./lib/finance";

export function JourneySummary() {
  const { state } = useJourney();
  return (
    <aside className="journey-summary">
      <span className="summary-sprout">
        <Sprout size={32} strokeWidth={1.5} />
      </span>
      <div className="eyebrow">YOUR NEXT CHAPTER</div>
      <h2>
        A small habit.
        <br />A future with
        <br />
        <span>more possibilities.</span>
      </h2>
      <div className="saved-simulation">
        <span>
          <Check size={15} /> YOUR SIMULATION IS SAVED
        </span>
        <div>
          <strong>
            {money(state.monthly)} <small>lei</small>
          </strong>
          <span>every month</span>
        </div>
        <div>
          <strong>
            {state.years} <small>years</small>
          </strong>
          <span>your time horizon</span>
        </div>
        <p>Your conversation and choices come with you.</p>
      </div>
      <span className="summary-bottom">
        <ShieldCheck size={16} /> Demo only. No money will move.
      </span>
    </aside>
  );
}
export default function Onboarding() {
  const { state } = useJourney();
  if (state.authenticated) return <Navigate to="/account/invest" replace />;
  return (
    <main className="container flow-page">
      <Link className="back-link" to="/coach">
        <ChevronLeft size={16} /> Back to my coach
      </Link>
      <div className="onboarding-grid">
        <div>
          <PageIntro
            eyebrow="KEEP THE MOMENTUM"
            title="Your next step, made simple."
          >
            You’ve done the exploring. Now choose how you’d like to continue.
            We’ll keep everything right where you left it.
          </PageIntro>
          <div className="onboarding-options">
            <Link to="/onboarding/new-account" className="onboarding-option">
              <span className="option-icon">
                <UserRound size={24} />
              </span>
              <div>
                <h2>I’m new here</h2>
                <p>Walk through a simple demo account opening.</p>
                <span>
                  Open a demo account <ArrowRight size={16} />
                </span>
              </div>
              <ArrowUpRight size={22} />
            </Link>
            <Link to="/onboarding/login" className="onboarding-option">
              <span className="option-icon neutral">
                <Landmark size={24} />
              </span>
              <div>
                <h2>I’m already a customer</h2>
                <p>Try the demo login and pick up your journey.</p>
                <span>
                  Continue with demo login <ArrowRight size={16} />
                </span>
              </div>
              <ArrowUpRight size={22} />
            </Link>
          </div>
          <Disclosure short />
          <p className="fine-print">
            No real banking credentials, identity documents, or personal details
            are needed.
          </p>
        </div>
        <JourneySummary />
      </div>
    </main>
  );
}
export function AccountForm() {
  const { pathname } = useLocation();
  const login = pathname.endsWith("login");
  const { state, update } = useJourney();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(state.name);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState("");
  if (state.authenticated) return <Navigate to="/account/invest" replace />;
  function complete() {
    if (!name.trim()) {
      setError("Please add a demo display name. A nickname is fine.");
      return;
    }
    if (!acknowledged) {
      setError("Please confirm that you understand this is a demo.");
      return;
    }
    update({ authenticated: true, name: name.trim().slice(0, 30) });
    navigate("/account/invest");
  }
  return (
    <main className="container flow-page">
      <Link className="back-link" to="/onboarding">
        <ChevronLeft size={16} /> Choose another way
      </Link>
      <div className="onboarding-grid">
        <section className="account-form">
          <PageIntro
            eyebrow={
              login
                ? "WELCOME BACK, IN DEMO MODE"
                : "LET’S MAKE A SMALL BEGINNING"
            }
            title={
              login
                ? "Good to see you again."
                : step === 0
                  ? "Meet your demo account."
                  : "One clear confirmation."
            }
          >
            {login
              ? "Continue as an example customer. Your real bank login stays out of this experience."
              : step === 0
                ? "A short walkthrough of what getting started could feel like. Use a nickname; no personal information needed."
                : "In a real journey, a regulated onboarding process would verify your identity and complete required checks."}
          </PageIntro>
          {!login && (
            <div className="form-steps">
              <span className={step === 0 ? "active" : "done"}>
                1 <span>Demo profile</span>
              </span>
              <i />
              <span className={step === 1 ? "active" : ""}>
                2 <span>Review & continue</span>
              </span>
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!login && step === 0) {
                if (name.trim()) {
                  setStep(1);
                  setError("");
                } else setError("Please add a demo display name.");
              } else complete();
            }}
          >
            <div className="form-card">
              {login || step === 0 ? (
                <>
                  <span className="form-card-icon">
                    {login ? (
                      <Fingerprint size={30} />
                    ) : (
                      <UserRound size={28} />
                    )}
                  </span>
                  <h2>
                    {login
                      ? "Demo customer access"
                      : "What should we call you?"}
                  </h2>
                  <p>
                    {login
                      ? "No password. No connection to a real bank account."
                      : "A first name or a nickname is all we need for this demo."}
                  </p>
                  <label className="field-label" htmlFor="display-name">
                    Demo display name
                  </label>
                  <input
                    id="display-name"
                    className="text-input"
                    autoComplete="off"
                    value={name}
                    maxLength={30}
                    onChange={(e) => setName(e.target.value)}
                    aria-describedby={error ? "form-error" : undefined}
                  />
                  <div className="identity-note">
                    <LockKeyhole size={16} />
                    <span>
                      Stored only in this browser. Never used to create a real
                      account.
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <span className="form-card-icon">
                    <ShieldCheck size={30} />
                  </span>
                  <h2>Here’s what happens in a real journey</h2>
                  <div className="illustrative-checks">
                    <p>
                      <Mail size={18} />
                      <span>
                        Verify contact details
                        <small>Illustrated only — no email is sent.</small>
                      </span>
                    </p>
                    <p>
                      <Fingerprint size={18} />
                      <span>
                        Complete identity checks
                        <small>Not performed in this prototype.</small>
                      </span>
                    </p>
                    <p>
                      <ShieldCheck size={18} />
                      <span>
                        Review terms and eligibility
                        <small>Real product checks would be required.</small>
                      </span>
                    </p>
                  </div>
                </>
              )}
              {(login || step === 1) && (
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(e) => setAcknowledged(e.target.checked)}
                  />
                  <span>
                    I understand this is a demo. No real account is created or
                    verified.
                  </span>
                </label>
              )}
              {error && (
                <p className="form-error" id="form-error" role="alert">
                  {error}
                </p>
              )}
              <Button className="full-width" type="submit">
                {login
                  ? "Continue as demo customer"
                  : step === 0
                    ? "Continue to review"
                    : "Create my demo profile"}
                <ArrowRight size={17} />
              </Button>
              {step === 1 && !login && (
                <button
                  className="text-button form-back"
                  type="button"
                  onClick={() => setStep(0)}
                >
                  <ArrowLeft size={14} /> Edit my display name
                </button>
              )}
            </div>
          </form>
          <Disclosure short />
        </section>
        <JourneySummary />
      </div>
    </main>
  );
}
