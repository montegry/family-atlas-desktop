// Pure geometry shared by the editor, normal tree and date-free artwork.
export const PHOTO_FRAMES={tree:{label:'Древо',width:48,height:61,shape:'rect',color:'#a4d7b9'},poster:{label:'Плакат',width:210,height:204,shape:'ellipse',color:'#e5c478'},posterPair:{label:'Плакат: супруги',width:114,height:204,shape:'ellipse',color:'#a9c9f4'}};
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const round=n=>Math.round(n*1e8)/1e8;
export function validCrop(c){return !!c&&['x','y','width','height'].every(k=>typeof c[k]==='number'&&Number.isFinite(c[k]))&&c.x>=0&&c.y>=0&&c.width>0&&c.height>0&&c.width<=1&&c.height<=1&&c.x+c.width<=1+1e-9&&c.y+c.height<=1+1e-9;}
export function centeredCrop(iw,ih,mode='tree',zoom=1,cx=.5,cy=.5){
  const frame=PHOTO_FRAMES[mode];if(!frame||![iw,ih,zoom,cx,cy].every(Number.isFinite)||iw<=0||ih<=0)throw new Error('Некорректные размеры фотографии');
  const ratio=frame.width/frame.height,scale=clamp(zoom,1,12);
  let width=1,height=iw/(ih*ratio);if(height>1){height=1;width=ih*ratio/iw;}
  width=round(width/scale);height=round(height/scale);
  return {x:round(clamp(cx-width/2,0,1-width)),y:round(clamp(cy-height/2,0,1-height)),width,height};
}
export function moveCrop(c,dx,dy){if(!validCrop(c)||![dx,dy].every(Number.isFinite))throw new Error('Некорректная область кадрирования');return {...c,x:round(clamp(c.x+dx,0,1-c.width)),y:round(clamp(c.y+dy,0,1-c.height))};}
export function cropZoom(c,iw,ih,mode){const base=centeredCrop(iw,ih,mode);return clamp(base.width/c.width,1,12);}
export function portraitReference(p,resolvePhoto){return [p.portraitPhoto,...(p.photos||[])].find(ref=>ref&&(p.photos||[]).includes(ref)&&resolvePhoto(ref))||null;}
export function photoCrop(p,reference,mode){const crop=p.photoCrops?.[reference]?.[mode];return validCrop(crop)?{x:crop.x,y:crop.y,width:crop.width,height:crop.height}:null;}
export function portraitKey(p){return p.crop?`${p.photo}|${['x','y','width','height'].map(k=>p.crop[k]).join(',')}`:p.photo;}
