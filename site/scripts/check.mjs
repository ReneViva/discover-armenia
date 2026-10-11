import {readFile,access} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const counts={dances:3,foods:11,history:12,music:10,quiz:12,language:12};
for(const [name,min] of Object.entries(counts)){
 const entries=JSON.parse(await readFile(`content/${name}.json`,'utf8'));assert(entries.length>=min,`${name}: incomplete content`);if(name==='quiz')assert.equal(entries.length,12,'quiz: expected exactly 12 questions');assert.equal(new Set(entries.map(x=>x.id)).size,entries.length,`${name}: duplicate ID`);
 for(const item of entries){assert.match(item.id,/^[a-z0-9-]+$/);if(item.image?.startsWith('/'))await access('.'+item.image);for(const source of item.sources||[])assert.match(source.url,/^https:\/\//);if(item.video?.id){assert.match(item.video.id,/^[\w-]{11}$/);assert.equal(new URL(item.video.url).searchParams.get('v'),item.video.id);}if(name==='foods'){for(const key of ['name','armenian','category','diet','summary','tradition','fact','image'])assert(item[key],`${item.id}: ${key}`);assert(item.ingredients.length>0);assert(item.imageCredit.url);}if(name==='quiz'){assert.equal(item.options.length,4);assert(Number.isInteger(item.answer)&&item.answer>=0&&item.answer<4);assert(item.explanation);assert(item.source.url);}}
 console.log(`${name}: ${entries.length} entries verified`);
}
execFileSync(process.execPath,['--check','app.js'],{stdio:'inherit'});
execFileSync(process.execPath,['--check','language-page.js'],{stdio:'inherit'});
execFileSync(process.execPath,['--check','participant-gallery.js'],{stdio:'inherit'});
const galleryConfig=JSON.parse(await readFile('content/gallery-config.json','utf8'));
if(galleryConfig.apiBase!==null){const api=new URL(galleryConfig.apiBase);assert.equal(api.protocol,'https:');assert.equal(api.username,'');assert.equal(api.password,'');assert.equal(api.pathname,'/');assert.equal(api.search,'');assert.equal(api.hash,'');}
const words=JSON.parse(await readFile('content/language.json','utf8'));
for(const word of words){for(const key of ['armenian','english','transliteration','pronunciation','category'])assert(word[key],`${word.id}: ${key}`);assert(['Greetings','Everyday','At the table'].includes(word.category));assert(word.sources.length>0);}
console.log('Content integrity, media paths and JavaScript syntax passed.');
