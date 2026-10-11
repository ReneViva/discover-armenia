const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const sitePath=path=>{
  const base=document.querySelector('meta[name="site-base"]')?.content||'/';
  return base==='/'?path:base.replace(/\/$/,'')+path;
};
const tokenKey='discover-armenia-own-photos-v1';
const participantIdPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ownTokens=new Map();
let storageAvailable=true;
try{
  const saved=JSON.parse(localStorage.getItem(tokenKey)||'{}');
  if(saved&&typeof saved==='object')for(const [id,token] of Object.entries(saved))if(participantIdPattern.test(id)&&typeof token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(token))ownTokens.set(id,token);
}catch{storageAvailable=false;}
const settings={apiBase:null,loaded:false};
let configPromise=null,eventsMounted=false,photoSequence=0;
const selfie={photo:null,previewUrl:null,displayName:'',consent:false,preparing:false,uploading:false,skipped:false,published:null,removalToken:null,message:'',tone:'info'};
const gallery={participants:null,loading:false,message:'',tone:'info',deleting:new Set()};
const status=(text,tone='info')=>text?`<p class="gallery-status gallery-status-${tone}" role="status" aria-live="polite">${escapeHTML(text)}</p>`:'';
const available=()=>Boolean(settings.apiBase);

async function request(url,options={}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),20000);
  try{
    const response=await fetch(url,{...options,signal:controller.signal,credentials:'omit',cache:'no-store'});
    let payload={};
    try{payload=await response.json();}catch{}
    if(!response.ok){
      const reason=typeof payload.error==='string'?payload.error:typeof payload.message==='string'?payload.message:null;
      throw Object.assign(new Error(reason||`The photo service returned ${response.status}. Please try again.`),{httpStatus:response.status});
    }
    return payload;
  }catch(error){
    if(error.name==='AbortError')throw new Error('The connection took too long. Check your connection and try again.');
    throw error;
  }finally{clearTimeout(timer);}
}

function validApiBase(value){
  if(typeof value!=='string'||!value.trim())return null;
  try{
    const url=new URL(value);
    if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/')return null;
    return url.origin;
  }catch{return null;}
}

async function loadConfig(){
  if(configPromise)return configPromise;
  configPromise=(async()=>{
    try{
      const config=await request(sitePath('/content/gallery-config.json'));
      settings.apiBase=validApiBase(config.apiBase);
    }catch{settings.apiBase=null;}
    settings.loaded=true;
    drawSelfie();
    drawGallery();
    return settings;
  })();
  return configPromise;
}

function clearPhoto(){
  photoSequence++;
  if(selfie.previewUrl)URL.revokeObjectURL(selfie.previewUrl);
  selfie.photo=null;
  selfie.previewUrl=null;
  selfie.consent=false;
  selfie.preparing=false;
}

export function resetSelfieStep(){
  if(selfie.uploading)return;
  clearPhoto();
  Object.assign(selfie,{displayName:'',skipped:false,published:null,removalToken:null,message:'',tone:'info'});
}

function selfieMarkup(){
  if(selfie.skipped)return `<div class="selfie-dismissed"><h2>Enjoy the rest of Armenian Night!</h2><p>You can join the photo gallery later if you like.</p><div class="gallery-actions"><button class="button button-light" type="button" data-gallery-action="start">Try a selfie</button><a class="text-link" href="${escapeHTML(sitePath('/participants'))}">See Our Armenian Night →</a></div></div>`;
  if(selfie.published)return `<div class="selfie-published"><span class="eyebrow">A SHARED MEMORY</span><h2>You’re in Our Armenian Night!</h2><p>Your photo is published in the shared gallery.</p><a class="button button-primary" href="${escapeHTML(sitePath('/participants'))}">Visit the gallery →</a>${!storageAvailable?status('This browser could not save your removal code. Save the details below so you can remove your photo later.','warning'):''}<details class="removal-receipt"><summary>Keep your private removal details</summary><p>Save these details privately. Anyone with this code can remove this photo.</p><p><strong>Photo ID:</strong> <code>${escapeHTML(selfie.published.id)}</code></p><p><strong>Removal code:</strong> <code>${escapeHTML(selfie.removalToken)}</code></p><button class="button button-light" type="button" data-gallery-action="copy-removal">Copy removal details</button><p>Use “Remove my photo” on the gallery page if you return on another device.</p></details>${status(selfie.message,selfie.tone)}</div>`;
  const busy=selfie.uploading||selfie.preparing;
  const disabled=!selfie.photo||!selfie.consent||!available()||busy;
  return `<span class="eyebrow">OPTIONAL · A MEMORY TO SHARE</span><h2>Your Armenian Night selfie.</h2><p>Take or choose a photo to join <strong>Our Armenian Night</strong>. You can skip this step.</p>
    <form data-gallery-form="selfie" class="selfie-form">
      <label class="gallery-visually-hidden" for="armenian-selfie-file">Take or choose a selfie</label><input class="gallery-file-input" type="file" id="armenian-selfie-file" data-gallery-photo accept="image/*" capture="user" tabindex="-1" ${busy?'disabled':''}>
      ${selfie.previewUrl?`<div class="selfie-preview"><img src="${escapeHTML(selfie.previewUrl)}" alt="Your selected photo, currently a private preview"><span>Private preview</span></div>`:`<div class="selfie-placeholder" aria-hidden="true"><span>✦</span><p>One night.<br>A room full of stories.</p></div>`}
      <div class="gallery-actions"><button class="button button-light" type="button" data-gallery-action="${selfie.previewUrl?'retake':'choose-photo'}" ${busy?'disabled':''}>${selfie.previewUrl?'Retake or choose another':'Take or choose a selfie'}</button>${selfie.previewUrl?`<button class="gallery-small-button" type="button" data-gallery-action="cancel" ${busy?'disabled':''}>Cancel photo</button>`:''}</div>
      ${selfie.preparing?status('Preparing a smaller photo and removing embedded location metadata…'):''}
      <div class="selfie-fields"><label for="armenian-selfie-name">Name or nickname <span>(optional, up to 40 characters)</span></label><input type="text" id="armenian-selfie-name" data-gallery-name name="displayName" maxlength="40" autocomplete="off" value="${escapeHTML(selfie.displayName)}" ${busy?'disabled':''}>
      <label class="public-consent" for="armenian-selfie-consent"><input type="checkbox" id="armenian-selfie-consent" data-gallery-consent required ${selfie.consent?'checked':''} ${busy?'disabled':''}><span>I agree to publish this photo and my optional name in a public gallery that anyone with the website link can view. I have permission from everyone shown in this photo.</span></label></div>
      ${!settings.loaded?status('Checking whether photo publishing is available…'):!available()?status('Photo publishing is not available yet. You can still take or choose a photo and see a private preview.','warning'):''}
      ${status(selfie.message,selfie.tone)}
      <div class="gallery-actions"><button class="button button-primary gallery-publish" type="submit" data-gallery-action="publish" ${disabled?'disabled':''}>${selfie.uploading?'Publishing…':'Publish to the shared gallery'}</button><button class="gallery-small-button" type="button" data-gallery-action="skip" ${busy?'disabled':''}>Skip this step</button></div>
      <p class="gallery-privacy">The photo leaves your device only when you press Publish with the consent box checked. A private removal code lets you delete it later.</p>
    </form>`;
}

export function renderSelfieStep(){
  return `<section class="selfie-step" data-selfie-step aria-label="Optional Armenian Night selfie">${selfieMarkup()}</section>`;
}

function drawSelfie(){
  const host=document.querySelector('[data-selfie-step]');
  if(host)host.innerHTML=selfieMarkup();
}

function validParticipant(item){
  if(!item||typeof item.id!=='string'||!participantIdPattern.test(item.id)||typeof item.photoUrl!=='string')return null;
  try{
    const url=new URL(item.photoUrl);
    if(url.protocol!=='https:'||url.username||url.password||url.origin!==settings.apiBase||url.pathname!=='/api/participants/'+item.id+'/photo'||url.search||url.hash)return null;
    return {id:item.id,displayName:typeof item.displayName==='string'?item.displayName.slice(0,40):'',createdAt:typeof item.createdAt==='string'?item.createdAt:'',photoUrl:url.href};
  }catch{return null;}
}

function galleryMarkup(){
  let body='';
  if(!settings.loaded)body='<div class="gallery-empty"><h2>Opening the gallery…</h2><p>Checking the shared photo service.</p></div>';
  else if(!available())body='<div class="gallery-empty"><span class="gallery-empty-mark" aria-hidden="true">✦</span><h2>Photo publishing is not available yet.</h2><p>Once the shared photo service is connected, everyone’s published photos will appear here.</p></div>';
  else if(gallery.loading&&gallery.participants===null)body='<div class="gallery-empty"><h2>Gathering tonight’s memories…</h2><p>Loading photos from the shared gallery.</p></div>';
  else if(gallery.participants===null)body='<div class="gallery-empty"><h2>The gallery could not load.</h2><p>Check your connection, then use Refresh photos to try again.</p></div>';
  else if(!gallery.participants.length)body='<div class="gallery-empty"><span class="gallery-empty-mark" aria-hidden="true">✦</span><h2>Be the first memory.</h2><p>No photos have been published yet. Finish the quiz, then choose an optional selfie to join the gallery.</p></div>';
  else body=`<div class="participant-grid">${gallery.participants.map(item=>{
    const own=ownTokens.has(item.id),deleting=gallery.deleting.has(item.id);
    const date=new Date(item.createdAt);
    const time=Number.isNaN(date.getTime())?'':date.toLocaleDateString('en',{month:'short',day:'numeric'});
    return `<article class="participant-card"><div class="participant-photo"><img src="${escapeHTML(item.photoUrl)}" alt="Armenian Cultural Night photo${item.displayName?' shared by '+escapeHTML(item.displayName):''}" loading="lazy" decoding="async" referrerpolicy="no-referrer"><p class="participant-photo-error" hidden>This photo could not load. Refresh photos to try again.</p></div><div class="participant-caption"><h2>${escapeHTML(item.displayName||'A friend of Armenian Night')}</h2>${time?`<time datetime="${escapeHTML(item.createdAt)}">${escapeHTML(time)}</time>`:''}${own?`<button class="gallery-small-button" type="button" data-gallery-action="remove" data-gallery-id="${escapeHTML(item.id)}" ${deleting?'disabled':''}>${deleting?'Removing…':'Remove my photo'}</button>`:''}</div></article>`;
  }).join('')}</div>`;
  const count=gallery.participants?.length;
  return `<div class="gallery-toolbar"><p>${typeof count==='number'?`${count} ${count===1?'shared memory':'shared memories'}`:'A shared gallery for tonight’s participants'}</p><button class="button button-light" type="button" data-gallery-action="refresh" ${gallery.loading||!available()?'disabled':''}>${gallery.loading?'Refreshing…':'Refresh photos'}</button></div>${status(gallery.message,gallery.tone)}${body}<div class="gallery-bottom"><a class="button button-primary" href="${escapeHTML(sitePath('/quiz'))}">Take the challenge & add a selfie →</a><p>Only photos published to the shared service appear here. Refresh to see new arrivals.</p></div>
    <details class="gallery-removal-help"><summary>Remove my photo with a saved code</summary><p>Use the same browser where you published to see a Remove my photo button. If that code was not saved, or you are on another device, enter your private removal details below.</p><form data-gallery-form="remove" class="manual-removal"><label for="gallery-removal-id">Photo ID</label><input type="text" id="gallery-removal-id" name="photoId" autocomplete="off" maxlength="200" required><label for="gallery-removal-token">Private removal code</label><input type="password" id="gallery-removal-token" name="removalToken" autocomplete="off" minlength="43" maxlength="43" pattern="[A-Za-z0-9_-]{43}" required><button class="button button-light" type="submit" ${!available()||gallery.deleting.size?'disabled':''}>Remove this photo</button></form><p>Lost both your browser’s saved code and your private copy? Ask the event organiser to remove the photo.</p></details>`;
}

export function renderParticipantsPage(){
  return `<section class="page-heading wrap"><a class="back-link" href="${escapeHTML(sitePath('/'))}">← Back to discovery</a><span class="eyebrow">OUR CULTURAL NIGHT · TOGETHER</span><h1>Our Armenian<br><em>Night.</em></h1><p class="lead">The faces, smiles, and shared memories of tonight. Add a photo after the challenge, or just enjoy the gallery.</p></section><section class="wrap participants-page" data-participants-page aria-label="Shared Armenian Night photo gallery">${galleryMarkup()}</section>`;
}

function drawGallery(){
  const host=document.querySelector('[data-participants-page]');
  if(host)host.innerHTML=galleryMarkup();
}

async function refreshParticipants(){
  await loadConfig();
  if(!available()||gallery.loading)return;
  gallery.loading=true;
  gallery.message='';
  drawGallery();
  try{
    const result=await request(settings.apiBase+'/api/participants');
    if(!Array.isArray(result.participants))throw new Error('The photo service returned an unexpected gallery. Please try again.');
    const items=result.participants.map(validParticipant);
    if(items.some(item=>!item))throw new Error('The photo service returned an invalid photo entry. Please try again.');
    gallery.participants=items;
  }catch(error){gallery.message=error.message||'The shared gallery could not load. Please try again.';gallery.tone='warning';}
  finally{gallery.loading=false;drawGallery();}
}

async function decodeImage(file){
  if(typeof createImageBitmap==='function'){
    try{return await createImageBitmap(file,{imageOrientation:'from-image'});}catch{}
  }
  const url=URL.createObjectURL(file);
  try{
    return await new Promise((resolve,reject)=>{
      const image=new Image();
      image.onload=()=>resolve(image);
      image.onerror=()=>reject(new Error('This photo format could not be opened. Try a JPEG or PNG photo.'));
      image.src=url;
    });
  }finally{URL.revokeObjectURL(url);}
}

const jpegBlob=(canvas,quality)=>new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('This browser could not prepare the photo. Try another photo or browser.')),'image/jpeg',quality));

async function preparePhoto(file){
  if(!file)return;
  if(selfie.uploading||selfie.preparing)return;
  if(!file.type.startsWith('image/')){selfie.message='Choose an image file, such as a JPEG or PNG photo.';selfie.tone='warning';drawSelfie();return;}
  if(file.size>40*1024*1024){selfie.message='Choose a photo smaller than 40 MB.';selfie.tone='warning';drawSelfie();return;}
  clearPhoto();
  const sequence=photoSequence;
  selfie.preparing=true;selfie.message='';drawSelfie();
  let image;
  try{
    image=await decodeImage(file);
    const width=image.width||image.naturalWidth,height=image.height||image.naturalHeight;
    if(!width||!height)throw new Error('This photo has no readable image dimensions. Try another photo.');
    const scale=Math.min(1,640/Math.max(width,height));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
    const context=canvas.getContext('2d');
    if(!context)throw new Error('Photo preparation is unavailable in this browser. Try another browser.');
    context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
    let blob;
    for(const quality of [.86,.72,.58,.4]){blob=await jpegBlob(canvas,quality);if(blob.size<=350*1024)break;}
    if(!blob||blob.size>350*1024)throw new Error('This photo could not be reduced enough. Please choose a simpler or smaller photo.');
    if(sequence!==photoSequence)return;
    selfie.photo=blob;selfie.previewUrl=URL.createObjectURL(blob);
    selfie.message='Your photo is ready as a private preview. Check the public consent box only if you want to publish it.';selfie.tone='info';
  }catch(error){if(sequence===photoSequence){selfie.message=error.message||'The photo could not be prepared. Please choose another.';selfie.tone='warning';}}
  finally{image?.close?.();if(sequence===photoSequence){selfie.preparing=false;drawSelfie();}}
}

function saveToken(id,token){
  ownTokens.set(id,token);
  try{localStorage.setItem(tokenKey,JSON.stringify(Object.fromEntries(ownTokens)));return true;}
  catch{storageAvailable=false;return false;}
}

function forgetToken(id){
  ownTokens.delete(id);
  try{localStorage.setItem(tokenKey,JSON.stringify(Object.fromEntries(ownTokens)));}
  catch{storageAvailable=false;}
}

async function publishSelfie(){
  if(selfie.uploading||selfie.preparing)return;
  await loadConfig();
  if(selfie.uploading||selfie.preparing)return;
  if(!available()){selfie.message='Photo publishing is not available yet. Your preview has stayed on this device.';selfie.tone='warning';drawSelfie();return;}
  if(!selfie.photo||!selfie.consent){selfie.message='Choose a photo and check the public consent box before publishing.';selfie.tone='warning';drawSelfie();return;}
  selfie.uploading=true;selfie.message='';drawSelfie();
  const form=new FormData();form.append('photo',selfie.photo,'armenian-night.jpg');form.append('displayName',selfie.displayName.trim().slice(0,40));form.append('consent','true');
  try{
    const result=await request(settings.apiBase+'/api/participants',{method:'POST',body:form});
    const participant=validParticipant(result.participant);
    if(!participant||!/^[A-Za-z0-9_-]{43}$/.test(result.removalToken||''))throw new Error('The service did not return complete publishing details. Refresh the gallery before trying again, or ask the organiser for help.');
    saveToken(participant.id,result.removalToken);
    clearPhoto();
    selfie.published=participant;selfie.removalToken=result.removalToken;selfie.displayName='';selfie.message='';
    gallery.participants=null;
  }catch(error){selfie.message=error.httpStatus?error.message:'We could not confirm the publishing result. Your photo may have reached the shared gallery. Refresh Our Armenian Night before trying again; if your photo appears without a removal code, ask the event organiser for help.';selfie.tone='warning';}
  finally{selfie.uploading=false;drawSelfie();}
}

async function removePhoto(id,token){
  await loadConfig();
  if(!available()||gallery.deleting.has(id))return;
  if(!participantIdPattern.test(id||'')||!/^[A-Za-z0-9_-]{43}$/.test(token||'')){gallery.message='Enter the complete photo ID and 43-character private removal code.';gallery.tone='warning';drawGallery();return;}
  gallery.deleting.add(id);gallery.message='';drawGallery();
  try{
    await request(settings.apiBase+'/api/participants/'+encodeURIComponent(id),{method:'DELETE',headers:{'X-Removal-Token':token}});
    forgetToken(id);
    if(gallery.participants)gallery.participants=gallery.participants.filter(item=>item.id!==id);
    gallery.message='Your photo has been removed from the shared gallery.';gallery.tone='success';
    if(selfie.published?.id===id){selfie.published=null;selfie.removalToken=null;selfie.skipped=true;drawSelfie();}
  }catch(error){gallery.message=error.message||'The photo could not be removed. Check your code and try again.';gallery.tone='warning';}
  finally{gallery.deleting.delete(id);drawGallery();}
}

function selectFile(){document.querySelector('[data-gallery-photo]')?.click();}

async function copyRemoval(){
  const details=`Photo ID: ${selfie.published?.id||''}\nRemoval code: ${selfie.removalToken||''}`;
  try{await navigator.clipboard.writeText(details);selfie.message='Removal details copied. Keep them somewhere private.';selfie.tone='success';}
  catch{selfie.message='Copy is unavailable here. Select and save the photo ID and removal code shown above.';selfie.tone='warning';}
  drawSelfie();
}

function mountEvents(){
  if(eventsMounted)return;
  eventsMounted=true;
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-gallery-action]');
    if(!button||button.disabled)return;
    event.preventDefault();
    switch(button.dataset.galleryAction){
      case 'choose-photo':selectFile();break;
      case 'retake':if(!selfie.uploading){clearPhoto();selfie.message='';drawSelfie();selectFile();}break;
      case 'cancel':if(!selfie.uploading){clearPhoto();selfie.displayName='';selfie.message='';drawSelfie();}break;
      case 'skip':if(!selfie.uploading){clearPhoto();selfie.displayName='';selfie.skipped=true;selfie.message='';drawSelfie();}break;
      case 'start':resetSelfieStep();drawSelfie();break;
      case 'publish':void publishSelfie();break;
      case 'refresh':void refreshParticipants();break;
      case 'remove':void removePhoto(button.dataset.galleryId,ownTokens.get(button.dataset.galleryId));break;
      case 'copy-removal':void copyRemoval();break;
    }
  });
  document.addEventListener('input',event=>{
    if(event.target.matches('[data-gallery-name]'))selfie.displayName=event.target.value.slice(0,40);
  });
  document.addEventListener('change',event=>{
    if(event.target.matches('[data-gallery-photo]')){const file=event.target.files?.[0];event.target.value='';void preparePhoto(file);}
    if(event.target.matches('[data-gallery-consent]')){
      selfie.consent=event.target.checked;
      const button=document.querySelector('.gallery-publish');
      if(button)button.disabled=!selfie.photo||!selfie.consent||!available()||selfie.uploading||selfie.preparing;
    }
  });
  document.addEventListener('submit',event=>{
    const form=event.target.closest('[data-gallery-form]');
    if(!form)return;
    event.preventDefault();
    if(form.dataset.galleryForm==='selfie')void publishSelfie();
    if(form.dataset.galleryForm==='remove')void removePhoto(form.elements.namedItem('photoId').value.trim(),form.elements.namedItem('removalToken').value.trim());
  });
  document.addEventListener('error',event=>{
    if(event.target.matches?.('.participant-photo img')){
      event.target.hidden=true;
      const message=event.target.parentElement.querySelector('.participant-photo-error');
      if(message)message.hidden=false;
    }
  },true);
}

export function mountParticipantGallery(){
  mountEvents();
  drawSelfie();drawGallery();
  void loadConfig().then(()=>{
    if(document.querySelector('[data-participants-page]'))void refreshParticipants();
  });
}
