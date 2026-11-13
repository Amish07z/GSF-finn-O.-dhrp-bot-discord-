// Verse start: wist EENMALIG de oude caches en changelog-onthoud-bestanden, zodat alles vanaf nu opnieuw wordt opgebouwd.
// Verhoog config.freshStart (bijv. naar '2') om dit nog een keer te laten gebeuren. Warns, blacklist, tickets en ledengegevens (data.json) blijven staan.
const fs = require('fs');
const path = require('path');
const config = require('./config');

function run() {
  const want = String(config.freshStart || '');
  if (!want) return;
  const dir = process.env.DATA_DIR || __dirname;
  const marker = path.join(dir, '.fresh-start');
  try { if (fs.readFileSync(marker, 'utf8').trim() === want) return; } catch { /* nog niet gedaan */ }
  const wiped = [];
  for (const f of ['msgcache.json', 'changelog-state.json', 'changelog-snapshot.json']) {
    for (const name of [f, `${f}.tmp`]) {
      try { fs.unlinkSync(path.join(dir, name)); if (!name.endsWith('.tmp')) wiped.push(name); } catch { /* bestond niet */ }
    }
  }
  try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(marker, want); } catch (e) { console.warn('Verse start: marker schrijven mislukt:', e.message); }
  console.log(`🧹 Verse start (${want}): ${wiped.length ? `gewist: ${wiped.join(', ')}` : 'geen oude cache-bestanden gevonden'}.`);
}
module.exports = { run };
