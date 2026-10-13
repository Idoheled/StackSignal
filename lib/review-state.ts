import type { Article, Source } from "./domain.ts";
import { canonicalLink } from "./links.ts";

export function primaryReviewSource(article: Article) {
  const source=article.reference_meta?.evaluation?.facts?.primary_source;
  if(typeof source!=="string")return null;
  try{return canonicalLink(source);}catch{return null;}
}

export function sourceState(source: Source, now = Date.now()) {
  if (!source.active) return "Paused";
  if (source.last_error) return source.last_error_kind === "deferred" || /budget reached|rate limit|deferred/i.test(source.last_error) ? "Deferred" : "Attention";
  if (!source.last_success_at) return "Awaiting scan";
  return now - Date.parse(source.last_success_at) > Math.max(3600000, source.interval_minutes * 120000) ? "Delayed" : "Healthy";
}

export function reviewLabel(article: Article) {
  const review = article.reference_meta?.evaluation;
  if (!review) return article.analysis_status === "reference" ? "Team reference" : "Awaiting evaluation";
  if (review.decision === "insufficient_evidence") return "Withheld · insufficient evidence";
  if (review.decision !== "useful") return "Evaluated · not selected";
  if (!["medium", "high"].includes(review.confidence || "") || !["practical", "advanced"].includes(review.depth || "") || (review.score ?? 0) < 55 || (review.evidence?.length ?? 0) < 10) return "Evaluated · below filter";
  return review.evaluator === "policy" ? "Passed · local evidence rules" : review.evaluator === "assistant" ? "Passed · assistant reviewed" : "Passed · Gemini reviewed";
}
