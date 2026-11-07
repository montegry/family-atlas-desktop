// A date-free, read-only projection of the current occurrence layout.
import {PHOTO_FRAMES,portraitReference,photoCrop,portraitKey} from './photo-crop.mjs';
const W = 300, H = 320, SX = 1.45;
const xml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const localPhoto = value => /^\/photos\/[a-f0-9]{20,64}\.(?:jpg|png|gif|webp)$/i.test(value || '') ? value : null;
const nameOf = p => [p.given, p.surname || p.married].filter(Boolean).join(' ') || p.name || 'Имя не указано';

export function createPosterScene(data, layout, resolvePhoto = () => null) {
  // Deliberately whitelist only names and local photo references. Never copy dates,
  // notes, places, military events, sources or the full API snapshot into the SVG.
  const portrait = (id,mode) => {
    const p = data.people[id];
    const ref=p&&portraitReference(p,resolvePhoto);
    return p ? {name:nameOf(p), photo:localPhoto(ref&&resolvePhoto(ref)),crop:photoCrop(p,ref,mode)} : null;
  };
  const source = layout.nodes || [];
  const minX = source.length ? Math.min(...source.map(n => n.x)) : 0;
  const keys = new Map(source.map((n, i) => [n, 'n' + i]));
  const included = new Set();
  const nodes = source.map(n => {
    let ids;
    if (n.type === 'person') ids = [n.id];
    else {
      const f = data.families[n.id] || {};
      const adjacent = new Set((layout.edges || []).flatMap(e => e.from === n ? [e.to] : e.to === n ? [e.from] : []).filter(v => v.type === 'person').map(v => v.id));
      // Partners already shown on adjoining person cards need no duplicate portrait.
      ids = [f.husband, f.wife].filter(id => data.people[id] && !adjacent.has(id));
    }
    const portraits = ids.map(id => {included.add(id); return portrait(id,ids.length>1?'posterPair':'poster');}).filter(Boolean);
    const compact = n.type === 'family' && !portraits.length;
    return {key:keys.get(n), kind:n.type, repeated:!!n.repeated, portraits,
      x:Math.round(120 + (n.x - minX) * SX), y:n.y,
      width:W, height:compact ? 110 : H};
  });
  // Union-only rows are short. Pack them without the empty portrait-sized
  // bands of the editor, while preserving every lane and generation order.
  const rows=new Map();
  for(const node of nodes){if(!rows.has(node.y))rows.set(node.y,[]);rows.get(node.y).push(node);}
  let cursor=220;
  for(const [,members] of [...rows].sort((a,b)=>a[0]-b[0])) {
    const height=Math.max(...members.map(n=>n.height));
    for(const node of members)node.y=cursor+(height-node.height)/2;
    cursor+=height+65;
  }
  const byKey = new Map(nodes.map(n => [n.key,n]));
  const edges = (layout.edges || []).map(e => ({from:keys.get(e.from), to:keys.get(e.to)})).filter(e => byKey.has(e.from) && byKey.has(e.to));
  return {nodes, edges, peopleCount:included.size,
    width:Math.max(720, ...nodes.map(n => n.x + n.width + 120)),
    height:Math.max(760, ...nodes.map(n => n.y + n.height + 150))};
}

function lines(value, size = 23) {
  // Break very long single words too; avoid clipping surnames in the ribbons.
  const words = String(value).trim().split(/\s+/).flatMap(w => Array.from(w).length > size ? w.match(new RegExp(`.{1,${size}}`, 'gu')) : [w]);
  const result = [];
  for (const word of words) {
    if (!result.length || Array.from(result.at(-1) + ' ' + word).length > size) result.push(word);
    else result[result.length - 1] += ' ' + word;
  }
  return result.length ? result : ['Имя не указано'];
}

function label(text, x, y, width, small = false) {
  const wrapped = lines(text, small ? 17 : 25);
  const font = Math.min(small ? 15 : 19, 75 / Math.max(3, wrapped.length));
  return `<g><path d="M${x-width/2-8} ${y-23} Q${x} ${y-34} ${x+width/2+8} ${y-23} L${x+width/2} ${y+64} Q${x} ${y+73} ${x-width/2} ${y+64}Z" fill="url(#paper)" stroke="#b89a63"/>
    <text text-anchor="middle" fill="#293a40" font-family="Georgia, 'Times New Roman', serif" font-size="${font}">${wrapped.map((line,i) => `<tspan x="${x}" y="${y + i*font*1.15}">${xml(line)}</tspan>`).join('')}</text></g>`;
}

function medallion(person, x, y, rx, ry, clip, images) {
  const image = images.get(portraitKey(person));
  const safe = /^data:image\/(?:jpeg|png|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(image || '');
  let leaves = '';
  for (let i=0;i<7;i++) {
    const a = -1.25 + i*.40;
    for (const side of [-1,1]) {
      const lx = x + side * (rx+12) * Math.cos(a), ly = y + (ry+8)*Math.sin(a);
      leaves += `<ellipse cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" rx="5" ry="12" transform="rotate(${side*(i*18-45)} ${lx.toFixed(1)} ${ly.toFixed(1)})" fill="#c5b180" opacity=".85"/>`;
    }
  }
  return `<defs><clipPath id="${clip}"><ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}"/></clipPath></defs>
    <ellipse cx="${x}" cy="${y}" rx="${rx+11}" ry="${ry+11}" fill="#172d3c" stroke="#bfa46d" stroke-width="2"/>
    <ellipse cx="${x}" cy="${y}" rx="${rx+5}" ry="${ry+5}" fill="#344d5c" stroke="#e1ce9c"/>
    <g clip-path="url(#${clip})">${safe ? `<image href="${image}" x="${x-rx}" y="${y-ry}" width="${rx*2}" height="${ry*2}" preserveAspectRatio="xMidYMid slice"/>` : `<rect x="${x-rx}" y="${y-ry}" width="${rx*2}" height="${ry*2}" fill="url(#portrait)"/><circle cx="${x}" cy="${y-ry*.26}" r="${rx*.32}" fill="#b7b3a4"/><path d="M${x-rx*.9} ${y+ry} Q${x-rx*.8} ${y+ry*.1} ${x} ${y+ry*.14} Q${x+rx*.8} ${y+ry*.1} ${x+rx*.9} ${y+ry}Z" fill="#b7b3a4"/>`}</g>${leaves}`;
}

export function renderPosterSvg(scene, {title = 'История нашей семьи', subtitle = '', images = new Map(), background = ''} = {}) {
  if(background && !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(background))throw new Error('Фон плаката должен быть встроенным PNG');
  const {width:w, height:h} = scene;
  const nodes = new Map(scene.nodes.map(n => [n.key,n]));
  const links = scene.edges.map(e => {
    const a=nodes.get(e.from), b=nodes.get(e.to), up=b.y<a.y;
    const x1=a.x+W/2,x2=b.x+W/2,y1=a.y+(up?0:a.height),y2=b.y+(up?b.height:0),mid=(y1+y2)/2;
    return `<path d="M${x1} ${y1} V${mid} H${x2} V${y2}" fill="none" stroke="#e0cf9f" stroke-width="3" stroke-linejoin="round"/>`;
  }).join('');
  const cards = scene.nodes.map((n,i) => {
    const cx=n.x+W/2;
    if (!n.portraits.length) return `<g><rect x="${n.x+30}" y="${n.y+12}" width="240" height="86" rx="35" fill="#203948" stroke="#c5ac76"/><g fill="none" stroke="#e3d2a4" stroke-width="3"><ellipse cx="${cx-10}" cy="${n.y+43}" rx="18" ry="12"/><ellipse cx="${cx+10}" cy="${n.y+43}" rx="18" ry="12"/></g><text x="${cx}" y="${n.y+77}" text-anchor="middle" fill="#e9dcb9" font-family="Georgia,serif" font-size="16">Семейная связь</text></g>`;
    const pair=n.portraits.length>1;
    return `<g>${n.portraits.map((p,j) => {
      const x=pair?n.x+76+j*148:cx;
      const frame=PHOTO_FRAMES[pair?'posterPair':'poster'];
      return medallion(p,x,n.y+110,frame.width/2,frame.height/2,`portrait-${i}-${j}`,images)+label(p.name,x,n.y+237,pair?133:264,pair);
    }).join('')}${n.kind==='family'?`<text x="${cx}" y="${n.y-15}" text-anchor="middle" fill="#cdbd96" font-size="13" font-family="Georgia,serif">Супруги и семья</text>`:''}${n.repeated?`<text x="${cx}" y="${n.y-15}" text-anchor="middle" fill="#cdbd96" font-size="13" font-family="Georgia,serif">Повторная ссылка</text>`:''}</g>`;
  }).join('');
  const titleLines=lines(String(title).slice(0,100)||'История нашей семьи',38);
  const titleFont=titleLines.length===1?Math.min(64,Math.max(30,w/26)):titleLines.length===2?32:22;
  const ornament = `<g fill="none" stroke="#c7ac72" stroke-width="2"><path d="M0 100 Q20 15 110 0 M10 100 Q38 30 110 10 M0 70 Q50 70 45 20 M20 45 Q75 45 76 0"/><path d="M20 80 Q-10 28 25 37 Q53 46 20 80 M53 30 Q32 -4 65 8 Q84 19 53 30" fill="#b7a47c" fill-opacity=".35"/></g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${xml(title)}"><title>${xml(title)}</title>
    <defs><linearGradient id="paper" x2="0" y2="1"><stop stop-color="#f4e7c8"/><stop offset="1" stop-color="#d5c099"/></linearGradient><linearGradient id="portrait" x2="1" y2="1"><stop stop-color="#516c75"/><stop offset="1" stop-color="#273d48"/></linearGradient></defs>
    <rect width="${w}" height="${h}" fill="#e6e4da"/>
    ${background?`<image data-poster-background="true" href="${background}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/>`:''}
    <rect x="26" y="26" width="${w-52}" height="${h-52}" rx="35" fill="none" stroke="#c4ab76" stroke-width="3"/><rect x="37" y="37" width="${w-74}" height="${h-74}" rx="29" fill="none" stroke="#9c986f"/>
    <g transform="translate(44 44)">${ornament}</g><g transform="translate(${w-44} 44) scale(-1 1)">${ornament}</g><g transform="translate(44 ${h-44}) scale(1 -1)">${ornament}</g><g transform="translate(${w-44} ${h-44}) scale(-1 -1)">${ornament}</g>
    <path d="M110 69 Q${w/2} 47 ${w-110} 69 L${w-125} 165 Q${w/2} 145 125 165Z" fill="url(#paper)" stroke="#b99c69" stroke-width="2"/>
    <text text-anchor="middle" fill="#243945" font-family="Georgia,'Times New Roman',serif" font-size="${titleFont}">${titleLines.map((line,i)=>`<tspan x="${w/2}" y="${titleLines.length===1?123:92+i*30}">${xml(line)}</tspan>`).join('')}</text>
    ${subtitle?`<text x="${w/2}" y="193" text-anchor="middle" fill="#e4d6b5" font-family="Georgia,serif" font-size="18">${xml(String(subtitle).slice(0,100))}</text>`:''}
    ${links}${cards}<path d="M${w/2-100} ${h-68} H${w/2-18} M${w/2+18} ${h-68} H${w/2+100}" stroke="#c5ac76"/><path d="M${w/2} ${h-79} l10 11 -10 11 -10 -11Z" fill="none" stroke="#d5bf8c"/>
    </svg>`;
}

export function pngSize(width, height, maxEdge = 4096, maxPixels = 16000000) {
  if (![width,height,maxEdge,maxPixels].every(v => Number.isFinite(v) && v>0)) throw new Error('Некорректный размер плаката');
  const scale=Math.min(2,maxEdge/width,maxEdge/height,Math.sqrt(maxPixels/(width*height)));
  return {width:Math.max(1,Math.floor(width*scale)),height:Math.max(1,Math.floor(height*scale))};
}
