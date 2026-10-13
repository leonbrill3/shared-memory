// Shared text matching for recall. Lexical, zero-dependency, but much better
// than exact-word overlap: lowercases, drops stopwords, light stemming
// (plurals / -ing / -ed), and partial substring credit so "phone" hits
// "iPhone" and "button" hits "buttons".
const STOP = new Set([
  'the', 'a', 'an', 'of', 'to', 'is', 'are', 'am', 'was', 'were', 'be',
  'and', 'or', 'but', 'what', 'which', 'who', 'does', 'do', 'did', 'use',
  'my', 'me', 'i', 'it', 'its', 'that', 'this', 'these', 'those', 'for',
  'on', 'in', 'at', 'by', 'with', 'as', 'he', 'she', 'they', 'you', 'his',
  'her', 'their', 'your', 'about', 'how', 'when', 'where', 'why', 'has', 'have',
]);

export function stem(w) {
  w = w.toLowerCase().replace(/'s$/, '');
  if (w.length > 4) {
    if (w.endsWith('ing')) w = w.slice(0, -3);
    else if (w.endsWith('ed')) w = w.slice(0, -2);
    else if (w.endsWith('es')) w = w.slice(0, -2);
    else if (w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  }
  return w;
}

export function terms(s) {
  return (((s || '').toLowerCase().match(/[a-z0-9]+/g)) || [])
    .filter((t) => !STOP.has(t))
    .map(stem);
}

// Score how well `text` answers `queryTerms` (already stemmed).
export function scoreText(queryTerms, text) {
  const ft = terms(text);
  if (!ft.length || !queryTerms.length) return 0;
  const ftSet = new Set(ft);
  let score = 0;
  for (const q of queryTerms) {
    if (ftSet.has(q)) { score += 1; continue; }
    // partial: substring either direction, for tokens long enough to be meaningful
    for (const f of ft) {
      if (q.length >= 3 && f.length >= 3 && (f.includes(q) || q.includes(f))) { score += 0.6; break; }
    }
  }
  return score;
}
