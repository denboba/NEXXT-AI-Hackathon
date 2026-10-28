import { Component, Suspense, lazy, useEffect } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { Link, Route, Routes, useLocation } from "react-router-dom";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { Header, Footer, PageIntro } from "./components/Layout";
import { Button } from "./components/ui/button";
import { useJourney } from "./lib/journey";
import Landing from "./Landing";
const Coach = lazy(() => import("./Coach"));
const Onboarding = lazy(() => import("./Onboarding"));
const AccountForm = lazy(() =>
  import("./Onboarding").then((m) => ({ default: m.AccountForm })),
);
const Invest = lazy(() => import("./Invest"));
const Plan = lazy(() => import("./Invest").then((m) => ({ default: m.Plan })));
const Success = lazy(() =>
  import("./Invest").then((m) => ({ default: m.Success })),
);
class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(_error: Error, _info: ErrorInfo) {
    /* Avoid logging conversation or personal data. */
  }
  render() {
    return this.state.failed ? (
      <main className="container error-page">
        <ShieldCheck size={36} />
        <PageIntro
          eyebrow="LET’S TAKE A BREATH"
          title="This page needs a fresh start."
        >
          Your saved demo journey is still in this browser. Reload to pick it
          back up.
        </PageIntro>
        <Button onClick={() => window.location.reload()}>
          Reload the experience <ArrowRight size={18} />
        </Button>
      </main>
    ) : (
      this.props.children
    );
  }
}
export default function App() {
  const { pathname } = useLocation();
  const { storageAvailable } = useJourney();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    document.title = `${pathname === "/" ? "AI Investment Coach" : pathname === "/coach" ? "Your investment coach" : pathname.startsWith("/onboarding") ? "Your next step" : "Your demo investment"} · Raiffeisen Concept`;
  }, [pathname]);
  return (
    <ErrorBoundary>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <Header />
      {!storageAvailable && (
        <div className="storage-note" role="status">
          Browser storage is unavailable. Your progress will last for this
          visit, but may be lost on refresh.
        </div>
      )}
      <div id="main-content" tabIndex={-1}>
        <Suspense
          fallback={
            <main className="container route-loading" role="status">
              <span className="loading-dot" /> Getting your next step ready…
            </main>
          }
        >
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/coach" element={<Coach />} />
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/onboarding/new-account" element={<AccountForm />} />
            <Route path="/onboarding/login" element={<AccountForm />} />
            <Route path="/account/invest" element={<Invest />} />
            <Route path="/account/plan" element={<Plan />} />
            <Route path="/account/success" element={<Success />} />
            <Route
              path="*"
              element={
                <main className="container error-page">
                  <PageIntro
                    eyebrow="A SMALL DETOUR"
                    title="Let’s get you back on track."
                  >
                    This page isn’t part of your journey. Your progress is still
                    saved.
                  </PageIntro>
                  <Button asChild>
                    <Link to="/coach">
                      Back to my coach <ArrowRight size={18} />
                    </Link>
                  </Button>
                </main>
              }
            />
          </Routes>
        </Suspense>
      </div>
      <Footer />
    </ErrorBoundary>
  );
}
