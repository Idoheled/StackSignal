import { canonicalLink } from "../../../lib/links.ts";
// Text-only extraction. Source markup is never rendered or executed in the application.
export const TRUSTED_HOSTS = [
  "api.github.com",
  "github.com",
  "raw.githubusercontent.com",
  "docs.vllm.ai",
  "docs.sglang.ai",
  "hypershift-docs.netlify.app",
  "developer.nvidia.com",
  "docs.nvidia.com",
  "nvidia.com",
  "www.nvidia.com",
  "kubernetes.io",
  "huggingface.co",
  "www.redhat.com",
  "redhat.com",
  "docs.redhat.com",
  "www.cisco.com",
  "blogs.cisco.com",
  "www.dell.com",
  "developer.dell.com",
  "www.hpe.com",
  "developer.hpe.com",
  "arxiv.org",
  "rss.arxiv.org",
  "export.arxiv.org",
  "openreview.net",
  "lmsys.org",
  "lmsysorg.github.io",
  "kserve.github.io",
  "llm-d.ai",
  "docs.litellm.ai",
  "cilium.io",
  "docs.cilium.io",
  "rocm.blogs.amd.com",
  "docs.amd.com",
  "www.kernel.org",
  "lwn.net",
  "pytorch.org",
  "blog.vllm.ai",
  "vllm.ai",
  "developers.redhat.com",
  "access.redhat.com",
  "infohub.delltechnologies.com",
  "networking-docs.nvidia.com",
  "enterprise-support.nvidia.com",
  "forums.developer.nvidia.com",
  "lws.sigs.k8s.io",
  "mlcommons.org",
  "man7.org",
  "netbox.readthedocs.io",
  "netboxlabs.com",
  "theforeman.org",
  "docs.theforeman.org",
  "kuadrant.io",
  "theagentrouter.ai",
  "containers.github.io",
  "uccl-project.github.io",
];
export function safeURL(input: string, hosts: string[] = TRUSTED_HOSTS) {
  const u = new URL(input);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    (u.port && u.port !== "443") ||
    !hosts.includes(u.hostname)
  )
    throw new Error("Host is not on the collector allowlist");
  u.hash = "";
  for (const k of [...u.searchParams.keys()])
    if (k.startsWith("utm_") || ["gclid", "fbclid"].includes(k))
      u.searchParams.delete(k);
  return canonicalLink(u.toString());
}
export function publicIPv4(ip: string) {
  const n = ip.split(".").map(Number);
  if (n.length !== 4 || n.some((x) => !Number.isInteger(x) || x < 0 || x > 255))
    return false;
  const [a, b, c] = n;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0 || b === 2)) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}
export function textOnly(s: string) {
  return s
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|nav|footer|header)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[a-f0-9]+);/gi, (v) => {
      const named: Record<string, string> = {
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">",
        "&quot;": '"',
        "&apos;": "'",
        "&nbsp;": " ",
      };
      if (named[v]) return named[v];
      const n = v.startsWith("&#x")
        ? parseInt(v.slice(3, -1), 16)
        : parseInt(v.slice(2, -1));
      return Number.isFinite(n) && n <= 0x10ffff ? String.fromCodePoint(n) : "";
    })
    .replace(/\s+/g, " ")
    .trim();
}
export function dateISO(s?: string | null) {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) &&
    t <= Date.now() + 5 * 60 * 1000 &&
    t > Date.UTC(2000, 0, 1)
    ? new Date(t).toISOString()
    : null;
}
export function attrs(tag: string) {
  const result: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
    result[m[1].toLowerCase()] = m[2] ?? m[3];
  return result;
}
export function htmlMeta(html: string) {
  const meta: Record<string, string> = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const a = attrs(tag);
    const k = a.property || a.name;
    if (k && a.content) meta[k.toLowerCase()] = a.content;
  }
  const title = textOnly(
    meta["og:title"] ||
      html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ||
      "",
  ).slice(0, 500);
  const text = textOnly(html).slice(0, 50000);
  return {
    title,
    author:
      textOnly(meta.author || meta["article:author"] || "").slice(0, 120) ||
      null,
    summary: textOnly(meta.description || meta["og:description"] || "").slice(
      0,
      600,
    ),
    published_at: dateISO(
      meta["article:published_time"] || meta["datepublished"],
    ),
    updated_at: dateISO(meta["article:modified_time"]),
    text,
  };
}
export function parseFeed(xml: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error("External entities are not accepted");
  const blocks =
    xml.match(/<item\b[\s\S]*?<\/item>|<entry\b[\s\S]*?<\/entry>/gi) || [];
  return blocks
    .slice(0, 40)
    .map((block) => {
      const tag = (name: string) =>
        block.match(
          new RegExp(
            "<" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)<\\/" + name + ">",
            "i",
          ),
        )?.[1] || "";
      const linkTags = block.match(/<link\b[^>]*>/gi) || [];
      const alternate = linkTags
        .map(attrs)
        .find((a) => a.href && (!a.rel || a.rel === "alternate"));
      return {
        title: textOnly(tag("title")).slice(0, 500),
        url: textOnly(tag("link")) || alternate?.href || "",
        published_at: dateISO(
          textOnly(tag("pubDate") || tag("published") || tag("dc:date")),
        ),
        updated_at: dateISO(textOnly(tag("updated"))),
        author:
          textOnly(tag("dc:creator") || tag("author")).slice(0, 120) || null,
        summary: textOnly(
          tag("description") || tag("summary") || tag("content"),
        ).slice(0, 600),
      };
    })
    .filter((x) => x.title && x.url);
}
export function meaningfulChange(before: string, after: string) {
  const a = new Set(before.toLowerCase().split(/\s+/));
  const b = after.toLowerCase().split(/\s+/);
  const added = b.filter((t) => !a.has(t));
  return added.length >= 25 && added.length / Math.max(b.length, 1) > 0.025;
}
