// The only application transport: Tauri IPC. No HTTP fallback or local server.
let media={files:{},local:[],embedded:{}};
export async function invoke(command,args={}) {
  if(!globalThis.__TAURI__?.core?.invoke)throw new Error('Откройте установленное приложение «Семейный атлас», а не HTML в браузере.');
  try{return await globalThis.__TAURI__.core.invoke(command,args);}catch(error){throw new Error(typeof error==='string'?error:error.message||String(error));}
}
export const getTree=()=>invoke('get_tree');
export const getOnboardingStatus=()=>invoke('onboarding_status');
export const completeOnboarding=()=>invoke('onboarding_complete');
export async function getMedia(){media=await invoke('get_media');return media;}
export const applyAction=action=>invoke('apply_action',{action});
export const confirmAction=message=>invoke('confirm_action',{message});
export const importTree=revision=>invoke('import_tree',{revision});
export const importProject=revision=>invoke('import_project',{revision});
export const exportProject=()=>invoke('export_project');
export const exportData=(kind,data=null)=>invoke('export_data',{kind,data});
let posterBackground;
export function getPosterBackground(){
  // Cache the original packaged PNG, not a resampled canvas image or URL.
  if(!posterBackground)posterBackground=invoke('get_poster_background').catch(error=>{posterBackground=null;throw error;});
  return posterBackground;
}
export const setDirty=dirty=>invoke('set_dirty',{dirty}).catch(()=>{});
export const localPhotoName=name=>/^[a-f0-9]{20,64}\.(jpg|png|gif|webp)$/.test(name||'');
export function photoUrl(path){return media.embedded[path]||'';}
export async function readPhoto(path,signal){
  if(signal?.aborted)throw new Error('Отменено');
  if(!/^\/photos\/[a-f0-9]{20,64}\.(jpg|png|gif|webp)$/.test(path))throw new Error('Недопустимый путь фотографии');
  const data=photoUrl(path);if(!data||data.length>6_700_000)throw new Error('Фото недоступно или слишком велико');return data;
}
export async function saveBlob(blob,name){
  const kind=name.split('.').at(-1);
  const data=kind==='svg'?await blob.text():await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.onerror=()=>reject(new Error('Не удалось прочитать PNG'));r.readAsDataURL(blob);});
  return exportData(kind,data);
}
