"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowDownUp,
  ArrowRight,
  ArrowUpRight,
  Bookmark,
  Check,
  CheckCheck,
  ChevronRight,
  Clock3,
  ExternalLink,
  FileText,
  Folder as FolderIcon,
  FolderPlus,
  Layers3,
  Library,
  Link2,
  Loader2,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Radio,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  ThumbsUp,
  Trash2,
  X,
  EyeOff,
  RotateCcw,
  LockKeyhole,
  Pencil,
  Network,
  Cpu,
  Server,
  BookOpen,
  Inbox,
} from "lucide-react";
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarInset,
  SidebarTrigger,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/ui/sidebar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Article,
  Folder,
  Note,
  Source,
  TOPICS,
  PREVIEW_ARTICLES,
  SEED_SOURCES,
  folderPath,
  basicRelevance,
} from "@/lib/domain";
import { api, act, dateLabel } from "@/lib/client";
import { Access, SecurityGate } from "./access";
import AdminPanel from "./admin-panel";
type View = "feed" | "library" | "hidden" | "sources" | "admin" | "trash";
type Confirm = { title: string; body: string; run: () => Promise<void> };
const DEMO_FOLDERS: Folder[] = [
  { id: "inbox", name: "Inbox", parent_id: null },
  { id: "inference", name: "Inference & serving", parent_id: null },
  { id: "optimization", name: "Optimization", parent_id: "inference" },
  { id: "networking", name: "Networking & fabric", parent_id: null },
  { id: "platforms", name: "Platforms", parent_id: null },
];
const topicIcons: Record<string, typeof Cpu> = {
  Inference: Layers3,
  Platforms: Server,
  Networking: Network,
  Hardware: Cpu,
  "Models & research": BookOpen,
  Operations: Activity,
};
export default function Workspace() {
  const [status, setStatus] = useState<any>(null),
    [session, setSession] = useState<any>(null),
    [loadingSession, setLoadingSession] = useState(true),
    [preview, setPreview] = useState(false),
    [fatal, setFatal] = useState("");
  const refreshSession = useCallback(async () => {
    try {
      setSession(await api("me"));
    } catch {
      setSession(null);
    } finally {
      setLoadingSession(false);
    }
  }, []);
  useEffect(() => {
    api("status")
      .then((s) => {
        setStatus(s);
        if (s.configured) void refreshSession();
        else setLoadingSession(false);
      })
      .catch(() => {
        setFatal(
          "Unable to reach the workspace. Please refresh and try again.",
        );
        setLoadingSession(false);
      });
  }, [refreshSession]);
  const logout = async () => {
    if (!preview)
      try {
        await api("logout", {});
      } catch {
        setFatal("Sign-out could not be completed. Please retry.");
        return;
      }
    setPreview(false);
    setSession(null);
  };
  if (fatal)
    return (
      <div className="security-gate">
        <div className="error" role="alert">
          {fatal}
          <button className="text-button" onClick={() => location.reload()}>
            Reload workspace
          </button>
        </div>
      </div>
    );
  if (loadingSession)
    return (
      <div className="security-gate">
        <Loader2 className="spin" />
        <span className="subtle">Opening StackSignal…</span>
      </div>
    );
  if (!session && !preview)
    return (
      <Access
        status={status}
        onLogin={refreshSession}
        onPreview={() => setPreview(true)}
      />
    );
  if (session && (session.must_change_password || session.mfa_required))
    return (
      <SecurityGate
        session={session}
        onRefresh={refreshSession}
        onLogout={logout}
        onSessionEnded={() => setSession(null)}
      />
    );
  return (
    <Hub
      preview={preview}
      member={
        session?.member || {
          id: "preview",
          username: "preview",
          display_name: "Preview workspace",
          role: "admin",
        }
      }
      onLogout={logout}
      onSessionEnded={() => setSession(null)}
    />
  );
}
function Hub({
  preview,
  member,
  onLogout,
  onSessionEnded,
}: {
  preview: boolean;
  member: any;
  onLogout: () => void;
  onSessionEnded: () => void;
}) {
  const [view, setView] = useState<View>("feed"),
    [mode, setMode] = useState("week"),
    [topic, setTopic] = useState("All topics"),
    [query, setQuery] = useState(""),
    [debounced, setDebounced] = useState(""),
    [folder, setFolder] = useState(""),
    [sort, setSort] = useState("relevance"),
    [unread, setUnread] = useState(false);
  const [items, setItems] = useState<Article[]>([]),
    [total, setTotal] = useState(0),
    [offset, setOffset] = useState(0),
    [folders, setFolders] = useState<Folder[]>(preview ? DEMO_FOLDERS : []),
    [sources, setSources] = useState<Source[]>([]),
    [stats, setStats] = useState<any>({}),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0),
    [error, setError] = useState(""),
    [toast, setToast] = useState("");
  const [demoArticles, setDemoArticles] = useState<Article[]>(PREVIEW_ARTICLES),
    [demoNotes, setDemoNotes] = useState<Note[]>([]),
    [trashed, setTrashed] = useState<any>({ folders: [], notes: [] }),
    [selected, setSelected] = useState<Article | null>(null),
    [notes, setNotes] = useState<Note[]>([]),
    [reply, setReply] = useState<string | null>(null),
    [editNote, setEditNote] = useState<Note | null>(null),
    [noteVisibility, setNoteVisibility] = useState("team");
  const [dialog, setDialog] = useState<any>(null),
    [confirmation, setConfirmation] = useState<Confirm | null>(null),
    [working, setWorking] = useState(false),
    [light, setLight] = useState(false);
  const canWrite = member.role !== "reader";
  const notify = (s: string) => setToast(s);
  const reload = () => setRefresh((x) => x + 1);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 220);
    return () => clearTimeout(t);
  }, [query]);
  useEffect(() => {
    setOffset(0);
  }, [view, mode, topic, debounced, folder, sort, unread]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4200);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    document.documentElement.classList.toggle("light", light);
    return () => document.documentElement.classList.remove("light");
  }, [light]);
  useEffect(() => {
    if (preview) return;
    const t = setInterval(() => setRefresh((x) => x + 1), 60000);
    return () => clearInterval(t);
  }, [preview]);
  async function perform(action: string, p: any = {}) {
    if (!preview) return act(action, p);
    // Preview also runs over the internal HTTP development origin.
    const id =
      "preview-" +
      Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
    if (action === "feedback" || action === "read")
      setDemoArticles((as) =>
        as.map((a) =>
          a.id === p.article_id
            ? { ...a, ...p, read: action === "read" ? true : a.read }
            : a,
        ),
      );
    if (action === "save" || action === "unsave")
      setDemoArticles((as) =>
        as.map((a) => {
          if (a.id !== p.article_id) return a;
          const ids =
            action === "save"
              ? [...new Set([...(a.folder_ids || []), p.folder_id || "inbox"])]
              : (a.folder_ids || []).filter((i) => i !== p.folder_id);
          return { ...a, saved: ids.length > 0, folder_ids: ids };
        }),
      );
    if (action === "folder_save") {
      let parent = p.parent_id;
      while (parent) {
        if (parent === p.id) throw new Error("A folder cannot contain itself.");
        parent = folders.find((f) => f.id === parent)?.parent_id;
      }
      setFolders((fs) =>
        p.id
          ? fs.map((f) =>
              f.id === p.id
                ? { ...f, ...p, parent_id: p.parent_id || null }
                : f,
            )
          : [...fs, { id, name: p.name, parent_id: p.parent_id || null }],
      );
    }
    if (action === "folder_delete") {
      const ids = new Set([p.id]);
      let changed = true;
      while (changed) {
        changed = false;
        folders.forEach((f) => {
          if (f.parent_id && ids.has(f.parent_id) && !ids.has(f.id)) {
            ids.add(f.id);
            changed = true;
          }
        });
      }
      setTrashed((t: any) => ({
        ...t,
        folders: [...t.folders, ...folders.filter((f) => ids.has(f.id))],
      }));
      setFolders((fs) => fs.filter((f) => !ids.has(f.id)));
      setFolder("");
    }
    if (action === "note_save")
      setDemoNotes((ns) =>
        p.id
          ? ns.map((n) => (n.id === p.id ? { ...n, body: p.body } : n))
          : [
              ...ns,
              {
                id,
                article_id: p.article_id,
                body: p.body,
                visibility: p.visibility,
                parent_id: p.parent_id,
                user_id: member.id,
                username: member.username,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
            ],
      );
    if (action === "note_delete") {
      setTrashed((t: any) => ({
        ...t,
        notes: [...t.notes, ...demoNotes.filter((n) => n.id === p.id)],
      }));
      setDemoNotes((ns) => ns.filter((n) => n.id !== p.id));
    }
    if (action === "restore") {
      if (p.type === "folder") {
        setFolders((fs) => [...fs, ...trashed.folders]);
        setTrashed((t: any) => ({ ...t, folders: [] }));
      } else {
        setDemoNotes((ns) => [
          ...ns,
          ...trashed.notes.filter((n: Note) => n.id === p.id),
        ]);
        setTrashed((t: any) => ({
          ...t,
          notes: t.notes.filter((n: Note) => n.id !== p.id),
        }));
      }
    }
    if (action === "submit") {
      const u = new URL(p.url);
      if (u.protocol !== "https:") throw new Error("Use an HTTPS link.");
      const relevance = basicRelevance(p.title + " " + p.url);
      setDemoArticles((as) => [
        {
          id,
          title: p.title || u.hostname,
          url: p.url,
          source: u.hostname,
          published_at: null,
          discovered_at: new Date().toISOString(),
          kind: "Submitted link",
          ...relevance,
          summary:
            "Added in preview. Automatic extraction runs after backend setup.",
          saved: true,
          liked: p.teach,
          folder_ids: [p.folder_id || "inbox"],
          analysis_status: "reference",
        },
        ...as,
      ]);
    }
    return { ok: true, id };
  }
  async function change(action: string, p: any = {}, message = "Updated") {
    try {
      await perform(action, p);
      reload();
      notify(message);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }
  useEffect(() => {
    let cancelled = false;
    setError("");
    setBusy(true);
    async function load() {
      try {
        if (preview) {
          setSources(
            SEED_SOURCES.map((s, i) => ({
              id: String(i),
              name: s[0],
              url: s[1],
              type: s[2],
              topic: s[3],
              active: true,
              interval_minutes: 240,
              last_success_at: null,
              last_error: null,
            })),
          );
          setStats({
            week: 0,
            saved: demoArticles.filter((a) => a.saved).length,
            sources: SEED_SOURCES.length,
          });
          let list = demoArticles.filter((a) =>
            view === "hidden" ? a.hidden : !a.hidden,
          );
          if (view === "library")
            list = list.filter(
              (a) =>
                a.saved &&
                (!folder ||
                  (a.folder_ids || []).some((id) => {
                    let f = folders.find((x) => x.id === id);
                    const visited = new Set();
                    while (f && !visited.has(f.id)) {
                      if (f.id === folder) return true;
                      visited.add(f.id);
                      f = folders.find((x) => x.id === f?.parent_id);
                    }
                    return false;
                  })),
            );
          if (topic !== "All topics")
            list = list.filter((a) => a.topic === topic);
          list = list.filter(
            (a) =>
              a.title.toLowerCase().includes(debounced.toLowerCase()) &&
              (!unread || !a.read),
          );
          list.sort((a, b) =>
            sort === "relevance"
              ? b.score - a.score
              : b.discovered_at.localeCompare(a.discovered_at),
          );
          setItems(list.slice(offset, offset + 30));
          setTotal(list.length);
          return;
        }
        const results = await Promise.all([
          act("folders"),
          act("sources"),
          act("stats"),
          ["feed", "library", "hidden"].includes(view)
            ? act(view, {
                mode,
                topic,
                q: debounced,
                folder,
                sort,
                unread,
                offset,
                limit: 30,
              })
            : Promise.resolve(null),
          view === "trash" ? act("trash") : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setFolders(results[0]);
        setSources(results[1]);
        setStats(results[2]);
        if (results[3]) {
          setItems(results[3].items);
          setTotal(results[3].total);
        }
        if (results[4]) setTrashed(results[4]);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setBusy(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
    // folders are stable across live loads; preview changes intentionally trigger the local filter.
  }, [
    view,
    mode,
    topic,
    debounced,
    folder,
    sort,
    unread,
    offset,
    refresh,
    preview,
    demoArticles,
  ]);
  useEffect(() => {
    let cancelled = false;
    if (!selected) return;
    const current = (preview ? demoArticles : items).find(
      (a) => a.id === selected.id,
    );
    if (current) setSelected(current);
    if (preview) {
      setNotes(demoNotes.filter((n) => n.article_id === selected.id));
      return;
    }
    act("notes", { article_id: selected.id })
      .then((n) => {
        if (!cancelled) setNotes(n);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [selected?.id, refresh, demoNotes, demoArticles, items, preview]);
  function navigate(v: View, f = "") {
    setView(v);
    setFolder(f);
    setQuery("");
    setTopic("All topics");
  }
  function openArticle(a: Article) {
    setSelected(a);
    setReply(null);
    setEditNote(null);
    if (!a.read) void change("read", { article_id: a.id }, "Marked as read");
  }
  function confirm(title: string, body: string, run: () => Promise<void>) {
    setConfirmation({ title, body, run });
  }
  function hide(a: Article) {
    confirm(
      a.hidden ? "Restore this signal?" : "Mark this as not relevant?",
      a.hidden
        ? "Return it to your feed."
        : "This hides the link for you and adjusts your topic preferences. You can restore it in Hidden signals.",
      async () => {
        await perform("feedback", {
          article_id: a.id,
          hidden: !a.hidden,
          confirmed: true,
        });
        reload();
        setSelected(null);
      },
    );
  }
  function tree(parent: string | null = null, depth = 0): React.ReactNode {
    return folders
      .filter((f) => f.parent_id === parent)
      .map((f) => (
        <div key={f.id}>
          <button
            className={
              "folder-nav " +
              (view === "library" && folder === f.id ? "active" : "")
            }
            style={{ paddingLeft: 16 + depth * 15 }}
            onClick={() => navigate("library", f.id)}
          >
            <FolderIcon size={15} />
            <span>{f.name}</span>
            <small>
              {preview
                ? demoArticles.filter((a) => a.folder_ids?.includes(f.id))
                    .length
                : f.count || ""}
            </small>
          </button>
          {depth < 20 && tree(f.id, depth + 1)}
        </div>
      ));
  }
  const folderObj = folders.find((f) => f.id === folder);
  const title =
    view === "feed"
      ? "Your signal, distilled."
      : view === "library"
        ? folderObj?.name || "The team library."
        : view === "sources"
          ? "A pulse on your stack."
          : view === "admin"
            ? "Workspace controls."
            : view === "hidden"
              ? "Hidden signals."
              : "Recover your work.";
  const description =
    view === "feed"
      ? "The releases, research and ideas worth your attention."
      : view === "library"
        ? "Collect what matters. Make it useful together."
        : view === "sources"
          ? "A transparent view of what is being watched, and when."
          : view === "admin"
            ? "Access, coverage and usage. All in your hands."
            : view === "hidden"
              ? "Your personal relevance feedback. Restore a link at any time."
              : "Deleted folders and notes stay here for 30 days.";
  const picked =
    (selected &&
      (preview ? demoArticles : items).find((a) => a.id === selected.id)) ||
    selected;
  return (
    <SidebarProvider
      style={{ "--sidebar-width": "244px" } as React.CSSProperties}
    >
      <Sidebar className="app-sidebar">
        <SidebarHeader>
          <button
            className="brand sidebar-brand"
            onClick={() => navigate("feed")}
          >
            <Layers3 size={26} /> StackSignal
            <span className="brand-dot" />
          </button>
          <div className="workspace-label">
            <span className="team-avatar">AI</span>
            <div>
              AI Engineering<small>Private workspace</small>
            </div>
            <LockKeyhole size={12} />
          </div>
        </SidebarHeader>
        <SidebarContent>
          <div className="nav-label">WORKSPACE</div>
          <SidebarMenu className="main-nav">
            {(
              [
                {
                  v: "feed",
                  label: "Discover",
                  icon: Radio,
                  n: preview ? null : stats.week,
                },
                {
                  v: "library",
                  label: "Library",
                  icon: Library,
                  n: stats.saved,
                },
                { v: "sources", label: "Sources", icon: Activity, n: null },
              ] as const
            ).map((n) => (
              <SidebarMenuItem key={n.v}>
                <SidebarMenuButton
                  size="lg"
                  isActive={view === n.v && !folder}
                  onClick={() => navigate(n.v)}
                >
                  <n.icon />
                  <span>{n.label}</span>
                  {n.n != null && <span className="nav-count">{n.n}</span>}
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
          <div className="nav-label folders-label">
            COLLECTIONS
            {canWrite && (
              <button
                title="Create folder"
                aria-label="Create folder"
                onClick={() => setDialog({ type: "folder" })}
              >
                <Plus size={15} />
              </button>
            )}
          </div>
          <div className="folder-tree">
            {tree()}
            {!folders.length && (
              <p className="sidebar-empty">
                Save your first link to get started.
              </p>
            )}
          </div>
          <div className="sidebar-bottom-links">
            <button
              onClick={() => navigate("hidden")}
              className={view === "hidden" ? "active" : ""}
            >
              <EyeOff size={15} /> Hidden signals
            </button>
            {canWrite && (
              <button
                onClick={() => navigate("trash")}
                className={view === "trash" ? "active" : ""}
              >
                <Trash2 size={15} /> Trash
              </button>
            )}
            {member.role === "admin" && (
              <button
                onClick={() => navigate("admin")}
                className={view === "admin" ? "active" : ""}
              >
                <Settings2 size={15} /> Administration
              </button>
            )}
          </div>
        </SidebarContent>
        <SidebarFooter>
          <div className="coverage-mini">
            <span className="status-dot" />{" "}
            {preview
              ? "Preview mode"
              : stats.last_scan
                ? "Source monitoring active"
                : "Awaiting first scan"}
            <small>
              {preview
                ? "Public references · temporary changes"
                : stats.last_scan
                  ? "Last success " + dateLabel(stats.last_scan)
                  : "Configure the collector to begin"}
            </small>
          </div>
          <div className="profile-row">
            <span className="user-avatar">
              {member.username.slice(0, 2).toUpperCase()}
            </span>
            <div>
              <button
                className="profile-name"
                title="Change password"
                onClick={() => setDialog({ type: "password" })}
              >
                {member.username}
              </button>
              <small>
                {preview
                  ? "Explore the workspace"
                  : member.role === "reader"
                    ? "Read-only"
                    : member.role === "admin"
                      ? "Administrator"
                      : "Maintainer"}
              </small>
            </div>
            <button aria-label="Sign out" title="Sign out" onClick={onLogout}>
              <LogOut size={17} />
            </button>
          </div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="topbar">
          <div className="breadcrumb">
            <SidebarTrigger />
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>
              {view === "feed"
                ? "Discover"
                : view === "admin"
                  ? "Administration"
                  : view.charAt(0).toUpperCase() + view.slice(1)}
            </strong>
          </div>
          <div className="topbar-actions">
            <span className="private-pill">
              <LockKeyhole size={11} /> PRIVATE
            </span>
            <button
              className="icon-button"
              aria-label={light ? "Use dark theme" : "Use light theme"}
              onClick={() => setLight(!light)}
            >
              <Sun size={17} />
            </button>
            {canWrite && (
              <button
                className="primary"
                onClick={() => setDialog({ type: "submit" })}
              >
                <Plus size={16} /> Add a link
              </button>
            )}
          </div>
        </header>
        {preview && (
          <div className="preview-banner">
            <Sparkles size={14} />
            <span>
              Interactive preview · public reference links, not this week’s
              news. Changes last until you leave.
            </span>
            <button onClick={onLogout}>
              Back to login <ArrowRight size={13} />
            </button>
          </div>
        )}
        <div className="page-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow page-eyebrow">
                {view === "feed"
                  ? "THE ENGINEERING BRIEF"
                  : view === "library"
                    ? "SHARED KNOWLEDGE"
                    : view === "sources"
                      ? "SOURCE OBSERVABILITY"
                      : view === "admin"
                        ? "ADMINISTRATOR"
                        : "YOUR WORKSPACE"}
              </div>
              <h1>{title}</h1>
              <p>{description}</p>
            </div>
            {view === "library" && canWrite && (
              <div className="heading-actions">
                <button
                  className="secondary-button"
                  onClick={() =>
                    setDialog({ type: "folder", parent_id: folder })
                  }
                >
                  <FolderPlus size={15} /> New folder
                </button>
                {folderObj && (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className="icon-button"
                      aria-label="Folder actions"
                    >
                      <MoreHorizontal size={20} />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem
                        onClick={() =>
                          setDialog({ type: "folder", ...folderObj })
                        }
                      >
                        Rename or move
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          confirm(
                            "Delete this folder?",
                            `“${folderObj.name}” and its subfolders will move to Trash for 30 days. Saved links remain recoverable.`,
                            async () => {
                              await perform("folder_delete", {
                                id: folder,
                                confirmed: true,
                              });
                              setFolder("");
                              reload();
                            },
                          )
                        }
                      >
                        Move to trash
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            )}
          </div>
          {error && (
            <div className="error error-row" role="alert">
              {error}
              <button onClick={() => setError("")} aria-label="Dismiss error">
                <X size={15} />
              </button>
            </div>
          )}
          {["feed", "library", "hidden"].includes(view) && (
            <>
              <div className="discovery-toolbar">
                {view === "feed" ? (
                  <Tabs value={mode} onValueChange={setMode}>
                    <TabsList className="feed-tabs">
                      <TabsTrigger value="week">This week</TabsTrigger>
                      <TabsTrigger value="updates">Updated docs</TabsTrigger>
                      <TabsTrigger value="archive">All discoveries</TabsTrigger>
                    </TabsList>
                  </Tabs>
                ) : (
                  <span className="library-scope">
                    <Library size={15} />
                    {folderObj
                      ? folderPath(folderObj, folders) + " / all subfolders"
                      : "All folders & subfolders"}
                  </span>
                )}
                <label className="search-box">
                  <Search size={16} />
                  <input
                    aria-label={
                      view === "library"
                        ? "Search saved titles"
                        : "Search titles"
                    }
                    placeholder={
                      view === "library"
                        ? "Search saved titles…"
                        : "Search titles…"
                    }
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  {query && (
                    <button
                      aria-label="Clear search"
                      onClick={() => setQuery("")}
                    >
                      <X size={13} />
                    </button>
                  )}
                </label>
              </div>
              <div className="topic-row">
                {TOPICS.map((t) => (
                  <button
                    key={t}
                    className={topic === t ? "topic active" : "topic"}
                    onClick={() => setTopic(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <div className="feed-layout">
                <section className="signal-list">
                  <div className="results-row">
                    <span>
                      {busy ? (
                        <>
                          <Loader2 size={12} className="spin" /> Updating
                        </>
                      ) : (
                        <>
                          <span className="status-dot" />
                          {total} {preview ? "reference links" : "signals"}
                        </>
                      )}
                      {view === "feed" && !preview && (
                        <small>
                          {" "}
                          ·{" "}
                          {mode === "week"
                            ? "published in the past 7 days"
                            : mode === "updates"
                              ? "changed in the past 7 days"
                              : "including undated references"}
                        </small>
                      )}
                    </span>
                    <div>
                      <label className="check-label">
                        <input
                          type="checkbox"
                          checked={unread}
                          onChange={(e) => setUnread(e.target.checked)}
                        />{" "}
                        Unread
                      </label>
                      <label className="sort-label">
                        <ArrowDownUp size={12} />
                        <select
                          aria-label="Sort signals"
                          value={sort}
                          onChange={(e) => setSort(e.target.value)}
                        >
                          <option value="relevance">Relevance</option>
                          <option value="newest">Newest</option>
                        </select>
                      </label>
                    </div>
                  </div>
                  {!items.length && !busy ? (
                    <div className="empty-state">
                      <Radio size={32} />
                      <h3>
                        {query
                          ? "No matching titles."
                          : view === "library"
                            ? "A place for what matters."
                            : "You’re up to date."}
                      </h3>
                      <p>
                        {query
                          ? "Try another keyword or search across all folders."
                          : view === "library"
                            ? "Save a signal or add a link to start your collection."
                            : "New signals appear here after the collector finds matching publications. Undated links live in All discoveries."}
                      </p>
                      {canWrite && view === "library" && (
                        <button
                          className="secondary-button"
                          onClick={() => setDialog({ type: "submit" })}
                        >
                          <Plus size={14} /> Add a link
                        </button>
                      )}
                    </div>
                  ) : (
                    items.map((a, index) => {
                      const Icon = topicIcons[a.topic] || FileText;
                      return (
                        <article
                          key={a.id}
                          className={
                            "signal-card " +
                            (index === 0 && view === "feed"
                              ? "lead-signal "
                              : "") +
                            (a.read ? "is-read" : "")
                          }
                        >
                          <div className="signal-topline">
                            <span
                              className={
                                "source-icon tone-" +
                                (TOPICS.indexOf(a.topic) % 4)
                              }
                            >
                              <Icon size={16} />
                            </span>
                            <span className="source-name">{a.source}</span>
                            <span className="source-separator">/</span>
                            <span>{a.kind}</span>
                            <span className="signal-date">
                              {a.published_at
                                ? dateLabel(a.published_at)
                                : "Undated reference"}
                            </span>
                          </div>
                          <button
                            className="signal-title"
                            onClick={() => openArticle(a)}
                          >
                            <h2>{a.title}</h2>
                            <ArrowUpRight size={19} />
                          </button>
                          <p className="signal-summary">
                            {a.summary ||
                              "Metadata extraction is queued. Open the original for details."}
                          </p>
                          <div className="tag-row">
                            {a.tags.slice(0, 3).map((t) => (
                              <span key={t}>{t}</span>
                            ))}
                          </div>
                          <div className="signal-footer">
                            <button
                              className="relevance"
                              onClick={() => openArticle(a)}
                            >
                              <Sparkles size={13} />
                              {a.analysis_status === "reference"
                                ? "Profile match"
                                : a.analysis_status === "ai"
                                  ? "AI assisted match"
                                  : "Topic match"}
                              <span>{a.score}</span>
                            </button>
                            <div className="article-actions">
                              {canWrite && (
                                <button
                                  className={a.liked ? "chosen" : ""}
                                  onClick={() =>
                                    void change(
                                      "feedback",
                                      { article_id: a.id, liked: !a.liked },
                                      a.liked
                                        ? "Feedback removed"
                                        : "Marked helpful",
                                    )
                                  }
                                  aria-label={
                                    a.liked
                                      ? "Remove helpful vote"
                                      : "Mark helpful"
                                  }
                                  title="Helpful"
                                >
                                  <ThumbsUp size={15} />
                                  {a.likes || ""}
                                </button>
                              )}
                              <button
                                onClick={() => openArticle(a)}
                                aria-label="View notes and comments"
                                title="Notes & comments"
                              >
                                <MessageSquare size={15} />
                                {a.comments || ""}
                              </button>
                              {canWrite && (
                                <button
                                  className={a.saved ? "chosen" : ""}
                                  onClick={() =>
                                    setDialog({ type: "save", article: a })
                                  }
                                  aria-label="Save to a folder"
                                  title="Save to a folder"
                                >
                                  <Bookmark
                                    size={15}
                                    fill={a.saved ? "currentColor" : "none"}
                                  />
                                </button>
                              )}
                              {canWrite && (
                                <DropdownMenu>
                                  <DropdownMenuTrigger
                                    aria-label="Signal options"
                                    title="Signal options"
                                  >
                                    <MoreHorizontal size={17} />
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent>
                                    <DropdownMenuItem onClick={() => hide(a)}>
                                      {a.hidden
                                        ? "Restore signal"
                                        : "Not relevant"}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() => openArticle(a)}
                                    >
                                      Open details & notes
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              )}
                            </div>
                          </div>
                        </article>
                      );
                    })
                  )}
                  {total > 30 && (
                    <div className="pagination">
                      <button
                        className="secondary-button"
                        disabled={!offset}
                        onClick={() => setOffset(Math.max(0, offset - 30))}
                      >
                        Previous
                      </button>
                      <span>
                        {offset + 1}–{Math.min(offset + 30, total)} of {total}
                      </span>
                      <button
                        className="secondary-button"
                        disabled={offset + 30 >= total}
                        onClick={() => setOffset(offset + 30)}
                      >
                        Next
                      </button>
                    </div>
                  )}
                </section>
                <aside className="context-rail">
                  <div className="rail-card">
                    <div className="rail-title">
                      <Radio size={15} /> YOUR RADAR
                    </div>
                    <h3>
                      From silicon
                      <br />
                      to tokens.
                    </h3>
                    <p>
                      A broad perspective.
                      <br />A focused reading list.
                    </p>
                    <div className="coverage-topics">
                      {TOPICS.slice(1).map((t) => {
                        const Icon = topicIcons[t];
                        return (
                          <button key={t} onClick={() => setTopic(t)}>
                            <Icon size={15} />
                            {t}
                            <ChevronRight size={12} />
                          </button>
                        );
                      })}
                    </div>
                    <button
                      className="rail-link"
                      onClick={() => navigate("sources")}
                    >
                      Explore {sources.length} sources{" "}
                      <ArrowUpRight size={14} />
                    </button>
                  </div>
                  <div className="rail-note">
                    <span className="small-icon">
                      <Sparkles size={17} />
                    </span>
                    <h4>Make the signal yours.</h4>
                    <p>
                      Helpful votes and submissions improve your ranking over
                      time. Every recommendation tells you why it appeared.
                    </p>
                    {canWrite && (
                      <button onClick={() => setDialog({ type: "submit" })}>
                        Teach your radar <ArrowRight size={13} />
                      </button>
                    )}
                  </div>
                  <div className="rail-footnote">
                    <ShieldCheck size={14} />
                    <span>
                      Private by design.
                      <br />
                      Built for your team.
                    </span>
                  </div>
                </aside>
              </div>
            </>
          )}
          {view === "sources" && (
            <>
              <div className="source-summary">
                <div>
                  <strong>{sources.filter((s) => s.active).length}</strong>
                  <span>active sources</span>
                </div>
                <div>
                  <strong>
                    {sources.filter((s) => s.last_success_at).length}
                  </strong>
                  <span>successfully checked</span>
                </div>
                <div>
                  <strong>{sources.filter((s) => s.last_error).length}</strong>
                  <span>need attention</span>
                </div>
                <div>
                  <strong>{preview ? "—" : dateLabel(stats.last_scan)}</strong>
                  <span>last successful scan</span>
                </div>
              </div>
              <div className="section-line">
                <h3>Monitored sources</h3>
                {member.role === "admin" && (
                  <button
                    className="secondary-button"
                    onClick={() => navigate("admin")}
                  >
                    Manage sources <ArrowRight size={14} />
                  </button>
                )}
              </div>
              <div className="source-grid">
                {sources.map((s) => (
                  <div className="source-card" key={s.id}>
                    <div className="source-card-heading">
                      <span className="source-icon">
                        <Radio size={16} />
                      </span>
                      <h3>{s.name}</h3>
                      <span
                        className={"state-pill " + (s.last_error ? "warn" : "")}
                      >
                        {!s.active
                          ? "Paused"
                          : s.last_error
                            ? "Attention"
                            : s.last_success_at
                              ? "Healthy"
                              : "Awaiting scan"}
                      </span>
                    </div>
                    <p>
                      {s.topic} <span>·</span>{" "}
                      {s.type === "github"
                        ? "GitHub releases"
                        : s.type === "rss"
                          ? "RSS feed"
                          : "Documentation changes"}
                    </p>
                    <div className="source-card-footer">
                      <span>
                        <Clock3 size={12} /> Every {s.interval_minutes / 60}h
                      </span>
                      <a href={s.url} target="_blank" rel="noopener noreferrer">
                        View source <ExternalLink size={12} />
                      </a>
                    </div>
                    {s.last_error && (
                      <p className="source-error">{s.last_error}</p>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
          {view === "admin" && member.role === "admin" && (
            <AdminPanel
              preview={preview}
              sources={sources}
              notify={notify}
              confirm={confirm}
              onRefresh={reload}
            />
          )}
          {view === "trash" && (
            <div className="trash-list">
              {[
                ...trashed.folders.map((f: any) => ({
                  ...f,
                  type: "folder",
                  label: f.name,
                })),
                ...trashed.notes.map((n: any) => ({
                  ...n,
                  type: "note",
                  label: n.body,
                })),
              ].map((x: any) => (
                <div key={x.id} className="trash-row">
                  <Trash2 size={17} />
                  <div>
                    <strong>{x.label}</strong>
                    <small>
                      {x.type} · {dateLabel(x.deleted_at)}
                    </small>
                  </div>
                  <button
                    className="secondary-button"
                    onClick={() =>
                      void change(
                        "restore",
                        { id: x.id, type: x.type },
                        "Restored",
                      )
                    }
                  >
                    <RotateCcw size={14} /> Restore
                  </button>
                </div>
              ))}
              {!trashed.folders.length && !trashed.notes.length && (
                <div className="empty-state">
                  <Trash2 size={30} />
                  <h3>Nothing in the trash.</h3>
                  <p>Deleted folders and notes will appear here.</p>
                </div>
              )}
            </div>
          )}
          <footer className="page-footer">
            <span>
              STACKSIGNAL <span className="footer-divider">/</span> FROM SILICON
              TO TOKENS
            </span>
            <span>
              {preview
                ? "Interactive preview"
                : "Private engineering intelligence"}
            </span>
          </footer>
        </div>
      </SidebarInset>
      <Sheet
        open={!!selected}
        onOpenChange={(v) => {
          if (!v) setSelected(null);
        }}
      >
        <SheetContent className="detail-sheet">
          <SheetHeader>
            <SheetTitle>Signal details</SheetTitle>
            <SheetDescription>
              Source context, shared knowledge and your private notes.
            </SheetDescription>
          </SheetHeader>
          {picked && (
            <div className="detail-body">
              <div className="eyebrow">
                {picked.topic} / {picked.kind}
              </div>
              <h2>{picked.title}</h2>
              <div className="detail-meta">
                {picked.source}
                {picked.author && " · " + picked.author}
                <br />
                Published: {dateLabel(picked.published_at)}
                <br />
                Discovered: {dateLabel(picked.discovered_at)}
                {picked.updated_at && (
                  <>
                    <br />
                    Updated: {dateLabel(picked.updated_at)}
                  </>
                )}
              </div>
              <a
                className="primary original-link"
                href={picked.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Read original <ArrowUpRight size={16} />
              </a>
              <p>{picked.summary}</p>
              <div className="why-box">
                <span>
                  <Sparkles size={15} /> Why this matters
                </span>
                <p>{picked.reason}</p>
                {picked.evidence && <blockquote>{picked.evidence}</blockquote>}
                <small>
                  {picked.analysis_status === "ai"
                    ? "AI assisted assessment · verify against the original"
                    : "Transparent topic matching · not a quality guarantee"}
                </small>
              </div>
              {canWrite && (
                <div className="detail-actions">
                  <button
                    className="secondary-button"
                    onClick={() => setDialog({ type: "save", article: picked })}
                  >
                    <Bookmark size={15} />{" "}
                    {picked.saved ? "Organize saved link" : "Save to library"}
                  </button>
                  <button className="text-button" onClick={() => hide(picked)}>
                    <EyeOff size={14} />{" "}
                    {picked.hidden ? "Restore" : "Not relevant"}
                  </button>
                </div>
              )}
              <section className="notes-section">
                <h3>
                  <MessageSquare size={17} /> Notes & discussion{" "}
                  <span>{notes.length}</span>
                </h3>
                {notes.length === 0 && (
                  <p className="subtle">
                    Add context your future self — or a teammate — will
                    appreciate.
                  </p>
                )}
                {notes.map((n) => (
                  <div
                    key={n.id}
                    className={"note " + (n.parent_id ? "reply-note" : "")}
                  >
                    <div className="note-meta">
                      <strong>{n.username}</strong>
                      <span>
                        {n.visibility === "private" ? (
                          <>
                            <LockKeyhole size={11} /> Only you
                          </>
                        ) : (
                          "Team"
                        )}{" "}
                        · {dateLabel(n.created_at)}
                      </span>
                    </div>
                    <p>{n.body}</p>
                    <div className="note-actions">
                      {canWrite && n.visibility === "team" && (
                        <button
                          onClick={() => {
                            setReply(n.id);
                            setEditNote(null);
                            setNoteVisibility("team");
                          }}
                        >
                          Reply
                        </button>
                      )}
                      {canWrite && n.user_id === member.id && (
                        <button
                          onClick={() => {
                            setEditNote(n);
                            setReply(null);
                            setNoteVisibility(n.visibility);
                          }}
                        >
                          Edit
                        </button>
                      )}
                      {canWrite &&
                        (n.user_id === member.id ||
                          (member.role === "admin" &&
                            n.visibility === "team")) && (
                          <button
                            onClick={() =>
                              confirm(
                                "Delete this note?",
                                "The note will move to Trash for 30 days.",
                                async () => {
                                  await perform("note_delete", {
                                    id: n.id,
                                    confirmed: true,
                                  });
                                  reload();
                                },
                              )
                            }
                          >
                            Delete
                          </button>
                        )}
                    </div>
                  </div>
                ))}
                {canWrite && (
                  <form
                    key={editNote?.id || reply || "new"}
                    className="note-composer"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const form = e.currentTarget;
                      const d = new FormData(form);
                      if (
                        await change(
                          "note_save",
                          {
                            ...(editNote ? { id: editNote.id } : {}),
                            article_id: picked.id,
                            body: d.get("body"),
                            visibility: noteVisibility,
                            parent_id: reply,
                          },
                          "Note saved",
                        )
                      ) {
                        form.reset();
                        setReply(null);
                        setEditNote(null);
                      }
                    }}
                  >
                    <div className="composer-top">
                      <label>
                        <span className="sr-only">Note visibility</span>
                        <select
                          disabled={!!reply || !!editNote}
                          value={noteVisibility}
                          onChange={(e) => setNoteVisibility(e.target.value)}
                        >
                          <option value="team">Shared with the team</option>
                          <option value="private">Private · only you</option>
                        </select>
                      </label>
                      {(reply || editNote) && (
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => {
                            setReply(null);
                            setEditNote(null);
                          }}
                        >
                          Cancel {editNote ? "edit" : "reply"}
                        </button>
                      )}
                    </div>
                    <textarea
                      name="body"
                      rows={4}
                      maxLength={10000}
                      required
                      defaultValue={editNote?.body || ""}
                      placeholder={
                        reply
                          ? "Write a reply…"
                          : noteVisibility === "private"
                            ? "Your private note…"
                            : "What should the team know?"
                      }
                    />
                    <button className="primary">
                      {editNote
                        ? "Save changes"
                        : reply
                          ? "Post reply"
                          : "Add note"}{" "}
                      <ArrowRight size={14} />
                    </button>
                  </form>
                )}
              </section>
            </div>
          )}
        </SheetContent>
      </Sheet>
      <Dialog
        open={!!dialog}
        onOpenChange={(v) => {
          if (!v) {
            setDialog(null);
            setError("");
          }
        }}
      >
        <DialogContent className="app-dialog">
          <DialogHeader>
            <DialogTitle>
              {dialog?.type === "password"
                ? "Change your password"
                : dialog?.type === "submit"
                  ? "Add to your signal."
                  : dialog?.type === "folder"
                    ? dialog.id
                      ? "Edit collection"
                      : "Create a collection"
                    : "Save to your library"}
            </DialogTitle>
            <DialogDescription>
              {dialog?.type === "password"
                ? "Use a unique passphrase of at least 16 characters. All your sessions will end after the change."
                : dialog?.type === "submit"
                  ? "Bring a useful link into the library and teach the radar what matters."
                  : dialog?.type === "folder"
                    ? "Organize shared knowledge in a way that works for your team."
                    : "A link can live in more than one folder."}
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
              onSubmit={async (e) => {
                e.preventDefault();
                setWorking(true);
                const d = new FormData(e.currentTarget);
                try {
                  if (dialog.type === "password") {
                    if (preview)
                      throw new Error(
                        "Password changes require the account service.",
                      );
                    await api("change-password", {
                      current_password: d.get("current_password"),
                      password: d.get("password"),
                    });
                    onSessionEnded();
                    return;
                  }
                  if (dialog.type === "folder")
                    await perform("folder_save", {
                      ...(dialog.id ? { id: dialog.id } : {}),
                      name: d.get("name"),
                      parent_id: d.get("parent_id"),
                    });
                  else if (dialog.type === "save")
                    await perform("save", {
                      article_id: dialog.article.id,
                      folder_id: d.get("folder_id"),
                    });
                  else
                    await perform("submit", {
                      url: d.get("url"),
                      title: d.get("title"),
                      reason: d.get("reason"),
                      teach: d.get("teach") === "on",
                      folder_id: d.get("folder_id"),
                    });
                  setDialog(null);
                  reload();
                  notify(
                    dialog.type === "submit"
                      ? "Link saved. Metadata extraction is queued."
                      : "Saved",
                  );
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setWorking(false);
                }
              }}
            >
              {dialog.type === "submit" && (
                <>
                  <label>
                    Link
                    <input
                      name="url"
                      type="url"
                      placeholder="https://…"
                      required
                      maxLength={2048}
                    />
                  </label>
                  <label>
                    Title <span className="optional">Optional</span>
                    <input
                      name="title"
                      placeholder="A useful, descriptive title"
                      maxLength={500}
                    />
                  </label>
                  <label>
                    Why it matters{" "}
                    <span className="optional">
                      Optional · stays in your workspace
                    </span>
                    <textarea
                      name="reason"
                      rows={3}
                      maxLength={500}
                      placeholder="What caught your attention?"
                    />
                  </label>
                </>
              )}
              {dialog.type === "password" ? (
                <>
                  <label>
                    Current password
                    <input
                      type="password"
                      name="current_password"
                      autoComplete="current-password"
                      required
                    />
                  </label>
                  <label>
                    New passphrase
                    <input
                      type="password"
                      name="password"
                      autoComplete="new-password"
                      minLength={16}
                      required
                    />
                  </label>
                </>
              ) : dialog.type === "folder" ? (
                <>
                  <label>
                    Folder name
                    <input
                      name="name"
                      defaultValue={dialog.name}
                      required
                      maxLength={80}
                      placeholder="e.g. Serving benchmarks"
                    />
                  </label>
                  <label>
                    Parent folder
                    <select
                      name="parent_id"
                      defaultValue={dialog.parent_id || ""}
                    >
                      <option value="">Top level</option>
                      {folders
                        .filter((f) => f.id !== dialog.id)
                        .map((f) => (
                          <option key={f.id} value={f.id}>
                            {folderPath(f, folders)}
                          </option>
                        ))}
                    </select>
                  </label>
                </>
              ) : (
                <label>
                  Collection
                  <select name="folder_id" defaultValue={folder || ""}>
                    <option value="">Inbox</option>
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {folderPath(f, folders)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {dialog.type === "submit" && (
                <label className="check-label teach-label">
                  <input name="teach" type="checkbox" defaultChecked /> Use this
                  as a positive relevance signal
                </label>
              )}
              {dialog.type === "save" &&
                dialog.article.folder_ids?.length > 0 && (
                  <div className="saved-locations">
                    <small>SAVED IN</small>
                    {dialog.article.folder_ids.map((id: string) => (
                      <div key={id}>
                        <FolderIcon size={14} />
                        <span>
                          {folders.find((f) => f.id === id)?.name ||
                            "Collection"}
                        </span>
                        <button
                          type="button"
                          aria-label="Remove from this folder"
                          onClick={() => {
                            const a = dialog.article;
                            setDialog(null);
                            confirm(
                              "Remove this saved link?",
                              "The link will be removed from this folder for everyone. Other collections are unaffected.",
                              async () => {
                                await perform("unsave", {
                                  article_id: a.id,
                                  folder_id: id,
                                  confirmed: true,
                                });
                                reload();
                              },
                            );
                          }}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              <div className="dialog-footer">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setDialog(null)}
                >
                  Cancel
                </button>
                <button className="primary" disabled={working}>
                  {working ? (
                    <Loader2 size={15} className="spin" />
                  ) : (
                    <Check size={15} />
                  )}{" "}
                  {dialog.type === "password"
                    ? "Update password"
                    : dialog.type === "submit"
                      ? "Add link"
                      : dialog.type === "folder"
                        ? "Save collection"
                        : "Save link"}
                </button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={!!confirmation}
        onOpenChange={(v) => {
          if (!v && !working) setConfirmation(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmation?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmation?.body}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={working}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={working}
              onClick={async (e) => {
                e.preventDefault();
                setWorking(true);
                try {
                  await confirmation?.run();
                  setConfirmation(null);
                  notify("Updated");
                } catch (e) {
                  setError((e as Error).message);
                  setConfirmation(null);
                } finally {
                  setWorking(false);
                }
              }}
            >
              {working ? "Working…" : "Yes, continue"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {toast && (
        <div className="toast" role="status">
          <CheckCheck size={16} />
          {toast}
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={13} />
          </button>
        </div>
      )}
    </SidebarProvider>
  );
}
