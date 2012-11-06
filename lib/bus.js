
/**
 * Module dependencies.
 */

var EventEmitter = require('events').EventEmitter,
    emitter = new EventEmitter,
    log = require('./log.js').getLogger('bus'); 

/**
 * Expose emit event method on EventEmitter to provide
 * well formed event names.
 */

emitter.emitEvent = function(component, operation, identifer, argument) {
    log.trace("emit", [component, operation, identifer].join('.'), argument);
    emitter.emit([component, operation, identifer].join('.'), argument);
};

/**
 * Expose the emitter.
 */

module.exports = emitter;
