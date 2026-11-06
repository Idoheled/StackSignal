import { dateISO, textOnly } from "./content.ts";

const day = 86_400_000;
const failure = /\b(?:incident|postmortem|outage|regression|crash(?:es|ed)?|deadlock|hangs?|stuck|stalls?|data loss|corruption|oom|timeout|leak|unreachable|fail(?:s|ed|ure|ures)?)\b/i;
const impact = /\b(?:outage|unavailable|data loss|corruption|deadlock|hangs?|crash(?:es|ed)?|oom|leak|stalls?|regression|timeout|production|incorrect results?|throughput drop|packet loss)\b/i;
const mechanism = /\b(?:root cause|trigger(?:ed|s)?|caused by|because|race condition|dependency|initiali[sz]\w*|state machine|bisect\w*|packet capture|stack trace|kernel patch)\b/i;
const remedy = /\b(?:mitigat\w*|workaround|roll(?:ed)? back|fix(?:es|ed)?|patch\w*|reproduc\w*|prevent\w*|isolat\w*)\b/i;
const technical = /\b(?:kubernetes|gke|openshift|hypershift|coredns|dns|etcd|tcp|envoy|cilium|kernel|rdma|roce|nccl|gpu|cuda|vllm|llm-d|sglang|inference|kv[ -]cache|numa|nvme|redfish|pcie)\b/i;
const support = /\b(?:question|support|documentation|typo|duplicate|invalid|wontfix|not planned|feature request|enhancement|good first issue)\b/i;
const launch = /\b(?:introducing|open[ -]sourc(?:e|ed|ing)|announc(?:e|es|ed|ing)|initial release)\b/i;

export function engineeringClass(title: string, text: string, kind?: string) {
  const content = title + " " + text;
  if (!technical.test(content)) return undefined;
  if (kind === "Issue" && failure.test(content) && impact.test(content)) return "repository_issue";
  if (mechanism.test(text) && (
      (failure.test(title) && remedy.test(text)) ||
      /\b(?:postmortem|incident report|outage|network mystery)\b/i.test(title)))
    return "incident";
  if (launch.test(title) && /\b(?:architecture|benchmark|quickstart|control plane|gateway api|scheduler|kubectl|helm|deployment|routing)\b/i.test(text))
    return "project_launch";
  return undefined;
}

/** Only a few evidence-backed reports from the verified watch repository reach review. */
export function githubIssueHighlights(value: unknown, repository: string, since: number, until: number) {
  if (!Array.isArray(value)) throw new Error("Invalid GitHub issue list");
  return value.slice(0, 30).flatMap((record: unknown) => {
    if (typeof record !== "object" || record === null) return [];
    const issue = record as Record<string, unknown>;
    const { number, updated_at, title: rawTitle, body: rawBody, html_url } = issue;
    if (issue.pull_request || issue.state_reason === "duplicate" || issue.state_reason === "not_planned" ||
        typeof number !== "number" || !Number.isSafeInteger(number) || number <= 0 ||
        typeof rawTitle !== "string" || typeof rawBody !== "string" ||
        typeof html_url !== "string" || html_url.toLowerCase() !== `https://github.com/${repository.toLowerCase()}/issues/${number}`)
      return [];
    const updated = Date.parse(dateISO(typeof updated_at === "string" ? updated_at : null) || "");
    if (!Number.isFinite(updated) || updated <= since || updated > until) return [];
    const labels = Array.isArray(issue.labels) ? issue.labels.flatMap((label: unknown) =>
      label && typeof label === "object" && "name" in label && typeof label.name === "string" ? [label.name] : []) : [];
    const title = textOnly(rawTitle).slice(0, 500);
    const text = textOnly(rawBody).slice(0, 12000);
    if (text.length < 180 || labels.some(label => support.test(label)) ||
        /^(?:\[(?:question|feature request|support)\]|(?:how (?:do|can|to)|help (?:me|with))\b)/i.test(title)) return [];
    const report = `${repository} ${title} ${text}`;
    if (!technical.test(report) || !failure.test(title + " " + text) || !impact.test(title + " " + text)) return [];
    const hasMechanism = mechanism.test(text);
    const hasReproduction = /\b(?:minimal reproduc\w*|reproduc(?:es|ed|ible|tion)|stack trace|traceback|panic|bisect\w*)\b/i.test(text) ||
      /steps to reproduce.{0,120}\b(?:kubectl|helm|docker|podman|python|curl|nccl-tests|deploy|upgrade|restart|run)\b/i.test(text);
    const corroborated = labels.some(label => /\b(?:regression|confirmed|critical|security|priority[ :/-]*(?:0|1|critical|high)|p[01])\b/i.test(label)) ||
      ["OWNER", "MEMBER", "COLLABORATOR"].includes(String(issue.author_association));
    if (!(hasMechanism || hasReproduction) || !(corroborated || (hasMechanism && hasReproduction))) return [];
    return [{ issue: { ...issue, number, body: rawBody }, rank: Number(corroborated) * 2 + Number(impact.test(title)) + Number(hasMechanism), updated }];
  }).sort((a,b) => b.rank - a.rank || b.updated - a.updated || a.issue.number - b.issue.number).slice(0, 2);
}

export function issueScanWindow(cursor: unknown, now: number) {
  const parsed = typeof cursor === "string" ? Date.parse(cursor) : 0;
  return Math.max(now - 14 * day, Number.isFinite(parsed) ? parsed : 0);
}

const incidentQueries = [
  "Kubernetes production outage postmortem CoreDNS etcd control plane dependency root cause mitigation",
  "Kubernetes GKE networking incident Linux TCP Envoy packet loss debugging root cause",
  "GPU infrastructure outage postmortem RDMA RoCE NCCL storage kernel regression mitigation",
  "Kubernetes engineering incident root cause site:render.com OR site:cloud.google.com OR site:kubernetes.io",
];
const focusQueries: Record<string, string> = {
  "cluster-dns": "Kubernetes CoreDNS etcd outage dependency control plane postmortem mitigation",
  "packet-path": "Kubernetes Cilium Envoy TCP networking regression packet trace postmortem",
  "gpu-fabric": "GPU cluster NCCL RDMA RoCE InfiniBand regression root cause troubleshooting",
  "inference-routing": "vLLM Kubernetes inference control plane open source KV cache aware routing gateway benchmark",
  "inference-runtime": "vLLM SGLang GPU serving runtime regression prefix caching scheduler benchmarks",
  "gpu-platform": "OpenShift HyperShift Kubernetes GPU operator bare metal provisioning engineering",
  "storage": "Kubernetes GPU inference NVMe storage offload incident performance engineering",
  "hardware": "GPU server NUMA PCIe firmware regression root cause engineering",
  "model-optimization": "LLM inference quantization MoE speculative decoding open source implementation benchmark",
  "observability": "Kubernetes GPU observability production incident DCGM tracing engineering",
};
const projectQuery = "vLLM Kubernetes open source inference control plane launch KV cache aware gateway routing";

export function engineeringQueries(weights: Record<string, number>, now = Date.now()) {
  const rotation = Math.floor(now / day);
  const focus = Object.keys(focusQueries).filter(key => (weights[key] || 0) > 0)
    .sort((a,b) => weights[b] - weights[a] || a.localeCompare(b)).slice(0, 4);
  // Keep a baseline launch search and rotate among positive signals. A single dislike cannot erase coverage.
  const adaptive = rotation % 2 && focus.length ? focusQueries[focus[Math.floor(rotation / 2) % focus.length]] : projectQuery;
  return [incidentQueries[rotation % incidentQueries.length], adaptive];
}

export function isEngineeringQuery(query: string) {
  return incidentQueries.includes(query) || Object.values(focusQueries).includes(query) || query === projectQuery;
}
