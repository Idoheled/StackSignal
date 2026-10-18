import { expect, test } from "@playwright/test";

const member = { id: "layout-reader", username: "reader", role: "reader", active: true };
const invite = "https://chat.whatsapp.com/SyntheticInviteOnly12345";

for (const width of [360, 1280]) {
  test(`WhatsApp join, confirmation, persistence and leaving at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    let registration = "unregistered";
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      let json: unknown = {};
      if (path === "/api/status") json = { configured: true };
      else if (path === "/api/me") json = { member, mfa_required: false };
      else if (path === "/api/action") {
        const { action, payload } = route.request().postDataJSON();
        if (["feed", "library"].includes(action)) json = { items: [], total: 0 };
        else if (["folders", "sources"].includes(action)) json = [];
        else if (["whatsapp_preferences", "whatsapp_preferences_save", "whatsapp_confirm_joined"].includes(action)) {
          if (action === "whatsapp_preferences_save") registration = payload.opt_in ? "pending" : "unregistered";
          if (action === "whatsapp_confirm_joined") registration = "registered";
          json = { opt_in: registration !== "unregistered", registration, registration_source: "user_confirmed", enabled: false, invite_url: registration !== "unregistered" ? invite : null };
        }
      }
      await route.fulfill({ json });
    });
    await page.goto("/");
    if (width < 768) await page.getByRole("button", { name: "Toggle Sidebar", exact: true }).click();
    await page.getByRole("button", { name: "WhatsApp alerts", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "WhatsApp alerts" });
    const toggle = dialog.getByRole("switch", { name: "WhatsApp registration" });
    await expect(toggle).not.toBeChecked();
    await expect(dialog.getByText("Unregistered", { exact: true })).toBeVisible();
    await toggle.check();
    const link = dialog.getByRole("link", { name: "Join the group", exact: true });
    await expect(link).toHaveAttribute("href", invite);
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    await expect(dialog.getByText("Waiting to join", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "I’ve joined the group" }).click();
    await expect(dialog.getByText("Registered", { exact: true })).toBeVisible();
    await expect.poll(() => dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: `/tmp/stacksignal-whatsapp-${testInfo.project.name}-${width}.png` });
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "WhatsApp alerts", exact: true }).click();
    await expect(toggle).toBeChecked();
    await expect(dialog.getByText("Registered", { exact: true })).toBeVisible();
    await toggle.uncheck();
    const leave = page.getByRole("dialog", { name: "You’re unregistered" });
    await expect(leave.getByRole("heading", { name: "One last step: leave the group." })).toBeVisible();
    expect(registration).toBe("unregistered");
    await leave.getByRole("button", { name: "Got it" }).click();
    await expect(toggle).not.toBeChecked();
    await expect(dialog.getByRole("link", { name: "Join the group", exact: true })).toHaveCount(0);
  });
}

test("a failed save keeps the last recorded choice and permits retry", async ({ page }) => {
  let fail = true;
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/status") return route.fulfill({ json: { configured: true } });
    if (path === "/api/me") return route.fulfill({ json: { member, mfa_required: false } });
    const { action, payload } = route.request().postDataJSON();
    if (action === "whatsapp_preferences") return route.fulfill({ json: { opt_in: false, registration: "unregistered", enabled: false, invite_url: null } });
    if (action === "whatsapp_preferences_save") {
      if (fail) return route.fulfill({ status: 503, json: { error: "Registration save unavailable" } });
      return route.fulfill({ json: { opt_in: payload.opt_in, registration: "pending", enabled: false, invite_url: invite } });
    }
    return route.fulfill({ json: ["feed", "library"].includes(action) ? { items: [], total: 0 } : [] });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "WhatsApp alerts", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "WhatsApp alerts" });
  await dialog.getByRole("switch").click();
  await expect(dialog.getByRole("alert")).toHaveText("Registration save unavailable");
  await expect(dialog.getByRole("switch")).not.toBeChecked();
  await expect(dialog.getByRole("switch")).toBeEnabled();
  fail = false;
  await dialog.getByRole("switch").check();
  await expect(dialog.getByText("Registration saved", { exact: true })).toBeVisible();
});

test("signup is optional and pending members receive the join dialog after login", async ({ page }) => {
  let payload: any;
  let loggedIn = false;
  await page.addInitScript(() => {
    (window as any).turnstile = { render: (_el: unknown, options: any) => {
      options.callback("synthetic-captcha"); return "synthetic-widget";
    }, remove: () => {}, reset: () => {} };
  });
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/status") return route.fulfill({ json: { configured: true, site_key: "synthetic-site" } });
    if (path === "/api/me") return loggedIn ? route.fulfill({ json: { member, mfa_required: false } }) : route.fulfill({ status: 401, json: { error: "Sign in" } });
    if (path === "/api/register") { payload = route.request().postDataJSON(); return route.fulfill({ json: { ok: true } }); }
    if (path === "/api/login") { loggedIn = true; return route.fulfill({ json: { ok: true } }); }
    const { action } = route.request().postDataJSON();
    return route.fulfill({ json: action === "whatsapp_preferences" ? { opt_in: true, registration: "pending", enabled: false, invite_url: invite }
      : ["feed", "library"].includes(action) ? { items: [], total: 0 } : [] });
  });
  await page.goto("/#invite=" + "a".repeat(64));
  const toggle = page.getByRole("checkbox", { name: "Notify me about top-tier drops via WhatsApp." });
  await expect(toggle).not.toBeChecked();
  await expect(page.getByText(/You can always register later/)).toBeVisible();
  await toggle.check();
  await page.getByRole("textbox", { name: "Username", exact: true }).fill("newreader");
  await page.getByLabel("New password", { exact: true }).fill("A synthetic lengthy passphrase 2026");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("your WhatsApp group invitation will appear");
  expect(payload.whatsapp_opt_in).toBe(true);
  expect(payload.token).toBe("a".repeat(64));
  await page.getByRole("textbox", { name: "Username", exact: true }).fill("newreader");
  await page.getByLabel("Password", { exact: true }).fill("A synthetic lengthy passphrase 2026");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "WhatsApp alerts" }).getByRole("link", { name: "Join the group", exact: true })).toHaveAttribute("href", invite);
});
