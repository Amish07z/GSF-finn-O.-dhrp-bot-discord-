const messageLog = require('../messagelog');
function init(client) { messageLog.init(client); }
function destroy(client) { messageLog.destroy?.(client); }
module.exports = { init, destroy };
