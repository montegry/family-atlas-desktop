import {validCrop,portraitKey,portraitReference,photoCrop} from './photo-crop.mjs';
import {photoUrl} from './native.mjs';

const images=new Map(),rendered=new Map();
export function loadPhoto(path){
  if(!images.has(path))images.set(path,new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>{images.delete(path);reject(new Error('Не удалось открыть фотографию'));};const source=photoUrl(path);if(!source){images.delete(path);reject(new Error('Фотография недоступна локально'));return;}image.src=source;}));
  return images.get(path);
}
export function drawCrop(context,image,crop,width,height){
  if(!validCrop(crop))throw new Error('Некорректная область кадрирования');
  context.clearRect(0,0,width,height);context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';
  context.drawImage(image,crop.x*image.naturalWidth,crop.y*image.naturalHeight,crop.width*image.naturalWidth,crop.height*image.naturalHeight,0,0,width,height);
}
export async function croppedPhoto(path,crop,maxEdge=1024){
  if(!crop)return photoUrl(path);
  if(!validCrop(crop))throw new Error('Некорректная область кадрирования');
  const key=portraitKey({photo:path,crop})+'|'+maxEdge;
  if(!rendered.has(key))rendered.set(key,(async()=>{const image=await loadPhoto(path),canvas=document.createElement('canvas');const w=crop.width*image.naturalWidth,h=crop.height*image.naturalHeight,scale=Math.min(1,maxEdge/Math.max(w,h));canvas.width=Math.max(1,Math.round(w*scale));canvas.height=Math.max(1,Math.round(h*scale));const context=canvas.getContext('2d');if(!context)throw new Error('Недоступна обработка фото');drawCrop(context,image,crop,canvas.width,canvas.height);return canvas.toDataURL('image/png');})().catch(error=>{rendered.delete(key);throw error;}));
  return rendered.get(key);
}
const portraits=new Map();
export async function preparePortraits(data,resolvePhoto){
  await Promise.all(Object.values(data.people).map(async p=>{const ref=portraitReference(p,resolvePhoto),path=ref&&resolvePhoto(ref),crop=photoCrop(p,ref,'tree');if(path&&crop){const key=portraitKey({photo:path,crop});try{portraits.set(key,await croppedPhoto(path,crop,512));}catch{portraits.delete(key);}}}));
}
export function treePortraitUrl(p,resolvePhoto){const ref=portraitReference(p,resolvePhoto);if(!ref)return '';const path=resolvePhoto(ref),crop=photoCrop(p,ref,'tree');return crop?portraits.get(portraitKey({photo:path,crop}))||'':photoUrl(path);}
