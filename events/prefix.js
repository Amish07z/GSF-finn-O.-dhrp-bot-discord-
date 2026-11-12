const { Events } = require('discord.js');
const { handleMessage } = require('../prefix');
let listener = null;
function init(client) {
  if (listener) return;
  listener = (message) => handleMessage(message, client);
  client.on(Events.MessageCreate, listener);
}
function destroy(client) {
  if (listener) client.removeListener(Events.MessageCreate, listener);
  listener = null;
}
module.exports = { init, destroy };
