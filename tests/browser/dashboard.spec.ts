import {test,expect} from '@playwright/test';
const at=new Date().toISOString();
for(const width of[360,1280])test(`administrator BI is usable and honest at ${width}px`,async({page},info)=>{
 await page.setViewportSize({width,height:940});let calls=0;const pageErrors:string[]=[];
 page.on('pageerror',error=>pageErrors.push(error.message));
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;let json:unknown={};
  if(path==='/api/status')json={configured:true};
  else if(path==='/api/me')json={member:{id:'admin-fixture',username:'owner',role:'admin',active:true},mfa_required:false};
  else if(path==='/api/action'){
   const {action,payload}=route.request().postDataJSON();
   if(['feed','library'].includes(action))json={items:[],total:0};
   else if(['sources','folders','trash'].includes(action))json=[];
   // PostgreSQL jsonb_object_agg returns null for a genuinely empty job queue.
   else if(action==='admin')json={members:[],invites:[],audit:[],profile:{queries:[],repo_queries:[],priorities:{}},jobs:null,usage:[]};
   else if(action==='admin_dashboard'){
    calls++;json={checked_at:at,window_days:payload.window_days,observation:{observed_at:at,snapshot:{stages:[{key:'database',label:'Database',status:'healthy',detail:'Authenticated check passed.'},{key:'evaluation',label:'Evaluation',status:'waiting',detail:'Quota wait is expected.'}],reviews:{pending:3},sources:{overdue:0},notifications:{sent:8,pending:0},evaluation:{usage:{used_24h:9,used_month:40},daily_ceiling:16,monthly_ceiling:496}}},totals:{retained_links:744,reviewed_links:700,discoveries_24h:49,active_sources:88,members:3,active_members:3,whatsapp_registered:3,reads:12,bookmarks:5,database_bytes:16000000},trends:[{day:'2026-10-17',discovered:20,reviewed:18},{day:'2026-10-18',discovered:49,reviewed:30}],topics:[{topic:'Inference',n:40},{topic:'Networking',n:25}],users:[{id:'member-fixture',username:'fixture_user',display_name:'Fixture User',role:'reader',active:true,whatsapp_registration:'registered',reads:4,saved:2,recorded_actions:7,last_activity:at}],incidents:[{id:'resolved-fixture',code:'collection_degraded',summary:'One overdue job recovered.',severity:'warning',first_seen:at,resolved_at:at}],recoveries:[{kind:'superseded_source_failure',affected:1,created_at:at}]};
   }
  }
  await route.fulfill({json});
 });
 await page.goto('/?view=admin');
 await expect(page.getByRole('heading',{name:'Platform overview',exact:true})).toBeVisible();
 await expect(page.getByText('All monitored stages are operational',{exact:true})).toBeVisible();
 await expect(page.getByRole('cell',{name:'Fixture User fixture_user'})).toBeVisible();
 await page.getByLabel('Dashboard period').selectOption('30');await expect(page.getByRole('columnheader',{name:'Actions · 30d'})).toBeVisible();
 await page.getByLabel('Include resolved').check();await expect(page.getByText('One overdue job recovered.',{exact:true})).toBeVisible();
 await page.getByRole('tab',{name:'Health & audit',exact:true}).click();
 await expect(page.getByText('queued jobs',{exact:true})).toBeVisible();
 await expect(page.getByText('failed jobs',{exact:true})).toBeVisible();
 await page.getByRole('tab',{name:'Dashboard',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Platform overview',exact:true})).toBeVisible();
 expect(pageErrors).toEqual([]);
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath('dashboard.png'),fullPage:true});
 expect(calls).toBeGreaterThanOrEqual(2);
});
