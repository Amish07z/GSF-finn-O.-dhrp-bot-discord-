// GSF | Den Haag Roleplay – regels accepteren (kanaal ✅︱regels-accepteren in de categorie Landingsbaan)
// Nieuwe leden zien alleen dit kanaal met de regels en een knop. Pas na het klikken krijgen ze de Inwoner-rol,
// waardoor alle kanalen opengaan die bij hun rollen horen. De bot plaatst/bewerkt het bericht zelf bij het opstarten
// (alleen als de tekst gewijzigd is) en onthoudt het bericht in data.json (db.data.panels.verify).
const { Events, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits: P } = require('discord.js');
const crypto = require('crypto');
const config = require('./config');
const db = require('./db');
const { embed, E, sendToChannel } = require('./utils');

// ===== Instellingen (overschrijven kan via config.verify in config.js) =====
const CFG = {
  channelId: config.verify?.channelId || '1570057402768822282',  // ✅︱regels-accepteren
  categoryId: config.verify?.categoryId || '', // Landingsbaan (optioneel)
  buttonLabel: config.verify?.buttonLabel || 'Ik ga akkoord met de regels',
  ...(config.verify || {}),
};
const BRAND = 'GSF | Den Haag Roleplay';
const COLOR = config.logColor;          // kleur van de embed
const STYLE = ButtonStyle.Success; // groen
const BUTTON_ID = 'rules_accept';
const KEY = 'verify';

const INTRO = 'Welkom op de Discord server. Door deel te nemen ga je akkoord met deze regels. Overtreding kan leiden tot waarschuwingen, verlies van je rang, mute, kick of een permanente ban zonder refund.';
const RULES = [
  ['Respect', 'Behandel iedereen met respect. Beledigen, uitschelden, provoceren of toxic gedrag is niet toegestaan.'],
  ['Geen Discriminatie', 'Racisme, discriminatie, haatdragende opmerkingen of kwetsend gedrag tegenover anderen wordt niet getolereerd.'],
  ['Geen Pesterijen of Dreigingen', 'Pesten, intimideren, bedreigen of lastigvallen van leden is verboden.'],
  ['Geen Spam of Reclame', 'Geen spam, selfpromo, ongewenste links, reclame of misbruik van serverfuncties.'],
  ['Houd het Gezellig', 'Voorkom onnodige drama, respecteer staffleden en luister naar waarschuwingen/moderatie.'],
  ['Gebruik Gezond Verstand', 'Niet alles staat letterlijk in de regels. Staff mag ingrijpen wanneer gedrag de community schaadt.'],
  ['Sancties', 'Staff bepaalt de straf afhankelijk van de overtreding. Dit kan een waarschuwing, mute, verlies van rang of permanente ban zijn. Refunds worden niet gegeven.'],
];

// ===== Embed + knop =====
function buildPanel(guild) {
  const e = embed(`📜 ${BRAND} Server Regels!`, INTRO, COLOR).setTimestamp(null);
  const icon = guild?.iconURL?.({ size: 256 });
  if (icon) e.setThumbnail(icon);
  RULES.forEach(([name, text], n) => e.addFields({ name: `${n + 1}. ${name}`, value: text }));
  e.addFields({ name: '​', value: '✅ **Klik op de knop hieronder om de regels te accepteren.** Daarna gaan alle kanalen voor je open.' });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(BUTTON_ID).setLabel(CFG.buttonLabel).setEmoji('✅').setStyle(STYLE));
  return { embeds: [e], components: [row] };
}

// Plaatst het paneel of bewerkt het bestaande (alleen als de inhoud veranderd is, zodat er geen "(bewerkt)" bij elke start komt)
async function ensurePanel(client, { force = false } = {}) {
  const ch = await client.channels.fetch(CFG.channelId).catch(() => null);
  if (!ch?.isTextBased?.()) throw new Error(`Kanaal ${CFG.channelId} niet gevonden of geen tekstkanaal (check config.verify.channelId; heeft de bot toegang?)`);
  const payload = buildPanel(ch.guild);
  const hash = crypto.createHash('sha1').update(JSON.stringify(payload.embeds[0].toJSON()) + CFG.buttonLabel + STYLE).digest('hex').slice(0, 12);
  const ref = db.data.panels?.[KEY];

  let msg = ref && ref.channelId === ch.id ? await ch.messages.fetch({ message: ref.messageId, force: true }).catch(() => null) : null;
  if (!msg) { // na verlies van data.json: eigen bericht met de knop terugvinden
    const recent = await ch.messages.fetch({ limit: 50 }).catch(() => null);
    msg = recent?.find((m) => m.author.id === client.user.id && m.components?.some((r) => r.components?.some((c) => c.customId === BUTTON_ID))) || null;
  }
  if (msg) {
    if (!force && ref?.messageId === msg.id && ref.hash === hash) return { msg, created: false, changed: false };
    await msg.edit(payload);
    db.setPanel(KEY, { channelId: ch.id, messageId: msg.id, hash });
    return { msg, created: false, changed: true };
  }
  msg = await ch.send(payload);
  db.setPanel(KEY, { channelId: ch.id, messageId: msg.id, hash });
  return { msg, created: true, changed: true };
}

// ===== Knop afhandelen =====
const inwonerRole = (guild) => (config.inwonerRoleId
  ? guild.roles.cache.get(config.inwonerRoleId)
  : guild.roles.cache.find((r) => r.name.toLowerCase() === 'inwoner')) || null;

async function onInteraction(i) {
  if (!i.isButton() || i.customId !== BUTTON_ID || i.guildId !== config.guildId) return;
  try {
    const role = inwonerRole(i.guild);
    if (!role) return await i.reply({ embeds: [embed('⚠️ Rol niet gevonden', 'De Inwoner-rol bestaat niet (meer). Meld dit bij de staff.', COLOR)], flags: E });
    const member = i.member?.roles?.cache ? i.member : await i.guild.members.fetch(i.user.id);
    if (member.roles.cache.has(role.id)) {
      return await i.reply({ embeds: [embed('✅ Je hebt de regels al geaccepteerd', 'Je hebt al toegang tot de server. Veel plezier!', COLOR)], flags: E });
    }
    await member.roles.add(role, 'Regels geaccepteerd');
    await i.reply({ embeds: [embed('✅ Regels geaccepteerd', `Welkom bij **${BRAND}**!\nJe hebt de rol <@&${role.id}> gekregen; alle kanalen voor jouw rollen zijn nu zichtbaar.`, COLOR)], flags: E });
    sendToChannel(i.client, 'logs', { embeds: [embed('✅ Regels geaccepteerd', `${member} heeft de regels geaccepteerd en de rol <@&${role.id}> gekregen.`, config.logColor)], allowedMentions: { parse: [] } });
  } catch (err) {
    console.error('Regels accepteren mislukt (staat de bot-rol boven Inwoner en heeft hij "Rollen beheren"?):', err.message);
    const msg = { content: '❌ Het geven van de rol is mislukt. Meld dit bij de staff.', flags: E };
    if (i.replied || i.deferred) i.followUp(msg).catch(() => {}); else i.reply(msg).catch(() => {});
  }
}

// ===== Controle: wat zien nieuwe leden (zonder Inwoner-rol) nu nog? =====
const CH_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice, ChannelType.GuildStageVoice, ChannelType.GuildForum, ChannelType.GuildCategory];
async function audit(guild) {
  const everyone = guild.roles.everyone;
  const role = inwonerRole(guild);
  const me = guild.members.me;
  const problems = [];
  if (!me?.permissions.has(P.ManageRoles)) problems.push('De bot mist de permissie **Rollen beheren**.');
  else if (role && me.roles.highest.comparePositionTo(role) <= 0) problems.push(`De bot-rol staat niet **boven** ${role}. Sleep de bot-rol hoger in Serverinstellingen > Rollen.`);
  if (!role) problems.push('De Inwoner-rol is niet gevonden (config.inwonerRoleId).');

  const chans = await guild.channels.fetch();
  const landing = chans.get(CFG.channelId);
  if (landing) {
    const p = landing.permissionsFor(everyone);
    if (!p.has(P.ViewChannel)) problems.push(`${landing} is niet zichtbaar voor @everyone: nieuwe leden zien de regels niet.`);
    if (p.has(P.SendMessages)) problems.push(`@everyone kan in ${landing} typen (gebruik de optie rechten:Ja).`);
  }
  const visible = [...chans.values()].filter((c) => c && CH_TYPES.includes(c.type) && c.id !== CFG.channelId && c.parentId !== CFG.categoryId && c.id !== CFG.categoryId
    && c.type !== ChannelType.GuildCategory && c.permissionsFor(everyone)?.has(P.ViewChannel));
  return { problems, visible };
}

// Zet het regels-kanaal goed: @everyone mag lezen maar niet typen, Inwoners zien het niet meer, kanaal in de Landingsbaan
async function applyPermissions(guild) {
  const ch = await guild.channels.fetch(CFG.channelId);
  const role = inwonerRole(guild);
  if (CFG.categoryId && ch.parentId !== CFG.categoryId) await ch.setParent(CFG.categoryId, { lockPermissions: false, reason: 'Regels-accepteren in Landingsbaan' }).catch(() => {});
  await ch.permissionOverwrites.edit(guild.roles.everyone, {
    ViewChannel: true, ReadMessageHistory: true, SendMessages: false, AddReactions: false,
    CreatePublicThreads: false, CreatePrivateThreads: false, SendMessagesInThreads: false,
  }, { reason: 'Regels-accepteren: alleen lezen' });
  if (role) await ch.permissionOverwrites.edit(role, { ViewChannel: false }, { reason: 'Regels-accepteren: verborgen na accepteren' });
}

let handler = null;
let timer = null;
let onReady = null;
function init(client) {
  destroy(client);
  handler = onInteraction;
  client.on(Events.InteractionCreate, handler);
  const run = () => {
    timer = setTimeout(() => ensurePanel(client)
      .then((r) => { if (r.changed) console.log(`✅ Regels-accepteren ${r.created ? 'geplaatst' : 'bijgewerkt'} in <#${CFG.channelId}>.`); })
      .catch((e) => console.error('❌ Regels-accepteren plaatsen mislukt:', e.message)), 6000);
  };
  if (client.isReady()) run(); else { onReady = run; client.once(Events.ClientReady, onReady); }
}
function destroy(client) {
  if (handler) client.removeListener(Events.InteractionCreate, handler);
  if (onReady) client.removeListener(Events.ClientReady, onReady);
  if (timer) clearTimeout(timer);
  handler = onReady = timer = null;
}

module.exports = { init, destroy, ensurePanel, buildPanel, audit, applyPermissions, onInteraction, CFG };
