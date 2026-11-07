import {MONTHS, GED_MONTHS, formatDate, toGedcom, calendarDate, calendarCells, dayToGedcom} from './dates.mjs';

export function dateValue(input) {
  // Never normalize untouched imported values, especially incomplete years.
  if (input.value.trim() === input.dataset.dateDisplay.trim()) return input.dataset.dateOriginal;
  return toGedcom(input.value);
}
export function safeDateValue(input) {
  try {return dateValue(input);} catch {return '';}
}
export function dateFormValues(form) {
  const values = Object.fromEntries(new FormData(form));
  for (const input of form.querySelectorAll('.date-input')) values[input.name] = dateValue(input);
  return values;
}

let dialog, target, view, selected;
function ensureDialog() {
  if (dialog) return;
  dialog = document.createElement('dialog'); dialog.id = 'calendar-dialog'; dialog.className = 'calendar-dialog';
  dialog.setAttribute('aria-labelledby','calendar-title');
  dialog.innerHTML = '<div class="calendar-heading"><h2 id="calendar-title">Выберите дату</h2><button type="button" data-close aria-label="Закрыть календарь">×</button></div><div class="calendar-nav"><button type="button" data-prev aria-label="Предыдущий месяц">‹</button><label><span class="sr-only">Месяц</span><select id="calendar-month" aria-label="Месяц"></select></label><label><span class="sr-only">Год</span><input id="calendar-year" type="number" min="1" max="9999" step="1" aria-label="Год"></label><button type="button" data-next aria-label="Следующий месяц">›</button></div><div class="calendar-weekdays" aria-hidden="true"><span>Пн</span><span>Вт</span><span>Ср</span><span>Чт</span><span>Пт</span><span>Сб</span><span>Вс</span></div><div id="calendar-days" class="calendar-days" role="grid"></div><p class="calendar-note">Выбор дня задаёт точную дату. Для неполной даты выберите только месяц или год.</p><div class="calendar-actions"><button type="button" data-month>Только месяц</button><button type="button" data-year>Только год</button><button type="button" data-today>Сегодня</button><button type="button" data-clear>Очистить</button></div>';
  const month = dialog.querySelector('#calendar-month');
  MONTHS.forEach((name,index) => month.add(new Option(name[0].toUpperCase()+name.slice(1),String(index+1))));
  const year = dialog.querySelector('#calendar-year');
  year.required = true;
  function readView() {
    if (!year.checkValidity() || !Number.isInteger(Number(year.value)) || Number(year.value)<1 || Number(year.value)>9999) {year.reportValidity(); return false;}
    view = {year:Number(year.value), month:Number(month.value)}; return true;
  }
  month.addEventListener('change', () => {if(readView()) renderDays();});
  year.addEventListener('change', () => {if(readView()) renderDays();});
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  dialog.querySelector('[data-prev]').addEventListener('click', () => changeMonth(-1));
  dialog.querySelector('[data-next]').addEventListener('click', () => changeMonth(1));
  dialog.querySelector('[data-clear]').addEventListener('click', () => choose(''));
  dialog.querySelector('[data-today]').addEventListener('click', () => {const now=new Date();choose(dayToGedcom(now.getFullYear(),now.getMonth()+1,now.getDate()));});
  dialog.querySelector('[data-month]').addEventListener('click', () => {if(readView()) choose(`${GED_MONTHS[view.month-1]} ${String(view.year).padStart(4,'0')}`);});
  dialog.querySelector('[data-year]').addEventListener('click', () => {if(readView()) choose(String(view.year).padStart(4,'0'));});
  dialog.addEventListener('close', () => {if(target?.isConnected) target.focus();});
  document.body.append(dialog);
}
function changeMonth(delta) {
  const monthIndex = view.year*12 + view.month-1 + delta;
  const year = Math.floor(monthIndex/12), month = monthIndex%12+1;
  if(year<1 || year>9999) return;
  view={year,month}; renderDays();
}
function choose(value) {
  target.value = formatDate(value);
  target.dispatchEvent(new Event('input',{bubbles:true}));
  target.dispatchEvent(new Event('change',{bubbles:true}));
  dialog.close();
}
function renderDays(focusDay = null) {
  dialog.querySelector('#calendar-month').value = String(view.month);
  dialog.querySelector('#calendar-year').value = String(view.year);
  dialog.querySelector('[data-prev]').disabled = view.year === 1 && view.month === 1;
  dialog.querySelector('[data-next]').disabled = view.year === 9999 && view.month === 12;
  const grid=dialog.querySelector('#calendar-days'); grid.replaceChildren(); grid.setAttribute('aria-label',`${MONTHS[view.month-1]} ${view.year}`);
  for(const day of calendarCells(view.year,view.month)) {
    if(day===null) {const empty=document.createElement('span'); empty.setAttribute('aria-hidden','true'); grid.append(empty); continue;}
    const button=document.createElement('button'); button.type='button'; button.textContent=String(day); button.dataset.day=day; button.setAttribute('role','gridcell');
    const isSelected = selected && selected.year===view.year && selected.month===view.month && selected.day===day;
    button.setAttribute('aria-selected',String(!!isSelected)); button.setAttribute('aria-label',formatDate(dayToGedcom(view.year,view.month,day)));
    button.addEventListener('click',()=>{
      const year=dialog.querySelector('#calendar-year');
      if(year.reportValidity()) choose(dayToGedcom(Number(year.value),Number(dialog.querySelector('#calendar-month').value),day));
    });
    button.addEventListener('keydown',event=>{
      const offsets={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7};
      if(event.key==='PageUp'||event.key==='PageDown') {event.preventDefault();changeMonth(event.key==='PageUp'?-1:1);grid.querySelector('button')?.focus();return;}
      if(!(event.key in offsets)) return;
      event.preventDefault(); const date=new Date(0);date.setUTCFullYear(view.year,view.month-1,day+offsets[event.key]);
      if(date.getUTCFullYear()<1 || date.getUTCFullYear()>9999)return;
      view={year:date.getUTCFullYear(),month:date.getUTCMonth()+1};renderDays(date.getUTCDate());
    });
    grid.append(button);
  }
  if(focusDay) grid.querySelector(`[data-day="${focusDay}"]`)?.focus();
}
function openCalendar(input) {
  ensureDialog(); target=input; selected=calendarDate(safeDateValue(input));
  const raw=safeDateValue(input).replace(/^(ABT|CAL|EST|BEF|AFT|FROM) /,''), partial=/^(?:\d{1,2} )?([A-Z]{3}) (\d{4})$/.exec(raw);
  const now=new Date();
  view=selected || {year:partial?Number(partial[2]):/^\d{4}$/.test(raw)?Number(raw):now.getFullYear(),month:partial?GED_MONTHS.indexOf(partial[1])+1:now.getMonth()+1};
  if(view.year<1 || view.year>9999 || view.month<1) view={year:now.getFullYear(),month:now.getMonth()+1};
  dialog.querySelector('#calendar-title').textContent=input.labels[0]?.textContent || 'Выберите дату';
  renderDays(); dialog.showModal();
  const focusDay=selected?.day || 1; dialog.querySelector(`[data-day="${focusDay}"]`)?.focus();
}
export function mountDateFields(container) {
  for(const input of container.querySelectorAll('.date-input')) {
    if(input.dataset.dateOriginal!==undefined) continue;
    input.dataset.dateOriginal=input.value; input.value=formatDate(input.value); input.dataset.dateDisplay=input.value;
    input.placeholder=input.name==='death' ? '' : '08 июня 1990 г'; input.autocomplete='off';
    const wrapper=document.createElement('div');wrapper.className='date-control';input.before(wrapper);wrapper.append(input);
    const button=document.createElement('button');button.type='button';button.className='calendar-open';button.textContent='▦';button.dataset.calendarFor=input.id;
    button.setAttribute('aria-label',`Открыть календарь: ${input.labels[0]?.textContent || 'Дата'}`);button.setAttribute('aria-haspopup','dialog');button.addEventListener('click',()=>openCalendar(input));wrapper.append(button);
    input.addEventListener('input',()=>{try{dateValue(input);input.setCustomValidity('');}catch(error){input.setCustomValidity(error.message);}});
    input.addEventListener('blur',()=>{try{input.value=formatDate(dateValue(input));input.setCustomValidity('');}catch{/* Keep invalid text visible for correction. */}});
    input.addEventListener('keydown',event=>{if(event.key==='ArrowDown'&&event.altKey){event.preventDefault();openCalendar(input);}});
  }
}
