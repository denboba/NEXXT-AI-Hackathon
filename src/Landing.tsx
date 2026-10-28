import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  Clock3,
  Coins,
  HeartHandshake,
  MessageCircle,
  ShieldCheck,
  Sprout,
  TrendingDown,
  TrendingUp,
  Wallet,
  CircleHelp,
} from "lucide-react";
import { Button } from "./components/ui/button";
import { Disclosure } from "./components/Layout";
import { purchasingPower, money } from "./lib/finance";
export default function Landing() {
  const [years, setYears] = useState(5);
  const power = purchasingPower(10000, years);
  return (
    <main>
      <section className="hero container">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="yellow-dot" /> A LITTLE CLARITY. A BIG FIRST STEP.
          </div>
          <h1>
            Turn idle cash
            <br />
            into a{" "}
            <span className="underline-accent">
              first
              <br className="desktop-break" /> investment.
            </span>
          </h1>
          <p className="hero-description">
            Your money should work for your goals. Explore what a monthly
            investment could look like, with a friendly coach that makes it all
            make sense.
          </p>
          <div className="hero-actions">
            <Button asChild>
              <Link to="/coach">
                Start my 2-minute investment journey <ArrowUpRight size={18} />
              </Link>
            </Button>
            <a className="how-link" href="#how-it-works">
              See how it works <ArrowDown size={15} />
            </a>
          </div>
          <div className="hero-reassurance">
            <span>
              <Check size={14} /> No sign-up to explore
            </span>
            <span>
              <Check size={14} /> At your own pace
            </span>
          </div>
        </div>
        <div className="hero-art">
          <div className="art-grid" />
          <div className="art-orbit orbit-one" />
          <div className="art-orbit orbit-two" />
          <div className="art-label">
            <span className="mini-spark">✳</span> SMALL STEPS. REAL
            POSSIBILITIES.
          </div>
          <div className="growth-card">
            <div className="growth-card-heading">
              <span className="icon-tile">
                <TrendingUp size={20} />
              </span>
              <span>
                Your future starts with
                <br />
                <strong>500 lei a month.</strong>
              </span>
              <span className="card-ellipsis">···</span>
            </div>
            <div className="growth-value">
              A little today.
              <br />
              <span>More possibilities tomorrow.</span>
            </div>
            <div className="growth-visual">
              <svg viewBox="0 0 380 140" aria-hidden="true">
                <defs>
                  <linearGradient id="hero-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop stopColor="#eee22d" stopOpacity=".5" />
                    <stop offset="1" stopColor="#eee22d" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path
                  d="M0 130 C40 123 45 113 75 112 S110 91 138 94 S177 73 200 75 S240 47 260 49 S308 20 330 27 S358 7 380 7 L380 140 L0 140Z"
                  fill="url(#hero-fill)"
                />
                <path
                  d="M0 130 C40 123 45 113 75 112 S110 91 138 94 S177 73 200 75 S240 47 260 49 S308 20 330 27 S358 7 380 7"
                  stroke="#84851b"
                  strokeWidth="3"
                  fill="none"
                />
                <circle
                  cx="377"
                  cy="8"
                  r="5"
                  fill="#84851b"
                  stroke="white"
                  strokeWidth="3"
                />
              </svg>
              <div className="hero-chart-labels">
                <span>Your first step</span>
                <span>Your future</span>
              </div>
            </div>
            <div className="growth-card-footer">
              <span>
                <span className="green-dot" /> A habit worth building
              </span>
              <span>Illustration only</span>
            </div>
          </div>
          <div className="floating-coach">
            <span className="coach-orb">
              <Sprout size={22} />
            </span>
            <span>
              “Let’s find a starting point
              <br />
              <strong>that feels right for you.”</strong>
            </span>
            <span className="bubble-dots">•••</span>
          </div>
          <div className="art-caption">
            <ShieldCheck size={13} /> Your goals. Your pace. Your decision.
          </div>
        </div>
      </section>
      <div className="trust-strip">
        <div className="container">
          <span>
            <ShieldCheck size={18} /> Built around understanding
          </span>
          <span>
            <MessageCircle size={18} /> Plain language, always
          </span>
          <span>
            <HeartHandshake size={18} /> Explore without commitment
          </span>
          <span>
            <Clock3 size={18} /> A two-minute first step
          </span>
        </div>
      </div>
      <section className="inflation-section container" id="inflation">
        <div className="section-copy">
          <div className="eyebrow">
            <span /> THE COST OF STANDING STILL
          </div>
          <h2>
            Same balance.
            <br />
            <span className="muted-heading">Less buying power.</span>
          </h2>
          <p>
            Money sitting still doesn’t stand still in value. When prices rise,
            the same savings can buy less over time.
          </p>
          <Link className="text-link" to="/coach">
            Let’s put the numbers in perspective <ArrowRight size={16} />
          </Link>
        </div>
        <div className="inflation-card">
          <div className="inflation-top">
            <span>
              <Coins size={18} /> If you saved 10,000 lei today
            </span>
            <div
              className="segmented"
              role="group"
              aria-label="Inflation time horizon"
            >
              {[1, 3, 5, 10].map((y) => (
                <button
                  key={y}
                  className={years === y ? "active" : ""}
                  aria-pressed={years === y}
                  onClick={() => setYears(y)}
                >
                  {y}y
                </button>
              ))}
            </div>
          </div>
          <div className="inflation-stats">
            <div>
              <span>Today’s balance</span>
              <strong>
                10,000 <small>lei</small>
              </strong>
            </div>
            <ArrowRight className="inflation-arrow" size={24} />
            <div>
              <span>
                Buying power in {years} {years === 1 ? "year" : "years"}
              </span>
              <strong>
                {money(power)} <small>lei</small>
              </strong>
            </div>
            <span className="loss-tag">
              <TrendingDown size={14} /> −
              {Math.round((1 - power / 10000) * 100)}%
            </span>
          </div>
          <div className="purchasing-bars">
            {Array.from({ length: years + 1 }, (_, y) => (
              <div key={y} className="purchasing-column">
                <span>
                  {y === 0 || y === years
                    ? money(purchasingPower(10000, y))
                    : ""}
                </span>
                <div
                  style={{ height: `${purchasingPower(10000, y) / 110}%` }}
                  className={y === years ? "last" : ""}
                />
                <label>{y === 0 ? "Today" : `Year ${y}`}</label>
              </div>
            ))}
          </div>
          <div className="inflation-footnote">
            <InfoIcon />
            <p>
              Assumes 5.5% annual inflation. Purchasing power = 10,000 / 1.055^
              {years}. Your balance stays the same; this shows estimated buying
              power. Illustration only.
            </p>
          </div>
        </div>
      </section>
      <section className="how-section" id="how-it-works">
        <div className="container">
          <div className="center-heading">
            <div className="eyebrow">
              <span /> FROM “WHAT IF” TO “I GET IT”
            </div>
            <h2>A clearer path to your first investment.</h2>
            <p>A conversation first. A decision when you’re ready.</p>
          </div>
          <div className="journey-cards">
            {[
              {
                icon: CircleHelp,
                title: "A question worth asking",
                text: "Discover what your idle cash could be doing.",
                tag: "01 · DISCOVER",
              },
              {
                icon: MessageCircle,
                title: "Let’s talk about you",
                text: "Three quick questions. Clear, personal explanations.",
                tag: "02 · EXPLORE",
              },
              {
                icon: Wallet,
                title: "Pick up where you left off",
                text: "Open a demo account or log in. Your choices come with you.",
                tag: "03 · CONTINUE",
              },
              {
                icon: Sprout,
                title: "Make a small beginning",
                text: "Explore example funds and simulate your monthly plan.",
                tag: "04 · YOUR INVESTMENT",
              },
            ].map(({ icon: Icon, title, text, tag }, i) => (
              <article className="journey-card" key={tag}>
                <div className="journey-card-top">
                  <span className={`journey-icon tone-${i}`}>
                    <Icon size={23} />
                  </span>
                  <ArrowRight size={17} />
                </div>
                <span className="eyebrow">{tag}</span>
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section className="concerns container" id="your-questions">
        <div className="section-heading-row">
          <div>
            <div className="eyebrow">
              <span /> YOU’RE NOT THE ONLY ONE ASKING
            </div>
            <h2>A few very human questions.</h2>
          </div>
          <p>
            You don’t need to have it all figured out.
            <br />
            That’s what the conversation is for.
          </p>
        </div>
        <div className="concern-grid">
          {[
            {
              icon: ShieldCheck,
              title: "“What if I lose my money?”",
              text: "It’s a fair question. Investment values can fall. We’ll explain the different risks, so you can explore with your eyes open.",
            },
            {
              icon: Wallet,
              title: "“What if I need it back?”",
              text: "Life happens. Access and withdrawal conditions depend on the product. We’ll help you understand what to look for.",
            },
            {
              icon: MessageCircle,
              title: "“I don’t speak stock market.”",
              text: "You don’t have to. Think everyday language, clear examples, and as many questions as you like.",
            },
          ].map(({ icon: Icon, title, text }) => (
            <article className="concern-card" key={title}>
              <Icon size={23} />
              <h3>{title}</h3>
              <p>{text}</p>
              <Link to="/coach">
                Let’s talk about it <ArrowUpRight size={16} />
              </Link>
            </article>
          ))}
        </div>
      </section>
      <section className="closing-cta container">
        <span className="closing-symbol">
          <Sprout size={42} strokeWidth={1.5} />
        </span>
        <div>
          <h2>Your first step doesn’t have to be a big one.</h2>
          <p>A little understanding can make all the difference.</p>
        </div>
        <Button asChild variant="dark">
          <Link to="/coach">
            Let’s explore my options <ArrowUpRight size={18} />
          </Link>
        </Button>
      </section>
      <div className="container landing-disclosure">
        <Disclosure />
      </div>
    </main>
  );
}
function InfoIcon() {
  return (
    <span className="info-circle" aria-hidden="true">
      i
    </span>
  );
}
