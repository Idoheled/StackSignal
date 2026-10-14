import { expect, test } from "@playwright/test";

const member = { id: "layout-reader", username: "reader", role: "reader", active: true };
const invite = "https://chat.whatsapp.com/SyntheticInviteOnly12345";

for (const width of [360, 1280]) {
  test(`WhatsApp preference persists and joins safely at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    let opted = false;
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      let json: unknown = {};
      if (path === "/api/status") json = { configured: true };
      else if (path === "/api/me") json = { member, mfa_required: false };
      else if (path === "/api/action") {
        const { action, payload } = route.request().postDataJSON();
        if (["feed", "library"].includes(action)) json = { items: [], total: 0 };
        else if (["folders", "sources"].includes(action)) json = [];
        else if (["whatsapp_preferences", "whatsapp_preferences_save"].includes(action)) {
          if (action === "whatsapp_preferences_save") opted = payload.opt_in;
          json = { opt_in: opted, enabled: false, invite_url: opted ? invite : null };
        }
      }
      await route.fulfill({ json });
    });
    await page.goto("/");
    if (width < 768) await page.getByRole("button", { name: "Toggle Sidebar", exact: true }).click();
    await page.getByRole("button", { name: "WhatsApp alerts", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Notification settings" });
    const toggle = dialog.getByRole("checkbox");
    await expect(toggle).not.toBeChecked();
    await expect(dialog.getByRole("link", { name: "Join the private group" })).toHaveCount(0);
    await toggle.check();
    const link = dialog.getByRole("link", { name: "Join the private group" });
    await expect(link).toHaveAttribute("href", invite);
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    await expect(dialog.getByText("Preference saved", { exact: true })).toBeVisible();
    await expect(dialog.getByText(/leave the WhatsApp group too/)).toBeVisible();
    await expect.poll(() => dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: `/tmp/stacksignal-whatsapp-${testInfo.project.name}-${width}.png` });
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "WhatsApp alerts", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Notification settings" }).getByRole("checkbox")).toBeChecked();
    await page.getByRole("dialog", { name: "Notification settings" }).getByRole("checkbox").uncheck();
    await expect(page.getByRole("link", { name: "Join the private group" })).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Notification settings" }).getByRole("checkbox")).toBeEnabled();
    expect(opted).toBe(false);
  });
}

test("a failed preference save restores the previous choice and permits retry", async ({ page }) => {
  let fail = true;
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/status") return route.fulfill({ json: { configured: true } });
    if (path === "/api/me") return route.fulfill({ json: { member, mfa_required: false } });
    const { action, payload } = route.request().postDataJSON();
    if (action === "whatsapp_preferences") return route.fulfill({ json: { opt_in: false, enabled: false, invite_url: null } });
    if (action === "whatsapp_preferences_save") {
      if (fail) return route.fulfill({ status: 503, json: { error: "Preference save unavailable" } });
      return route.fulfill({ json: { opt_in: payload.opt_in, enabled: false, invite_url: invite } });
    }
    return route.fulfill({ json: ["feed", "library"].includes(action) ? { items: [], total: 0 } : [] });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "WhatsApp alerts", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Notification settings" });
  await dialog.getByRole("checkbox").click();
  await expect(dialog.getByRole("alert")).toHaveText("Preference save unavailable");
  await expect(dialog.getByRole("checkbox")).not.toBeChecked();
  await expect(dialog.getByRole("checkbox")).toBeEnabled();
  await expect(dialog.getByRole("link", { name: "Join the private group" })).toHaveCount(0);
  fail = false;
  await dialog.getByRole("checkbox").check();
  await expect(dialog.getByText("Preference saved", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Join the private group" })).toHaveAttribute("href", invite);
});

test("invited registration starts unchecked and submits the user's explicit choice", async ({ page }) => {
  let payload: any;
  await page.addInitScript(() => {
    (window as any).turnstile = { render: (_el: unknown, options: any) => {
      options.callback("synthetic-captcha"); return "synthetic-widget";
    }, remove: () => {}, reset: () => {} };
  });
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/status") await route.fulfill({ json: { configured: true, site_key: "synthetic-site" } });
    else if (path === "/api/me") await route.fulfill({ status: 401, json: { error: "Sign in" } });
    else if (path === "/api/register") {
      payload = route.request().postDataJSON(); await route.fulfill({ json: { ok: true } });
    } else throw new Error("Unexpected request: " + path);
  });
  await page.goto("/#invite=" + "a".repeat(64));
  const toggle = page.getByRole("checkbox", { name: "Notify me about top-tier drops via WhatsApp." });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await page.getByRole("textbox", { name: "Username", exact: true }).fill("newreader");
  await page.getByLabel("New password", { exact: true }).fill("A synthetic lengthy passphrase 2026");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Open WhatsApp alerts");
  expect(payload.whatsapp_opt_in).toBe(true);
  expect(payload.token).toBe("a".repeat(64));
  await expect(page.getByRole("link", { name: "Join the private group" })).toHaveCount(0);
});
