const changelog = require('../changelog');
function init(client) { changelog.init(client); }
function destroy(client) { changelog.destroy?.(client); }
module.exports = { init, destroy };
