import test from "node:test";
import assert from "node:assert/strict";
import {repositoryHealth,repositoryAdmitted,repositoryName,trendingProjects} from "../supabase/functions/_shared/repository-health.ts";
import {openshiftTags,openshiftItem,openshiftWatchURL} from "../supabase/functions/_shared/openshift.ts";
test("repository admission distinguishes watchers from stars and fails closed on weak maintenance",()=>{
  const now=Date.now(),date=new Date(now-86400000).toISOString();
  const meta={private:false,archived:false,disabled:false,fork:false,stargazers_count:1200,watchers_count:1200,subscribers_count:8,pushed_at:date,license:{spdx_id:"Apache-2.0"}};
  const health=repositoryHealth(meta,[{published_at:date},{published_at:date},{published_at:date,draft:true}],now);
  assert.equal(health.watchers,8);assert.equal(health.recent_releases,2);assert(repositoryAdmitted(health,{},now));
  for(const patch of [{stars:99},{watchers:4},{recent_releases:1},{active:false},{license:"NOASSERTION"},{checked_at:new Date(now-8*86400000).toISOString()},{pushed_at:new Date(now-91*86400000).toISOString()},{latest_release:new Date(now-181*86400000).toISOString()}]) assert.equal(repositoryAdmitted({...health,...patch},{},now),false);
  assert.equal(repositoryAdmitted(repositoryHealth({...meta,subscribers_count:undefined},[{published_at:date},{published_at:date}],now),{},now),false);
  assert.equal(repositoryAdmitted(health,{repo_min_stars:2000},now),false);
  assert.equal(repositoryName("https://github.com/kagent-dev/kagent/pull/2959"),"kagent-dev/kagent");
});
test("Trending retains GitHub order, never claims more than the actual top five",()=>{
 const html=Array.from({length:7},(_,i)=>`<article class="Box-row"><a href="/login">noise</a><h2><a href="/team/repo${i}">project</a></h2></article>`).join("");
 assert.deepEqual(trendingProjects(html).map(x=>x.rank),[1,2,3,4,5]);assert.equal(trendingProjects(html)[4].repository,"team/repo4");
 assert.throws(()=>trendingProjects("Rate limit"));assert.throws(()=>trendingProjects('<article class="Box-row"><h2>Unknown</h2></article>'));
});
test("OpenShift streams require explicit prerelease opt-in and never invent dates or support guarantees",()=>{
 const source={url:"https://amd64.ocp.releases.ci.openshift.org/api/v1/releasestream/5-stable/tags",id:"watch",revision:2,include_prereleases:false};
 const tags={tags:[{name:"5.0.0-rc.6",phase:"Accepted"},{name:"5.0.0",phase:"Accepted"},{name:"5.1.0-ec.1",phase:"Accepted"},{name:"5.0.1",phase:"Rejected"}]};
 assert.deepEqual(openshiftTags(tags,source).map((x:any)=>x.name),["5.0.0"]);
 assert.equal(openshiftTags(tags,{...source,include_prereleases:true}).length,3);
 const detail={name:"5.0.0-rc.6",phase:"Accepted",changeLog:btoa("<h2>Changes</h2><p>Created: 2026-10-08 12:09:01 +0000 UTC</p><p>Kubernetes performance fix</p>")};
 const item=openshiftItem(detail,source,detail.name);assert.equal(item.published_at,"2026-10-08T12:09:01.000Z");assert.equal(item.reference_meta.prerelease,true);
 assert(item.url.includes("/5-stable/release/5.0.0-rc.6"));assert(item.summary.includes("not a support"));
 assert.equal(openshiftItem({...detail,changeLog:btoa("No creation date")},source,detail.name).published_at,null);
 assert.throws(()=>openshiftItem({...detail,phase:"Rejected"},source,detail.name));
 assert.equal(openshiftWatchURL(source.url),source.url);assert.throws(()=>openshiftWatchURL("https://evil.example/api/v1/releasestream/5-stable/tags"));
});
