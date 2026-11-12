// Controleert of alle commands geldig zijn (draait ook automatisch op GitHub bij elke push)
const { load } = require('./loader');
const { commands, components } = load();
const body = commands.map((c) => c.data.toJSON());
const names = body.map((b) => b.name);
const dupes = names.filter((n, i) => names.indexOf(n) !== i);
if (dupes.length) { console.error('Dubbele command-namen:', dupes); process.exit(1); }
console.log(`OK: ${body.length} commands, ${components.length} componenten`);
try { console.log(`OK: changelog.json (${require('./changelog').validate()} entries)`); } catch (e) { console.error('Changelog ongeldig:', e.message); process.exit(1); }
