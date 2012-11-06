
/**
 * Module dependencies.
 */

var logjs = require('log4js');

/**
 * Configure logging levels based on logging.json file.
 */

logjs.configure(__dirname + '/../logging.json');

/**
 * Return a logger for the given name.
 */

var getLogger = exports.getLogger = function(name) {
    return logjs.getLogger(name);
};

/**
 * Return a connect-express logger.
 */

module.exports.getExpressLogger = function() {
    return logjs.connectLogger(getLogger('express'));
};
