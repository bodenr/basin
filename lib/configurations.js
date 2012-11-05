
/**
 * Module dependencies.
 */

var store = require('./store.js'),
    Schema = store.Schema,
    log = require('./log.js').getLogger('configurations'),
    respond = require('./respond.js'),
    middleware = require('./middleware.js'),
    schemaValidator = require('json-schema'),
    util = require('util'),
    utils = require('./utils.js');

/**
 * Define schema structure.
 */

var ConfigurationSchema = new Schema({
	module: {type: String, required: true},
	name: {type: String, required: true},
	parameters: {type: Schema.Types.Mixed},
	description: {type: String}
});

/**
 * Store decoration options.
 */

var opts = {
		keyMap: {
			name: 'name',
			module: 'module',
			parameters: 'parameters',
			description: 'description'
		},
		idKey: 'configuration',
		name: 'Configuration',
		markModified: ['parameters']
};

/**
 * Decorate schema, create model and bind it.
 */

store.decorate(ConfigurationSchema, opts);
var ConfigurationModel = store.model('Configuration', ConfigurationSchema);
store.bindModel(ConfigurationSchema, ConfigurationModel);

/**
 * Hook into pre save to validate configuration based on JSON
 * schema of middleware module.
 */

ConfigurationSchema.pre('save', function(next) {
	var middlewareModule = middleware.modules[this.module], results;
	if (!middlewareModule) {
		next(new Error("Middleware module does not exist: " + this.module));
	}
	// validate against JSON schema
	results = schemaValidator.validate(this.parameters, middlewareModule.configurationSchema);
	if (!results.valid) {
		log.error(results.errors);
		next(new Error("Invalid configuration: " + util.inspect(results.errors, true, null)));
	}
	next();
});

/**
 * Replace toJSON() method of bindings with a web
 * response compatable version.
 */

var wrapToJSON = exports.wrapToJSON = function(configurations, req) {
	var configurationArray = utils.asArray(configurations);
	configurationArray.forEach(function(configuration) {
		var jsonObj = utils.objectToJSON(configuration),
				moduleName = configuration.module;
		jsonObj.url = req.getAdminUrl('/configurations/') + configuration._id;
		jsonObj.module = middleware.moduleToJSON(moduleName, req);
		configuration.toJSON = function() {
			return jsonObj;
		};
	});
	return configurations instanceof Array ? configurationArray : configurationArray[0];
};

/**
 * Bind routes.
 */

var setup = function(app) {
	app.get(app.buildAdminUri('configurations'), respond.json.list(ConfigurationModel.list));
	app.post(app.buildAdminUri('configurations'), respond.json.create(ConfigurationModel.create));
	app.get(app.buildAdminUri('configurations/:configuration'), 
			respond.json.get(ConfigurationModel.byId, opts.idKey));
	app.put(app.buildAdminUri('configurations/:configuration'), 
			respond.json.update(ConfigurationModel.update, opts.idKey));
	app.delete(app.buildAdminUri('configurations/:configuration'), 
			respond.json.remove(ConfigurationModel.remove, opts.idKey));
	
	// setup and attach filter to express routes
	var routeMappings = {};
	routeMappings[app.buildAdminUri('configurations')] = wrapToJSON;
	routeMappings[app.buildAdminUri('configurations/:configuration')] = wrapToJSON;
	app.decorateRoutes(routeMappings, 'filter');
};


/**
 * Module exports.
 */

module.exports.model = ConfigurationModel;
module.exports.schema = ConfigurationSchema;
module.exports.setup = setup;

