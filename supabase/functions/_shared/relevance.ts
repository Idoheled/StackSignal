import { basicRelevance } from "../../../lib/domain.ts";

export function relevance(title: string, text: string, profile: any = {}, item: any = {}) {
  const local = basicRelevance(title + " " + text, profile.priorities || {});
  const headline = basicRelevance(title, profile.priorities || {});
  const all = (title + " " + text).toLowerCase();
  const interests = String(profile.interests || "").split(/[,;\n]+/)
    .map(s => s.trim().toLowerCase()).filter(s => s.length >= 3 && s.length <= 80);
  const matches = interests.filter(term => term.length <= 4
    ? new RegExp("\\b" + term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b").test(all)
    : all.includes(term)).slice(0, 4);
  const signals = [
    [/\b(cve-\d|security fix|vulnerability|security advisory)/i, "Security"],
    [/\b(breaking change|deprecated|deprecation|migration guide)/i, "Compatibility"],
    [/\b(benchmark|mlperf|throughput|latency|performance tuning)/i, "Performance"],
    [/\b(how to|configuration|deployment|troubleshoot|tutorial|operator)/i, "Implementation"],
  ].filter(([pattern]) => (pattern as RegExp).test(title + " " + text)).map(([,label]) => String(label));
  let score = local.score + Math.min(9, matches.length * 3);
  if (headline.score >= 46) score += 5;
  if (local.score >= 46 && signals.length) score += 4;
  // Company mentions and investment headlines are weak signals for this engineering workspace.
  if (/\b(stock price|share price|price target|stock market|earnings report|investor returns)\b/i.test(title)) score -= 35;
  if (/\b(sponsored|webinar registration|giveaway|coupon)\b/i.test(title)) score -= 15;
  const watched = item.reference_meta?.alert_kind === "release";
  if (watched) score = Math.max(score, item.priority === "core" ? 88 : 80);
  else if (score >= 45) score += item.priority === "core" ? 5 : item.priority === "explore" ? -3 : 0;
  const tagWeights = profile._tagWeights || {};
  const learned = Math.max(-8, Math.min(8, local.tags.reduce((n, t) => n + (Number(tagWeights[t]) || 0), 0)));
  score += learned;
  const reason = watched
    ? `New ${item.reference_meta.prerelease ? "prerelease" : "release"} from a project your administrator follows. Read the release notes for applicability.`
    : matches.length ? `Matches your stack: ${matches.join(", ")}. ${signals.length ? "Signals: " + signals.join(", ").toLowerCase() + "." : ""}`
      : local.reason;
  const sentences = text.match(/[^.!?\n]+[.!?]?/g) || [];
  const excerpt = sentences.find(s => s.length >= 35 && local.tags.some(t => s.toLowerCase().includes(t))) || "";
  return { ...local, score: Math.max(0, Math.min(98, Math.round(score))),
    reason: reason + (learned ? " Team feedback also informs this match." : ""),
    evidence: excerpt.trim().slice(0, 155), signals };
}
