import {layoutTree, edgePath, CARD_W, CARD_H} from './layout.mjs';
import {ERAS, resolveEra} from './eras.mjs';
import {formatDate} from './dates.mjs';
import {mountDateFields, dateFormValues, dateValue, safeDateValue} from './date-picker.mjs';
import {militarySummary, militaryBadge, sourceLinks} from './military.mjs';
import {mountPosterExport} from './poster-export.mjs';
import {mountTutorial} from './tutorial.mjs';
import {getOnboardingStatus,completeOnboarding} from './native.mjs';
import {mountPhotoEditor} from './photo-editor.mjs';
import {portraitReference} from './photo-crop.mjs';
import {preparePortraits,treePortraitUrl} from './photo-render.mjs';
import {getTree,getMedia,applyAction,confirmAction,importTree,importProject,exportProject,exportData,photoUrl,localPhotoName,setDirty,invoke} from './native.mjs';

const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let data, media = {files:{}, errors:{}}, root, selected, selectionType = 'person', mode = 'descendants', all = false;
let collapsed = new Set(), depth = Infinity, layout, zoom = .85, pan = {x:0,y:30}, currentFormDirty = false, toastTimer;
const viewport = $('#viewport');

function toast(message) {
  $('#toast').textContent = message; $('#toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => {$('#toast').hidden = true;}, 4500);
}
function markDirty(value){currentFormDirty=value;setDirty(value);}
function lifeDates(p) {return [formatDate(p.birth) || '…', p.deceased ? '† ' + (formatDate(p.death) || '…') : ''].filter(Boolean).join('\n');}
function displayName(p) {return [p.given,p.surname || p.married].filter(Boolean).join(' ') || p.name;}
function photoPath(url) {
  const local = /^photos\/([a-f0-9]{64}\.(jpg|png|gif|webp))$/.exec(url);
  if (local && media.local?.includes(local[1])) return '/' + url;
  return localPhotoName(media.files[url]) && media.local?.includes(media.files[url]) ? '/photos/' + media.files[url] : null;
}
function avatar(p) {
  const src = treePortraitUrl(p,photoPath);
  return src ? `<img class="avatar" src="${escape(src)}" alt="${escape(displayName(p))}" loading="lazy">` : `<span class="avatar ${p.sex === 'F' ? 'female' : ''}" aria-hidden="true">${escape((p.given || p.name || '?')[0])}${escape((p.surname || p.married || '')[0] || '')}</span>`;
}
function orderedPeople() {return Object.values(data.people).sort((a,b) => (a.surname || a.married || a.name).localeCompare(b.surname || b.married || b.name, 'ru'));}
function renderList() {
  const term = $('#search').value.toLocaleLowerCase('ru');
  const people = orderedPeople().filter(p => [p.name,p.married,p.birthPlace,p.deathPlace,p.id].join(' ').toLocaleLowerCase('ru').includes(term));
  $('#people-count').textContent = Object.keys(data.people).length;
  $('#people-list').innerHTML = people.map(p => `<button class="person-row ${p.id === selected ? 'selected' : ''}" data-person="${escape(p.id)}">${avatar(p)}<span class="label"><strong>${escape(displayName(p))}</strong><small>${escape(lifeDates(p))}${p.birthPlace ? '\n' + escape(p.birthPlace) : ''}</small></span></button>`).join('') || '<p class="muted">Никого не найдено. Попробуйте другое имя.</p>';
}
function transform() {$('#world').style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`; $('#zoom-value').textContent = Math.round(zoom * 100) + '%';}
function fit() {
  if (!layout.nodes.length) return;
  zoom = Math.max(.035, Math.min(1, (viewport.clientWidth - 60) / layout.width, (viewport.clientHeight - 60) / layout.height));
  pan = {x:(viewport.clientWidth - layout.width * zoom)/2, y:25}; transform();
}
function centerRoot() {
  const node = layout.nodes.find(n => n.isRoot) || layout.nodes[0];
  if (!node) return;
  zoom = Math.max(.35, Math.min(.85, viewport.clientHeight / 480));
  const targetY = mode === 'ancestors' ? viewport.clientHeight - CARD_H * zoom - 28 : mode === 'both' ? (viewport.clientHeight - CARD_H * zoom) / 2 : 28;
  pan = {x:viewport.clientWidth / 2 - (node.x + CARD_W/2) * zoom, y:targetY - node.y * zoom}; transform();
}
function renderTree(recenter = false) {
  layout = layoutTree(data, {root, mode, all, collapsed, depth});
  const svg = $('#connections'); svg.setAttribute('width', layout.width); svg.setAttribute('height', layout.height);
  svg.innerHTML = layout.edges.map(({from,to}) => `<path class="connection" d="${edgePath(from,to)}"/>`).join('');
  $('#nodes').replaceChildren();
  for (const n of layout.nodes) {
    const element = document.createElement('div');
    element.className = `node ${n.type === 'family' ? 'family-node' : ''} ${selected === n.id && selectionType === n.type ? 'selected' : ''}`;
    element.style.left = n.x + 'px'; element.style.top = n.y + 'px';
    element.dataset.key = n.key; element.dataset.type = n.type; element.dataset.id = n.id;
    element.dataset.direction = n.isRoot ? 'root' : n.direction;
    element.tabIndex = 0; element.setAttribute('role', 'button');
    if (n.type === 'person') {
      const p = data.people[n.id];
      element.setAttribute('aria-label', displayName(p) + ', открыть карточку');
      const badge = militaryBadge(p);
      element.innerHTML = `${avatar(p)}<div class="node-text"><div class="node-name">${escape(p.given || p.name)}<span class="surname">${escape(p.surname || p.married)}</span></div><div class="node-dates">${escape(lifeDates(p))}</div>${n.repeated ? '<div class="repeat-label">↗ Уже есть в другой ветке</div>' : `<div class="node-id ${badge ? 'node-military' : ''}" title="${escape(badge ? badge + '\n' + (p.awards || '') : p.birthPlace || '')}">${escape(badge || p.birthPlace || 'Место рождения не указано')}</div>`}</div>`;
    } else {
      const f = data.families[n.id];
      const names = [f.husband,f.wife].filter(id => data.people[id]).map(id => displayName(data.people[id]));
      element.setAttribute('aria-label', 'Семья: ' + names.join(' и '));
      element.innerHTML = `<div class="family-symbol">◇</div><div class="spouse-links">${[f.husband,f.wife].filter(id => data.people[id]).map(id => `<button type="button" class="spouse-link" data-spouse="${escape(id)}" title="Редактировать: ${escape(displayName(data.people[id]))}" aria-label="Редактировать: ${escape(displayName(data.people[id]))}">${escape(displayName(data.people[id]))} ↗</button>`).join('') || '<span>Семья без родителей</span>'}</div><div class="node-dates">${escape(formatDate(f.date) || `${f.children.length} · детей`)}${f.place ? ' · ' + escape(f.place) : ''}</div>`;
      element.querySelectorAll('[data-spouse]').forEach(button => button.addEventListener('click', event => {event.stopPropagation(); openPerson(button.dataset.spouse);}));
    }
    const dateText = element.querySelector('.node-dates');
    dateText.title = dateText.textContent;
    for (const branch of n.branches || [n]) if (branch.expandable) {
      const toggle = document.createElement('button'); toggle.className = `branch-toggle ${branch.direction === 'up' ? 'branch-up' : ''}`; toggle.textContent = branch.children.length ? '−' : '+';
      const directionLabel = branch.direction === 'up' ? 'предков' : 'потомков';
      toggle.setAttribute('aria-label', `${branch.children.length ? 'Свернуть' : 'Раскрыть'} ветку ${directionLabel}`); toggle.setAttribute('aria-expanded', String(!!branch.children.length));
      toggle.dataset.branch = branch.direction;
      toggle.addEventListener('click', e => {e.stopPropagation();
        // Keep the clicked card stationary while its subtree changes width.
        const oldX = n.x, oldY = n.y;
        if (branch.children.length) collapsed.add(branch.key); else {collapsed.delete(branch.key); if (depth !== Infinity) {for (const visible of layout.nodes) for (const other of visible.branches || [visible]) if (other.expandable && !other.children.length && other.key !== branch.key) collapsed.add(other.key); depth = Infinity;}}
        renderTree(); const moved = layout.nodes.find(v => v.key === n.key); if (moved) {pan.x += (oldX - moved.x) * zoom; pan.y += (oldY - moved.y) * zoom;} transform();
      }); element.append(toggle);
    }
    function open() {n.type === 'person' ? openPerson(n.id) : openFamily(n.id);}
    element.addEventListener('click', open);
    element.addEventListener('keydown', e => {if (e.target === element && (e.key === 'Enter' || e.key === ' ')) {e.preventDefault(); open();}});
    $('#nodes').append(element);
  }
  $('#tree-title').textContent = all ? 'Все семейные линии' : data.people[root] ? displayName(data.people[root]) : 'Наше древо';
  $('#tree-description').textContent = all ? `${Object.keys(data.people).length} человек · ${Object.keys(data.families).length} семей · отдельные линии без пересечений` : `${mode === 'ancestors' ? 'Предки — вверх' : mode === 'both' ? 'Предки — вверх · потомки — вниз' : 'Потомки и семьи — вниз'} · повторные родственники обозначены ссылками`;
  $('#visible-count').textContent = `${layout.nodes.length} карточек`;
  $('#empty-state').hidden = !!layout.nodes.length;
  for (const direction of ['descendants','ancestors','both']) {$('#'+direction).classList.toggle('active', mode === direction); $('#'+direction).setAttribute('aria-pressed', String(mode === direction));}
  if (recenter) centerRoot(); else transform();
}
async function mayLeave() {return !currentFormDirty || await confirmAction('В карточке есть несохранённые изменения. Отменить их?');}
function detailHeader(label) {return `<div class="detail-top"><span>${label}</span><button class="close-detail" aria-label="Закрыть карточку">×</button></div>`;}
function field(key,label,value='',type='text') {const date=['birth','death','date','relative-birth','serviceStart','serviceEnd'].includes(key); return `<label for="field-${key}">${label}</label><input id="field-${key}" name="${key}" type="${type}" ${date ? 'class="date-input"' : ''} value="${escape(value)}">`;}
function trackForm() {
  markDirty(false); $('#detail').hidden = false;
  $('#detail form')?.addEventListener('input', () => markDirty(true));
  $('#detail form')?.addEventListener('change', () => markDirty(true));
  $('.close-detail').addEventListener('click', async () => {if (await mayLeave()) {$('#detail').hidden = true; markDirty(false);}});
  renderList(); renderTree();
}
function focusPerson(id) {
  root = id; all = false; collapsed.clear(); depth = Infinity; renderTree(true);
}
function showPhoto(url) {$('#large-photo').src = photoUrl(url); $('#photo-dialog').showModal();}
function updateEraBackground(person) {
  const era = resolveEra(person);
  $('#detail').className = `detail epoch-themed era-${era.id}`;
  $('#era-reason').textContent = era.reason;
}
function militaryCard(p) {
  const {rank, service, awards} = militarySummary(p);
  const evidence = p.militaryEvidence || [];
  return `<section class="military-card" aria-label="Военная служба и награды"><h3>Военная служба и награды</h3><dl><dt>Воинское звание</dt><dd>${escape(rank || 'Не указано')}</dd><dt>Годы службы</dt><dd>${escape(service || 'Не установлены')}</dd><dt>Награды</dt><dd>${awards.length ? `<ul>${awards.map(name => `<li>${escape(name)}</li>`).join('')}</ul>` : 'Сведения не внесены'}</dd></dl>${evidence.length ? `<details class="military-evidence"><summary>Источники и сведения документов</summary><p class="muted">Семейная атрибуция и степень проверки указаны в заметках. Дата документа не обязательно является датой вручения награды.</p>${evidence.map(item => `<article><strong>${escape(item.title)}</strong>${item.date ? `<p>${escape(formatDate(item.date))}</p>` : ''}<p class="evidence-note">${escape(item.note)}</p>${item.sources.map(source => `<div class="military-source"><strong>${escape(source.title)}</strong>${sourceLinks(source.text).map(url => `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">Открыть источник ↗</a>`).join('')}</div>`).join('')}</article>`).join('')}</details>` : ''}</section>`;
}
function personEditor(p, id) {
  return `<form id="person-form">
    ${field('given','Имя и отчество',p.given)}${field('surname','Фамилия при рождении',p.surname)}${field('married','Фамилия в браке',p.married)}
    <label for="field-sex">Пол</label><select id="field-sex" name="sex"><option value="">Не указан</option><option value="M">Мужской</option><option value="F">Женский</option><option value="U">Неизвестен</option></select>
    <div class="form-row date-event-row"><div>${field('birth','Дата рождения',p.birth)}</div><div>${field('birthPlace','Место рождения',p.birthPlace)}</div></div>
    <p class="muted">Выберите день в календаре или введите дату по-русски. Неполные даты: июнь 1990 г, 1990 г, около 1900 г; диапазон: между 1900 г и 1910 г.</p>
    <label class="checkbox-label"><input name="deceased" type="checkbox" ${p.deceased ? 'checked' : ''}> Умер / умерла</label>
    <div class="form-row date-event-row"><div>${field('death','Дата смерти',p.death)}</div><div>${field('deathPlace','Место смерти',p.deathPlace)}</div></div>
    <details class="military-editor"><summary>Редактировать звания, награды и годы службы</summary>
      <label for="field-militaryRank">Воинское звание (каждое с новой строки)</label><textarea id="field-militaryRank" name="militaryRank" rows="2">${escape(p.militaryRank)}</textarea>
      <div class="form-row date-event-row"><div>${field('serviceStart','Начало службы',p.serviceStart)}</div><div>${field('serviceEnd','Окончание службы',p.serviceEnd)}</div></div>
      <label for="field-awards">Награды (каждая с новой строки)</label><textarea id="field-awards" name="awards" rows="5">${escape(p.awards)}</textarea>
      <p class="muted">Неизвестные даты оставьте пустыми. Даты документов и источники смотрите в разделе выше. При изменении названия награды новая запись не наследует подтверждение прежней.</p>
    </details>
    <label for="field-note">Заметки</label><textarea id="field-note" name="note">${escape(p.note)}</textarea>
    <p class="form-error" role="alert"></p><div class="form-actions"><button class="primary" type="submit">Сохранить</button>${id ? '<button id="delete-person" type="button" class="quiet danger">Удалить</button>' : ''}</div>
  </form>`;
}
async function openPerson(id = null, force = false) {
  if (!force && !await mayLeave()) return;
  const p = data.people[id] || {given:'',surname:'',married:'',sex:'',birth:'',birthPlace:'',death:'',deathPlace:'',note:'',photos:[]};
  selected = id; selectionType = 'person';
  const relatives = Object.values(data.families).filter(f => [f.husband, f.wife, ...f.children].includes(id));
  const photos = p.photos.map(photoPath).filter(Boolean);
  const photoEntries=p.photos.map(reference=>({reference,path:photoPath(reference)})).filter(entry=>entry.path);
  $('#detail').innerHTML = detailHeader(id ? 'ЛИЧНОЕ ДЕЛО · ' + escape(id.replaceAll('@','')) : 'НОВАЯ ЗАПИСЬ') +
    (id ? `<div class="detail-portrait">${avatar(p)}<div><h2>${escape(displayName(p))}</h2><p>${escape(lifeDates(p))}</p></div></div><button id="focus-person" class="secondary-action">◎ Сделать центром дерева</button>` : '<h2>Добавить человека</h2>') +
    militaryCard(p) + personEditor(p,id) +
    (id ? `<hr><div class="section-label">СЕМЬИ И РОДСТВЕННИКИ</div>${relatives.map(f => `<button class="relative-link" data-family="${escape(f.id)}">◇ ${escape(f.children.includes(id) ? 'Родительская семья' : 'Собственная семья')} · ${escape(f.id.replaceAll('@',''))} ↗</button>`).join('') || '<p class="muted">Связи пока не добавлены.</p>'}<button id="add-family" class="secondary-action">+ Добавить семью</button><hr><div class="section-label">ФОТОГРАФИИ · ${photos.length}</div><div class="gallery">${photoEntries.map(({reference,path})=>`<div class="gallery-item"><button data-photo="${escape(path)}" title="Открыть оригинал"><img src="${escape(photoUrl(path))}" alt="Семейная фотография"></button><button type="button" data-crop-photo="${escape(reference)}">Кадрировать</button></div>`).join('')}</div>${p.photos.length > photos.length ? '<p class="muted">Часть фото недоступна локально. Перенесите папку проекта вместе с photos или добавьте фото с компьютера.</p>' : ''}` : '');
  $('#field-sex').value = p.sex;
  mountDateFields($('#person-form'));
  const eraField = document.createElement('details');
  eraField.className = 'era-field';
  eraField.innerHTML = `<summary>Настройки фона</summary><label for="field-era">Оформление по эпохе жизни</label><select id="field-era" name="era"><option value="">Автоматически по датам</option>${ERAS.map(era => `<option value="${era.id}">${era.name} · ${era.period}</option>`).join('')}</select><p id="era-reason" class="muted"></p><a class="era-gallery-link" href="/eras/index.html" target="_blank" rel="noopener">Посмотреть все пять фонов ↗</a>`;
  $('#field-sex').after(eraField);
  $('#field-era').value = p.era || '';
  const refreshEra = () => updateEraBackground({...p, era:$('#field-era').value, birth:safeDateValue($('#field-birth')), death:safeDateValue($('#field-death'))});
  for (const selector of ['#field-era','#field-birth','#field-death']) $(selector).addEventListener('input', refreshEra);
  $('#field-era').addEventListener('change', refreshEra);
  refreshEra();
  if (id) {
    const tools = document.createElement('div');
    tools.className = 'relative-tools';
    tools.innerHTML = '<button type="button" data-add-relative="child">+ Ребёнок</button><button type="button" data-add-relative="husband">+ Муж</button><button type="button" data-add-relative="wife">+ Жена</button>';
    $('#add-family').before(tools);
    tools.querySelectorAll('[data-add-relative]').forEach(button => button.addEventListener('click', () => openRelative(id, button.dataset.addRelative)));
    const photoTools = document.createElement('div');
    photoTools.innerHTML = '<button id="add-photo" type="button" class="secondary-action">+ Добавить фото с компьютера</button><input id="photo-file" type="file" accept="image/jpeg,image/png,image/gif,image/webp" hidden><p class="muted">JPG, PNG, GIF или WebP · до 5 МБ. Фото сохраняется сразу в папку photos/.</p>';
    $('#detail .gallery').after(photoTools);
    $('#add-photo').addEventListener('click', async () => {if (await mayLeave()) {await openPerson(id, true); $('#photo-file').click();}});
    $('#photo-file').addEventListener('change', async event => {
      const file = event.target.files[0];
      if (!file) return;
      try {
        if (file.size > 5_000_000) throw new Error('Фотография должна быть не больше 5 МБ');
        const encoded = await new Promise((resolve, reject) => {const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = () => reject(new Error('Не удалось прочитать файл')); reader.readAsDataURL(file);});
        const result = await save({type:'uploadPhoto', id, values:{data:encoded}}, $('#person-form'));
        if (result) {media = await getMedia(); await openPerson(id, true);}
      } catch (error) {toast(error.message);}
      finally {event.target.value = '';}
    });
  }
  $('#person-form').addEventListener('submit', async e => {e.preventDefault(); const form = e.currentTarget; const values = dateFormValues(form); values.deceased = form.elements.deceased.checked; const result = await save({type:'person', id, values}, form); if (result) {openPerson(result.editedId, true); if (!root) focusPerson(result.editedId);}});
  $('#focus-person')?.addEventListener('click', () => focusPerson(id));
  $('#delete-person')?.addEventListener('click', async () => {if (await confirmAction('Удалить человека и его связи со всеми семьями? Фотографии и исходный файл останутся.')) {if (await save({type:'deletePerson',id}, $('#person-form'))) {markDirty(false);$('#detail').hidden=true; selected=null; if(!data.people[root]) root=Object.keys(data.people)[0]; renderList();renderTree(true);}}});
  $('#add-family')?.addEventListener('click', () => openFamily(null, false, id));
  $('#detail').querySelectorAll('[data-family]').forEach(b => b.addEventListener('click', () => openFamily(b.dataset.family)));
  $('#detail').querySelectorAll('[data-photo]').forEach(b => b.addEventListener('click', () => showPhoto(b.dataset.photo)));
  const editPhoto=async reference=>{if(!await mayLeave())return;try{await openPerson(id,true);await photoEditor.open(data.people[id],reference,photoPath(reference));}catch(error){toast(error.message);}};
  $('#detail').querySelectorAll('[data-crop-photo]').forEach(b=>b.addEventListener('click',()=>editPhoto(b.dataset.cropPhoto)));
  const primary=portraitReference(p,photoPath);
  if(primary){$('.detail-portrait .avatar')?.addEventListener('click',()=>showPhoto(photoPath(primary)));const button=document.createElement('button');button.id='crop-portrait';button.className='secondary-action';button.textContent='✂ Кадрировать портрет';button.addEventListener('click',()=>editPhoto(primary));$('#focus-person').after(button);}
  trackForm();
}
async function openFamily(id = null, force = false, personId = null) {
  if (!force && !await mayLeave()) return;
  $('#detail').className = 'detail';
  const f = data.families[id] || {husband:personId && data.people[personId].sex !== 'F' ? personId : '',wife:personId && data.people[personId].sex === 'F' ? personId : '',children:[],date:'',place:''};
  selected=id; selectionType='family';
  const options = '<option value="">Не указан / не указана</option>' + orderedPeople().map(p => `<option value="${escape(p.id)}">${escape(displayName(p))} · ${escape(p.id.replaceAll('@',''))}</option>`).join('');
  $('#detail').innerHTML = detailHeader('СЕМЕЙНЫЕ СВЯЗИ') + `<h2>${id ? 'Редактировать семью' : 'Новая семья'}</h2><p class="muted">Связи сохраняются в обе стороны: у семьи и у каждого человека.</p><form id="family-form"><label for="husband">Муж / отец</label><select id="husband" name="husband">${options}</select><label for="wife">Жена / мать</label><select id="wife" name="wife">${options}</select>${field('date','Дата брака',f.date)}${field('place','Место брака',f.place)}<label>Дети (можно выбрать несколько)</label><input id="child-search" type="search" placeholder="Найти ребёнка…" aria-label="Поиск в списке детей"><div class="children-picker">${orderedPeople().map(p => `<label data-child-name="${escape(displayName(p).toLowerCase())}"><input type="checkbox" name="children" value="${escape(p.id)}" ${f.children.includes(p.id) ? 'checked' : ''}>${escape(displayName(p))}</label>`).join('')}</div><p class="form-error" role="alert"></p><div class="form-actions"><button class="primary" type="submit">Сохранить семью</button>${id ? '<button id="delete-family" class="quiet danger" type="button">Удалить семью</button>' : ''}</div></form><hr><div class="section-label">ПЕРЕЙТИ К ЧЕЛОВЕКУ</div>${[f.husband,f.wife,...f.children].filter(i => data.people[i]).map(i => `<button class="relative-link" data-relative="${escape(i)}">${escape(displayName(data.people[i]))} ↗</button>`).join('')}`;
  $('#husband').value=f.husband; $('#wife').value=f.wife;
  mountDateFields($('#family-form'));
  if (id) {
    const spouseEditors = document.createElement('div'); spouseEditors.className = 'family-spouse-editors';
    spouseEditors.innerHTML = [['husband','Муж'],['wife','Жена']].map(([role,label]) => data.people[f[role]] ? `<button type="button" data-relative="${escape(f[role])}"><span>${label}</span>${escape(displayName(data.people[f[role]]))} ↗</button>` : `<p class="muted">${label}: не указан${role === 'wife' ? 'а' : ''}</p>`).join('');
    $('#family-form').before(spouseEditors);
  }
  $('#child-search').addEventListener('input', e => {const term=e.target.value.toLowerCase(); $('#detail').querySelectorAll('[data-child-name]').forEach(label => {label.hidden=!label.dataset.childName.includes(term);});});
  $('#family-form').addEventListener('submit', async e => {e.preventDefault();const form=e.currentTarget, fd=new FormData(form);const result=await save({type:'family',id,values:{husband:fd.get('husband'),wife:fd.get('wife'),date:dateValue($('#field-date')),place:fd.get('place'),children:fd.getAll('children')}},form);if(result)openFamily(result.editedId,true);});
  $('#delete-family')?.addEventListener('click', async () => {if(await confirmAction('Удалить семью и связи с ней? Люди останутся.')) {if(await save({type:'deleteFamily',id},$('#family-form'))) {markDirty(false);$('#detail').hidden=true;selected=null;renderTree();}}});
  $('#detail').querySelectorAll('[data-relative]').forEach(b => b.addEventListener('click', () => openPerson(b.dataset.relative)));
  trackForm();
}
async function openRelative(id, relationship) {
  if (!await mayLeave()) return;
  await openPerson(id, true);
  const label = {child:'ребёнка',husband:'мужа',wife:'жену'}[relationship];
  const families = Object.values(data.families).filter(f => relationship === 'child' ? [f.husband,f.wife].includes(id) : f[relationship === 'husband' ? 'wife' : 'husband'] === id && !f[relationship]);
  const personOptions = orderedPeople().filter(p => p.id !== id).map(p => `<option value="${escape(p.id)}">${escape(displayName(p))} · ${escape(lifeDates(p))}</option>`).join('');
  $('#relative-content').innerHTML = `<div class="detail-top"><h2>Добавить ${label}</h2><button type="button" id="close-relative" aria-label="Закрыть">×</button></div><p class="muted">Для: ${escape(displayName(data.people[id]))}. Человек и связь будут сохранены вместе.</p><form id="relative-form"><label for="relative-mode">Кого добавить</label><select id="relative-mode" name="mode"><option value="new">Создать нового человека</option><option value="existing">Выбрать человека из дерева</option></select><div id="relative-new">${field('relative-given','Имя и отчество')}${field('relative-surname','Фамилия')}<label for="relative-sex">Пол</label><select id="relative-sex"><option value="">Не указан</option><option value="M">Мужской</option><option value="F">Женский</option></select>${field('relative-birth','Дата рождения (GEDCOM)')}</div><div id="relative-existing" hidden><label for="relative-person">Человек</label><select id="relative-person"><option value="">Выберите человека</option>${personOptions}</select></div><label for="relative-family">В какую семью</label><select id="relative-family">${families.map(f => `<option value="${escape(f.id)}">${escape([f.husband,f.wife].filter(i => data.people[i]).map(i => displayName(data.people[i])).join(' + '))} · ${f.children.length} детей · ${escape(f.id)}</option>`).join('')}<option value="">Создать отдельную семью</option></select><p class="muted">Для другого брака выберите отдельную семью. Ребёнок будет добавлен только в выбранную семью.</p><p class="form-error" role="alert"></p><div class="form-actions"><button type="submit" class="primary">Добавить ${label}</button><button id="cancel-relative" type="button">Отмена</button></div></form>`;
  $('#relative-sex').value = relationship === 'husband' ? 'M' : relationship === 'wife' ? 'F' : '';
  $('#field-relative-birth').labels[0].textContent='Дата рождения';
  mountDateFields($('#relative-form'));
  $('#relative-mode').addEventListener('change', event => {const existing = event.target.value === 'existing'; $('#relative-new').hidden = existing; $('#relative-existing').hidden = !existing; $('#relative-new').querySelectorAll('input,select').forEach(input => {input.disabled=existing;});});
  for (const selector of ['#close-relative','#cancel-relative']) $(selector).addEventListener('click', () => $('#relative-dialog').close());
  $('#relative-form').addEventListener('submit', async event => {
    event.preventDefault();
    const values = {relationship, familyId:$('#relative-family').value};
    if ($('#relative-mode').value === 'existing') {
      values.personId = $('#relative-person').value;
      if (!values.personId) {$('#relative-form .form-error').textContent = 'Выберите человека'; return;}
    } else values.person = {given:$('#field-relative-given').value, surname:$('#field-relative-surname').value, sex:$('#relative-sex').value, birth:dateValue($('#field-relative-birth'))};
    const result = await save({type:'addRelative', id, values}, event.currentTarget);
    if (result) {$('#relative-dialog').close(); openPerson(id, true); focusPerson(id);}
  });
  $('#relative-dialog').showModal();
}
async function save(action, form) {
  const buttons=form ? [...form.querySelectorAll('button')] : [];
  buttons.forEach(b=>b.disabled=true);
  if(form)form.querySelector('.form-error').textContent='';
  try {
    const result=await applyAction({...action,revision:data.revision});
    await preparePortraits(result,photoPath);
    data=result; markDirty(false); $('#save-status').textContent='SQLite · все изменения сохранены'; renderList();renderTree();toast('Сохранено на этом компьютере');return result;
  } catch(error) {if(form)form.querySelector('.form-error').textContent=error.message;else toast(error.message);return null;}
  finally {buttons.forEach(b=>b.disabled=false);}
}
$('#search').addEventListener('input',renderList);
$('#people-list').addEventListener('click', async e=>{const row=e.target.closest('[data-person]');if(row && await mayLeave()){await openPerson(row.dataset.person,true);focusPerson(row.dataset.person);}});
$('#new-person').addEventListener('click',()=>openPerson());
$('#show-all').addEventListener('click',()=>{all=true;mode='descendants';collapsed.clear();depth=Infinity;renderTree();fit();});
for (const direction of ['descendants','ancestors','both']) $('#'+direction).addEventListener('click',()=>{mode=direction;all=false;collapsed.clear();depth=Infinity;renderTree(true);});
$('#collapse-all').addEventListener('click',()=>{collapsed.clear();depth=0;renderTree(true);});
$('#expand-all').addEventListener('click',()=>{collapsed.clear();depth=Infinity;renderTree();fit();});
$('#fit').addEventListener('click',fit);
function zoomAt(factor,x=viewport.clientWidth/2,y=viewport.clientHeight/2) {const next=Math.max(.035,Math.min(2,zoom*factor));pan.x=x-(x-pan.x)*next/zoom;pan.y=y-(y-pan.y)*next/zoom;zoom=next;transform();}
$('#zoom-in').addEventListener('click',()=>zoomAt(1.25));$('#zoom-out').addEventListener('click',()=>zoomAt(.8));
viewport.addEventListener('wheel',e=>{e.preventDefault();const r=viewport.getBoundingClientRect();zoomAt(Math.exp(-e.deltaY*.0015),e.clientX-r.left,e.clientY-r.top);},{passive:false});
let drag=null;
viewport.addEventListener('pointerdown',e=>{if(e.target.closest('.node') || e.button!==0)return;drag={x:e.clientX,y:e.clientY,px:pan.x,py:pan.y};viewport.setPointerCapture(e.pointerId);viewport.classList.add('dragging');});
viewport.addEventListener('pointermove',e=>{if(!drag)return;pan.x=drag.px+e.clientX-drag.x;pan.y=drag.py+e.clientY-drag.y;transform();});
function endDrag(){drag=null;viewport.classList.remove('dragging');}
viewport.addEventListener('pointerup',endDrag);viewport.addEventListener('pointercancel',endDrag);
viewport.addEventListener('keydown',e=>{if(e.target!==viewport)return;const shifts={ArrowLeft:[50,0],ArrowRight:[-50,0],ArrowUp:[0,50],ArrowDown:[0,-50]};if(shifts[e.key]){e.preventDefault();pan.x+=shifts[e.key][0];pan.y+=shifts[e.key][1];transform();}else if(e.key==='+'||e.key==='=')zoomAt(1.25);else if(e.key==='-')zoomAt(.8);else if(e.key==='0')fit();});
$('#close-photo').addEventListener('click',()=>$('#photo-dialog').close());
$('#import-button').addEventListener('click',async()=>{if(!await mayLeave())return;try{if(await importTree(data.revision))await reloadTree();}catch(error){toast(error.message);}});
$('#import-project').addEventListener('click',async()=>{if(!await mayLeave())return;try{if(await importProject(data.revision))await reloadTree();}catch(error){toast(error.message);}});
$('#export-project').addEventListener('click',async()=>{try{const path=await exportProject();if(path)toast('Полная копия сохранена: '+path);}catch(error){toast(error.message);}});
for(const kind of ['json','ged'])$('#export-'+kind).addEventListener('click',async()=>{try{if(await exportData(kind))toast('Файл сохранён');}catch(error){toast(error.message);}});
$('#storage-info').addEventListener('click',async()=>{try{const info=await invoke('storage_info');toast('SQLite и фотографии: '+info.directory);}catch(error){toast(error.message);}});
document.addEventListener('click',async event=>{const link=event.target.closest('a[href]');if(!link)return;const href=link.getAttribute('href');event.preventDefault();try{if(/^https?:\/\//.test(href))await invoke('open_source',{url:href});else if(href==='/eras/index.html')await invoke('open_gallery');}catch(error){toast(error.message);}});
window.addEventListener('beforeunload',e=>{if(currentFormDirty){e.preventDefault();e.returnValue='';}});
window.addEventListener('resize',transform);
const tutorial=mountTutorial({button:$('#help-button'),getStatus:getOnboardingStatus,complete:completeOnboarding,notify:toast});
const photoEditor=mountPhotoEditor({onDirty:markDirty,onSave:async(id,values)=>{const result=await save({type:'cropPhoto',id,values});if(result)await openPerson(id,true);return !!result;}});
mountPosterExport({button:$('#poster-button'),dialog:$('#poster-dialog'),
  getSnapshot:()=>({data,layout,all,rootName:data?.people[root]?displayName(data.people[root]):'Наше древо'}),
  resolvePhoto:photoPath,notify:toast});

export async function reloadTree() {
  try {
    [data,media]=await Promise.all([getTree(),getMedia()]);
    await preparePortraits(data,photoPath);
    markDirty(false);selected=null;$('#detail').hidden=true;collapsed.clear();depth=Infinity;
    // Pick a wide lineage, not an arbitrary first record from the exporter.
    const score=id=>{const seen=new Set();function visit(i){if(seen.has(i))return;seen.add(i);for(const f of Object.values(data.families))if([f.husband,f.wife].includes(i))for(const c of f.children)visit(c);}visit(id);return seen.size;};
    root=Object.keys(data.people).sort((a,b)=>score(b)-score(a))[0];
    $('#save-status').textContent='SQLite · локальное приложение';
    renderList();renderTree(true);
  }catch(error){$('#tree-description').textContent='Ошибка загрузки: '+error.message;toast(error.message);throw error;}
}
await reloadTree();
await tutorial.startIfNeeded();
document.body.dataset.appReady='true';
