const KEY = 'icu-pathways:bookmarks';

export function createStore(storage) {
  let ids = [];
  try {
    const raw = storage && storage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) ids = parsed.filter(x => typeof x === 'string');
  } catch { ids = []; }

  const save = () => {
    try { if (storage) storage.setItem(KEY, JSON.stringify(ids)); } catch { /* keep in memory */ }
  };

  return {
    isBookmarked: (id) => ids.includes(id),
    toggle(id) {
      ids = ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id];
      save();
    },
    list: () => [...ids],
  };
}
