import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

async function noModelServer(page: Page) {
  await page.route("**/api/health", (route) =>
    route.fulfill({
      json: {
        status: "ok",
        coachMode: "guided-demo",
        region: "us-west-2",
        model: "test",
      },
    }),
  );
}

test("decision lab shows the challenge, the revision and a consent-gated local export", async ({
  page,
}) => {
  await noModelServer(page);
  await page.goto("/decision");
  await page
    .getByRole("button", { name: "Load synthetic demo: Ana" })
    .click();
  await expect(page.locator(".lab-banner")).toContainText("SYNTHETIC");
  await page.getByRole("button", { name: "Run assessment" }).click();
  await expect(page.locator(".lab-loopback")).toContainText(
    "severe-crash-loss",
  );
  await expect(page.locator(".lab-strategy")).toHaveCount(2);
  await expect(page.locator(".lab-changes")).toContainText(
    "Equity share 50.0% -> 25.7%",
  );
  await expect(page.locator(".lab-validation")).toContainText(
    "Validated with open issues",
  );
  await page.getByRole("button", { name: /Preview adviser briefing/ }).click();
  const download = page.getByRole("button", {
    name: /Download briefing/,
  });
  await expect(download).toBeDisabled();
  await page.getByRole("checkbox", { name: /briefing content above/ }).check();
  await page.getByRole("button", { name: "Give consent" }).click();
  await expect(download).toBeEnabled();
  const file = page.waitForEvent("download");
  await download.click();
  expect((await file).suggestedFilename()).toBe("adviser-briefing.json");
  await expect(page.getByRole("dialog")).toContainText(
    "no appointment was booked",
  );
});

test("decision lab replays a changed constraint and reports reused stages", async ({
  page,
}) => {
  await noModelServer(page);
  await page.goto("/decision");
  await page
    .getByRole("button", { name: "Load synthetic demo: Ana" })
    .click();
  await page.getByRole("button", { name: "Run assessment" }).click();
  await page.getByLabel("Monthly contribution (lei)").last().fill("900");
  await page.getByRole("button", { name: "Replay with this change" }).click();
  await expect(page.locator(".lab-delta")).toContainText("monthlyContribution");
  await expect(page.locator(".lab-delta")).toContainText("Reused");
});

test("evaluation lab derives pass counts from running the scenarios", async ({
  page,
}) => {
  await page.goto("/lab");
  await page.getByRole("button", { name: /Run all \d+ scenarios/ }).click();
  await expect(page.getByText(/scenarios run: \d+ passed, 0 failed/)).toBeVisible({
    timeout: 30000,
  });
});
