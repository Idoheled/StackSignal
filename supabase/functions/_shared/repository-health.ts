import { dateISO } from "./content.ts";

export const REPO_POLICY = { repo_min_stars:100, repo_min_watchers:5, repo_min_releases:2, repo_active_days:90, repo_release_days:180, trending_discovery:true };
export function repositoryName(input:string) {
  const u=new URL(input);
  const m=u.hostname==="github.com" ? u.pathname.match(/^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\/|$)/) : null;
  return m ? m[1]+"/"+m[2].replace(/\.git$/i,"") : null;
}
export function repositoryHealth(metadata:any,releases:any[],now=Date.now()) {
  const dates=releases.filter(x=>!x.draft).map(x=>dateISO(x.published_at)).filter((x):x is string=>!!x && Date.parse(x)<=now && Date.parse(x)>=now-365*86400000).sort();
  return { checked_at:new Date(now).toISOString(), stars:Math.max(0,Number(metadata.stargazers_count)||0),
    // watchers_count is GitHub's historical alias for stars, NOT subscribers.
    watchers:Math.max(0,Number(metadata.subscribers_count)||0), recent_releases:dates.length,
    latest_release:dates.at(-1)||null, pushed_at:dateISO(metadata.pushed_at),
    license:String(metadata.license?.spdx_id||"Unspecified").slice(0,80),
    active:metadata.private===false && metadata.archived===false && metadata.disabled===false && metadata.fork===false };
}
export function repositoryAdmitted(health:any,profile:any={},now=Date.now()) {
  const p={...REPO_POLICY,...profile};
  return !!health && health.active===true && Date.parse(health.checked_at)<=now && Date.parse(health.checked_at)>=now-7*86400000 &&
    health.stars>=p.repo_min_stars && health.watchers>=p.repo_min_watchers && health.recent_releases>=p.repo_min_releases &&
    Date.parse(health.pushed_at)<=now && Date.parse(health.pushed_at)>=now-p.repo_active_days*86400000 &&
    Date.parse(health.latest_release)<=now && Date.parse(health.latest_release)>=now-p.repo_release_days*86400000 &&
    !["Unspecified","NOASSERTION","NONE"].includes(health.license);
}
export function trendingProjects(html:string) {
  const rows=html.match(/<article\b[^>]*class="[^"]*\bBox-row\b[^"]*"[^>]*>[\s\S]*?<\/article>/gi)||[];
  if(!rows.length) throw new Error("GitHub Trending markup unavailable; no ranking inferred");
  return rows.slice(0,5).flatMap((row,index)=>{
    const heading=row.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1]||"";
    const m=heading.match(/href="\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)"/);
    if(!m) throw new Error("GitHub Trending rank could not be parsed");
    return [{repository:m[1]+"/"+m[2],rank:index+1}];
  });
}
