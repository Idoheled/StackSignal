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
    gemini_daily_limit: 20,
    search_monthly_limit: 800,
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
    [refresh, setRefresh] = useState(0);
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
                  priorities: data.profile.priorities || {},
                  queries: String(d.get("queries"))
                    .split("\n")
                    .map((x) => x.trim())
                    .filter(Boolean),
                  gemini_daily_limit: Number(d.get("gemini_daily_limit")),
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
            <label>
              Discovery queries{" "}
              <span className="optional">One per line · up to 20</span>
              <textarea
                name="queries"
                rows={4}
                defaultValue={data.profile.queries.join("\n")}
              />
            </label>
            <div className="form-grid">
              <label>
                Daily Gemini call ceiling
                <input
                  type="number"
                  name="gemini_daily_limit"
                  min={0}
                  max={500}
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
            <h3>Source registry</h3>
            <button
              className="secondary-button"
              onClick={() => setDialog({ type: "source" })}
            >
              <Plus size={15} /> Add source
            </button>
          </div>
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
                {sources.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <button
                        className="table-title"
                        onClick={() => setDialog({ type: "source", source: s })}
                      >
                        {s.name}
                      </button>
                    </td>
                    <td>{s.type}</td>
                    <td>{s.interval_minutes} min</td>
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
                : "Use an official RSS feed, GitHub releases API URL or documentation page. The collector only fetches approved public hosts."}
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
                        defaultValue={dialog.source?.type || "rss"}
                      >
                        <option value="rss">RSS / Atom</option>
                        <option value="github">GitHub releases</option>
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
