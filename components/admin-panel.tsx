"use client";
import { useEffect, useState } from "react";
import {
  Copy,
  Download,
  KeyRound,
  Plus,
  Radio,
  RefreshCw,
  ShieldCheck,
  Users,
  Activity,
  ArrowUpRight,
  Loader2,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { act, dateLabel } from "@/lib/client";
import { DEFAULT_REPO_QUERIES } from "@/lib/source-config";
import { Source, TOPICS } from "@/lib/domain";
type Props = {
  preview: boolean;
  previewProfile?: unknown;
  sources: Source[];
  notify: (s: string) => void;
  confirm: (t: string, b: string, run: () => Promise<void>) => void;
  onRefresh: () => void;
};
const EMPTY = {
  members: [],
  invites: [],
  audit: [],
  profile: {
    interests:
      "Bare metal, RoCE, InfiniBand, OpenShift, HyperShift, GPU operators, LLM serving, token quotas and optimization",
    queries: [
      "LLM inference serving benchmark vLLM SGLang",
      "OpenShift HyperShift GPU operator release",
      "RoCE InfiniBand NCCL performance",
    ],
    gemini_daily_limit: 0,
    gemini_monthly_limit: 100,
    gemini_mode: "off",
    search_monthly_limit: 0,
    repo_discovery: true,
    repo_queries: DEFAULT_REPO_QUERIES,
    min_score: 55,
  },
  jobs: {},
  usage: [],
  database_bytes: 0,
};
export default function AdminPanel({
  preview,
  previewProfile,
  sources,
  notify,
  confirm,
  onRefresh,
}: Props) {
  const [data, setData] = useState<any>(
      preview && previewProfile ? { ...EMPTY, profile: previewProfile } : EMPTY,
    ),
    [error, setError] = useState(""),
    [dialog, setDialog] = useState<any>(null),
    [link, setLink] = useState(""),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0),
    [sourceQuery, setSourceQuery] = useState("");
  useEffect(() => {
    if (preview) return;
    act("admin")
      .then(setData)
      .catch((e) => setError(e.message));
  }, [preview, refresh]);
  async function run(action: string, p: any = {}) {
    if (preview)
      throw new Error(
        "Connect the account service to manage real invitations, users and sources.",
      );
    const out = await act(action, p);
    setRefresh((x) => x + 1);
    onRefresh();
    return out;
  }
  const checked = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="admin-panel">
      {preview && (
        <div className="notice">
          <ShieldCheck size={17} />
          <span>
            Administrator preview. Real access management becomes available
            after backend setup.
          </span>
        </div>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <Tabs defaultValue="people">
        <TabsList className="admin-tabs">
          <TabsTrigger value="people">
            <Users size={14} /> People & access
          </TabsTrigger>
          <TabsTrigger value="coverage">
            <Radio size={14} /> Coverage
          </TabsTrigger>
          <TabsTrigger value="health">
            <Activity size={14} /> Health & audit
          </TabsTrigger>
        </TabsList>
        <TabsContent value="people">
          <div className="section-line">
            <div>
              <h3>Workspace members</h3>
              <p>One owner. Up to 100 invited members.</p>
            </div>
            <button
              className="primary"
              onClick={() => setDialog({ type: "invite" })}
            >
              <Plus size={15} /> Invite member
            </button>
          </div>
          <div className="permission-strip">
            <div>
              <strong>Administrator</strong>
              <span>Access, sources, content and settings</span>
            </div>
            <div>
              <strong>Maintainer</strong>
              <span>Curate, organize and discuss</span>
            </div>
            <div>
              <strong>Read-only</strong>
              <span>Read, browse and search</span>
            </div>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {(preview
                  ? [
                      {
                        id: "preview",
                        username: "administrator",
                        role: "admin",
                        active: true,
                      },
                    ]
                  : data.members || []
                ).map((m: any) => (
                  <tr key={m.id}>
                    <td>
                      <strong>{m.username}</strong>
                    </td>
                    <td>
                      {m.role === "admin" ? (
                        "Administrator"
                      ) : (
                        <select
                          aria-label={"Role for " + m.username}
                          value={m.role}
                          onChange={(e) => {
                            const role = e.target.value;
                            confirm(
                              "Change this member’s role?",
                              "Their current sessions will be revoked. They must sign in again with the new permissions.",
                              async () => {
                                await run("member_update", {
                                  id: m.id,
                                  role,
                                  active: m.active,
                                  confirmed: true,
                                });
                              },
                            );
                          }}
                        >
                          <option value="maintainer">Maintainer</option>
                          <option value="reader">Read-only</option>
                        </select>
                      )}
                    </td>
                    <td>
                      <span className="state-pill">
                        {m.active ? "Active" : "Disabled"}
                      </span>
                    </td>
                    <td>
                      {m.role === "admin" ? (
                        <span className="subtle">Protected owner</span>
                      ) : (
                        <div className="table-actions">
                          <button
                            onClick={() =>
                              confirm(
                                m.active
                                  ? "Disable this account?"
                                  : "Enable this account?",
                                m.active
                                  ? "Access will stop on the next request, including existing sessions."
                                  : "The member will be able to sign in again.",
                                async () => {
                                  await run("member_update", {
                                    id: m.id,
                                    role: m.role,
                                    active: !m.active,
                                    confirmed: true,
                                  });
                                },
                              )
                            }
                          >
                            {m.active ? "Disable" : "Enable"}
                          </button>
                          <button
                            onClick={() =>
                              confirm(
                                "Create a password reset link?",
                                "Share the resulting one-hour link privately with this member. Existing sessions are revoked when the password is reset. MFA remains enabled.",
                                async () => {
                                  const out = await run("recovery", {
                                    id: m.id,
                                    confirmed: true,
                                  });
                                  setLink(
                                    location.origin + "/#recover=" + out.token,
                                  );
                                },
                              )
                            }
                          >
                            Reset password
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="section-line">
            <h3>Invitations</h3>
            <small>Single use · expires after 24 hours</small>
          </div>
          {!(data.invites || []).length ? (
            <p className="subtle panel-empty">
              No invitations yet. Create one and share the link privately.
            </p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Label</th>
                    <th>Role</th>
                    <th>Expires</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.invites.map((i: any) => (
                    <tr key={i.id}>
                      <td>{i.label || "Invitation"}</td>
                      <td>{i.role}</td>
                      <td>{dateLabel(i.expires_at)}</td>
                      <td>
                        {i.used_at ? (
                          "Accepted"
                        ) : i.revoked ? (
                          "Revoked"
                        ) : new Date(i.expires_at) < new Date() ? (
                          "Expired"
                        ) : (
                          <button
                            className="text-button"
                            onClick={() =>
                              confirm(
                                "Revoke this invitation?",
                                "Anyone with this link will no longer be able to use it.",
                                async () => {
                                  await run("invite_revoke", {
                                    id: i.id,
                                    confirmed: true,
                                  });
                                },
                              )
                            }
                          >
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
        <TabsContent value="coverage">
          <div className="section-line">
            <div>
              <h3>What matters to your team</h3>
              <p>
                Use generic technical topics only. Search queries go to the
                search provider.
              </p>
            </div>
          </div>
          <form
            className="profile-form"
            key={refresh}
            onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              void checked(async () => {
                await run("profile_save", {
                  interests: d.get("interests"),
                  priorities: Object.fromEntries(TOPICS.slice(1).map(t => [t, Number(d.get("priority:"+t))])),
                  repo_discovery: d.get("repo_discovery") === "on",
                  repo_queries: String(d.get("repo_queries") || "").split("\n").map(x => x.trim()).filter(Boolean),
                  min_score: Number(d.get("min_score")),
                  queries: String(d.get("queries"))
                    .split("\n")
                    .map((x) => x.trim())
                    .filter(Boolean),
                  gemini_daily_limit: Number(d.get("gemini_daily_limit")),
                  gemini_mode: d.get("gemini_mode"),
                  gemini_monthly_limit: Number(d.get("gemini_monthly_limit")),
                  search_monthly_limit: Number(d.get("search_monthly_limit")),
                });
                notify("Coverage profile saved");
              });
            }}
          >
            <label>
              Team interests
              <textarea
                name="interests"
                rows={3}
                maxLength={5000}
                defaultValue={data.profile.interests}
              />
            </label>
            <div className="radar-settings">
              <div><h3>Look beyond the watchlist</h3><p className="subtle">Discover active public projects daily. No AI key or paid search is required. Queries are sent to GitHub: use public technical terms only.</p></div>
              <label className="check-label"><input type="checkbox" name="repo_discovery" defaultChecked={data.profile.repo_discovery !== false} /> Enable project discovery</label>
              <label>Repository discovery queries <span className="optional">One per line · up to 12 · 160 characters each</span>
                <textarea name="repo_queries" rows={5} defaultValue={(data.profile.repo_queries || DEFAULT_REPO_QUERIES).join("\n")} />
              </label>
              <label>Minimum match score <input type="number" name="min_score" min={45} max={85} defaultValue={data.profile.min_score || 55} /></label>
              <p className="subtle">Higher values produce a narrower feed. All discoveries remain searchable in the archive. Match scores measure relevance, not factual accuracy.</p>
              <div className="form-grid">{TOPICS.slice(1).map(t => <label key={t}>{t} priority<input type="number" min={-20} max={20} name={"priority:"+t} defaultValue={data.profile.priorities?.[t] || 0} /></label>)}</div>
            </div>
            <label>
              Web-search queries{" "}
              <span className="optional">One per line · up to 20</span>
              <textarea
                name="queries"
                rows={6}
                defaultValue={data.profile.queries.join("\n")}
              />
            </label>
            <p className="subtle">Tavily searches these public technical queries daily. Three quarters target recent material; a rotating quarter explores beyond the past week. Search snippets retain provenance; only approved hosts are automatically fetched.</p>
            <label>Gemini evaluation mode
              <select name="gemini_mode" defaultValue={data.profile.gemini_mode || "off"}>
                <option value="off">Off</option><option value="shadow">Compare only (recommended)</option><option value="rerank">Apply confident evaluations to ranking</option>
              </select>
            </label>
            <label>Monthly Gemini attempt ceiling<input type="number" name="gemini_monthly_limit" min={0} max={100} defaultValue={data.profile.gemini_monthly_limit ?? 100} /></label>
            <p className="subtle">Keep the Google API project on the Free tier. Flash Latest reviews a budgeted queue of public discoveries. It cannot guarantee AI review of every item within free quotas. Hard limits: 4 attempts in 24 hours and 100 per UTC calendar month; failures count. Calls are spaced across the remaining month. Saved mode and budgets survive redeployments. Compare mode preserves your feed. Only public excerpts and recognized public stack terms reach Google. A separate free-tier API key is required.</p>
            <div className="form-grid">
              <label>
                Gemini attempts per 24 hours
                <input
                  type="number"
                  name="gemini_daily_limit"
                  min={0}
                  max={4}
                  defaultValue={data.profile.gemini_daily_limit}
                />
              </label>
              <label>
                Monthly search ceiling
                <input
                  type="number"
                  name="search_monthly_limit"
                  min={0}
                  max={800}
                  defaultValue={data.profile.search_monthly_limit}
                />
              </label>
            </div>
            <p className="subtle">
              Set either limit to 0 to disable that integration. Feed collection
              and rule-based ranking work without AI or search APIs. Provider
              quotas may be lower.
            </p>
            <button className="primary" disabled={busy}>
              Save coverage profile
            </button>
          </form>
          <div className="section-line">
            <div><h3>Source & project registry</h3><p>Edit any watch, choose release channels, or pause collection.</p></div>
            <button
              className="secondary-button"
              onClick={() => setDialog({ type: "source" })}
            >
              <Plus size={15} /> Add source / follow project
            </button>
          </div>
          <label className="search-box source-search"><Radio size={15} /><input aria-label="Find a source or project" placeholder="Find a source or project…" value={sourceQuery} onChange={e => setSourceQuery(e.target.value)} /></label>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Type</th>
                  <th>Interval</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {sources.filter(s => (s.name+" "+s.url+" "+s.topic).toLowerCase().includes(sourceQuery.toLowerCase())).map((s) => (
                  <tr key={s.id}>
                    <td>
                      <button
                        className="table-title"
                        onClick={() => setDialog({ type: "source", source: s })}
                      >
                        {s.name}
                      </button>
                    </td>
                    <td>{s.type === "github" ? "GitHub" : s.type}<small className="cell-detail">{s.priority || "normal"}{s.type === "github" ? (s.include_prereleases ? " · incl. previews" : " · stable") : ""}</small></td>
                    <td>{s.interval_minutes} min<small className="cell-detail">{s.last_success_at ? "Checked " + dateLabel(s.last_success_at) : "Awaiting first check"}</small>{s.last_error && <small className="source-error">{s.last_error}</small>}</td>
                    <td>
                      <button
                        className="text-button"
                        onClick={() =>
                          confirm(
                            s.active
                              ? "Pause this source?"
                              : "Resume this source?",
                            s.active
                              ? "New content from this source will stop being collected. Existing links remain available."
                              : "The collector will resume checking this source.",
                            async () => {
                              await run("source_toggle", {
                                id: s.id,
                                active: !s.active,
                                confirmed: true,
                              });
                            },
                          )
                        }
                      >
                        {s.active ? "Pause" : "Resume"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>
        <TabsContent value="health">
          <div className="source-summary">
            <div>
              <strong>{data.jobs.pending || 0}</strong>
              <span>queued jobs</span>
            </div>
            <div>
              <strong>{data.jobs.failed || 0}</strong>
              <span>failed jobs</span>
            </div>
            <div>
              <strong>
                {data.database_bytes
                  ? (data.database_bytes / 1048576).toFixed(1)
                  : "—"}
              </strong>
              <span>database MB / 500 MB free</span>
            </div>
          </div>
          <div className="radar-settings">
            <h3>Discovery coverage</h3>
            <p className="subtle">Project search: {data.profile.repo_discovery === false ? "paused" : "enabled"} · Last success: {dateLabel(data.discovery_health?.repository_last_success)}</p>
            {data.discovery_health?.repository_last_error && <p className="source-error">{data.discovery_health.repository_last_error}</p>}
            {data.discovery_health?.repository_partial && <p className="subtle">GitHub reported partial search results. The next daily search will continue coverage.</p>}
            <div className="coverage-grid">{TOPICS.slice(1).map(t => {
              const watches = sources.filter(s => s.topic === t && s.active);
              return <div key={t}><strong>{t}</strong><span>{watches.length} active watches · {watches.filter(s => s.last_error || !s.last_success_at || Date.now()-Date.parse(s.last_success_at) > Math.max(3600000,s.interval_minutes*120000)).length} awaiting / delayed</span></div>;
            })}</div>
            <p className="subtle">Coverage comes from your watchlist, publication feeds and daily public project search. Optional web search and AI need separately configured API keys; a subscription does not activate them here.</p>
            <h3>Web discovery</h3>
            <h3>Gemini evaluation</h3>
            <p className="subtle">{(data.evaluation_health?.state || "not configured").replaceAll("_", " ")} · {data.profile.gemini_mode || "off"} · {data.evaluation_health?.model || "gemini-flash-latest"}</p>
            <p className="subtle">Attempts: {data.evaluation_health?.usage?.used_24h || 0} / {data.profile.gemini_daily_limit || 0} in 24 hours · {data.evaluation_health?.usage?.used_month || 0} / {data.profile.gemini_monthly_limit ?? 100} this month. Last success: {dateLabel(data.evaluation_health?.last_success)}</p>
            {data.evaluation_health?.next_attempt_at && <p className="subtle">Next paced opportunity: {new Date(data.evaluation_health.next_attempt_at).toLocaleString()}. Quotas, cooldowns and pending inputs can delay it.</p>}
            {data.evaluation_health?.coverage && <p className="subtle">AI coverage: {data.evaluation_health.coverage.evaluated} reviewed · {data.evaluation_health.coverage.pending} awaiting review · {data.evaluation_health.coverage.failed} failed · {data.evaluation_health.coverage.eligible} eligible public inputs. Updated {dateLabel(data.evaluation_health.coverage.checked_at)}. Rules continue while AI is pending. Release alerts bypass this queue.</p>}
            {data.evaluation_health?.resolved_model && <p className="subtle">Last successful model: {data.evaluation_health.resolved_model}</p>}
            {data.evaluation_health?.last_error && <p className="source-error">{data.evaluation_health.last_error}</p>}
            {(data.evaluation_health?.comparisons || []).map((c:any) => <div className="evaluation-comparison" key={c.article_id + c.evaluated_at}>
              <div><strong>{c.title}</strong><p className="subtle">Rules {c.rules_score} · AI {c.ai_score} · Applied {c.applied_score} · {c.confidence} confidence · {c.depth} · {c.scope.replaceAll("_", " ")}</p>
                <p>{c.summary}</p><p className="subtle">{c.reason}</p>{c.action && <p className="subtle">Consider: {c.action}</p>}{c.evidence && <blockquote>{c.evidence}</blockquote>}
              </div>
            </div>)}
            <p className="subtle">Tavily: {data.web_discovery_health?.configured ? Number(data.profile.search_monthly_limit) > 0 ? (data.web_discovery_health.state || "ready").replaceAll("_", " ") : "paused" : "API key not configured"} · Last successful search: {dateLabel(data.web_discovery_health?.last_success)}</p>
            <p className="subtle">Ceiling: {data.profile.search_monthly_limit || 0} basic searches per month · Hard daily ceiling: 24. Provider billing and credits are managed in your Tavily account.</p>
            {data.web_discovery_health?.last_error && <p className="source-error">{data.web_discovery_health.last_error}</p>}
            {data.web_discovery_health?.last_query && <p className="subtle">Last query: {data.web_discovery_health.last_query}<br />{data.web_discovery_health.last_accepted || 0} new references · {data.web_discovery_health.last_duplicates || 0} already known · {data.web_discovery_health.last_filtered || 0} filtered</p>}
          </div>
          <div className="health-actions">
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() =>
                void checked(async () => {
                  await run("rescan");
                  notify("Source checks queued for the next collector run");
                })
              }
            >
              <RefreshCw size={14} /> Check sources next run
            </button>
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() =>
                void checked(async () => {
                  const out = await run("export");
                  const url = URL.createObjectURL(
                    new Blob([JSON.stringify(out, null, 2)], {
                      type: "application/json",
                    }),
                  );
                  const a = document.createElement("a");
                  a.href = url;
                  a.download =
                    "stacksignal-export-" +
                    new Date().toISOString().slice(0, 10) +
                    ".json";
                  a.click();
                  URL.revokeObjectURL(url);
                  notify("Content export downloaded");
                })
              }
            >
              <Download size={14} /> Export workspace content
            </button>
          </div>
          <p className="subtle">
            Exports include shared content and your own private notes.
            Authentication data and other members’ private notes require a
            separate administrator database backup.
          </p>
          <div className="section-line">
            <h3>Integration usage</h3>
          </div>
          {data.usage.length ? (
            data.usage.map((u: any) => (
              <div className="usage-row" key={u.key}>
                <code>{u.key.replace("budget:", "")}</code>
                <strong>{u.n} requests</strong>
                <small>Resets {dateLabel(u.expires_at)}</small>
              </div>
            ))
          ) : (
            <p className="subtle panel-empty">
              No metered integration calls recorded.
            </p>
          )}
          <div className="section-line">
            <h3>Audit trail</h3>
            <small>Latest 100 events · content is not logged</small>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Username</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {data.audit.map((a: any) => (
                  <tr key={a.id}>
                    <td>{a.action.replaceAll("_", " ")}</td>
                    <td>{a.username || "System"}</td>
                    <td>{dateLabel(a.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.audit.length && (
              <p className="subtle panel-empty">
                Workspace activity will appear here.
              </p>
            )}
          </div>
        </TabsContent>
      </Tabs>
      <Dialog
        open={!!dialog}
        onOpenChange={(v) => {
          if (!v) setDialog(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog?.type === "invite"
                ? "Invite a teammate"
                : "Configure a source"}
            </DialogTitle>
            <DialogDescription>
              {dialog?.type === "invite"
                ? "They choose their own username and password. Share the link through a trusted private channel."
                : "Paste a public GitHub project URL to follow releases, or add an official RSS feed or documentation page. Existing library links are kept when a watch is removed. Automatic fetches use approved publisher hosts."}
            </DialogDescription>
          </DialogHeader>
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          {dialog && (
            <form
              className="dialog-form"
              onSubmit={(e) => {
                e.preventDefault();
                const d = new FormData(e.currentTarget);
                void checked(async () => {
                  if (dialog.type === "invite") {
                    const out = await run("invite", {
                      label: d.get("label"),
                      role: d.get("role"),
                    });
                    setLink(location.origin + "/#invite=" + out.token);
                  } else
                    await run("source_save", {
                      ...(dialog.source ? { id: dialog.source.id } : {}),
                      name: d.get("name"),
                      url: d.get("url"),
                      type: d.get("type"),
                      topic: d.get("topic"),
                      interval_minutes: Number(d.get("interval_minutes")),
                      include_prereleases: d.get("include_prereleases") === "on",
                      priority: d.get("priority"),
                    });
                  setDialog(null);
                  notify("Saved");
                });
              }}
            >
              {dialog.type === "invite" ? (
                <>
                  <label>
                    Invitation label
                    <input
                      name="label"
                      maxLength={100}
                      placeholder="e.g. Platform team"
                    />
                  </label>
                  <label>
                    Role
                    <select name="role">
                      <option value="maintainer">Maintainer</option>
                      <option value="reader">Read-only</option>
                    </select>
                  </label>
                </>
              ) : (
                <>
                  <label>
                    Name
                    <input
                      name="name"
                      required
                      maxLength={120}
                      defaultValue={dialog.source?.name}
                    />
                  </label>
                  <label>
                    Public HTTPS URL
                    <input
                      name="url"
                      type="url"
                      required
                      maxLength={2048}
                      defaultValue={dialog.source?.url}
                    />
                  </label>
                  <div className="form-grid">
                    <label>
                      Type
                      <select
                        name="type"
                        defaultValue={dialog.source?.type || "github"}
                      >
                        <option value="rss">RSS / Atom</option>
                        <option value="github">GitHub project / releases</option>
                        <option value="page">Documentation page</option>
                      </select>
                    </label>
                    <label>
                      Check interval (minutes)
                      <input
                        name="interval_minutes"
                        type="number"
                        min={30}
                        max={10080}
                        defaultValue={dialog.source?.interval_minutes || 240}
                      />
                    </label>
                  </div>
                  <label>Priority<select name="priority" defaultValue={dialog.source?.priority || "normal"}><option value="core">Core stack</option><option value="normal">Normal</option><option value="explore">Explore</option></select></label>
                  <label className="check-label"><input type="checkbox" name="include_prereleases" defaultChecked={dialog.source?.include_prereleases || false} /> Include GitHub prereleases (clearly labeled)</label>
                  <label>
                    Topic
                    <select
                      name="topic"
                      defaultValue={dialog.source?.topic || "Inference"}
                    >
                      {TOPICS.slice(1).map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              {dialog.type === "source" && dialog.source && <div className="source-manage-actions">
                <button type="button" className="secondary-button" disabled={busy || !dialog.source.active} onClick={() => void checked(async () => { await run("source_scan",{id:dialog.source.id}); notify("Check queued for the next collector run"); })}><RefreshCw size={14} /> Check next run</button>
                <button type="button" className="text-button" disabled={busy} onClick={() => confirm("Remove this watch?", "Collection stops for this source. Its existing articles, saved links and notes stay in the library.", async () => { await run("source_delete",{id:dialog.source.id,confirmed:true}); setDialog(null); notify("Watch removed; library preserved"); })}>Remove watch</button>
              </div>}
              <button className="primary" disabled={busy}>
                {busy ? (
                  <Loader2 size={15} className="spin" />
                ) : dialog.type === "invite" ? (
                  "Generate invitation"
                ) : (
                  "Save source"
                )}
              </button>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!link}
        onOpenChange={(v) => {
          if (!v) setLink("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Share this link privately.</DialogTitle>
            <DialogDescription>
              The secret is shown once. Anyone holding this link may use it
              until it expires or is revoked.
            </DialogDescription>
          </DialogHeader>
          <textarea
            readOnly
            value={link}
            rows={4}
            aria-label="One-time access link"
          />
          <button
            className="primary"
            onClick={() =>
              void checked(async () => {
                await navigator.clipboard.writeText(link);
                notify("Link copied");
              })
            }
          >
            <Copy size={15} /> Copy link
          </button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
