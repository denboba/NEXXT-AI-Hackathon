import { describe, expect, it } from "vitest";
import { eligibleProducts, project, purchasingPower } from "../src/lib/finance";
import { restoreJourney } from "../src/lib/journey";

describe("financial assumptions", () => {
  it("matches the reference purchasing-power example without rounding intermediate years", () => {
    expect(purchasingPower(10000, 5)).toBeCloseTo(7651.34, 2);
    expect(purchasingPower(10000, 0)).toBe(10000);
  });
  it("calculates end-of-month contributions, rather than a lump sum", () => {
    const monthlyRate = 1.06 ** (1 / 12) - 1;
    const annuity = (500 * ((1 + monthlyRate) ** 120 - 1)) / monthlyRate;
    const result = project(500, 10, 0.06, 0);
    expect(result.balance).toBeCloseTo(annuity, 7);
    expect(result.contributed).toBe(60000);
    expect(result.points).toHaveLength(11);
    expect(result.points.at(-1)?.projected).toBe(result.balance);
  });
  it("handles zero net growth without division by zero", () => {
    expect(project(500, 5, 0.01, 0.01).balance).toBe(30000);
  });
  it("subtracts fees and converts the final balance to real purchasing power", () => {
    const result = project(750, 15, 0.06, 0.009);
    expect(result.balance).toBeLessThan(project(750, 15, 0.06, 0).balance);
    expect(result.real).toBeCloseTo(result.balance / 1.055 ** 15, 7);
    expect(result.growth).toBeCloseTo(result.balance - 135000, 7);
  });
  it("models a losing market as less than total contributions", () => {
    const loss = project(500, 5, -0.02, 0.009);
    expect(loss.balance).toBeLessThan(loss.contributed);
    expect(loss.growth).toBeLessThan(0);
  });
  it.each([
    [NaN, 5],
    [500, 0],
    [500, 2.5],
    [-1, 5],
    [Infinity, 10],
  ])("rejects invalid monthly amount %s or horizon %s", (monthly, years) => {
    expect(() => project(monthly, years)).toThrow(RangeError);
  });
  it("only includes funds whose illustrative horizon is met", () => {
    expect(eligibleProducts(3).map((p) => p.id)).toEqual(["steady"]);
    expect(eligibleProducts(5).map((p) => p.id)).toEqual([
      "steady",
      "balanced",
    ]);
    expect(eligibleProducts(10)).toHaveLength(3);
  });
});
describe("saved journey resilience", () => {
  it("restores valid choices and chat, and bounds malformed data", () => {
    const restored = restoreJourney({
      monthly: 750,
      years: 5,
      risk: "steady",
      planDay: 15,
      authenticated: true,
      name: "Test",
      messages: [{ id: "1", role: "user", text: "How do fees work?" }],
    });
    expect(restored.monthly).toBe(750);
    expect(restored.planDay).toBe(15);
    expect(restored.messages).toHaveLength(1);
    const invalid = restoreJourney({
      monthly: 101,
      years: -1,
      risk: "unknown",
      question: 900,
      productId: "missing",
      activated: true,
    });
    expect(invalid.monthly).toBe(500);
    expect(invalid.years).toBe(10);
    expect(invalid.activated).toBe(false);
    expect(invalid.question).toBe(0);
    expect(invalid.productId).toBe("balanced");
  });
  it("handles empty storage and excludes invalid messages", () => {
    expect(restoreJourney(null).monthly).toBe(500);
    expect(
      restoreJourney({ messages: [{ role: "system", text: "x" }, null] })
        .messages,
    ).toEqual([]);
  });
});
