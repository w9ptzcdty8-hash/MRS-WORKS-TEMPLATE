const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM,requestInterceptor,VirtualConsole}=require('jsdom');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const source=fs.readFileSync(path.join(root,'script.js'),'utf8');
const waitFor=async predicate=>{for(let i=0;i<200;i++){if(predicate())return;await new Promise(r=>setTimeout(r,5));}assert.fail('Expected state not reached');};
for(const mode of ['normal','hung','offline'])test(`initialization precedes advertising completion: ${mode}`,async()=>{
 let initialized=0,loaded=false,advertising=false;
 const errors=[],virtualConsole=new VirtualConsole();
 virtualConsole.on('log',message=>{if(message==='MRS WORKS initialized')initialized++;});
 virtualConsole.on('jsdomError',error=>errors.push(error));
 // Inject only a mock at the documented advertising insertion point.
 const adapted=html.replace('<!-- admax -->','<!-- admax --><script src="https://ad.example/block.js"></script>');
 const dom=new JSDOM(adapted,{
  url:'https://template.example/',runScripts:'dangerously',virtualConsole,
  resources:{interceptors:[requestInterceptor(request=>{
   if(request.url==='https://ad.example/block.js'){
    advertising=true;
    if(mode==='hung')return new Promise(()=>{});
    if(mode==='offline')throw Error('Advertising offline');
    return new Response('');
   }
   const css=new URL(request.url).pathname.endsWith('.css');
   return new Response(css?'':source,{headers:{'Content-Type':css?'text/css':'application/javascript'}});
  })]},
  beforeParse(w){w.localStorage.setItem('existing-save','keep');w.addEventListener('load',()=>{loaded=true;});}
 });
 try{
  await waitFor(()=>advertising&&initialized===1);
  if(mode==='hung'){assert.equal(loaded,false);assert.equal(dom.window.document.readyState,'loading');}
  assert.equal(dom.window.localStorage.getItem('existing-save'),'keep');
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  dom.window.dispatchEvent(new dom.window.Event('load'));
  assert.equal(initialized,1,'initialization does not duplicate after load events');
  assert.equal(errors.filter(error=>error.type!=='resource-loading').length,0,errors.map(String).join('\n'));
 }finally{dom.window.close();}
});
test('script initializes even if DOMContentLoaded has already fired',()=>{
 const dom=new JSDOM(html,{runScripts:'outside-only'});let initialized=0;
 try{dom.window.console.log=()=>initialized++;dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));dom.window.eval(source);assert.equal(initialized,1);}finally{dom.window.close();}
});
test('entry has one app loader after app/ad container and before advertising insertion',()=>{
 const app=html.indexOf('<script src="script.js"></script>');
 assert.ok(app>html.indexOf('</main>'));assert.ok(app>html.indexOf('<div class="ad-banner">'));
 assert.ok(app<html.indexOf('<!-- admax -->'));
 assert.equal([...html.matchAll(/<script src="script.js"/g)].length,1);
 assert.equal([...html.matchAll(/<script[^>]*src=/g)].length,1,'no fake URL or live advertising network dependency');
 assert.doesNotMatch(html,/rel=["']manifest["']/i);assert.doesNotMatch(source,/serviceWorker/);
});
test('initialization waits for the ready app DOM, without a DOMContentLoaded listener',()=>{
 const dom=new JSDOM(html,{runScripts:'outside-only'});
 try{dom.window.console.log=()=>assert.ok(dom.window.document.getElementById('app'));dom.window.eval(source);assert.doesNotMatch(source,/addEventListener\(["'](?:DOMContentLoaded|load)["']/);}finally{dom.window.close();}
});
