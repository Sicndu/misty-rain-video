import test from 'node:test';
import assert from 'node:assert/strict';
import {CatalogSearch,normalizeCatalogSearch} from '../server/catalogSearch.js';
const payload={subjects:{items:[
 {target_type:'tv',target:{id:'123',title:'庆余年 第二季',year:'2024',card_subtitle:'中国大陆 / 剧情 古装',rating:{value:7.3,count:1},cover_url:'https://qnmob3-sign.doubanio.com/view/photo/p123.jpg?a=b'}},
 {target_type:'tv',target:{id:'456',title:'某动画',year:'2026',card_subtitle:'日本 / 动画',rating:{value:0,count:0},cover_url:'https://example.com/not-an-image'}},
 {target_type:'book',target:{id:'789',title:'同名小说'}}
]}};
test('catalog normalizes only films/TV, preserves season/year, detects animation, and rejects foreign posters',()=>{
 const items=normalizeCatalogSearch(payload);assert.equal(items.length,2);assert.equal(items[0].category,'tv');assert.equal(items[0].title,'庆余年 第二季');assert.equal(items[0].year,'2024');assert.equal(items[0].rating,7.3);assert.equal(items[1].category,'anime');assert.equal(items[1].imageUrl,'');assert.equal(items[1].rating,null);
 assert.deepEqual(normalizeCatalogSearch({subjects:{items:[]}}),[]);assert.throws(()=>normalizeCatalogSearch({banned:'blocked',subjects:{items:[]}}));
});
test('catalog exposes real rating counts for popularity, preserves unknown counts and release years',()=>{
 const items=normalizeCatalogSearch({subjects:{items:[
  {target_type:'movie',target:{id:1,title:'已评分',year:'2025',rating:{value:8.2,count:10023}}},
  {target_type:'movie',target:{id:2,title:'未评分',year:'2027',rating:{value:0,count:0}}},
  {target_type:'tv',target:{id:3,title:'缺失',year:'',rating:{value:7.1}}},
  {target_type:'tv',target:{id:4,title:'错误数据',year:'不详',rating:{value:7.1,count:-1}}}
 ]}});
 assert.deepEqual(items.map(item=>item.ratingCount),[10023,0,null,null]);
 assert.deepEqual(items.map(item=>item.year),['2025','2027','','']);
 assert.equal(items[1].rating,null);assert.equal('releaseDate' in items[0],false);
});
test('catalog lookup is deduplicated/cached and only registers trusted poster metadata, never requests a drive search',async()=>{
 let calls=0,registered=[];const service=new CatalogSearch({discovery:{registerCatalogItems:items=>registered=items},fetcher:async url=>{calls++;assert.match(url,/m.douban.com\/rexxar\/api\/v2\/search\?type=movie/);return Response.json(payload)}});
 const [first,second]=await Promise.all([service.search(' 庆余年 '),service.search('庆余年')]);assert.deepEqual(first,second);await service.search('庆余年');assert.equal(calls,1);assert.equal(registered.length,2);assert.match(first.items[0].poster,/^\/api\/discovery\/posters\/douban-123/);assert.equal(first.items[0].imageUrl,undefined);
 for(const query of ['',null,'x'.repeat(101),'https://pan.quark.cn/s/example'])await assert.rejects(service.search(query),{statusCode:400});assert.equal(calls,1);
});
test('provider outage remains distinguishable from an empty catalog result and can be retried',async()=>{
 let fail=true;const service=new CatalogSearch({discovery:{registerCatalogItems(){}},fetcher:async()=>fail?new Response('blocked',{status:403}):Response.json({subjects:{items:[]}})});
 await assert.rejects(service.search('找不到'),{code:'CATALOG_UNAVAILABLE',statusCode:503});fail=false;assert.deepEqual((await service.search('找不到')).items,[]);
});

test('current-season chart entries supplement stale search suggestions without duplicating subject IDs',async()=>{
 const latest={...normalizeCatalogSearch(payload)[0],id:'douban-999',title:'庆余年 第三季',year:'2027'};
 const service=new CatalogSearch({discovery:{registerCatalogItems(){},matchingCatalogItems:()=>[normalizeCatalogSearch(payload)[0],latest]},fetcher:async()=>Response.json(payload)});
 const result=await service.search('庆余年');assert.equal(result.items.length,3);assert.ok(result.items.some(item=>item.id==='douban-999'));assert.equal(result.items.filter(item=>item.id==='douban-123').length,1);
});

test('an older chart cache cannot erase a real rating count returned by search',async()=>{
 const old={...normalizeCatalogSearch(payload)[0],ratingCount:null};
 const service=new CatalogSearch({discovery:{registerCatalogItems(){},matchingCatalogItems:()=>[old]},fetcher:async()=>Response.json(payload)});
 assert.equal((await service.search('庆余年')).items[0].ratingCount,1);
});

test('query-specific login denial falls back to deduplicated public chart matches and preserves sorting metadata',async()=>{
 let calls=0,registered=[];
 const known={...normalizeCatalogSearch(payload)[0],title:'闹鬼酒店 第二季',ratingCount:12345};
 const service=new CatalogSearch({discovery:{registerCatalogItems:items=>registered=items,matchingCatalogItems:query=>{
  assert.equal(query,'闹鬼');return [known,known,...Array.from({length:35},(_,index)=>({...known,id:`douban-${1000+index}`})),
   {...known,id:'untrusted'}, {...known,id:'douban-9000',imageUrl:'https://attacker.test/image'}];
 }},fetcher:async url=>{calls++;assert.equal(new URL(url).hostname,'m.douban.com');return Response.json({msg:'need_login'},{status:403});}});
 const [first,duplicate]=await Promise.all([service.search('闹鬼'),service.search('闹鬼')]);
 assert.equal(calls,1);assert.deepEqual(first,duplicate);assert.equal(first.partial,true);assert.equal(first.items.length,30);
 assert.equal(new Set(first.items.map(item=>item.id)).size,30);assert.equal(registered.length,30);
 assert.equal(first.items[0].ratingCount,12345);assert.equal(first.items[0].rating,7.3);assert.equal(first.items[0].year,'2024');
 assert.equal(first.items[0].imageUrl,undefined);assert.match(first.items[0].poster,/^\/api\/discovery\/posters\//);
 assert.deepEqual(await service.search('闹鬼'),first);assert.equal(calls,1);assert.equal(service.pending.size,0);
});

test('partial chart fallback expires after thirty seconds and cannot mask recovered catalog search',async()=>{
 let clock=100_000,calls=0,blocked=true;
 const known=normalizeCatalogSearch(payload)[0];
 const service=new CatalogSearch({now:()=>clock,discovery:{registerCatalogItems(){},matchingCatalogItems:()=>[known]},fetcher:async()=>{
  calls++;return blocked?Response.json({msg:'need_login'},{status:403}):Response.json(payload);
 }});
 assert.equal((await service.search('庆余年')).partial,true);
 blocked=false;clock+=29_999;assert.equal((await service.search('庆余年')).partial,true);assert.equal(calls,1);
 clock+=1;const recovered=await service.search('庆余年');assert.equal(calls,2);assert.equal(recovered.partial,false);assert.equal(recovered.items.length,2);
 clock+=30_001;assert.deepEqual(await service.search('庆余年'),recovered);assert.equal(calls,2);
});

test('login denial with no valid matching chart remains a retryable error and never caches a false empty result',async()=>{
 let calls=0;
 const known=normalizeCatalogSearch(payload)[0];
 for(const matches of [[],[{...known,provider:'other'}],[{...known,imageUrl:'http://127.0.0.1/private'}],[{...known,title:''}]]) {
  const service=new CatalogSearch({discovery:{registerCatalogItems(){assert.fail('must not register invalid fallback');},matchingCatalogItems:()=>matches},
   fetcher:async()=>{calls++;return Response.json({msg:'need_login'},{status:403});}});
  await assert.rejects(service.search('闹鬼'),{code:'CATALOG_UNAVAILABLE',statusCode:503});
  assert.equal(service.cache.size,0);assert.equal(service.pending.size,0);
 }
 assert.equal(calls,4);
});
