import { validatePathway } from './validate.js';

const isOffline = (res) => !!(res && res.headers && typeof res.headers.get === 'function' && res.headers.get('x-offline-copy'));
const message = (e) => (e && e.message) || String(e);

async function loadOne(file, fetchFn) {
  let data, res;
  try {
    res = await fetchFn(`pathways/${file}`);
    if (!res || !res.ok) throw new Error('could not load file');
    data = await res.json();
  } catch (e) {
    return { failed: { id: file, error: message(e) } };
  }
  const id = data && typeof data.id === 'string' && data.id ? data.id : file;
  let errors;
  try { errors = validatePathway(data); }
  catch (e) { errors = [`validator error: ${message(e)}`]; }
  if (errors.length) return { failed: { id, error: errors.join('; ') } };
  return { pathway: data, offline: isOffline(res) };
}

export async function loadLibrary(fetchFn) {
  let files, indexRes;
  try {
    const res = indexRes = await fetchFn('pathways/index.json');
    if (!res || !res.ok) throw new Error('could not load pathways/index.json');
    files = await res.json();
    if (!Array.isArray(files) || !files.every(f => typeof f === 'string')) {
      throw new Error('pathways/index.json must be an array of file names');
    }
  } catch (e) {
    return { pathways: [], failed: [{ id: 'index', error: message(e) }] };
  }
  const results = await Promise.all(files.map(f => loadOne(f, fetchFn)));
  const pathways = [];
  const failed = [];
  let offline = isOffline(indexRes);
  const seen = new Set();
  for (const r of results) {
    if (r.offline) offline = true;
    if (r.failed) failed.push(r.failed);
    else if (seen.has(r.pathway.id)) failed.push({ id: r.pathway.id, error: 'duplicate id' });
    else { seen.add(r.pathway.id); pathways.push(r.pathway); }
  }
  return { pathways, failed, offline };
}
