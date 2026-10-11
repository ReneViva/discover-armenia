import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

// Run with: node scripts/test-quiz.mjs
// This harness executes the real app and its real delegated click handlers.
// Only the DOM/browser boundary and independently tested gallery/language modules are stubbed.
const siteRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const storageKey='discover-armenia-quiz-v2';
const sourceOnly=process.argv.includes('--source-only');
for(const argument of process.argv.slice(2))assert.equal(argument,'--source-only',`Unknown option: ${argument}`);
let bootNumber=0;

class ElementStub{
 constructor(attributes={}){this.attributes={...attributes};this.dataset={};this.listeners=new Map();this.innerHTML='';this.open=false;this.disabled=false;this.focusCount=0;this.classList={add(){},remove(){},toggle(){}};}
 getAttribute(name){return this.attributes[name]??null;}
 setAttribute(name,value){this.attributes[name]=String(value);}
 removeAttribute(name){delete this.attributes[name];}
 addEventListener(type,listener){this.listeners.set(type,listener);}
 focus(){this.focusCount++;}
 close(){this.open=false;}
 showModal(){this.open=true;}
 getBoundingClientRect(){return {left:0,right:100,top:0,bottom:100};}
 closest(selector){return selector==='[data-action]'&&this.dataset.action?this:null;}
}

function randomGenerator(seed){return ()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296;};}

async function boot(appSource,content,basePath,storage=new Map()){
 const main=new ElementStub(),menu=new ElementStub({'aria-expanded':'false'}),navigation=new ElementStub(),dialog=new ElementStub(),close=new ElementStub();
 const links=['','dances','food','history','music','quiz','language','participants','about'].map(route=>new ElementStub({href:basePath+route}));
 navigation.querySelectorAll=selector=>selector==='a'?links:[];
 const listeners=new Map(),errors=[],requests=[];
 const calls={selfie:0,gallery:0,reset:0};
 const location={pathname:basePath+'quiz',origin:'https://culture.example',search:''};
 const document={
  title:'',
  querySelector(selector){
   if(selector==='main')return main;
   if(selector==='.menu-toggle')return menu;
   if(selector==='#navigation')return navigation;
   if(selector==='#detail-dialog')return dialog;
   if(selector==='.dialog-close')return close;
   if(selector==='meta[name="site-base"]')return {content:basePath};
   if(selector==='.next-question')return main.innerHTML.includes('data-action="quiz-next"')?new ElementStub():null;
   return null;
  },
  addEventListener(type,listener){const handlers=listeners.get(type)||[];handlers.push(listener);listeners.set(type,handlers);}
 };
 const localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)};
 const math=Object.create(Math);math.random=randomGenerator(351+1009*(++bootNumber));
 const context=vm.createContext({
  document,location,localStorage,Math:math,
  window:{history:{pushState(_state,_title,url){location.pathname=url;}},scrollTo(){},addEventListener(){}},
  console:{error(...arguments_){errors.push(arguments_.map(String).join(' '));}},
  async fetch(url){
   requests.push(url);
   assert(url.startsWith(basePath+'content/'),`Content fetch lost base path: ${url}`);
   const name=String(url).match(/\/content\/([\w-]+)\.json$/)?.[1];
   assert(name&&content[name],`Unexpected content fetch: ${url}`);
   return {ok:true,json:async()=>JSON.parse(JSON.stringify(content[name]))};
  },
  renderLanguage:()=>'<section>Language module stub</section>',
  renderSelfieStep:()=>{calls.selfie++;return '<section data-test-selfie="true">Optional selfie step</section>';},
  renderParticipantsPage:()=>'<section>Participants module stub</section>',
  mountParticipantGallery:()=>{calls.gallery++;},
  resetSelfieStep:()=>{calls.reset++;}
 });
 const executable=appSource.replace(/^import\s+[^\r\n]+;\s*$/gm,'');
 assert(!/^import\s/m.test(executable),'Unexpected import format in app');
 const probe=await new vm.Script(`(async()=>{${executable}\nreturn {state:()=>JSON.stringify(quizState),score:()=>score()};})()`,{filename:'app-under-test.js'}).runInContext(context);
 assert.deepEqual(errors,[],'The app reported a loading/runtime error');
 assert.equal(requests.length,6,'All six editable content files should load');
 const click=(action,extra={})=>{
  const button=new ElementStub();button.dataset={action,...extra};
  const event={target:button,button:0,preventDefault(){}};
  for(const listener of listeners.get('click')||[])listener(event);
  assert.deepEqual(errors,[],'The app reported a click-handler error');
 };
 return {state:()=>JSON.parse(probe.state()),score:probe.score,html:()=>main.innerHTML,click,calls,storage};
}

function validNewState(state,questions){
 assert.equal(state.version,2);
 assert.equal(state.order.length,12);
 assert.deepEqual([...state.order].sort(),questions.map(question=>question.id).sort());
 assert.equal(state.index,0);
 assert.deepEqual(state.answers,{});
}

function checkProgress(app,index,answered,score){
 const html=app.html();
 assert(html.includes(`Question ${index+1} of 12`),'Question count or position is wrong');
 assert(html.includes('aria-valuemax="12"'),'Progress maximum must be 12');
 assert(html.includes(`aria-valuenow="${index+(answered?1:0)}"`),'Progress does not reflect the current answer');
 assert(html.includes(`Score: <strong>${score}</strong>`),'The live score is wrong');
 assert.equal((html.match(/data-action="quiz-answer"/g)||[]).length,4,'A question must show four choices');
 assert.equal((html.match(/data-action="quiz-answer"[^>]* disabled/g)||[]).length,answered?4:0,'Answer choices must lock after answering');
 assert(!html.includes('data-test-selfie'),'Selfie step appeared before results');
 assert.equal(app.calls.selfie,0);
 assert.equal(app.calls.gallery,0);
}

async function testVariant(label,appPath,basePath){
 const appSource=await readFile(appPath,'utf8');
 const content={};
 for(const name of ['dances','foods','history','music','quiz','language'])content[name]=JSON.parse(await readFile(resolve(dirname(appPath),'content',name+'.json'),'utf8'));
 const questions=content.quiz;
 assert.equal(questions.length,12,`${label}: the quiz data must contain exactly 12 questions`);
 assert.equal(new Set(questions.map(question=>question.id)).size,12);
 const byId=new Map(questions.map(question=>[question.id,question]));
 let app=await boot(appSource,content,basePath);
 validNewState(app.state(),questions);
 checkProgress(app,0,false,0);
 const initialState=app.state();
 app.click('quiz-next');
 assert.deepEqual(app.state(),initialState,'An unanswered question was skipped');
 const firstQuestion=byId.get(initialState.order[0]);
 app.click('quiz-answer',{answer:String(firstQuestion.answer)});
 assert.equal(app.score(),1);
 checkProgress(app,0,true,1);
 assert(app.html().includes('That’s right!'),'Correct answer feedback is missing');
 const firstAnswerState=app.state();
 app.click('quiz-answer',{answer:String((firstQuestion.answer+1)%4)});
 assert.deepEqual(app.state(),firstAnswerState,'A second click changed an answered question');
 assert.equal(app.score(),1,'A duplicate answer changed the score');
 assert.deepEqual(JSON.parse(app.storage.get(storageKey)),firstAnswerState,'Answer progress was not persisted immediately');

 // A fresh execution represents an accidental browser refresh using the same localStorage.
 app=await boot(appSource,content,basePath,app.storage);
 assert.deepEqual(app.state(),firstAnswerState,'Refresh did not restore version-2 progress');
 checkProgress(app,0,true,1);
 app.click('quiz-next');
 checkProgress(app,1,false,1);
 let expectedScore=1;
 for(let index=1;index<12;index++){
  assert.equal(app.state().index,index);
  const beforeAnswer=app.state();
  app.click('quiz-next');
  assert.deepEqual(app.state(),beforeAnswer,'The next handler advanced before an answer');
  const question=byId.get(beforeAnswer.order[index]);
  const correct=index%2===0;
  const selected=correct?question.answer:(question.answer+1)%4;
  app.click('quiz-answer',{answer:String(selected)});
  if(correct)expectedScore++;
  assert.equal(app.score(),expectedScore,'Correct/incorrect scoring is wrong');
  checkProgress(app,index,true,expectedScore);
  assert(app.html().includes(correct?'That’s right!':'A new fact for your collection.'),'Educational feedback is missing');
  const answeredState=app.state();
  app.click('quiz-answer',{answer:String((selected+1)%4)});
  assert.deepEqual(app.state(),answeredState,'An already answered question accepted another answer');
  assert.equal(app.score(),expectedScore);
  if(index===11)assert(app.html().includes('See My Results'),'The final answer must offer results');
  app.click('quiz-next');
 }
 assert.equal(expectedScore,6);
 assert.equal(app.state().index,12,'Completion should follow exactly 12 questions');
 assert.equal(Object.keys(app.state().answers).length,12);
 assert.equal(app.score(),6);
 assert(app.html().includes('CHALLENGE COMPLETE'),'Results were not rendered');
 assert(app.html().includes('class="result-score">6<span> / 12</span>'),'Final results score is wrong');
 assert(app.html().includes('Every explorer starts somewhere!'),'The score-specific results message is wrong');
 assert(app.html().includes('data-test-selfie="true"'),'The optional results selfie step is missing');
 assert.equal(app.calls.selfie,1,'Completion must render the selfie step once');
 assert.equal(app.calls.gallery,1,'Completion must mount the participant gallery once');
 assert.equal((app.html().match(/<h3>/g)||[]).length,12,'The results review must include all 12 questions');
 assert.deepEqual(JSON.parse(app.storage.get(storageKey)),app.state(),'Completion state was not saved');
 const restoredResults=await boot(appSource,content,basePath,app.storage);
 assert.deepEqual(restoredResults.state(),app.state(),'A refresh lost completed results');
 assert.equal(restoredResults.score(),6);
 assert.equal(restoredResults.calls.selfie,1,'Restored results must render one selfie step');
 assert.equal(restoredResults.calls.gallery,1);
 const completedOrder=app.state().order;
 app.click('quiz-replay');
 validNewState(app.state(),questions);
 assert.equal(app.score(),0,'Replay must reset score');
 assert.notDeepEqual(app.state().order,completedOrder,'Replay did not reshuffle question order');
 assert.equal(app.calls.reset,1,'Replay must reset the selfie flow');
 assert.equal(app.calls.selfie,1,'Replay must not render another results selfie step');
 assert(!app.html().includes('data-test-selfie'),'Replay must return to questions');
 assert(app.html().includes('Question 1 of 12'));
 assert(app.html().includes('Score: <strong>0</strong>'));
 assert.deepEqual(JSON.parse(app.storage.get(storageKey)),app.state(),'Replay state was not saved');

 for(const [finalScore,message] of [[0,'Every explorer starts somewhere!'],[8,'You’ve found your Armenian spark!'],[12,'You’re an Armenian culture star!']]){
  const completed={version:2,order:questions.map(question=>question.id),index:12,answers:Object.fromEntries(questions.map((question,index)=>[question.id,index<finalScore?question.answer:(question.answer+1)%4]))};
  const results=await boot(appSource,content,basePath,new Map([[storageKey,JSON.stringify(completed)]]));
  assert.equal(results.score(),finalScore);
  assert(results.html().includes(message),`Results message does not match a ${finalScore}/12 score`);
  assert(results.html().includes(`class="result-score">${finalScore}<span> / 12</span>`));
  assert.equal(results.calls.selfie,1);
 }

 const oldOrder=[...questions.map(question=>question.id),...Array.from({length:15},(_,index)=>`removed-question-${index}`)];
 const old27={version:2,order:oldOrder,index:8,answers:{[questions[0].id]:questions[0].answer}};
 const corruptStates=[
  ['outdated 27-question progress',JSON.stringify(old27)],
  ['malformed JSON','{broken'],
  ['unsupported storage version',JSON.stringify({...initialState,version:1})],
  ['duplicate question IDs',JSON.stringify({...initialState,order:Array(12).fill(questions[0].id)})],
  ['invalid saved answer',JSON.stringify({...initialState,answers:{[questions[0].id]:9}})],
  ['invalid saved position',JSON.stringify({...initialState,index:-1})]
 ];
 for(const [description,saved] of corruptStates){
  const recovered=await boot(appSource,content,basePath,new Map([[storageKey,saved]]));
  validNewState(recovered.state(),questions);
  assert.equal(recovered.score(),0,`${description} must reset score`);
  checkProgress(recovered,0,false,0);
  assert.deepEqual(JSON.parse(recovered.storage.get(storageKey)),recovered.state(),`${description} was not replaced with valid progress`);
 }
 console.log(`${label}: 12-question progress, 6/12 scoring, answer/next guards, results selfie, shuffled replay, refresh restore and corrupt/27-question recovery passed.`);
}

await testVariant('Source app',resolve(siteRoot,'app.js'),'/');
let variants=1;
if(!sourceOnly){
 const generated=resolve(siteRoot,'dist','app.js');
 try{
  await access(generated);
  const index=await readFile(resolve(siteRoot,'dist','index.html'),'utf8');
  const basePath=index.match(/<meta name="site-base" content="([^"]+)">/)?.[1]||'/';
  await testVariant(`Generated app (${basePath})`,generated,basePath);
  variants++;
 }catch(error){
  if(error.code==='ENOENT')console.log('Generated app is not available; run the production build to include its quiz checks.');
  else throw error;
 }
}
console.log(`Quiz behavior tests passed (${variants} app variant${variants===1?'':'s'}).`);
