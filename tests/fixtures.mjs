// Independently generated fixtures. No real names, dates or family topology.
export function syntheticTree(){
  const people=Object.fromEntries(Array.from({length:78},(_,i)=>['p'+(i+1),{id:'p'+(i+1),given:'Тест '+(i+1),surname:'Синтетический',photos:[]}]));
  const families=Object.fromEntries(Array.from({length:27},(_,i)=>['f'+(i+1),{id:'f'+(i+1),husband:'p'+(i+1),wife:'p'+(i+29),children:['p'+(i+2)],date:'',place:''}]));
  return {people,families};
}
