import {PHOTO_FRAMES,centeredCrop,moveCrop,cropZoom,photoCrop} from './photo-crop.mjs';
import {loadPhoto,drawCrop} from './photo-render.mjs';

export function mountPhotoEditor({onSave,onDirty}){
  const dialog=document.createElement('dialog');dialog.id='photo-editor';dialog.setAttribute('aria-labelledby','crop-heading');
  dialog.innerHTML=`<header class="crop-heading"><div><span class="eyebrow">ПОРТРЕТ БЕЗ ПОТЕРИ ОРИГИНАЛА</span><h2 id="crop-heading">Кадрирование фотографии</h2></div><button id="crop-close" type="button" aria-label="Закрыть редактор фото">×</button></header>
    <p class="muted">Перетаскивайте рамку на фотографии. Масштаб — ползунком или колёсиком. Рамки для разных видов настраиваются отдельно; справа показан точный результат.</p>
    <div class="crop-grid"><section><div class="crop-modes" role="group" aria-label="Редактируемая рамка">${Object.entries(PHOTO_FRAMES).map(([key,f])=>`<button type="button" data-crop-mode="${key}">${f.label}</button>`).join('')}</div>
    <canvas id="crop-source" width="960" height="560" tabindex="0" aria-label="Фотография с рамками кадрирования. Стрелки перемещают рамку; плюс и минус меняют масштаб."></canvas>
    <label class="crop-zoom-label" for="crop-zoom">Приближение <output id="crop-zoom-value"></output></label><input id="crop-zoom" type="range" min="1" max="12" step="0.01" value="1">
    <div class="crop-tools"><button id="crop-reset" type="button">Сбросить рамку</button><button id="crop-align" type="button">Общий центр для всех рамок</button><label><input id="crop-overlays" type="checkbox" checked> Все рамки поверх фото</label></div></section>
    <aside class="crop-previews"><h3>Как будет отображаться</h3>${Object.entries(PHOTO_FRAMES).map(([key,f])=>`<figure><canvas data-crop-preview="${key}" width="${f.width*2}" height="${f.height*2}" aria-label="Предпросмотр: ${f.label}"></canvas><figcaption>${f.label}</figcaption></figure>`).join('')}</aside></div>
    <label class="checkbox-label"><input id="crop-primary" type="checkbox" checked> Сделать основным портретом в древе и на плакате</label>
    <p class="muted">Сохраняются только настройки рамок. Оригинал фото не обрезается и не заменяется. Эти настройки входят в SQLite и JSON; GEDCOM их не переносит.</p>
    <p id="crop-error" class="form-error" role="alert"></p><footer class="crop-actions"><button id="crop-save" type="button" class="primary">Сохранить кадрирование</button><button id="crop-cancel" type="button">Отмена</button></footer>`;
  document.body.append(dialog);const $=s=>dialog.querySelector(s),canvas=$('#crop-source'),ctx=canvas.getContext('2d');
  let image,personId,reference,crops,mode='tree',dirty=false,saving=false,token=0,drag=null,view;
  const mark=()=>{dirty=true;onDirty(true);};
  const busy=value=>{saving=value;for(const e of dialog.querySelectorAll('button,input'))e.disabled=value;canvas.setAttribute('aria-disabled',String(value));};
  function draw(){
    if(!image)return;
    const scale=Math.min((canvas.width-40)/image.naturalWidth,(canvas.height-40)/image.naturalHeight);view={w:image.naturalWidth*scale,h:image.naturalHeight*scale};view.x=(canvas.width-view.w)/2;view.y=(canvas.height-view.h)/2;
    ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#152b31';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,view.x,view.y,view.w,view.h);
    const active=crops[mode],box=c=>({x:view.x+c.x*view.w,y:view.y+c.y*view.h,w:c.width*view.w,h:c.height*view.h});
    const a=box(active);ctx.fillStyle='#071819aa';ctx.beginPath();ctx.rect(view.x,view.y,view.w,view.h);ctx.rect(a.x,a.y,a.w,a.h);ctx.fill('evenodd');
    for(const [key,f] of Object.entries(PHOTO_FRAMES)){
      const preview=$(`[data-crop-preview="${key}"]`);drawCrop(preview.getContext('2d'),image,crops[key],preview.width,preview.height);
      if(key!==mode&&!$('#crop-overlays').checked)continue;
      const r=box(crops[key]);ctx.save();ctx.strokeStyle=f.color;ctx.lineWidth=key===mode?3:2;ctx.setLineDash(key===mode?[]:[9,5]);ctx.beginPath();if(f.shape==='ellipse')ctx.ellipse(r.x+r.w/2,r.y+r.h/2,r.w/2,r.h/2,0,0,Math.PI*2);else ctx.rect(r.x,r.y,r.w,r.h);ctx.stroke();
      if(key===mode){ctx.setLineDash([4,6]);ctx.lineWidth=1;ctx.strokeStyle='#ffffff88';for(const t of [1/3,2/3]){ctx.beginPath();ctx.moveTo(r.x+r.w*t,r.y);ctx.lineTo(r.x+r.w*t,r.y+r.h);ctx.moveTo(r.x,r.y+r.h*t);ctx.lineTo(r.x+r.w,r.y+r.h*t);ctx.stroke();}}
      ctx.restore();
    }
    const zoom=cropZoom(active,image.naturalWidth,image.naturalHeight,mode);$('#crop-zoom').value=zoom;$('#crop-zoom-value').textContent=zoom.toFixed(2)+'×';
    for(const b of dialog.querySelectorAll('[data-crop-mode]'))b.setAttribute('aria-pressed',String(b.dataset.cropMode===mode));
  }
  const zoomTo=z=>{const c=crops[mode];crops[mode]=centeredCrop(image.naturalWidth,image.naturalHeight,mode,z,c.x+c.width/2,c.y+c.height/2);mark();draw();};
  for(const button of dialog.querySelectorAll('[data-crop-mode]'))button.addEventListener('click',()=>{mode=button.dataset.cropMode;draw();});
  $('#crop-zoom').addEventListener('input',()=>zoomTo(Number($('#crop-zoom').value)));
  $('#crop-primary').addEventListener('change',mark);$('#crop-overlays').addEventListener('change',draw);
  $('#crop-reset').addEventListener('click',()=>{crops[mode]=centeredCrop(image.naturalWidth,image.naturalHeight,mode);mark();draw();});
  $('#crop-align').addEventListener('click',()=>{const c=crops[mode],z=cropZoom(c,image.naturalWidth,image.naturalHeight,mode);for(const key of Object.keys(PHOTO_FRAMES))crops[key]=centeredCrop(image.naturalWidth,image.naturalHeight,key,z,c.x+c.width/2,c.y+c.height/2);mark();draw();});
  function point(event){const rect=canvas.getBoundingClientRect();return {x:((event.clientX-rect.left)*canvas.width/rect.width-view.x)/view.w,y:((event.clientY-rect.top)*canvas.height/rect.height-view.y)/view.h};}
  canvas.addEventListener('pointerdown',event=>{if(!image||saving||event.button!==0)return;const p=point(event);if(p.x<0||p.x>1||p.y<0||p.y>1)return;const c=crops[mode];if(p.x<c.x||p.x>c.x+c.width||p.y<c.y||p.y>c.y+c.height){crops[mode]=moveCrop(c,p.x-c.x-c.width/2,p.y-c.y-c.height/2);mark();draw();}drag={point:p,crop:{...crops[mode]}};canvas.setPointerCapture(event.pointerId);canvas.focus();});
  canvas.addEventListener('pointermove',event=>{if(!drag||saving)return;const p=point(event);crops[mode]=moveCrop(drag.crop,p.x-drag.point.x,p.y-drag.point.y);mark();draw();});
  const end=()=>{drag=null;};canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);
  canvas.addEventListener('wheel',event=>{event.preventDefault();if(image&&!saving)zoomTo(cropZoom(crops[mode],image.naturalWidth,image.naturalHeight,mode)*Math.exp(-event.deltaY*.0015));},{passive:false});
  canvas.addEventListener('keydown',event=>{if(!image||saving)return;const step=event.shiftKey?.03:.005,delta={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]}[event.key];if(delta){event.preventDefault();crops[mode]=moveCrop(crops[mode],...delta);mark();draw();}else if(['+','=','-'].includes(event.key)){event.preventDefault();zoomTo(cropZoom(crops[mode],image.naturalWidth,image.naturalHeight,mode)*(event.key==='-'?.9:1.1));}});
  const close=()=>{if(!saving)dialog.close();};$('#crop-close').addEventListener('click',close);$('#crop-cancel').addEventListener('click',close);
  dialog.addEventListener('cancel',event=>{if(saving)event.preventDefault();});
  dialog.addEventListener('close',()=>{if(dialog.open)return;token++;image=null;drag=null;dirty=false;onDirty(false);});
  $('#crop-save').addEventListener('click',async()=>{
    if(!image||saving)return;busy(true);$('#crop-error').textContent='';
    try{const ok=await onSave(personId,{photo:reference,crops:structuredClone(crops),primary:$('#crop-primary').checked});if(ok){dirty=false;busy(false);dialog.close();}else{$('#crop-error').textContent='Кадрирование не сохранено. Проверьте сообщение об ошибке; настройки пока остаются в редакторе.';onDirty(dirty);}}
    catch(error){$('#crop-error').textContent=error.message;onDirty(dirty);}finally{busy(false);}
  });
  return {async open(person,photo,path){
    if(dialog.open)return;const generation=++token;const loaded=await loadPhoto(path);if(generation!==token)return;
    image=loaded;personId=person.id;reference=photo;mode='tree';dirty=false;saving=false;crops={};for(const key of Object.keys(PHOTO_FRAMES))crops[key]=photoCrop(person,photo,key)||centeredCrop(image.naturalWidth,image.naturalHeight,key);
    $('#crop-error').textContent='';$('#crop-primary').checked=true;$('#crop-overlays').checked=true;busy(false);dialog.showModal();draw();canvas.focus();
  }};
}
