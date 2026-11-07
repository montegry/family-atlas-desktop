// Occurrence-based tidy forest: disjoint subtree intervals and orthogonal edges.
// Repeated relatives are links, not cross-edges. Every subtree has its own lane.
export const CARD_W = 232, CARD_H = 108, LEVEL = 158, GAP = 28;

export function buildForest(data, {root, mode = 'descendants', all = false, collapsed = new Set(), depth = Infinity, keyPrefix = ''} = {}) {
  const {people, families} = data;
  const spouseFamilies = new Map(), parentFamilies = new Map();
  for (const f of Object.values(families)) {
    for (const id of [f.husband, f.wife].filter(Boolean)) {
      if (!spouseFamilies.has(id)) spouseFamilies.set(id, []);
      spouseFamilies.get(id).push(f);
    }
    for (const id of f.children) {
      if (!parentFamilies.has(id)) parentFamilies.set(id, []);
      parentFamilies.get(id).push(f);
    }
  }
  const seen = new Set(), seenFamilies = new Set(), expandedPeople = new Set();
  let total = 0;
  function family(f, key, path, generation) {
    seenFamilies.add(f.id);
    const relatives = mode === 'ancestors' ? [f.husband, f.wife].filter(Boolean) : f.children;
    const node = {type: 'family', id: f.id, key, children: [], expandable: relatives.length > 0};
    if (mode !== 'ancestors') for (const spouse of [f.husband, f.wife].filter(Boolean)) seen.add(spouse);
    if (all || !collapsed.has(key)) node.children = relatives.map(child => person(child, `${key}/${child}`, path, generation + 1)).filter(Boolean);
    return node;
  }
  function person(id, key, path, generation) {
    if (!people[id]) return null;
    const repeated = path.has(id) || expandedPeople.has(id);
    const node = {type: 'person', id, key, repeated, children: [], expandable: false};
    seen.add(id);
    total++;
    const fs = (mode === 'ancestors' ? parentFamilies : spouseFamilies).get(id) || [];
    node.expandable = !repeated && fs.length > 0;
    if (repeated || (!all && (collapsed.has(key) || generation >= depth)) || total > 2500) return node;
    expandedPeople.add(id);
    const nextPath = new Set([...path, id]);
    for (const f of fs) {
      const fk = `${key}/${f.id}`;
      node.children.push(family(f, fk, nextPath, generation));
    }
    return node;
  }
  const forest = [];
  if (all) {
    const roots = Object.values(families).filter(f => ![f.husband, f.wife].some(id => id && parentFamilies.has(id)));
    for (const f of roots) {
      if (!seenFamilies.has(f.id)) {
        const id = f.husband || f.wife;
        if (id) forest.push(person(id, `root/${id}`, new Set(), 0));
        else forest.push(family(f, `root/${f.id}`, new Set(), -1));
      }
    }
    // Disconnected families, pedigree loops, and isolated people must remain reachable.
    for (const f of Object.values(families)) {
      if (!seenFamilies.has(f.id)) {
        const id = f.husband || f.wife;
        if (id) forest.push(person(id, `root/${id}`, new Set(), 0));
      }
    }
    for (const id of Object.keys(people)) if (!seen.has(id)) forest.push(person(id, `root/${id}`, new Set(), 0));
  } else if (root && people[root]) forest.push(person(root, `${keyPrefix}root/${root}`, new Set(), 0));
  if (all) {
    function prune(n, generation) {
      if (collapsed.has(n.key) || (n.type === 'person' && generation >= depth)) n.children = [];
      else for (const child of n.children) prune(child, generation + (n.type === 'family' ? 1 : 0));
    }
    for (const n of forest.filter(Boolean)) prune(n, 0);
  }
  return forest.filter(Boolean);
}

export function layoutForest(forest) {
  const nodes = [], edges = [];
  function measure(n) {
    n.width = Math.max(CARD_W, n.children.reduce((sum, child) => sum + measure(child), 0) + Math.max(0, n.children.length - 1) * GAP);
    return n.width;
  }
  function place(n, left, level) {
    n.x = left + (n.width - CARD_W) / 2;
    n.y = level * LEVEL;
    nodes.push(n);
    let cursor = left + (n.width - n.children.reduce((sum, c) => sum + c.width, 0) - Math.max(0, n.children.length - 1) * GAP) / 2;
    for (const child of n.children) {
      place(child, cursor, level + 1);
      edges.push({from: n, to: child});
      cursor += child.width + GAP;
    }
  }
  let cursor = 40;
  for (const tree of forest) {measure(tree); place(tree, cursor, 0); cursor += tree.width + GAP * 3;}
  return {nodes, edges, width: Math.max(320, cursor), height: Math.max(250, ...nodes.map(n => n.y + CARD_H + 40))};
}

// One central occurrence, with independent ancestor/descendant subtree lanes.
export function layoutTree(data, options = {}) {
  const mode = options.all ? 'descendants' : options.mode || 'descendants';
  if (mode !== 'both') {
    const result = layoutForest(buildForest(data, {...options, mode}));
    const lastRow = Math.max(0, ...result.nodes.map(n => n.y));
    for (const node of result.nodes) {
      node.direction = mode === 'ancestors' ? 'up' : 'down';
      if (node.direction === 'up') node.y = lastRow - node.y;
    }
    if (!options.all && result.nodes[0]) result.nodes[0].isRoot = true;
    return result;
  }
  const below = layoutForest(buildForest(data, {...options, mode:'descendants', keyPrefix:'down/'}));
  const above = layoutForest(buildForest(data, {...options, mode:'ancestors', keyPrefix:'up/'}));
  const root = below.nodes[0], upperRoot = above.nodes[0];
  if (!root || !upperRoot) return below;
  const offset = root.x - upperRoot.x;
  for (const node of below.nodes) node.direction = 'down';
  for (const node of above.nodes) {node.x += offset; node.y = -node.y; node.direction = 'up';}
  root.isRoot = true;
  root.branches = [
    {key:upperRoot.key, direction:'up', expandable:upperRoot.expandable, children:upperRoot.children},
    {key:root.key, direction:'down', expandable:root.expandable, children:root.children},
  ];
  const nodes = [...below.nodes, ...above.nodes.slice(1)];
  const edges = [...below.edges, ...above.edges.map(edge => ({from:edge.from === upperRoot ? root : edge.from, to:edge.to}))];
  const minX = Math.min(...nodes.map(n => n.x)), minY = Math.min(...nodes.map(n => n.y));
  for (const node of nodes) {node.x += 40 - minX; node.y -= minY;}
  return {nodes, edges, width:Math.max(...nodes.map(n => n.x + CARD_W)) + 40, height:Math.max(...nodes.map(n => n.y + CARD_H)) + 40};
}

export function edgePath(from, to) {
  const upward = to.y < from.y;
  const x1 = from.x + CARD_W / 2, x2 = to.x + CARD_W / 2;
  const y1 = from.y + (upward ? 0 : CARD_H), y2 = to.y + (upward ? CARD_H : 0);
  const mid = (y1 + y2) / 2;
  return `M${x1},${y1} V${mid} H${x2} V${y2}`;
}
