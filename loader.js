const fs = require('fs');
const path = require('path');
const { REST, Routes, Collection } = require('discord.js');
const config = require('./config');

function load() {
  const commands = new Collection();
  const components = [];
  const dir = path.join(__dirname, 'commands');
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const mod = require(path.join(dir, f));
    for (const c of mod.commands || []) {
      // Zichtbaar voor iedereen (ook Inwoner). Wie geen rol heeft krijgt bij uitvoeren een "Geen toegang"-melding (zie index.js).
      c.data.setDefaultMemberPermissions(null).setDMPermission(false);
      commands.set(c.data.name, c);
    }
    components.push(...(mod.components || []));
  }
  return { commands, components };
}

// reset = true: verwijdert eerst ALLE commando's van de bot in de server en maakt ze opnieuw aan.
// Daarmee verdwijnen ook oude rechten-instellingen uit Serverinstellingen > Integraties (die commando's voor sommige rollen verbergen).
async function register(commands, { reset = false } = {}) {
  const rest = new REST({ version: '10' }).setToken(config.token);
  if (reset) await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: [] });
  const body = commands.map((c) => c.data.toJSON());
  await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body });
  return body.length;
}

module.exports = { load, register };
