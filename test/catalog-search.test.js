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
