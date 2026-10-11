/** Canonical public link identity. Meaningful parameters (e.g. Dell guid/lang or a video ID) survive. */
export function canonicalLink(input: string) {
  const u = new URL(input.trim());
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    (u.port && u.port !== "443")
  )
    throw new Error("Use a public HTTPS link without credentials.");
  if (
    !u.hostname.includes(".") ||
    /(^|\.)(localhost|local|internal|test|invalid)$/.test(u.hostname) ||
    /^\[|^\d+\.\d+\.\d+\.\d+$/.test(u.hostname)
  )
    throw new Error("Private addresses are not supported.");
  u.hash = "";
  for (const k of [...u.searchParams.keys()])
    if (
      k.startsWith("utm_") ||
      ["gclid", "fbclid", "hl", "_highlight"].includes(k)
    )
      u.searchParams.delete(k);
  if (["youtu.be", "youtube.com", "www.youtube.com"].includes(u.hostname)) {
    u.searchParams.delete("si");
    if (u.hostname === "youtu.be") {
      const id = u.pathname.slice(1);
      u.hostname = "www.youtube.com";
      u.pathname = "/watch";
      u.searchParams.set("v", id);
    } else u.hostname = "www.youtube.com";
  }
  if (u.hostname === "github.com") u.pathname = u.pathname.replace(/\/$/, "");
  return u.toString();
}

export function linkReviewLabel(meta?: { link_status?: string }) {
  switch (meta?.link_status) {
    case "unresolved":
      return "Resolve short link";
    case "title-match":
      return "Title-matched link";
    case "checked":
      return "Link checked";
    case "submitted":
      return "Metadata pending";
    case "search_result":
      return "Web search result";
    default:
      return "";
  }
}
