// Russian presentation at the UI boundary; GEDCOM stays unchanged in storage.
export const MONTHS = ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];
export const MONTHS_GENITIVE = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
export const GED_MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const QUALIFIERS = {ABT:'около',CAL:'расчётно',EST:'предположительно',BEF:'до',AFT:'после'};
const pad = n => String(n).padStart(2,'0');

export function daysInMonth(year, month) {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4,6,9,11].includes(month) ? 30 : 31;
}
export function validDate(year, month, day) {
  return Number.isInteger(year) && year >= 1 && year <= 9999 && Number.isInteger(month) && month >= 1 && month <= 12 && Number.isInteger(day) && day >= 1 && day <= daysInMonth(year,month);
}
export function dayToGedcom(year, month, day) {
  if (!validDate(year,month,day)) throw new Error('Такой даты не существует');
  return `${day} ${GED_MONTHS[month-1]} ${String(year).padStart(4,'0')}`;
}

export function formatDate(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  let m;
  if ((m = /^BET (.+) AND (.+)$/i.exec(text))) return `между ${formatDate(m[1])} и ${formatDate(m[2])}`;
  if ((m = /^FROM (.+) TO (.+)$/i.exec(text))) return `с ${formatDate(m[1])} по ${formatDate(m[2])}`;
  if ((m = /^(FROM|TO) (.+)$/i.exec(text))) return `${m[1].toUpperCase() === 'FROM' ? 'с' : 'по'} ${formatDate(m[2])}`;
  if ((m = /^(ABT|CAL|EST|BEF|AFT) (.+)$/i.exec(text))) return `${QUALIFIERS[m[1].toUpperCase()]} ${formatDate(m[2])}`;
  if ((m = /^(\d{1,2}) ([A-Z]{3}) (\d{1,4})$/i.exec(text))) {
    const month = GED_MONTHS.indexOf(m[2].toUpperCase());
    if (month >= 0) return `${pad(m[1])} ${MONTHS_GENITIVE[month]} ${m[3]} г`;
  }
  if ((m = /^([A-Z]{3}) (\d{1,4})$/i.exec(text))) {
    const month = GED_MONTHS.indexOf(m[1].toUpperCase());
    if (month >= 0) return `${MONTHS[month]} ${m[2]} г`;
  }
  if (/^\d{1,4}$/.test(text)) return text + ' г';
  // Unknown dialects remain legible and are preserved verbatim unless edited.
  return text;
}

function parseSimple(value) {
  const text = value.trim().replace(/\s+г(?:од(?:а)?)?\.?$/iu,'').trim();
  let m, year, month, day;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text))) [,year,month,day] = m.map(Number);
  else if ((m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text))) [,day,month,year] = m.map(Number);
  else if ((m = /^(?:(\d{1,2})\s+)?([^\s]+)\s+(\d{4})$/u.exec(text))) {
    const name = m[2].toLowerCase();
    month = MONTHS.indexOf(name) + 1 || MONTHS_GENITIVE.indexOf(name) + 1 || GED_MONTHS.indexOf(name.toUpperCase()) + 1;
    year = Number(m[3]); day = m[1] ? Number(m[1]) : null;
    if (day === null && year >= 1 && month > 0) return `${GED_MONTHS[month-1]} ${m[3]}`;
  } else if (/^\d{4}$/.test(text) && Number(text) >= 1) return text;
  if (validDate(year,month,day)) return dayToGedcom(year,month,day);
  throw new Error('Укажите существующую дату, например: 08 июня 1990 г, июнь 1990 г или 1990 г');
}

export function toGedcom(value) {
  const text = String(value || '').trim().replace(/\s+/g,' ');
  if (!text) return '';
  let m;
  if ((m = /^(?:между|BET) (.+) (?:и|AND) (.+)$/iu.exec(text))) return `BET ${parseSimple(m[1])} AND ${parseSimple(m[2])}`;
  if ((m = /^(?:с|FROM) (.+) (?:по|TO) (.+)$/iu.exec(text))) return `FROM ${parseSimple(m[1])} TO ${parseSimple(m[2])}`;
  const prefixes = {...QUALIFIERS, FROM:'с', TO:'по'};
  for (const [tag,ru] of Object.entries(prefixes)) {
    if ((m = new RegExp(`^(?:${tag}|${ru}) (.+)$`,'iu').exec(text))) return `${tag} ${parseSimple(m[1])}`;
  }
  return parseSimple(text);
}

export function calendarDate(value) {
  const m = /^(\d{1,2}) ([A-Z]{3}) (\d{4})$/.exec(value || '');
  if (!m) return null;
  const day = Number(m[1]), month = GED_MONTHS.indexOf(m[2])+1, year = Number(m[3]);
  return validDate(year,month,day) ? {year,month,day} : null;
}

export function calendarCells(year, month) {
  // setUTCFullYear avoids JavaScript's implicit 1900 offset for years 0–99.
  const first = new Date(0); first.setUTCFullYear(year,month-1,1); first.setUTCHours(0,0,0,0);
  const offset = (first.getUTCDay()+6)%7;
  return [...Array(offset).fill(null), ...Array.from({length:daysInMonth(year,month)},(_,i)=>i+1)];
}
