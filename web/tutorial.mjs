import {TUTORIAL_STEPS} from './tutorial-steps.mjs';

export function mountTutorial({button,getStatus,complete,notify=()=>{}}){
  const dialog=document.createElement('dialog');dialog.id='tutorial-dialog';dialog.setAttribute('aria-labelledby','tutorial-title');dialog.setAttribute('aria-describedby','tutorial-description');
  dialog.innerHTML=`<div class="tutorial-header"><span class="eyebrow">ЗНАКОМСТВО С СЕМЕЙНЫМ АТЛАСОМ</span><button id="tutorial-close" type="button" aria-label="Закрыть обучение">×</button></div>
    <div class="tutorial-layout"><nav class="tutorial-nav" aria-label="Шаги обучения"></nav><section class="tutorial-content"><div id="tutorial-icon" aria-hidden="true"></div><p id="tutorial-progress" role="status"></p><h2 id="tutorial-title"></h2><p id="tutorial-description"></p><ul id="tutorial-tips"></ul><p id="tutorial-location"></p></section></div>
    <footer class="tutorial-footer"><button id="tutorial-skip" type="button" class="quiet">Пропустить</button><div><button id="tutorial-back" type="button">Назад</button><button id="tutorial-next" type="button" class="primary">Далее</button></div></footer>`;
  document.body.append(dialog);const $=selector=>dialog.querySelector(selector);
  let index=0,touched=false,attempted=false,busy=false,highlight=null,previousFocus=null;
  const clearHighlight=()=>{highlight?.classList.remove('tutorial-target');highlight=null;};
  function render(){
    const step=TUTORIAL_STEPS[index];clearHighlight();highlight=document.querySelector(step.target);highlight?.classList.add('tutorial-target');
    dialog.dataset.step=step.id;$('#tutorial-icon').textContent=step.icon;$('#tutorial-title').textContent=step.title;$('#tutorial-description').textContent=step.text;$('#tutorial-location').textContent=step.location;
    $('#tutorial-progress').textContent=`Шаг ${index+1} из ${TUTORIAL_STEPS.length}`;$('#tutorial-tips').replaceChildren(...step.tips.map(text=>{const item=document.createElement('li');item.textContent=text;return item;}));
    $('#tutorial-back').disabled=index===0;$('#tutorial-next').textContent=index===TUTORIAL_STEPS.length-1?'Начать работу':'Далее';
    for(const item of dialog.querySelectorAll('[data-tutorial-step]'))item.setAttribute('aria-current',Number(item.dataset.tutorialStep)===index?'step':'false');
  }
  for(const [i,step] of TUTORIAL_STEPS.entries()){const item=document.createElement('button');item.type='button';item.dataset.tutorialStep=i;item.textContent=`${i+1}. ${step.label}`;item.addEventListener('click',()=>{if(!busy){index=i;render();}});$('.tutorial-nav').append(item);}
  function open(){if(dialog.open||busy)return;touched=true;previousFocus=document.activeElement;index=0;render();dialog.showModal();$('#tutorial-next').focus();}
  async function finish(){
    if(busy||!dialog.open)return;busy=true;for(const control of dialog.querySelectorAll('button'))control.disabled=true;
    try{await complete();}catch(error){notify('Не удалось запомнить просмотр обучения: '+error.message+'. Его всегда можно открыть кнопкой «?».');}
    finally{busy=false;for(const control of dialog.querySelectorAll('button'))control.disabled=false;dialog.close();}
  }
  $('#tutorial-next').addEventListener('click',()=>{if(busy)return;if(index===TUTORIAL_STEPS.length-1){finish();}else{index++;render();}});
  $('#tutorial-back').addEventListener('click',()=>{if(!busy&&index>0){index--;render();}});
  for(const selector of ['#tutorial-close','#tutorial-skip'])$(selector).addEventListener('click',finish);
  dialog.addEventListener('cancel',event=>{event.preventDefault();finish();});
  dialog.addEventListener('close',()=>{if(dialog.open)return;clearHighlight();if(previousFocus?.isConnected)previousFocus.focus();else button.focus();});
  dialog.addEventListener('keydown',event=>{if(busy)return;if(event.key==='ArrowRight'&&index<TUTORIAL_STEPS.length-1){event.preventDefault();index++;render();}else if(event.key==='ArrowLeft'&&index>0){event.preventDefault();index--;render();}});
  button.addEventListener('click',open);
  return {open,async startIfNeeded(){if(attempted||touched)return;attempted=true;try{const status=await getStatus();if(!status.completed&&!touched)open();}catch(error){notify('Обучение доступно по кнопке «?». Не удалось прочитать настройки: '+error.message);}}};
}
