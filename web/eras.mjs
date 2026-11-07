// These are interface themes, not claims about a person's identity or politics.
export const ERAS = [
  {id:'imperial', name:'Императорская Россия', period:'до 1917', image:'/eras/imperial.svg'},
  {id:'early-ussr', name:'Ранний СССР', period:'1917–1955', image:'/eras/early-ussr.svg'},
  {id:'late-ussr', name:'Поздний СССР', period:'1956–1991', image:'/eras/late-ussr.svg'},
  {id:'young-russia', name:'Молодая РФ', period:'1992–2009', image:'/eras/young-russia.svg'},
  {id:'modern-russia', name:'Современная РФ', period:'с 2010', image:'/eras/modern-russia.svg'},
];

function year(value) {
  const years = String(value || '').match(/\b\d{4}\b/g) || [];
  // A date range is deliberately not reduced to an invented exact date.
  return years.length === 1 ? Number(years[0]) : null;
}

export function resolveEra(person, currentYear = new Date().getFullYear()) {
  const explicit = ERAS.find(era => era.id === person.era);
  if (explicit) return {...explicit, reason:'Выбрано вручную', manual:true};
  const birth = year(person.birth), death = year(person.death);
  if (birth === null && death === null) return {id:'neutral', name:'Семейный архив', reason:'Недостаточно дат — нейтральное оформление', image:null};
  const reference = birth === null ? Math.min(death, currentYear) : Math.min(birth + 20, death ?? Infinity, currentYear);
  const index = reference < 1917 ? 0 : reference < 1956 ? 1 : reference < 1992 ? 2 : reference < 2010 ? 3 : 4;
  return {...ERAS[index], reference, manual:false, reason:birth === null ? `По году смерти: ${reference}` : `По датам жизни: ${reference} · год 20-летия, не позже смерти или текущего года`};
}
