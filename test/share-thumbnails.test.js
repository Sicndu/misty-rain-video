import test from 'node:test';
import assert from 'node:assert/strict';
import {ShareThumbnails} from '../server/shareThumbnails.js';
import {QuarkGateway} from '../server/quarkGateway.js';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/qcoAAAAASUVORK5CYII=','base64');
test('share thumbnails use opaque owner-scoped handles, deduplicate reads and expire without exposing upstream signatures',async()=>{
 let now=0,calls=0;const store=new ShareThumbnails(async()=>{calls++;return new Response(png)},()=>now);
 const url=store.register('https://cdn.example.test/image?private-signature=secret','admin');assert.doesNotMatch(url,/secret|example/);const id=url.split('/').at(-1);
 await assert.rejects(store.read(id,'user'),{statusCode:403});assert.equal(calls,0);
 const [a,b]=await Promise.all([store.read(id,'admin'),store.read(id,'admin')]);assert.equal(calls,1);assert.equal(a.contentType,'image/png');assert.deepEqual(a.bytes,b.bytes);
 now=600001;await assert.rejects(store.read(id,'admin'),{statusCode:404});store.cleanup();assert.equal(store.bytes,0);
 assert.equal(store.register('http://cdn.example.test/image','admin'),'');assert.equal(store.register('https://user:pass@cdn.example.test/image','admin'),'');
});
test('non-image and oversized upstream content are not served as a thumbnail',async()=>{
 for(const [body,status] of [[Buffer.from('<html>not an image</html>'),415],[Buffer.alloc(2*1024*1024+1),413]]){const store=new ShareThumbnails(async()=>new Response(body));const id=store.register('https://cdn.example.test/image','admin').split('/').at(-1);await assert.rejects(store.read(id,'admin'),{statusCode:status});assert.equal(store.bytes,0);}
});

test('thumbnail CDN requests retain URL validation but omit playback headers and cookies',async t=>{
 const gateway=new QuarkGateway({credentialStore:{getCookie:()=> 'private-cookie'}});t.after(()=>clearInterval(gateway.cleanupTimer));
 t.mock.method(globalThis,'fetch',async(_url,options)=>{assert.equal(options.headers.Referer,undefined);assert.equal(options.headers.Cookie,undefined);assert.equal(options.headers['User-Agent'],undefined);return new Response(png)});
 const id=gateway.shareThumbnails.register('https://thumb-c-zb.cdn.yun.cn/image','admin').split('/').at(-1);
 assert.equal((await gateway.shareThumbnails.read(id,'admin')).contentType,'image/png');
 await assert.rejects(gateway.fetchMedia('https://127.0.0.1/image',undefined,'thumbnail'));
});
