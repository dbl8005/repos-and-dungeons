export type RoomNode = { path: string; files: string[]; alcoves: string[]; parent: string | null; depth: number };

type Dir = { path: string; files: string[]; children: Map<string, Dir>; total: number };

function buildTree(paths: string[]): Dir {
  const root: Dir = { path: '', files: [], children: new Map(), total: 0 };
  for (const p of paths) {
    const parts = p.split('/');
    let d = root;
    d.total++;
    for (let i = 0; i < parts.length - 1; i++) {
      let c = d.children.get(parts[i]);
      if (!c) {
        c = { path: parts.slice(0, i + 1).join('/'), files: [], children: new Map(), total: 0 };
        d.children.set(parts[i], c);
      }
      d = c;
      d.total++;
    }
    d.files.push(p);
  }
  return root;
}

/** `src/main/java/com` style chains (no files, one sub-folder) become one room. */
function compress(d: Dir): Dir {
  while (d.files.length === 0 && d.children.size === 1) d = d.children.values().next().value!;
  return d;
}

const sortedChildren = (d: Dir) => [...d.children.values()].sort((a, b) => (a.path < b.path ? -1 : 1));

/**
 * Splits the folder tree into at most `maxRooms` rooms. The room holding the most files is split into its
 * sub-folders first, until the budget runs out; whatever is left folded becomes alcoves.
 */
export function buildRooms(paths: string[], o: { maxRooms?: number } = {}): RoomNode[] {
  const maxRooms = o.maxRooms ?? 400;
  const root = buildTree([...paths].sort());
  const parent = new Map<Dir, Dir | null>([[root, null]]);
  const folded = new Map<Dir, number>([[root, root.total]]);
  const split = new Set<Dir>();
  const blocked = new Set<Dir>();

  for (;;) {
    let pick: Dir | null = null;
    for (const [d, n] of folded) {
      if (d.children.size === 0 || split.has(d) || blocked.has(d)) continue;
      const pn = pick ? folded.get(pick)! : -1;
      if (n > pn || (n === pn && pick && d.path < pick.path)) pick = d;
    }
    if (!pick) break;
    const kids = sortedChildren(pick).map(compress);
    if (folded.size + kids.length > maxRooms) {
      blocked.add(pick);
      continue;
    }
    split.add(pick);
    folded.set(pick, pick.files.length);
    for (const k of kids) {
      parent.set(k, pick);
      folded.set(k, k.total);
    }
  }

  // An unsplit room holds its whole subtree; a split room keeps only its own direct files.
  const collectAll = (d: Dir, out: string[]) => {
    out.push(...d.files);
    for (const c of d.children.values()) collectAll(c, out);
  };

  const nodes: RoomNode[] = [];
  for (const d of folded.keys()) {
    const files: string[] = [];
    if (split.has(d)) files.push(...d.files);
    else collectAll(d, files);
    files.sort();
    const p = parent.get(d);
    nodes.push({
      path: d.path,
      files,
      alcoves: split.has(d) ? [] : sortedChildren(d).map((c) => c.path),
      parent: p ? p.path : null,
      depth: d.path ? d.path.split('/').length : 0,
    });
  }
  return nodes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
