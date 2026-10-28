import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { products } from "./finance";
import type { Risk } from "./finance";

export type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  source?: "guided" | "bedrock";
};
export type Journey = {
  monthly: number;
  years: number;
  risk: Risk;
  question: number;
  messages: Message[];
  authenticated: boolean;
  name: string;
  productId: string;
  activated: boolean;
  activatedAt: string | null;
  planDay: number;
};
export const initialJourney: Journey = {
  monthly: 500,
  years: 10,
  risk: "balanced",
  question: 0,
  messages: [],
  authenticated: false,
  name: "Alex",
  productId: "balanced",
  activated: false,
  activatedAt: null,
  planDay: 1,
};
const STORAGE_KEY = "investment-coach-journey-v1";
export function restoreJourney(value: unknown): Journey {
  if (!value || typeof value !== "object") return { ...initialJourney };
  const v = value as Partial<Journey>;
  return {
    ...initialJourney,
    monthly:
      typeof v.monthly === "number" &&
      v.monthly >= 100 &&
      v.monthly <= 2000 &&
      v.monthly % 50 === 0
        ? v.monthly
        : 500,
    years:
      typeof v.years === "number" && [3, 5, 10, 15, 20].includes(v.years)
        ? v.years
        : 10,
    risk: ["steady", "balanced", "growth"].includes(v.risk ?? "")
      ? v.risk!
      : "balanced",
    question:
      typeof v.question === "number" &&
      Number.isInteger(v.question) &&
      v.question >= 0 &&
      v.question <= 3
        ? v.question
        : 0,
    messages: Array.isArray(v.messages)
      ? v.messages
          .filter(
            (m) =>
              m &&
              typeof m.text === "string" &&
              m.text.length <= 6000 &&
              ["user", "assistant"].includes(m.role) &&
              typeof m.id === "string",
          )
          .slice(-40)
      : [],
    authenticated: v.authenticated === true,
    name:
      typeof v.name === "string" && v.name.trim()
        ? v.name.slice(0, 30)
        : "Alex",
    productId: products.some((p) => p.id === v.productId)
      ? v.productId!
      : "balanced",
    activated: v.activated === true && v.authenticated === true,
    planDay:
      typeof v.planDay === "number" && [1, 15, 28].includes(v.planDay)
        ? v.planDay
        : 1,
    activatedAt:
      typeof v.activatedAt === "string" &&
      Number.isFinite(Date.parse(v.activatedAt))
        ? v.activatedAt
        : null,
  };
}
function read(): Journey {
  try {
    return restoreJourney(
      JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"),
    );
  } catch {
    return { ...initialJourney };
  }
}
type JourneyUpdate =
  Partial<Journey> | ((current: Journey) => Partial<Journey>);
const JourneyContext = createContext<{
  state: Journey;
  update: (patch: JourneyUpdate) => void;
  reset: () => void;
  storageAvailable: boolean;
} | null>(null);
export function JourneyProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Journey>(read);
  const [storageAvailable, setStorageAvailable] = useState(true);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      setStorageAvailable(false);
    }
  }, [state]);
  return (
    <JourneyContext.Provider
      value={{
        state,
        update: (patch) =>
          setState((old) => {
            const next = typeof patch === "function" ? patch(old) : patch;
            const changed = (
              ["monthly", "years", "risk", "productId", "planDay"] as const
            ).some((key) => next[key] !== undefined && next[key] !== old[key]);
            return {
              ...old,
              ...(changed ? { activated: false, activatedAt: null } : {}),
              ...next,
            };
          }),
        reset: () => {
          try {
            localStorage.removeItem(STORAGE_KEY);
          } catch {
            /* In-memory reset still works when storage is unavailable. */
          }
          setState({ ...initialJourney });
        },
        storageAvailable,
      }}
    >
      {children}
    </JourneyContext.Provider>
  );
}
export function useJourney() {
  const context = useContext(JourneyContext);
  if (!context) throw new Error("Missing journey provider");
  return context;
}
