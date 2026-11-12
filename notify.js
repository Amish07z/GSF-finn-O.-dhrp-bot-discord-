// DM-meldingen bij moderatie: unban (met serverlink), timeout, timeout opgeheven, en handmatige ban/kick.
// Werkt via het audit log van Discord, dus ook als een mod het gewoon in Discord zelf doet (niet alleen via de bot).
// Staan iemands DM's dicht? Dan wordt de melding stilletjes overgeslagen.
// Vereist bij de bot: "Audit log bekijken" (en "Uitnodiging maken" als er nog geen serverlink is ingesteld).
const { Events, AuditLogEvent: A, ChannelType } = require('discord.js');
const config = require('./config');
const db = require('./db');
const { embed, recentlyDmed, markDm, appealLine } = require('./utils');

const GREEN = 0x2ecc71;
const WAIT_MS = 2500; // even wachten: commando's die zelf al een DM sturen worden zo niet dubbel gemeld

// ---- Permanente serverlink: config.inviteUrl > opgeslagen link > automatisch aanmaken ----
let inviteCache = null;
async function getInvite(client, guild) {
  const known = config.inviteUrl || inviteCache || db.data.inviteUrl;
  if (known) {
    if (config.inviteUrl) return known; // handmatig ingesteld: vertrouwen
    const code = known.split('/').pop();
    if (await client.fetchInvite(code).then(() => true).catch(() => false)) return (inviteCache = known);
  }
  const ids = [config.channels?.regels, config.channels?.welkom];
  const ch = ids.map((id) => id && guild.channels.cache.get(id)).find((c) => c?.isTextBased?.() && c.type !== ChannelType.GuildVoice)
    || guild.channels.cache.find((c) => c.type === ChannelType.GuildText && c.permissionsFor(guild.members.me)?.has('CreateInstantInvite'));
  if (!ch) return null;
  const inv = await ch.createInvite({ maxAge: 0, maxUses: 0, unique: false, reason: 'Permanente link voor unban-melding' }).catch(() => null);
  if (!inv) return null;
  db.data.inviteUrl = inv.url; db.save();
  return (inviteCache = inv.url);
}

// Stuurt de DM en logt in de console waarom het niet lukte (DM's dicht, geblokkeerd, geen gedeelde server...)
async function tell(user, emb, what, client = null, entry = null) {
  try { await user.send({ embeds: [emb] }); return true; }
  catch (e) {
    console.warn(`[notify] DM "${what}" naar ${user.tag} (${user.id}) mislukt: ${e.code || ''} ${e.message}`);
    return false;
  }
}

// Unban-DM met serverlink. Wordt door /unban zelf aangeroepen (niet afhankelijk van het audit log) en door de handmatige unban hieronder.
async function sendUnbanDm(client, guild, user, why, executorId) {
  markDm(user.id); // voorkomt dat het audit-log-pad dezelfde DM nog eens stuurt
  let link = null;
  try { link = await getInvite(client, guild); } catch (e) { console.warn('[notify] serverlink maken mislukt:', e.message); }
  const door = executorId && executorId !== client.user.id ? `\n**Door:** <@${executorId}>` : '';
  const text = `**Server:** ${config.serverName}\n**Reden:** ${why}${door}\n\nJe bent geunbanned en mag weer terugkomen.${link ? `\n\n🔗 **Kom terug naar de server:** ${link}` : ''}`;
  try { await user.send({ embeds: [embed('✅ Je bent geunbanned', text, GREEN)] }); return { ok: true, link }; }
  catch (e) { console.warn(`[notify] unban-DM naar ${user.tag} (${user.id}) mislukt: ${e.code || ''} ${e.message}`); return { ok: false, code: e.code, error: e.message, link }; }
}

const fmtReason = (r) => r || 'Geen reden opgegeven';
const by = (entry, client) => (entry.executorId && entry.executorId !== client.user.id ? `\n**Door:** <@${entry.executorId}>` : '');
const sameChangeVal = (entry, key) => entry.changes?.find((c) => c.key === key);

function init(client) {
  client.on(Events.GuildAuditLogEntryCreate, async (entry, guild) => {
    try {
      if (guild.id !== config.guildId || !entry.targetId) return;
      const action = entry.action;
      if (![A.MemberBanAdd, A.MemberBanRemove, A.MemberKick, A.MemberUpdate].includes(action)) return;
      const user = await client.users.fetch(entry.targetId).catch(() => null);
      if (!user || user.bot) return;
      const server = `**Server:** ${config.serverName}`;
      const why = fmtReason(entry.reason);

      // ---------- Unban (handmatig in Discord): melding + link om terug te komen ----------
      if (action === A.MemberBanRemove) {
        await new Promise((r) => setTimeout(r, WAIT_MS));
        if (recentlyDmed(user.id, 10000)) return; // /unban heeft zelf al een DM gestuurd
        await sendUnbanDm(client, guild, user, why, entry.executorId);
        return;
      }

      // ---------- Timeout gezet / opgeheven ----------
      if (action === A.MemberUpdate) {
        const ch = sameChangeVal(entry, 'communication_disabled_until');
        if (!ch) return;
        const until = ch.new ? new Date(ch.new).getTime() : null;
        if (until && until > Date.now()) {
          await new Promise((r) => setTimeout(r, WAIT_MS));
          if (recentlyDmed(user.id)) return; // het commando heeft al een DM gestuurd
          const ts = Math.floor(until / 1000);
          await tell(user, embed('🔇 Je hebt een timeout gekregen', `${server}\n**Tot:** <t:${ts}:F> (<t:${ts}:R>)\n**Reden:** ${why}${by(entry, client)}`), 'timeout', client, entry);
        } else if (!until && ch.old) {
          await tell(user, embed('🔊 Je timeout is opgeheven', `${server}\n**Reden:** ${why}${by(entry, client)}\n\nJe kunt weer praten.`, GREEN), 'timeout opgeheven', client, entry);
        }
        return;
      }

      // ---------- Handmatige ban / kick in Discord (via de bot-commando's is er al een DM verstuurd) ----------
      await new Promise((r) => setTimeout(r, WAIT_MS));
      if (recentlyDmed(user.id)) return;
      const isBan = action === A.MemberBanAdd;
      await tell(user, embed(isBan ? '🔨 Je bent gebanned' : '👢 Je bent gekickt', `${server}\n**Reden:** ${why}${by(entry, client)}${appealLine()}`), isBan ? 'ban' : 'kick', client, entry);
    } catch (e) { console.error('Moderatie-melding mislukt:', e.message); }
  });
}

module.exports = { init, sendUnbanDm };
