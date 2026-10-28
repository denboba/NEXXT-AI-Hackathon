export type Risk = "steady" | "balanced" | "growth";
export type Product = {
  id: string;
  name: string;
  type: string;
  description: string;
  risk: Risk;
  riskScore: number;
  grossReturn: number;
  fee: number;
  minimumYears: number;
  liquidity: string;
  allocation: string;
  color: string;
};
export const products: Product[] = [
  {
    id: "steady",
    name: "Steady Start",
    type: "BOND-FOCUSED FUND",
    description:
      "A gentler introduction, with mostly bonds and a smaller share of equities.",
    risk: "steady",
    riskScore: 2,
    grossReturn: 0.04,
    fee: 0.006,
    minimumYears: 3,
    liquidity: "Illustrative withdrawal: 3–5 business days",
    allocation: "80% bonds · 20% equities",
    color: "#7e9a86",
  },
  {
    id: "balanced",
    name: "Balanced Future",
    type: "MULTI-ASSET FUND",
    description:
      "A balance of bonds and global equities, built for a longer horizon.",
    risk: "balanced",
    riskScore: 4,
    grossReturn: 0.06,
    fee: 0.009,
    minimumYears: 5,
    liquidity: "Illustrative withdrawal: 3–5 business days",
    allocation: "50% bonds · 50% equities",
    color: "#bea426",
  },
  {
    id: "growth",
    name: "Long-Term Growth",
    type: "GLOBAL EQUITY FUND",
    description:
      "More exposure to global equities, with bigger ups and downs along the way.",
    risk: "growth",
    riskScore: 6,
    grossReturn: 0.08,
    fee: 0.012,
    minimumYears: 10,
    liquidity: "Illustrative withdrawal: 3–5 business days",
    allocation: "10% bonds · 90% equities",
    color: "#8896b9",
  },
];
export const INFLATION = 0.055;
export function purchasingPower(
  amount: number,
  years: number,
  inflation = INFLATION,
) {
  if (
    !Number.isFinite(amount) ||
    amount < 0 ||
    !Number.isFinite(years) ||
    years < 0 ||
    !Number.isFinite(inflation) ||
    inflation <= -1
  )
    throw new RangeError("Invalid inflation assumptions");
  return amount / (1 + inflation) ** years;
}
export function project(
  monthly: number,
  years: number,
  annualReturn = 0.06,
  annualFee = 0.009,
  inflation = INFLATION,
) {
  if (
    ![monthly, years, annualReturn, annualFee, inflation].every(
      Number.isFinite,
    ) ||
    monthly < 0 ||
    years < 1 ||
    years > 50 ||
    !Number.isInteger(years) ||
    annualFee < 0 ||
    annualReturn - annualFee <= -1 ||
    inflation <= -1
  )
    throw new RangeError("Invalid projection assumptions");
  const monthlyRate = (1 + annualReturn - annualFee) ** (1 / 12) - 1;
  let balance = 0;
  const points = [{ year: 0, contributed: 0, projected: 0, real: 0 }];
  for (let month = 1; month <= years * 12; month++) {
    // Contributions are made at the end of each month; fee is approximated as an annual return reduction.
    balance = balance * (1 + monthlyRate) + monthly;
    if (month % 12 === 0)
      points.push({
        year: month / 12,
        contributed: month * monthly,
        projected: balance,
        real: purchasingPower(balance, month / 12, inflation),
      });
  }
  const contributed = monthly * years * 12;
  return {
    balance,
    contributed,
    growth: balance - contributed,
    real: purchasingPower(balance, years, inflation),
    points,
  };
}
export function eligibleProducts(years: number) {
  return products.filter((p) => p.minimumYears <= years);
}
export const money = (amount: number) =>
  new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(
    Math.round(amount),
  );
export const pct = (amount: number) => `${+(amount * 100).toFixed(2)}%`;
