import { COVERAGE_TERMS, TEAM_SOURCES } from "./coverage.ts";
export type Role = "admin" | "maintainer" | "reader";
export type Member = {
  id: string;
  username: string;
  display_name: string;
  role: Role;
  active: boolean;
  must_change_password?: boolean;
};
export type Article = {
  id: string;
  title: string;
  url: string;
  source: string;
  author?: string;
  published_at: string | null;
  discovered_at: string;
  updated_at?: string | null;
  kind: string;
  topic: string;
  tags: string[];
  summary: string;
  reason: string;
  evidence?: string;
  analysis_status?: string;
  score: number;
  reference_meta?: {
    origin?: string;
    original_urls?: string[];
    link_status?: string;
    checked_at?: string;
    note?: string;
    source_id?: string;
    repository?: string;
    tag?: string;
    prerelease?: boolean;
    alert_kind?: string;
    signals?: string[];
    discovery_lane?: string;
    stars?: number;
    license?: string;
    date_basis?: string;
    search_provider?: string;
    search_query?: string;
    search_window?: string;
    source_tier?: string;
    evaluation?: { scope: string; confidence: string; depth: string; action?: string };
  };
  liked?: boolean;
  hidden?: boolean;
  saved?: boolean;
  read?: boolean;
  likes?: number;
  comments?: number;
  folder_ids?: string[];
  folder_paths?: string[];
};
export type Folder = {
  id: string;
  name: string;
  parent_id: string | null;
  count?: number;
  deleted_at?: string | null;
};
export type Note = {
  id: string;
  article_id: string;
  body: string;
  visibility: "private" | "team";
  username: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  parent_id?: string | null;
};
export type Source = {
  id: string;
  name: string;
  url: string;
  type: string;
  topic: string;
  active: boolean;
  interval_minutes: number;
  last_success_at: string | null;
  last_error: string | null;
  next_check_at?: string;
  include_prereleases?: boolean;
  priority?: "core" | "normal" | "explore";
  last_item_count?: number;
  revision?: number;
};
export const TOPICS = [
  "All topics",
  "Inference",
  "Platforms",
  "Networking",
  "Hardware",
  "Models & research",
  "Operations",
];
export const TOPIC_TERMS = COVERAGE_TERMS;
export const SEED_SOURCES = TEAM_SOURCES.map((s) => [
  s.name,
  s.url,
  s.type,
  s.topic,
]);
export const PREVIEW_ARTICLES: Article[] = [
  {
    id: "vllm",
    title: "vLLM: high-throughput LLM serving",
    url: "https://docs.vllm.ai/en/latest/",
    source: "vLLM",
    kind: "Documentation",
    topic: "Inference",
    tags: ["KV cache", "Continuous batching"],
    summary:
      "Serving documentation covering scheduling, memory management, parallelism and deployment.",
    reason: "Relevant to serving efficiency and GPU utilization.",
    score: 94,
    saved: true,
    folder_ids: ["inference"],
  },
  {
    id: "sglang",
    title: "SGLang: efficient inference for language models",
    url: "https://docs.sglang.ai/",
    source: "SGLang",
    kind: "Documentation",
    topic: "Inference",
    tags: ["Prefix caching", "Distributed inference"],
    summary:
      "Explore the runtime, serving configurations and performance tuning documentation.",
    reason: "Relevant to latency, prefix reuse and serving architecture.",
    score: 91,
  },
  {
    id: "hyper",
    title: "Hosted control planes with HyperShift",
    url: "https://hypershift-docs.netlify.app/",
    source: "HyperShift",
    kind: "Documentation",
    topic: "Platforms",
    tags: ["OpenShift", "Hosted control planes"],
    summary:
      "Project documentation for deploying and operating hosted OpenShift control planes.",
    reason: "Matches your hosted cluster and platform engineering work.",
    score: 90,
    saved: true,
    folder_ids: ["platforms"],
  },
  {
    id: "nccl",
    title: "NCCL collective communication library",
    url: "https://github.com/NVIDIA/nccl",
    source: "NVIDIA",
    kind: "Repository",
    topic: "Networking",
    tags: ["InfiniBand", "RoCE", "Collectives"],
    summary:
      "Source code and documentation for GPU collective communication primitives.",
    reason: "Relevant to diagnosing distributed inference communication.",
    score: 89,
  },
  {
    id: "gpu",
    title: "NVIDIA GPU Operator",
    url: "https://github.com/NVIDIA/gpu-operator",
    source: "NVIDIA",
    kind: "Repository",
    topic: "Platforms",
    tags: ["Kubernetes", "GPU lifecycle"],
    summary:
      "An operator for managing the software components required to provision GPUs in Kubernetes.",
    reason: "Matches your operator and GPU platform responsibilities.",
    score: 87,
  },
  {
    id: "litellm",
    title: "LiteLLM: model gateway and usage controls",
    url: "https://github.com/BerriAI/litellm",
    source: "LiteLLM",
    kind: "Repository",
    topic: "Operations",
    tags: ["Routing", "Token budgets"],
    summary:
      "Gateway project covering model routing, credentials and usage controls.",
    reason: "Relevant to organization-wide token management.",
    score: 85,
  },
].map((a) => ({
  ...a,
  published_at: null,
  discovered_at: "2026-09-26T00:00:00Z",
  analysis_status: "reference",
}));
export function normalizeUsername(value: string) {
  return value.normalize("NFKC").trim().toLowerCase();
}
export function validUsername(value: string) {
  return /^[a-z][a-z0-9_-]{2,31}$/.test(normalizeUsername(value));
}
export function strongPassword(value: string) {
  return (
    value.length >= 16 &&
    new TextEncoder().encode(value).length <= 72 &&
    !/^(.)\1+$/.test(value) &&
    ![
      "password",
      "123456",
      "qwerty",
      "letmein",
      "stacksignal",
      "administrator",
    ].some((x) => value.toLowerCase().includes(x))
  );
}
export function basicRelevance(
  text: string,
  weights: Record<string, number> = {},
) {
  const input = text.toLowerCase();
  let best = "Models & research",
    max = 0;
  const tags: string[] = [];
  for (const [topic, terms] of Object.entries(TOPIC_TERMS)) {
    const hits = terms.filter((t) =>
      t.length < 4
        ? new RegExp("\\b" + t + "\\b").test(input)
        : input.includes(t),
    );
    const broad = new Set([
      "nvidia",
      "dell",
      "hpe",
      "cisco",
      "nic",
      "kernel",
      "operator",
      "monitoring",
      "latency",
      "gateway",
      "benchmark",
      "llm",
      "agent",
    ]);
    const points = hits.reduce(
      (sum, term) => sum + (broad.has(term) ? 3 : 16),
      0,
    );
    const score = hits.length
      ? points + Math.max(-20, Math.min(20, weights[topic] || 0))
      : 0;
    tags.push(...hits);
    if (score > max) {
      max = score;
      best = topic;
    }
  }
  return {
    topic: best,
    score: tags.length ? Math.min(95, Math.max(15, 30 + max)) : 15,
    tags: [...new Set(tags)].slice(0, 8),
    reason: tags.length
      ? `Matches ${tags.slice(0, 3).join(", ")} in the team coverage profile.`
      : "Adjacent technical content; relevance has not been established.",
  };
}
export function folderPath(folder: Folder, folders: Folder[]): string {
  const names = [folder.name],
    visited = new Set([folder.id]);
  let p = folder.parent_id;
  while (p && !visited.has(p)) {
    visited.add(p);
    const f = folders.find((x) => x.id === p);
    if (!f) break;
    names.unshift(f.name);
    p = f.parent_id;
  }
  return names.join(" / ");
}
