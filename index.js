const { Client, GatewayIntentBits, Partials, Events, ActivityType } = require('discord.js');
const config = require('./config');
const { load, register } = require('./loader');

if (!config.token || !config.clientId || !config.guildId) {
  console.error('❌ Vul TOKEN, CLIENT_ID en GUILD_ID in je .env bestand in (kopieer .env.example naar .env).');
  process.exit(1);
}

const I = GatewayIntentBits;
const intents = [I.Guilds, I.GuildMembers, I.GuildModeration];
if (config.messageLog?.enabled !== false) {
  intents.push(I.GuildMessages, I.GuildMessageReactions, I.GuildVoiceStates);
  // Privileged intent: moet AAN staan in Developer Portal > Bot > Message Content Intent (anders start de bot niet)
  if (config.messageLog?.contentIntent !== false) intents.push(I.MessageContent);
}
// Prefixcommando's vereisen deze intents, ook wanneer message-logging uitstaat.
if (!intents.includes(I.GuildMessages)) intents.push(I.GuildMessages);
if (!intents.includes(I.MessageContent)) intents.push(I.MessageContent);
const client = new Client({
  intents,
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User, Partials.GuildMember],
});
let { commands, components } = load();
client.commands = commands;
client.components = components;
require('./security').init(client); // anti-nuke beveiliging
require('./messagelog').init(client); // uitgebreide message-logs
require('./verify').init(client); // regels-accepteren knop (Inwoner-rol na accepteren)
require('./notify').init(client); // DM's bij unban (met serverlink), timeout en handmatige ban/kick
require('./permfix').init(client); // zorgt dat iedereen overal bot-commands mag gebruiken

require('./events/core').init(client);
require('./changelog').init(client); // plaatst nieuwe changelog-entries automatisch in het changelog-kanaal

process.on('unhandledRejection', (e) => console.error('Unhandled rejection:', e));
client.login(config.token);
