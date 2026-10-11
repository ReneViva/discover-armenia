import {cp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const args=process.argv.slice(2);
const githubPages=args.includes('--github-pages');
const baseArgument=args.find(arg=>arg.startsWith('--base='));
for(const arg of args)if(arg!=='--github-pages'&&!arg.startsWith('--base='))throw new Error(`Unknown build option: ${arg}`);
const requestedBase=baseArgument?.slice('--base='.length)||'/';
const basePath='/'+requestedBase.replace(/^\/+|\/+$/g,'')+(requestedBase.replace(/^\/+|\/+$/g,'')?'/':'');
if(!/^\/(?:[A-Za-z0-9._~-]+\/)*$/.test(basePath)||basePath.split('/').some(part=>part==='.'||part==='..'))throw new Error('The base must be a site path, such as /discover-armenia/.');
const withBase=value=>value.startsWith('/')&&!value.startsWith('//')?basePath+value.slice(1):value;
// Rebase generated HTML/template attributes, leaving fragments and external URLs alone.
const rebaseAttributes=source=>source.replace(/\b(href|src)=(['"])\/(?!\/)/g,(_,attribute,quote)=>`${attribute}=${quote}${basePath}`);
const replaceRequired=(source,before,after)=>{
  if(!source.includes(before))throw new Error(`Base-path integration needs updating: ${before}`);
  return source.replace(before,after);
};
// Helpers are injected into the generated app only. Editable source stays usable at /.
const runtimeBase=`
const BASE_PATH=document.querySelector('meta[name="site-base"]')?.content||'/';
const sitePath=value=>{
 value=String(value??'');
 if(!value.startsWith('/')||value.startsWith('//')||BASE_PATH==='/'||value.startsWith(BASE_PATH))return value;
 return BASE_PATH+value.slice(1);
};
const routePath=value=>{
 if(BASE_PATH==='/')return value;
 if(value===BASE_PATH.slice(0,-1))return '/';
 return value.startsWith(BASE_PATH)?'/'+value.slice(BASE_PATH.length):value;
};
`;
execFileSync(process.execPath,['scripts/check.mjs'],{stdio:'inherit'});
await mkdir('dist',{recursive:true});
for(const f of ['index.html','app.js','language-page.js','participant-gallery.js','styles.css','participants.css','assets','content'])await cp(f,`dist/${f}`,{recursive:true});
const template=rebaseAttributes(await readFile('index.html','utf8')).replace('<head>',`<head>\n  <meta name="site-base" content="${basePath}">`);
await writeFile('dist/index.html',template);
let app=await readFile('app.js','utf8');
app=replaceRequired(app,"from '/language-page.js'",`from '${withBase('/language-page.js')}'`);
app=replaceRequired(app,"from '/participant-gallery.js'",`from '${withBase('/participant-gallery.js')}'`);
app=replaceRequired(app,"const main=document.querySelector('main');",runtimeBase+"const main=document.querySelector('main');");
app=replaceRequired(app,'location.pathname.replace(','routePath(location.pathname).replace(');
app=replaceRequired(app,"a.getAttribute('href')===`/${route}`","a.getAttribute('href')===sitePath(`/${route}`)");
app=replaceRequired(app,'fetch(`/content/${name}.json`)','fetch(sitePath(`/content/${name}.json`))');
app=replaceRequired(app,'return [name,await response.json()]','return [name,(await response.json()).map(item=>item.image?{...item,image:sitePath(item.image)}:item)]');
await writeFile('dist/app.js',rebaseAttributes(app));
await writeFile('dist/language-page.js',rebaseAttributes(await readFile('language-page.js','utf8')));
await writeFile('dist/participant-gallery.js',rebaseAttributes(await readFile('participant-gallery.js','utf8')));
const styles=(await readFile('styles.css','utf8')).replace(/url\((['"]?)\/(?!\/)/g,(_,quote)=>`url(${quote}${basePath}`);
await writeFile('dist/styles.css',styles);
execFileSync(process.execPath,['--check','dist/app.js'],{stdio:'inherit'});
execFileSync(process.execPath,['--check','dist/language-page.js'],{stdio:'inherit'});
execFileSync(process.execPath,['--check','dist/participant-gallery.js'],{stdio:'inherit'});
const routes=['dances','food','history','music','quiz','language','participants','about'];
for(const group of ['dances','foods']){const items=JSON.parse(await readFile(`content/${group}.json`,'utf8'));for(const x of items)routes.push(`${group==='foods'?'food':group}/${x.id}`);}
for(const route of routes){await mkdir(`dist/${route}`,{recursive:true});await writeFile(`dist/${route}/index.html`,template);}
await writeFile('dist/404.html',template);
await writeFile('dist/_redirects','/* /index.html 200\n');
await writeFile('dist/robots.txt','User-agent: *\nAllow: /\n');
await writeFile('dist/.nojekyll','');
if(!githubPages){
  try{const hosting=JSON.parse(await readFile('.openai/hosting.json','utf8'));hosting.static={directory:'dist'};await writeFile('.openai/hosting.json',JSON.stringify(hosting,null,2)+'\n');}
  catch(error){if(error.code!=='ENOENT')throw error;}
}
console.log(`Production build ready: home + ${routes.length} direct routes, base ${basePath}${githubPages?' (GitHub Pages)':''}, optimized local media, no runtime dependencies.`);
