import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MONTHS,MONTHS_GENITIVE,GED_MONTHS,formatDate,toGedcom,calendarDate,calendarCells,daysInMonth,dayToGedcom} from '../web/dates.mjs';
import {dateValue} from '../web/date-picker.mjs';

test('full dates use Russian genitive month and a two-digit day',()=>{
  assert.equal(formatDate('8 JUN 1990'),'08 июня 1990 г');
  assert.equal(formatDate('7 NOV 2024'),'07 ноября 2024 г');
  for(let month=0;month<12;month++) {
    const ged=`8 ${GED_MONTHS[month]} 1990`, ru=`08 ${MONTHS_GENITIVE[month]} 1990 г`;
    assert.equal(formatDate(ged),ru);assert.equal(toGedcom(ru),ged);
  }
});
test('incomplete dates never invent day or month',()=>{
  assert.equal(formatDate('1990'),'1990 г');assert.equal(toGedcom('1990 г'),'1990');
  for(let month=0;month<12;month++) {
    assert.equal(formatDate(`${GED_MONTHS[month]} 1990`),`${MONTHS[month]} 1990 г`);
    assert.equal(toGedcom(`${MONTHS[month]} 1990 г`),`${GED_MONTHS[month]} 1990`);
  }
});
test('approximate dates and bounds translate and roundtrip',()=>{
  for(const [tag,ru] of [['ABT','около'],['CAL','расчётно'],['EST','предположительно'],['BEF','до'],['AFT','после'],['FROM','с'],['TO','по']]) {
    const text=`${ru} 08 июня 1990 г`;assert.equal(formatDate(`${tag} 8 JUN 1990`),text);assert.equal(toGedcom(text),`${tag} 8 JUN 1990`);
  }
});
test('ranges preserve both dates and qualifier semantics',()=>{
  for(const [ged,ru] of [['BET 1900 AND 1910','между 1900 г и 1910 г'],['FROM 8 JUN 1990 TO 9 JUL 1991','с 08 июня 1990 г по 09 июля 1991 г']]) {
    assert.equal(formatDate(ged),ru);assert.equal(toGedcom(ru),ged);
  }
});
test('manual numeric and ISO dates are parsed without timezone shifts',()=>{
  assert.equal(toGedcom('08.06.1990'),'8 JUN 1990');assert.equal(toGedcom('1990-06-08'),'8 JUN 1990');
  assert.equal(toGedcom('8 ИЮНЯ 1990 г.'),'8 JUN 1990');assert.equal(toGedcom('8 JUN 1990'),'8 JUN 1990');
  assert.equal(toGedcom('ABT 1900'),'ABT 1900');assert.equal(toGedcom(''),'');assert.equal(formatDate(''),'');
});
test('nonexistent dates and insufficient years cannot be silently corrected',()=>{
  for(const text of ['29 февраля 1900 г','31 апреля 1990 г','32 июня 1990 г','1990-13-01','21 марта 19 г','не дата'])assert.throws(()=>toGedcom(text));
  assert.equal(toGedcom('29 февраля 2000 г'),'29 FEB 2000');
  assert.equal(daysInMonth(1900,2),28);assert.equal(daysInMonth(2000,2),29);
});
test('calendar starts on Monday and handles historical leap years',()=>{
  assert.deepEqual(calendarCells(2024,1).slice(0,3),[1,2,3]);
  assert.deepEqual(calendarCells(1990,6).slice(0,6),[null,null,null,null,1,2]);
  assert.equal(calendarCells(2000,2).filter(Boolean).length,29);
  assert.equal(calendarCells(1900,2).filter(Boolean).length,28);
  assert.deepEqual(calendarDate('8 JUN 1990'),{year:1990,month:6,day:8});
  assert.equal(calendarDate('ABT 1990'),null);assert.equal(calendarDate('21 MAR 19'),null);
  assert.equal(dayToGedcom(19,3,21),'21 MAR 0019');
});
test('untouched unusual source dates are preserved verbatim',()=>{
  for(const original of ['21 MAR 19','@#DJULIAN@ 1 JAN 1800','ABT 1989','08 JUN 1990','']) {
    const display=formatDate(original), input={value:display,dataset:{dateOriginal:original,dateDisplay:display}};
    assert.equal(dateValue(input),original);
  }
  assert.equal(formatDate('21 MAR 19'),'21 марта 19 г');
});
test('precise, partial and qualified dates survive presentation and untouched save',()=>{
  const dates=GED_MONTHS.flatMap(month=>[`8 ${month} 1990`,`${month} 1900`,`ABT ${month} 1910`,`BEF 8 ${month} 1945`]).concat(['21 MAR 19','ABT 1989','BET 1900 AND 1910']);
  assert.ok(dates.length>40);
  for(const original of dates) {
    const display=formatDate(original);
    assert.equal(dateValue({value:display,dataset:{dateOriginal:original,dateDisplay:display}}),original);
    assert.ok(!/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|ABT)\b/.test(display));
  }
});
