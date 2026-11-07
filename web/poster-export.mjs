import {createPosterScene, renderPosterSvg, pngSize} from './poster.mjs';
import {readPhoto,saveBlob,getPosterBackground} from './native.mjs';
import {portraitKey} from './photo-crop.mjs';
import {croppedPhoto} from './photo-render.mjs';

function imageLoad(src) {
  return new Promise((resolve,reject) => {const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('Не удалось открыть изображение плаката'));image.src=src;});
}

export async function svgToPng(svg, width, height, maxEdge = 4096) {
  const size=pngSize(width,height,maxEdge);
  const document=new DOMParser().parseFromString(svg,'image/svg+xml');
  document.documentElement.setAttribute('width',size.width);
  document.documentElement.setAttribute('height',size.height);
  const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(document)],{type:'image/svg+xml'}));
  try {
    const image=await imageLoad(url),canvas=window.document.createElement('canvas');
    canvas.width=size.width;canvas.height=size.height;
    const context=canvas.getContext('2d');
    if(!context)throw new Error('Браузер не поддерживает сохранение PNG');
    context.drawImage(image,0,0,size.width,size.height);
    return await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Не удалось сохранить PNG')),'image/png'));
  } finally {URL.revokeObjectURL(url);}
}

async function photoData(path, signal) {
  return readPhoto(path,signal);
}

async function download(blob, name) {return saveBlob(blob,name);}

export function mountPosterExport({button,dialog,getSnapshot,resolvePhoto,notify}) {
  const $=s=>dialog.querySelector(s);
  let scene,images,background='',svg='',previewUrl=null,generation=0,controller,subtitle='';
  const busy=value=>{for(const b of dialog.querySelectorAll('[data-poster-download]'))b.disabled=value;};
  const redraw=()=>{
    if(!scene||!background)return;
    svg=renderPosterSvg(scene,{title:$('#poster-title').value,subtitle,images,background});
    if(previewUrl)URL.revokeObjectURL(previewUrl);
    previewUrl=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));
    $('#poster-preview').src=previewUrl;
  };
  const close=()=>dialog.close();
  $('#poster-close').addEventListener('click',close);
  $('#poster-title').addEventListener('input',redraw);
  dialog.addEventListener('close',()=>{
    // Native close events are queued. A fast close/reopen must not clear the
    // new preview, revoke its URL or cancel its pending photo requests.
    if(dialog.open)return;
    generation++;controller?.abort();if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=null;$('#poster-preview').removeAttribute('src');scene=null;images=null;background='';svg='';button.focus();
  });
  $('#poster-preview').addEventListener('error',()=>{if(dialog.open&&previewUrl)$('#poster-status').textContent='Предпросмотр не загрузился. Закройте и откройте плакат снова.';});
  $('#poster-svg').addEventListener('click',async()=>{try{if(svg)await download(new Blob([svg],{type:'image/svg+xml;charset=utf-8'}),'family-poster.svg');}catch(error){notify(error.message);}});
  $('#poster-png').addEventListener('click',async()=>{
    if(!svg)return;
    const token=generation,text=svg,{width,height}=scene;
    busy(true);$('#poster-status').textContent='Готовим PNG…';
    try {const blob=await svgToPng(text,width,height);if(token===generation){const saved=await download(blob,'family-poster.png');$('#poster-status').textContent=saved?'PNG сохранён. Для печати большого дерева используйте SVG.':'Сохранение отменено.';}}
    catch(error){if(token===generation){$('#poster-status').textContent=error.message;notify(error.message);}}
    finally {if(token===generation)busy(false);}
  });
  button.addEventListener('click',async()=>{
    if(dialog.open)return;
    const snapshot=getSnapshot();
    if(!snapshot?.layout?.nodes.length){notify('Сначала откройте ветвь дерева');return;}
    const token=++generation;
    controller?.abort();controller=new AbortController();const signal=controller.signal;
    scene=createPosterScene(snapshot.data,snapshot.layout,resolvePhoto);images=new Map();background='';svg='';
    if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=null;$('#poster-preview').removeAttribute('src');
    subtitle=snapshot.all?'Семейные линии':snapshot.rootName;
    $('#poster-title').value='История нашей семьи';
    $('#poster-status').textContent='Загружаем ваш фон и локальные фотографии…';busy(true);
    dialog.showModal();
    const portraits=[...new Map(scene.nodes.flatMap(n=>n.portraits).filter(p=>p.photo).map(p=>[portraitKey(p),p])).values()];
    const loaded=new Map();let cursor=0,missing=0;
    try {
    const [,artwork]=await Promise.all([Promise.all(Array.from({length:Math.min(4,portraits.length)},async()=>{
      while(cursor<portraits.length && !signal.aborted){const p=portraits[cursor++];try{loaded.set(portraitKey(p),p.crop?await croppedPhoto(p.photo,p.crop):await photoData(p.photo,signal));}catch{missing++;}}
    })),getPosterBackground()]);
    if(token!==generation)return;
    images=loaded;background=artwork;redraw();busy(false);
    $('#poster-status').textContent=`${scene.peopleCount} человек · ${scene.nodes.length} карточек · ${loaded.size} фото${missing?` · недоступных фото: ${missing}, показаны силуэты`:''}`;
    } catch(error){if(token===generation){svg='';$('#poster-status').textContent='Не удалось загрузить фон плаката: '+error.message;notify(error.message);}}
  });
}
