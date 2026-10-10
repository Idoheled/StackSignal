import { normalizeUsername, validUsername, strongPassword } from "../domain.ts";
import {
  API_HEADERS,
  HttpError,
  boundedJSON,
  validateOrigin,
  sha256,
  seal,
  unseal,
  jwtClaims,
  publicHttpsURL,
  base64ToBytes,
} from "./security.ts";
export type Config = {
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SESSION_SECRET?: string;
  APP_ORIGIN?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  ENVIRONMENT?: string;
  // Enable only on the owner-private Sites deployment; never on an open production origin.
  STACKSIGNAL_PRIVATE_PREVIEW_ORIGIN?: string;
};
type Session = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
};
const COOKIE = "__Host-stacksignal";
export function isConfigured(c: Config) {
  try {
    return !!(
      c.SUPABASE_URL?.match(/^https:\/\/[a-z0-9-]+\.supabase\.co$/) &&
      c.SUPABASE_ANON_KEY &&
      c.SUPABASE_SERVICE_ROLE_KEY &&
      c.APP_ORIGIN?.startsWith("https://") &&
      c.SESSION_SECRET &&
      base64ToBytes(c.SESSION_SECRET).length === 32 &&
      c.TURNSTILE_SITE_KEY &&
      c.TURNSTILE_SECRET_KEY
    );
  } catch {
    return false;
  }
}
export function createService(c: Config, network: typeof fetch = fetch) {
  async function sb(
    path: string,
    method = "GET",
    body?: unknown,
    bearer?: string,
    service = false,
  ) {
    const key = service ? c.SUPABASE_SERVICE_ROLE_KEY! : c.SUPABASE_ANON_KEY!;
    const res = await network(c.SUPABASE_URL + path, {
      method,
      headers: {
        apikey: key,
        Authorization: `Bearer ${bearer || key}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    });
    const out: any = await res.json().catch(() => null);
    if (!res.ok) {
      const code = out?.code || out?.error_code;
      throw new HttpError(
        code === "42501" || res.status === 403
          ? 403
          : res.status === 401
            ? 401
            : res.status === 429
              ? 429
              : 400,
        code === "23505"
          ? "That username or record is already in use."
          : code === "42501"
            ? "This account is not permitted to perform that action."
            : res.status === 429
              ? "Too many requests. Please try again later."
              : "The operation could not be completed. Check the information and try again.",
      );
    }
    return out;
  }
  async function rpc(
    name: string,
    body: unknown,
    token?: string,
    service = false,
  ) {
    return sb("/rest/v1/rpc/" + name, "POST", body, token, service);
  }
  async function guardRate(key: string, max: number, seconds: number) {
    const allowed = await rpc(
      "ss_rate_limit",
      { keys: [key], max_count: max, window_seconds: seconds },
      undefined,
      true,
    );
    if (!allowed)
      throw new HttpError(
        429,
        "Too many attempts. Please wait before trying again.",
      );
  }
  async function captcha(token: string, request: Request, action: string) {
    if (!token || token.length > 2048)
      throw new HttpError(400, "Complete the security check.");
    const data = new URLSearchParams({
      secret: c.TURNSTILE_SECRET_KEY!,
      response: token,
    });
    const ip = request.headers.get("cf-connecting-ip");
    if (ip) data.set("remoteip", ip);
    const res = await network(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      { method: "POST", body: data, signal: AbortSignal.timeout(10000) },
    );
    const result = (await res.json()) as {
      success?: boolean;
      hostname?: string;
      action?: string;
    };
    if (
      !res.ok ||
      result.success !== true ||
      result.hostname !== new URL(c.APP_ORIGIN!).hostname ||
      result.action !== action
    )
      throw new HttpError(400, "Security check expired. Please try again.");
  }
  function tokenSession(x: any): Session {
    if (!x.access_token || !x.refresh_token)
      throw new HttpError(401, "Unable to establish a session.");
    const j = jwtClaims(x.access_token);
    return {
      access_token: x.access_token,
      refresh_token: x.refresh_token,
      expires_at: Number(j.exp),
    };
  }
  async function grant(s: Session, userId: string) {
    const j = jwtClaims(s.access_token);
    if (!j.session_id) throw new HttpError(401, "Invalid session.");
    await sb(
      "/rest/v1/ss_sessions",
      "POST",
      { session_id: j.session_id, user_id: userId },
      undefined,
      true,
    );
  }
  return async function handle(request: Request): Promise<Response> {
    let cookie: string | undefined;
    const respond = (value: unknown, status = 200) => {
      const headers = new Headers(API_HEADERS);
      headers.set("Content-Type", "application/json");
      if (cookie) headers.set("Set-Cookie", cookie);
      return new Response(JSON.stringify(value), { status, headers });
    };
    const setSession = async (s: Session) => {
      cookie = `${COOKIE}=${await seal(s, c.SESSION_SECRET!)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200`;
    };
    try {
      const path = new URL(request.url).pathname.replace(/^\/api\//, "");
      if (path === "status" && request.method === "GET")
        return respond({
          configured: isConfigured(c),
          site_key: c.TURNSTILE_SITE_KEY || null,
          username_login: true,
          preview_enabled:
            !isConfigured(c) &&
            c.STACKSIGNAL_PRIVATE_PREVIEW_ORIGIN ===
              new URL(request.url).origin,
        });
      if (path === "preview" && request.method === "GET" && !isConfigured(c)) {
        if (
          c.STACKSIGNAL_PRIVATE_PREVIEW_ORIGIN !== new URL(request.url).origin
        )
          throw new HttpError(
            404,
            "Private preview is not enabled on this deployment.",
          );
        const { TEAM_ARTICLES, STARTER_FOLDERS, IMPORT_STATS } = await import(
          "../team-library.ts"
        );
        const { TEAM_SOURCES, TEAM_PROFILE, TEAM_STACK } = await import(
          "../coverage.ts"
        );
        return respond({
          articles: TEAM_ARTICLES,
          folders: STARTER_FOLDERS,
          sources: TEAM_SOURCES,
          profile: TEAM_PROFILE,
          stack: TEAM_STACK,
          stats: IMPORT_STATS,
        });
      }
      if (!isConfigured(c))
        throw new HttpError(
          503,
          "The administrator needs to finish account service setup.",
        );
      if (request.method !== "GET" && request.method !== "POST")
        throw new HttpError(405, "Method not allowed.");
      if (request.method === "POST") validateOrigin(request, c.APP_ORIGIN!);
      const p = request.method === "POST" ? await boundedJSON(request) : {};
      if (!p || Array.isArray(p) || typeof p !== "object")
        throw new HttpError(400, "JSON object required.");
      const ipHash = await sha256(
        "ip:" +
          String(request.headers.get("cf-connecting-ip") || "unknown") +
          c.SESSION_SECRET,
      );
      if (["login", "register", "recover"].includes(path)) {
        if (request.method !== "POST")
          throw new HttpError(405, "POST required.");
        await guardRate("authip:" + ipHash, 60, 900);
        if (path !== "login") await captcha(String(p.captcha || ""), request, path);
        else if (!p.captcha || String(p.captcha).length > 2048)
          throw new HttpError(400, "Complete the security check.");
        const uname = normalizeUsername(String(p.username || ""));
        if (!validUsername(uname))
          throw new HttpError(
            400,
            "Username must be 3–32 characters, starting with a letter. Use letters, numbers, underscores or hyphens.",
          );
        await guardRate("authuser:" + (await sha256(uname)), 10, 900);
        if (path === "login") {
          let raw: any;
          try {
            raw = await sb("/auth/v1/token?grant_type=password", "POST", {
              email: uname + "@accounts.stacksignal.invalid",
              password: String(p.password || ""),
              gotrue_meta_security: { captcha_token: p.captcha },
            });
          } catch (e) {
            if (e instanceof HttpError && e.status === 429) throw e;
            throw new HttpError(401, "Username or password is incorrect.");
          }
          const members = await sb(
            "/rest/v1/ss_members?id=eq." + raw.user.id + "&select=*",
            "GET",
            undefined,
            undefined,
            true,
          );
          if (!members[0]?.active)
            throw new HttpError(401, "Username or password is incorrect.");
          const s = tokenSession(raw);
          await grant(s, raw.user.id);
          await setSession(s);
          return respond({ ok: true });
        }
        if (!strongPassword(String(p.password || "")))
          throw new HttpError(
            400,
            "Use at least 16 characters (maximum 72 UTF-8 bytes) and avoid common passwords.",
          );
        if (path === "recover") {
          const hash = await sha256(String(p.token || ""));
          const rows = await sb(
            "/rest/v1/ss_recovery?token_hash=eq." +
              hash +
              "&used_at=is.null&expires_at=gt." +
              encodeURIComponent(new Date().toISOString()) +
              "&select=*",
            "GET",
            undefined,
            undefined,
            true,
          );
          const recovery = rows[0];
          const members = recovery
            ? await sb(
                "/rest/v1/ss_members?id=eq." +
                  recovery.user_id +
                  "&username=eq." +
                  uname +
                  "&select=id",
                "GET",
                undefined,
                undefined,
                true,
              )
            : [];
          if (!members.length)
            throw new HttpError(400, "Recovery link is unavailable.");
          const used = await sb(
            "/rest/v1/ss_recovery?id=eq." + recovery.id + "&used_at=is.null",
            "PATCH",
            { used_at: new Date().toISOString() },
            undefined,
            true,
          );
          if (!used.length)
            throw new HttpError(400, "Recovery link is unavailable.");
          await sb(
            "/auth/v1/admin/users/" + recovery.user_id,
            "PUT",
            { password: p.password },
            undefined,
            true,
          );
          await sb(
            "/rest/v1/ss_sessions?user_id=eq." + recovery.user_id,
            "PATCH",
            { revoked: true },
            undefined,
            true,
          );
          return respond({ ok: true });
        }
        if (["admin", "administrator", "system", "support"].includes(uname))
          throw new HttpError(400, "Choose a different username.");
        const claim = crypto.randomUUID();
        let invite: any;
        let userId: string | undefined;
        try {
          if (!/^[a-f0-9]{64}$/.test(String(p.token || "")))
            throw new HttpError(400, "Invitation is invalid or expired.");
          invite = await rpc(
            "ss_claim_invite",
            { token: p.token, claim },
            undefined,
            true,
          );
          const created = await sb(
            "/auth/v1/admin/users",
            "POST",
            {
              email: uname + "@accounts.stacksignal.invalid",
              password: p.password,
              email_confirm: true,
            },
            undefined,
            true,
          );
          userId = created.id;
          await rpc(
            "ss_finish_invite",
            {
              invite_id: invite.id,
              claim,
              user_id: userId,
              uname,
              dname: uname,
            },
            undefined,
            true,
          );
          return respond({ ok: true });
        } catch (e) {
          if (userId)
            await sb(
              "/auth/v1/admin/users/" + userId,
              "DELETE",
              undefined,
              undefined,
              true,
            ).catch(() => {});
          if (invite)
            await sb(
              "/rest/v1/ss_invites?id=eq." +
                invite.id +
                "&claim_id=eq." +
                claim,
              "PATCH",
              { claim_id: null, claimed_at: null },
              undefined,
              true,
            ).catch(() => {});
          throw e;
        }
      }
      const cv = request.headers
        .get("cookie")
        ?.split(";")
        .map((x) => x.trim())
        .find((x) => x.startsWith(COOKIE + "="))
        ?.slice(COOKIE.length + 1);
      let s = cv ? await unseal<Session>(cv, c.SESSION_SECRET!) : null;
      if (!s) throw new HttpError(401, "Please sign in.");
      if (s.expires_at < Date.now() / 1000 + 45) {
        try {
          s = tokenSession(
            await sb("/auth/v1/token?grant_type=refresh_token", "POST", {
              refresh_token: s.refresh_token,
            }),
          );
          await setSession(s);
        } catch {
          throw new HttpError(
            401,
            "Your session has expired. Please sign in again.",
          );
        }
      }
      // getUser verifies the JWT at the identity provider; decoded claims are never sufficient authentication.
      const user = await sb("/auth/v1/user", "GET", undefined, s.access_token);
      const member = await rpc(
        "ss_api",
        { action: "me", p: {} },
        s.access_token,
      );
      const claims = jwtClaims(s.access_token);
      await guardRate("api:" + user.id, 240, 60);
      if (path === "me")
        return respond({
          member,
          mfa_required: member.role !== "reader" && claims.aal !== "aal2",
          factors: (user.factors || [])
            .filter((f: any) => f.factor_type === "totp")
            .map((f: any) => ({ id: f.id, status: f.status })),
          must_change_password: member.must_change_password,
        });
      if (request.method !== "POST") throw new HttpError(405, "POST required.");
      if (path === "logout") {
        await sb(
          "/rest/v1/ss_sessions?session_id=eq." + claims.session_id,
          "PATCH",
          { revoked: true },
          undefined,
          true,
        );
        await sb(
          "/auth/v1/logout?scope=local",
          "POST",
          {},
          s.access_token,
        ).catch(() => {});
        cookie = `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
        return respond({ ok: true });
      }
      if (path === "change-password") {
        await guardRate("password:" + user.id, 10, 900);
        if (typeof p.current_password !== "string" || !p.current_password)
          throw new HttpError(400, "Enter your current password.");
        if (!strongPassword(String(p.password || "")))
          throw new HttpError(
            400,
            "Use a strong passphrase of at least 16 characters, no more than 72 UTF-8 bytes.",
          );
        if (
          !member.must_change_password &&
          member.role !== "reader" &&
          claims.aal !== "aal2"
        )
          throw new HttpError(403, "MFA verification required.");
        // Provider verifies the current password; no administrator password-reset shortcut is used.
        await sb(
          "/auth/v1/user",
          "PUT",
          { password: p.password, current_password: p.current_password },
          s.access_token,
        );
        await sb(
          "/rest/v1/ss_members?id=eq." + user.id,
          "PATCH",
          { must_change_password: false },
          undefined,
          true,
        );
        await sb(
          "/rest/v1/ss_sessions?user_id=eq." + user.id,
          "PATCH",
          { revoked: true },
          undefined,
          true,
        );
        cookie = `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
        return respond({ ok: true });
      }
      if (member.must_change_password)
        throw new HttpError(403, "Change your temporary password first.");
      if (path === "mfa/enroll") {
        await guardRate("mfa:" + user.id, 10, 600);
        const verified = (user.factors || []).some(
          (f: any) => f.factor_type === "totp" && f.status === "verified",
        );
        if (verified)
          throw new HttpError(400, "Use your existing authenticator.");
        for (const f of user.factors || [])
          if (f.status === "unverified")
            await sb(
              "/auth/v1/factors/" + f.id,
              "DELETE",
              undefined,
              s.access_token,
            );
        const factor = await sb(
          "/auth/v1/factors",
          "POST",
          {
            factor_type: "totp",
            friendly_name: "StackSignal",
            issuer: "StackSignal",
          },
          s.access_token,
        );
        return respond({ id: factor.id, totp: factor.totp });
      }
      if (path === "mfa/verify") {
        await guardRate("mfa:" + user.id, 10, 600);
        if (!/^[0-9a-f-]{36}$/i.test(p.factor_id) || !/^\d{6}$/.test(p.code))
          throw new HttpError(400, "Enter the six-digit authenticator code.");
        const challenge = await sb(
          "/auth/v1/factors/" + p.factor_id + "/challenge",
          "POST",
          {},
          s.access_token,
        );
        const verified = await sb(
          "/auth/v1/factors/" + p.factor_id + "/verify",
          "POST",
          { challenge_id: challenge.id, code: p.code },
          s.access_token,
        );
        await setSession(tokenSession(verified));
        return respond({ ok: true });
      }
      if (member.role !== "reader" && claims.aal !== "aal2")
        throw new HttpError(403, "Verify your authenticator to continue.");
      if (path !== "action") throw new HttpError(404, "Not found.");
      const action = String(p.action || ""),
        payload = p.payload || {};
      const allowed = [
        "feed",
        "library",
        "hidden",
        "folders",
        "notes",
        "sources",
        "stats",
        "read",
        "feedback",
        "folder_save",
        "folder_delete",
        "save",
        "unsave",
        "note_save",
        "note_delete",
        "submit",
        "trash",
        "restore",
        "admin",
        "invite",
        "invite_revoke",
        "member_update",
        "source_save",
        "source_toggle",
        "profile_save",
        "rescan",
        "export",
        "recovery",
      ];
      if (!allowed.includes(action))
        throw new HttpError(400, "Unknown action.");
      if (["submit", "source_save"].includes(action))
        payload.url = publicHttpsURL(String(payload.url || ""));
      if (["invite", "recovery", "submit", "rescan", "export"].includes(action))
        await guardRate("sensitive:" + user.id + ":" + action, 10, 600);
      const out = await rpc("ss_api", { action, p: payload }, s.access_token);
      return respond(out);
    } catch (e) {
      if (e instanceof HttpError)
        return respond({ error: e.message }, e.status);
      return respond(
        { error: "The service is temporarily unavailable. Please try again." },
        503,
      );
    }
  };
}
