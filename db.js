// Simpele JSON-opslag (data.json). Prima voor één Discord-server.
const fs = require('fs');
const path = require('path');
const config = require('./config');
const DIR = process.env.DATA_DIR || __dirname;
fs.mkdirSync(DIR, { recursive: true });
const FILE = path.join(DIR, 'data.json');

let data = {
  warns: [], nextWarnId: 1, blacklist: {}, absences: [], absent: {}, hired: {}, tickets: {},  // absences = logboek, absent = wie nu afwezig staat
  porto: null,            // { frequentie, changedAt } - de gang-porto
  maxMembers: config.maxMembers || 0,
  statusMode: 'auto',     // sollicitatie-status: auto | open | bijna | vol
  panels: {},             // { porto|ledenlijst|commands|regels: { channelId, messageId } }
};
try { data = { ...data, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch {}

// Oude data.json (voor deze versie): porto was per speler, warns hadden geen nummer
if (!data.porto || typeof data.porto.frequentie === 'undefined') data.porto = null;
{
  const seen = {};
  for (const w of data.warns) {
    if (!w.nummer) w.nummer = (seen[w.userId] = (seen[w.userId] || 0) + 1);
    else seen[w.userId] = Math.max(seen[w.userId] || 0, w.nummer);
  }
}

// Opslaan is "debounced": meerdere wijzigingen vlak na elkaar = 1 schrijfactie, zodat de bot niet vastloopt.
let saveTimer = null;
function writeNow() {
  clearTimeout(saveTimer); saveTimer = null;
  fs.writeFileSync(FILE + '.tmp', JSON.stringify(data, null, 2));
  fs.renameSync(FILE + '.tmp', FILE);
}
function save() { if (!saveTimer) saveTimer = setTimeout(() => { try { writeNow(); } catch (e) { console.error('data.json opslaan mislukt:', e.message); } }, 200); }
// Bij afsluiten nog niet-opgeslagen wijzigingen wegschrijven
const flush = () => { if (saveTimer) { try { writeNow(); } catch {} } };
process.on('exit', flush);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { flush(); process.exit(0); });

module.exports = {
  data,
  save,
  // ----- warns (nummer = warn 1, 2, 3 van die speler) -----
  addWarn({ userId, modId, reason, nummer, tag = null }) {
    const w = { id: data.nextWarnId++, userId, modId, reason, nummer, tag, date: Date.now() };
    data.warns.push(w); save(); return w;
  },
  getWarns: (userId) => data.warns.filter((w) => w.userId === userId).sort((a, b) => a.nummer - b.nummer),
  // alle spelers met minstens 1 warn (voor de /removewarn-dropdown)
  getWarnedUsers() {
    const m = new Map();
    for (const w of data.warns) { const e = m.get(w.userId) || { userId: w.userId, tag: null, count: 0 }; e.count++; if (w.tag) e.tag = w.tag; m.set(w.userId, e); }
    return [...m.values()];
  },
  getWarn: (userId, nummer) => data.warns.find((w) => w.userId === userId && w.nummer === nummer) || null,
  removeWarn(userId, nummer) {
    const i = data.warns.findIndex((w) => w.userId === userId && w.nummer === nummer);
    if (i === -1) return null;
    const [w] = data.warns.splice(i, 1); save(); return w;
  },
  // ----- blacklist (until = null: permanent) -----
  addBlacklist(userId, reason, modId, until = null, tag = null) { data.blacklist[userId] = { reason, modId, date: Date.now(), until, tag }; save(); },
  getBlacklist: () => Object.entries(data.blacklist).filter(([, b]) => !(b.until && b.until <= Date.now())).map(([userId, b]) => ({ userId, ...b })).sort((a, b) => a.date - b.date),
  removeBlacklist(userId) { const had = !!data.blacklist[userId]; delete data.blacklist[userId]; save(); return had; },
  isBlacklisted(userId) { const b = data.blacklist[userId]; return !!b && !(b.until && b.until <= Date.now()); },
  // Haalt verlopen blacklists uit de opslag en geeft de user-ID's terug
  takeExpiredBlacklist() {
    const ids = Object.entries(data.blacklist).filter(([, b]) => b.until && b.until <= Date.now()).map(([id]) => id);
    ids.forEach((id) => delete data.blacklist[id]);
    if (ids.length) save();
    return ids;
  },
  // ----- afwezigheid (wie nu afwezig staat; per persoon 1 melding) -----
  setAbsent(userId, a) { data.absent[userId] = a; save(); },
  removeAbsent(userId) { const had = !!data.absent[userId]; delete data.absent[userId]; if (had) save(); return had; },
  getAbsent: () => Object.entries(data.absent).map(([userId, a]) => ({ userId, ...a })).sort((a, b) => a.date - b.date),
  // ----- aangenomen-datum per lid (voor /memberinfo) -----
  setHired(userId, info) { data.hired ||= {}; data.hired[userId] = info; save(); },
  getHired: (userId) => (data.hired || {})[userId] || null,
  // ----- tickets -----
  setTicket(channelId, t) { data.tickets[channelId] = t; save(); },
  deleteTicket(channelId) { delete data.tickets[channelId]; save(); },
  // ----- gang porto -----
  setPorto(frequentie) { const old = data.porto?.frequentie ?? null; data.porto = { frequentie, changedAt: Date.now() }; save(); return old; },
  // ----- max gangleden -----
  setStatusMode(m) { data.statusMode = m; save(); },
  setMax(n) { const old = data.maxMembers; data.maxMembers = n; save(); return old; },
  // ----- vaste berichten (porto, ledenlijst, ...) zodat ze bewerkt kunnen worden -----
  setPanel(key, ref) { data.panels[key] = ref; save(); },
};
