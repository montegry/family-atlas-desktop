import {formatDate} from './dates.mjs';

export function militarySummary(p) {
  const dates = [p.serviceStart, p.serviceEnd].map(value => formatDate(value || ''));
  const service = dates.some(Boolean) ? `${dates[0] || 'не указано'} — ${dates[1] || 'не указано'}` : '';
  const awards = (p.awards || '').split('\n').filter(Boolean);
  return {rank:p.militaryRank || '', service, awards};
}

export function militaryBadge(p) {
  const {rank, service, awards} = militarySummary(p);
  return [rank.replaceAll('\n', ', '), service ? `Служба: ${service}` : '', awards.length ? `Награды: ${awards.length}` : ''].filter(Boolean).join(' · ');
}

export function sourceLinks(text) {
  return [...new Set((text || '').match(/https?:\/\/[^\s<>";]+/g) || [])].map(url => url.replace(/[.,]+$/, ''));
}
