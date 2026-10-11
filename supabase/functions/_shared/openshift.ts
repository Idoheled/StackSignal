import { isPrerelease } from "./github.ts";
import { textOnly, dateISO } from "./content.ts";
export function openshiftWatchURL(input:string) {
  const u=new URL(input);
  if(u.protocol!=="https:" || u.hostname!=="amd64.ocp.releases.ci.openshift.org" || u.port || u.username || u.password || !/^\/api\/v1\/releasestream\/[45]-(?:stable|dev-preview)\/tags$/.test(u.pathname)) throw new Error("Use an official amd64 OpenShift 4/5 stable or dev-preview tags API URL");
  u.search="";u.hash="";return u.toString();
}
export function openshiftTags(value:any,source:any) {
  if(!value || !Array.isArray(value.tags)) throw new Error("Invalid OpenShift release stream");
  return value.tags.filter((x:any)=>x.phase==="Accepted" && /^[45]\.\d+\.\d+(?:-(?:rc|ec)\.\d+)?$/.test(x.name||"") && (source.include_prereleases || !isPrerelease({tag_name:x.name}) && !/-ec\./.test(x.name))).slice(0,5);
}
export function openshiftItem(value:any,source:any,tag:string) {
  if(value.name!==tag || value.phase!=="Accepted") throw new Error("OpenShift release is not accepted or does not match its tag");
  let changelog="";
  if(typeof value.changeLog==="string") {
    if(value.changeLog.length>6000000) throw new Error("OpenShift changelog exceeds limit");
    changelog=textOnly(new TextDecoder().decode(Uint8Array.from(atob(value.changeLog),c=>c.charCodeAt(0))));
  }
  const created=changelog.match(/Created:\s*(\d{4}-\d\d-\d\d\s+\d\d:\d\d:\d\d)\s+\+0000/);
  const stream=new URL(source.url).pathname.split("/")[4];
  const prerelease=/-[a-z]/i.test(tag);
  const disclaimer="OpenShift CI release payload; Accepted is a CI phase, not a support or production-readiness guarantee. "+(prerelease ? "Release candidate or engineering preview. " : "");
  const text=disclaimer+changelog;
  return {url:`https://amd64.ocp.releases.ci.openshift.org/releasestream/${stream}/release/${tag}`,title:`OpenShift ${tag}`,source:"OpenShift release controller",topic:"Platforms",kind:"Release",priority:source.priority,
    published_at:dateISO(created ? created[1].replace(" ","T")+"Z" : null),summary:text.slice(0,600),text:text.slice(0,12000),
    reference_meta:{origin:"source_watch",source_id:source.id,source_revision:source.revision,alert_kind:"release",tag,prerelease,release_phase:"Accepted",release_stream:stream,note:disclaimer,date_basis:created ? "publisher" : "unknown"}};
}
