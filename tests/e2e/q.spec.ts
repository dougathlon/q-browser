import { expect, test, type Page } from "@playwright/test";

function collectRuntimeFailures(page: Page): string[] {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`);
  });
  page.on("requestfailed", (request) => failures.push(`request: ${request.url()} ${request.failure()?.errorText ?? "failed"}`));
  return failures;
}

test("boots, exposes the five interventions, and keeps debug state separate", async ({ page }, testInfo) => {
  const failures = collectRuntimeFailures(page);
  await page.goto("./?seed=1337");
  await expect(page.getByTestId("q-canvas")).toBeVisible();
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.locator("[data-ui='distance']")).toHaveText(/\d+/);
  for (const action of ["place", "treat", "call", "care", "rescue"]) {
    await expect(page.getByTestId(`action-${action}`)).toBeVisible();
  }
  await page.screenshot({ path: `test-results/${testInfo.project.name}-gameplay.png`, fullPage: true });

  await page.keyboard.press("F3");
  await expect(page.locator("[data-ui='debug']")).toBeVisible();
  await expect(page.locator("[data-debug-value='run-seed']")).toHaveText("1337");
  await expect(page.locator("[data-debug-value='curiosity']")).toHaveText(/0\.\d{3}/);
  await expect(page.locator("[data-debug-value='candidates']")).not.toContainText("No decision yet.");
  await page.screenshot({ path: `test-results/${testInfo.project.name}-debug.png`, fullPage: true });

  await page.locator("[data-effect='frenzy']").click();
  await expect(page.locator("[data-debug-value='modifiers']")).toContainText("frenzy");
  await page.locator("[data-command='same-seed']").click();
  await expect(page.locator("[data-debug-value='run-seed']")).toHaveText("1337");
  await expect(page.locator("[data-debug-value='modifiers']")).toHaveText("none");
  expect(failures).toEqual([]);
});
