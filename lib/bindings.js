
/**
 * Module dependencies.
 */

var respond = require('./respond.js'),
    store = require('./store.js'),
    Schema = store.Schema,
    ConfigurationModel = require('./configurations.js').model,
    configurations = require('./configurations.js'),
    log = require('./log.js').getLogger('bindings'),
    async = require('async'),
    middleware = require('./middleware.js'),
    path = require('path'),
    utils = require('./utils.js');

/**
 * Copy express supported verbs and push the special
 * 'all' verb on it.
 */

var validVerbs = respond.verbs.slice(0);
validVerbs.push('all', 'ALL'); // TODO remove ALL


/**
 * Define schema structure.
 */

var BindingsSchema = new Schema({
    verb: {type: String, required: true, enum: validVerbs},
    path: {type: String, required: true},
    configuration: {type: Schema.Types.ObjectId, ref: 'Configuration', required: true}
});

/**
 * Store decoration options.
 */

var opts = {
        keyMap: {
            verb: respond.formatVerb,
            path: function(key) {
                return key || "/";
            }
        },
        childKeys: ['configuration'],
        populateKeys: ['configuration'],
        name: 'Bindings'
};

/**
 * Decorate schema, create model and bind it.
 */

store.decorate(BindingsSchema, opts);
var BindingsModel = store.model('Bindings', BindingsSchema);
store.bindModel(BindingsSchema, BindingsModel);

/**
 * Replace toJSON() method of bindings with a web
 * response compatable version.
 */

exports.wrapToJSON = function(bindings, req, contextUrl) {
    var bindingArray = utils.asArray(bindings);
    bindingArray.forEach(function(binding) {
        configurations.wrapToJSON(binding.configuration, req);
        var jsonObj = binding.toJSON();
        jsonObj.url = path.basename(contextUrl) == jsonObj._id ? contextUrl : 
            contextUrl + (contextUrl.endsWith('/') ? '' : '/') + jsonObj._id;
        binding.toJSON = function() {
            return jsonObj;
        };
    });
    return bindings instanceof Array ? bindingArray : bindingArray[0];
};

/**
 * Module exports.
 */

module.exports.model = BindingsModel;
module.exports.schema = BindingsSchema;
