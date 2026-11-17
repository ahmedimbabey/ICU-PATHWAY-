const isText = (v) => typeof v === 'string' && v.trim() !== '';

// A real calendar date written as YYYY-MM-DD.
export function isIsoDate(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function validatePathway(p) {
  const errors = [];
  if (!p || typeof p !== 'object' || Array.isArray(p)) return ['pathway: not an object'];

  for (const f of ['id', 'title', 'category']) {
    if (!isText(p[f])) errors.push(`${f}: must be a non-empty string`);
  }
  if (!Array.isArray(p.sources) || p.sources.length === 0) {
    errors.push('sources: must be a non-empty array');
  }
  if (p.status !== 'draft' && p.status !== 'reviewed') {
    errors.push(`status: must be "draft" or "reviewed", got ${JSON.stringify(p.status)}`);
  } else if (p.status === 'reviewed' && !(typeof p.reviewed === 'string' && p.reviewed)) {
    errors.push('reviewed: status "reviewed" requires a reviewed date');
  }
  if (p.reviewed != null && !isIsoDate(p.reviewed)) {
    errors.push(`reviewed: must be null or a real date written YYYY-MM-DD, got ${JSON.stringify(p.reviewed)}`);
  }

  const nodes = p.nodes && typeof p.nodes === 'object' && !Array.isArray(p.nodes) ? p.nodes : null;
  if (!nodes) { errors.push('nodes: missing'); return errors; }

  const next = {}; // id -> valid successor ids
  for (const [id, n] of Object.entries(nodes)) {
    next[id] = [];
    if (!n || (n.type !== 'question' && n.type !== 'end')) {
      errors.push(`node ${id}: type must be "question" or "end"`);
    } else if (n.type === 'question') {
      if (!isText(n.text)) errors.push(`node ${id}: question text must be a non-empty string`);
      if (!Array.isArray(n.answers) || n.answers.length < 2) {
        errors.push(`node ${id}: question needs at least 2 answers`);
      }
      const targets = new Set();
      for (const [i, a] of (Array.isArray(n.answers) ? n.answers : []).entries()) {
        if (!a || !isText(a.label)) errors.push(`node ${id}: answer ${i} label must be a non-empty string`);
        if (!a || typeof a.next !== 'string' || !(a.next in nodes)) {
          errors.push(`node ${id}: answer ${i} next "${a && a.next}" does not exist`);
          continue;
        }
        if (targets.has(a.next)) {
          errors.push(`node ${id}: answer ${i} next "${a.next}" is shared with another answer; each answer must lead to a different node`);
        }
        targets.add(a.next);
        next[id].push(a.next);
      }
    } else {
      if (!isText(n.title)) errors.push(`node ${id}: end title must be a non-empty string`);
      if (!Array.isArray(n.actions) || n.actions.length === 0 || !n.actions.every(isText)) {
        errors.push(`node ${id}: actions must be a non-empty list of non-empty strings`);
      }
      if (!Array.isArray(n.cautions) || !n.cautions.every(isText)) {
        errors.push(`node ${id}: cautions must be a list (may be empty) of non-empty strings`);
      }
    }
  }

  if (typeof p.start !== 'string' || !(p.start in nodes)) {
    errors.push(`start: node "${p.start}" does not exist`);
    return errors;
  }

  const seen = new Set([p.start]);
  const stack = [p.start];
  while (stack.length) {
    for (const m of next[stack.pop()]) if (!seen.has(m)) { seen.add(m); stack.push(m); }
  }
  for (const id of Object.keys(nodes)) {
    if (!seen.has(id)) errors.push(`node ${id}: unreachable from start`);
  }

  // every question must be able to reach an end node
  const canEnd = new Set(Object.keys(nodes).filter(id => nodes[id] && nodes[id].type === 'end'));
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of Object.keys(nodes)) {
      if (!canEnd.has(id) && next[id].some(m => canEnd.has(m))) { canEnd.add(id); changed = true; }
    }
  }
  for (const id of Object.keys(nodes)) {
    if (nodes[id] && nodes[id].type === 'question' && !canEnd.has(id)) {
      errors.push(`node ${id}: no end node reachable from this question`);
    }
  }
  return errors;
}

// Compare the file names in pathways/index.json with the pathway files on disk.
export function compareIndex(listed, onDisk) {
  const errors = [];
  if (!Array.isArray(listed) || !listed.every(f => typeof f === 'string')) {
    return ['index.json: must be an array of file names'];
  }
  const disk = new Set(onDisk);
  const seen = new Set();
  for (const f of listed) {
    if (seen.has(f)) errors.push(`index.json: "${f}" is listed more than once`);
    seen.add(f);
    if (!disk.has(f)) errors.push(`index.json: lists "${f}" but no such file is in pathways/`);
  }
  for (const f of onDisk) {
    if (!seen.has(f)) errors.push(`index.json: "${f}" is in pathways/ but not listed (run node scripts/build-index.mjs)`);
  }
  return errors;
}
