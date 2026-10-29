import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

async function guide(page: Page) {
  await page.route("**/api/coach", (route) =>
    route.fulfill({
      json: {
        text: "Investments can fall in value. Keep a cash buffer and understand the risks before making a decision.",
        source: "guided",
      },
    }),
  );
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
}
async function finishQuestions(page: Page, years = 5) {
  await page.goto("/coach");
  await page
    .getByRole("slider", { name: "Monthly investment" })
    .first()
    .focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
  await page.getByRole("button", { name: "That feels comfortable" }).click();
  await page
    .getByRole("button", {
      name: years === 3 ? /In a few years/ : /A little further ahead/,
    })
    .click();
  await page
    .getByRole("button", { name: /Some ups and downs are okay/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "A little clearer already." }),
  ).toBeVisible();
}
async function demoLogin(page: Page) {
  await page.goto("/onboarding/login");
  await page.getByLabel("Demo display name").fill("Taylor");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Continue as demo customer" }).click();
  await expect(page).toHaveURL(/\/account\/invest$/);
}
test("landing explains purchasing power and supports changing the horizon", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "Stop situationshipping with your cash.",
    }),
  ).toBeVisible();
  await expect(page.locator(".inflation-stats")).toContainText("7,651");
  await page.getByRole("button", { name: "10y", exact: true }).click();
  await expect(page.locator(".inflation-stats")).toContainText("5,854");
  await noOverflow(page);
  await page.getByRole("link", { name: "See what it could do" }).click();
  await expect(page).toHaveURL(/\/coach$/);
});
test("complete new-customer journey preserves choices and activates only a demo plan", async ({
  page,
}) => {
  await guide(page);
  await finishQuestions(page);
  await page.getByRole("button", { name: "Could I lose money?" }).click();
  await expect(page.locator(".message-bubble").last()).toContainText(
    "cash buffer",
  );
  await page.reload();
  await expect(page.locator(".conversation-complete")).toContainText(
    "750 lei/month, 5-year scenario",
  );
  await expect(page.locator(".message-bubble").last()).toContainText(
    "cash buffer",
  );
  await noOverflow(page);
  await page
    .getByRole("link", { name: "Explore my options", exact: true })
    .click();
  await noOverflow(page);
  await page.getByRole("link", { name: /I’m new here/ }).click();
  await page.getByLabel("Demo display name").fill("Sam");
  await page.getByRole("button", { name: "Continue to review" }).click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create my demo profile" }).click();
  await expect(
    page.getByRole("heading", { name: "Find your kind of starting point." }),
  ).toBeVisible();
  await expect(page.locator(".investment-summary-bar")).toContainText(
    "750 lei",
  );
  await expect(page.locator(".investment-summary-bar")).toContainText(
    "5 years",
  );
  await noOverflow(page);
  await page
    .getByRole("link", { name: "Review my Balanced Future plan" })
    .click();
  await expect(page.locator(".plan-details")).toContainText("750");
  await page.getByLabel("Make it a monthly habit").selectOption("15");
  await page
    .getByRole("button", { name: "Simulate activating my monthly plan" })
    .click();
  await expect(page.getByRole("alert")).toContainText("Please confirm");
  await page.getByRole("checkbox").check();
  await noOverflow(page);
  await page
    .getByRole("button", { name: "Simulate activating my monthly plan" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Here’s to your future, Sam." }),
  ).toBeVisible();
  await expect(page.locator(".success-demo")).toContainText(
    "No real investment executed",
  );
  await expect(page.locator(".success-metrics")).toContainText("750");
  await expect(page.locator(".success-metrics")).toContainText("15");
  await noOverflow(page);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save my demo plan" }).click();
  expect((await download).suggestedFilename()).toBe(
    "my-demo-investment-plan.txt",
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Here’s to your future, Sam." }),
  ).toBeVisible();
});
test("existing customer path and horizon requirements work", async ({
  page,
}) => {
  await finishQuestions(page, 3);
  await demoLogin(page);
  await expect(
    page.getByRole("button", { name: "Requires a 5+ year horizon" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Requires a 10+ year horizon" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Bond-focused", exact: true }).click();
  await expect(page.locator(".product-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Explore fund details" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "not a real investment product",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("link", { name: "Review my Steady Start plan" }).click();
  await expect(page).toHaveURL(/\/account\/plan$/);
});
test("unavailable AI gives an honest answer, without losing the conversation", async ({
  page,
}) => {
  await page.route("**/api/coach", (route) =>
    route.fulfill({ status: 503, json: { error: "unavailable" } }),
  );
  await page.goto("/coach");
  await page
    .getByRole("textbox", { name: "Ask your investment coach" })
    .fill("Can I withdraw my money?");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".message-bubble").last()).toContainText(
    "3–5 business-day",
  );
  await expect(page.getByRole("status")).toContainText("educational guide");
  await expect(page.locator(".message.user")).toContainText(
    "Can I withdraw my money?",
  );
  await expect(
    page.getByRole("button", { name: "Send message" }),
  ).toBeDisabled();
});
test("private demo screens redirect and corrupted storage does not crash", async ({
  page,
}) => {
  await page.goto("/account/invest");
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.evaluate(() =>
    localStorage.setItem("investment-coach-journey-v1", "{broken"),
  );
  await page.goto("/coach");
  await expect(
    page.getByRole("heading", {
      name: "How much could you comfortably set aside each month?",
    }),
  ).toBeVisible();
  await noOverflow(page);
});
test("changing the scenario requires reviewing a new demo activation", async ({
  page,
}) => {
  await demoLogin(page);
  await page
    .getByRole("link", { name: "Review my Balanced Future plan" })
    .click();
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Simulate activating my monthly plan" })
    .click();
  await expect(page).toHaveURL(/\/account\/success$/);
  await page.goto("/coach");
  await page
    .getByRole("slider", { name: "Monthly investment" })
    .first()
    .focus();
  await page.keyboard.press("ArrowRight");
  await page.goto("/account/success");
  await expect(page).toHaveURL(/\/account\/plan$/);
});
test("core pages pass automated accessibility checks", async ({ page }) => {
  for (const route of [
    "/",
    "/coach",
    "/onboarding",
    "/onboarding/login",
    "/onboarding/new-account",
  ]) {
    await page.goto(route);
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      result.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      })),
    ).toEqual([]);
  }
  await demoLogin(page);
  for (const route of ["/account/invest", "/account/plan"]) {
    await page.goto(route);
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      result.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      })),
    ).toEqual([]);
  }
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Simulate activating my monthly plan" })
    .click();
  await expect(page).toHaveURL(/\/account\/success$/);
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    result.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
});
