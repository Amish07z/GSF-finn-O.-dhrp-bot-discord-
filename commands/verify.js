const { SlashCommandBuilder } = require('discord.js');
const { E, embed } = require('../utils');
const verify = require('../verify');

const commands = [];

// /regelspaneel: (her)plaatst het regels-accepteren paneel en controleert of nieuwe leden niet te veel zien
commands.push({
  level: 'management',
  data: new SlashCommandBuilder().setName('regelspaneel').setDescription('Plaats of werk het regels-accepteren paneel bij en controleer de zichtbaarheid')
    .addBooleanOption((o) => o.setName('rechten').setDescription('Zet het regels-kanaal goed: alleen lezen voor @everyone, verborgen voor Inwoners')),
  async execute(i, client) {
    await i.deferReply({ flags: E });
    const lines = [];
    try {
      if (i.options.getBoolean('rechten')) { await verify.applyPermissions(i.guild); lines.push('🔒 Rechten van het regels-kanaal ingesteld (alleen lezen, verborgen voor Inwoners).'); }
      const r = await verify.ensurePanel(client, { force: true });
      lines.push(r.created ? `✅ Paneel geplaatst in <#${r.msg.channelId}>.` : '✅ Paneel bijgewerkt.');
      const { problems, visible } = await verify.audit(i.guild);
      problems.forEach((p) => lines.push(`⚠️ ${p}`));
      if (visible.length) {
        lines.push(`⚠️ **${visible.length} kanaal/kanalen** zijn ook zichtbaar voor @everyone, dus voor leden die de regels nog niet hebben geaccepteerd:`);
        lines.push(visible.slice(0, 15).map((c) => `• ${c}`).join('\n') + (visible.length > 15 ? `\n… en ${visible.length - 15} meer` : ''));
        lines.push('Zet bij die kanalen/categorieën **Kanaal bekijken** uit voor @everyone en aan voor de juiste rollen.');
      } else if (!problems.length) lines.push('✅ Alle andere kanalen zijn verborgen voor @everyone: alleen met de Inwoner-rol (of een andere rol) zie je ze.');
    } catch (err) { lines.push(`⚠️ Mislukt: ${err.message}`); }
    return i.editReply({ embeds: [embed('📜 Regels-accepteren', lines.join('\n'))] });
  },
});

module.exports = { commands };
