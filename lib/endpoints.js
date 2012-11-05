
/**
 * Module dependencies.
 */

var store = require('./store.js'),
    Schema = store.Schema,
    respond = require('./respond.js'),
    utils = require('./utils.js'),
    bus = require('./bus.js'),
    bindings = require('./bindings.js'),
    BindingModel = bindings.model,
    BindingSchema = bindings.schema,
    ConfigurationModel = require('./configurations.js').model,
    log = require('./log.js').getLogger('endpoints'),
    util = require('util'),
    application = require('../app.js').app,
    express = require('express'),
    middleware = require('./middleware.js');

/**
 * Define schema structure.
 */

var EndpointSchema = new Schema({
   host: {type: String, required: true, unique: true},
   name: {type: String},
   description: {type: String},
   region: {type: String},
   middleware: [BindingSchema],
   adapters: [BindingSchema]
});

/**
 * Store decoration options.
 */

var opts = {
		keyMap: {
			host: 'host',
			name: 'name',
			region: 'region',
			description: 'description'
		},
		idKey: 'endpoint',
		childKeys: ['middleware', 'adapters'],
		name: 'Endpoint',
		createMiddleware: BindingModel.createNew,
		createAdapters: BindingModel.createNew,
		populateKeys: ['middleware.configuration', 'adapters.configuration'],
		model: EndpointModel
};

/**
 * Decorate schema, create model and bind it.
 */

store.decorate(EndpointSchema, opts);
var EndpointModel = store.model('Endpoint', EndpointSchema);
store.bindModel(EndpointSchema, EndpointModel);

/**
 * Internal cache for endpoint express sub apps
 * indexed by endpoint id.
 */

var subApps = {};

/**
 * Create a new middleware route on the given app
 * by creating an instance of it and binding.
 */

var bindMiddleware = function(mw, app) {
	app[mw.verb.toLowerCase()](mw.path, middleware.newInstance(mw.configuration));
};

/**
 * Iterate through the given endpoint middleware
 * and adapters, attach them to a new express sub
 * app and cache the new sub app by the endpoint's
 * id.
 */

var attachEndpoints = function(endpoint) {
	utils.asArray(endpoint).forEach(function(ep) {
		var epApp = express();
		ep.middleware.forEach(function(mw) {
			bindMiddleware(mw, epApp);
		});
		ep.adapters.forEach(function(adapter) {
			bindMiddleware(adapter, epApp);
		});
		
		// bind sub app to main app creating a virtual
		// uri space under the endpoint id
		application.use("/" + ep._id, epApp);
		log.info(util.format("Attached endpoint '%s' to route %s", ep.name, "/" + ep._id));
		subApps[ep._id] = epApp; 
	});
};

/**
 * Remove the given endpoints sub apps from the 
 * main application stack thereby removing its
 * uri space.
 */

var detachEndpoints = function(endpoint) {
	utils.asArray(endpoint).forEach(function(ep) {
		// remove sub-app from middleware stack
		var removed = utils.removeFromArray(ep, application.stack,
			function(ep, stackItem) {
				return stackItem.route == '/' + ep._id;
			});
		log.trace(util.format("Removed endpoint sub-app %s... %s", 
				ep._id, (removed != null)));
		delete removed;
	});
};

/**
 * Refresh the endpoints sub app by remove it from
 * the main app stack, then recreating it from scratch.
 */

var reattachEndpoint = function(endpoint) {
	detachEndpoints(endpoint);
	attachEndpoints(endpoint);	
};

/**
 * Handle endpoint deleted event.
 */

bus.on('store.delete.Endpoint', function(ep) {
	detachEndpoints(ep);
});

/**
 * Handle endpoint created event.
 */

bus.on('store.create.Endpoint', function(ep) {
	app = express();
	application.use("/" + ep._id, app);
	subApps[ep._id] = app;
});

/**
 * Handle endpoint middleware delete event.
 */

bus.on('store.delete.Endpoint.middleware', function(event) {
	reattachEndpoint(event.parent);
});

/**
 * Handle endpoint adapter deleted event.
 */

bus.on('store.delete.Endpoint.adapters', function(event) {
	reattachEndpoint(event.parent);
});

/**
 * Handle endpoint middleware added event.
 */

bus.on('store.add.Endpoint.middleware', function(event) {
	reattachEndpoint(event.parent);
});

/**
 * Handle endpoint adapter added event.
 */

bus.on('store.add.Endpoint.adapters', function(event) {
	reattachEndpoint(event.parent);
});

/**
 * Handle middleware reordered event.
 */

bus.on('store.reorder.Endpoint.middleware', function(event) {
	reattachEndpoint(event.parent);
});

/**
 * Handle adapters reordered event.
 */

bus.on('store.reorder.Endpoint.adapters', function(event) {
	reattachEndpoint(event.parent);
});

/**
 * Replace toJSON() method of endpoints with a web
 * response compatable version.
 */

var wrapToJSON = exports.wrapToJSON = function(endpoints, req) {
	var endpointArray = utils.asArray(endpoints);
	endpointArray.forEach(function(endpoint) {
		var endpointUrl = req.getAdminUrl('/endpoints/') + endpoint._id;
		bindings.wrapToJSON(endpoint.middleware, req, endpointUrl + "/middleware");
		bindings.wrapToJSON(endpoint.adapters, req, endpointUrl + "/adapters");
		var jsonObj = endpoint.toJSON();
		jsonObj.url = endpointUrl;
		endpoint.toJSON = function() {
			return jsonObj;
		};
	});
	return endpoints instanceof Array ? endpointArray : endpointArray[0];
};

/**
 * Delegate replacement of toJSON() method for endpoint
 * middleware. 
 */

var middlewareToJSON = function(middleware, req) {
	var httpMethod = req.route.method;
	return (httpMethod == 'post' || httpMethod == 'delete' || httpMethod == 'put') ? 
		wrapToJSON(middleware, req) : 
		bindings.wrapToJSON(middleware, req, req.fullUrl);
};

/**
 * Delegate replacement of toJSON() method for endpoint
 * adapters. 
 */

var adaptersToJSON = function(adapters, req) {
	var httpMethod = req.route.method;
	return (httpMethod == 'post' || httpMethod == 'put') ? wrapToJSON(adapters, req) : 
		bindings.wrapToJSON(adapters, req, req.fullUrl);
};

/**
 * Delegate replacement of toJSON() method for endpoint
 * adapter. 
 */

var adapterToJSON = function(adapter, req) {
	return req.route.method == 'delete' ? wrapToJSON(adapter, req) : 
		bindings.wrapToJSON(adapter, req, req.fullUrl);
};
	
/**
 * Bind routes.
 */

var setup = function(app) {
	// save the route mapping functions as we go
	var routeMappings = {};
	
	// bind endpoint related uris
	app.get(app.buildAdminUri('endpoints'), respond.json.list(EndpointModel.list));
	app.post(app.buildAdminUri('endpoints'), respond.json.create(EndpointModel.create));
    app.get(app.buildAdminUri('endpoints/:endpoint'), 
    	respond.json.get(EndpointModel.byId, opts.idKey));
    app.put(app.buildAdminUri('endpoints/:endpoint'), 
    	respond.json.update(EndpointModel.update, opts.idKey));
    app.delete(app.buildAdminUri('endpoints/:endpoint'), 
    	respond.json.remove(EndpointModel.remove, opts.idKey));
    
    routeMappings[app.buildAdminUri('endpoints')] = wrapToJSON;
    routeMappings[app.buildAdminUri('endpoints/:endpoint')] = wrapToJSON;


    // bind endpoint middleware related uris
    app.get(app.buildAdminUri('endpoints/:endpoint/middleware'),
    	respond.json.get(EndpointModel.listMiddleware, opts.idKey, 'middleware'));
	app.put(app.buildAdminUri('endpoints/:endpoint/middleware'),
		respond.json.reorderChildren(EndpointModel.reorderChildren, 'endpoint', 'middleware'));    
	app.get(app.buildAdminUri('endpoints/:endpoint/middleware/:middleware'),
		respond.json.getChild(EndpointModel.childById, opts.idKey, 'middleware', 'middleware'));
	app.delete(app.buildAdminUri('endpoints/:endpoint/middleware/:middleware'),
		respond.json.deleteChild(EndpointModel.deleteChildById, opts.idKey, 'middleware', 'middleware'));	
	app.post(app.buildAdminUri('endpoints/:endpoint/middleware'),
		respond.json.createChild(EndpointModel.createChild, 'endpoint', 'middleware'));
	app.put(app.buildAdminUri('endpoints/:endpoint/middleware/:middleware'),
		respond.json.updateChild(EndpointModel.updateChild, 'endpoint', 'middleware', 'middleware'));

	routeMappings[app.buildAdminUri('endpoints/:endpoint/middleware')] = middlewareToJSON;
	routeMappings[app.buildAdminUri('endpoints/:endpoint/middleware/:middleware')] = middlewareToJSON;
	
	
	// bind endpoint adapter related uris
    app.get(app.buildAdminUri('endpoints/:endpoint/adapters'), 
    	respond.json.get(EndpointModel.listAdapters, opts.idKey));
	app.put(app.buildAdminUri('endpoints/:endpoint/adapters'),
		respond.json.reorderChildren(EndpointModel.reorderChildren, 'endpoint', 'adapters'));
	app.get(app.buildAdminUri('endpoints/:endpoint/adapters/:adapter'),
		respond.json.getChild(EndpointModel.childById, opts.idKey, 'adapters', 'adapter'));
	app.delete(app.buildAdminUri('endpoints/:endpoint/adapters/:adapter'),
		respond.json.deleteChild(EndpointModel.deleteChildById, opts.idKey, 'adapters', 'adapter'));	
	app.post(app.buildAdminUri('endpoints/:endpoint/adapters'),
		respond.json.createChild(EndpointModel.createChild, 'endpoint', 'adapters'));
	app.put(app.buildAdminUri('endpoints/:endpoint/adapters/:adapter'),
			respond.json.updateChild(EndpointModel.updateChild, 'endpoint', 'adapters', 'adapter'));
	
	routeMappings[app.buildAdminUri('endpoints/:endpoint/adapters')] = adaptersToJSON;
	routeMappings[app.buildAdminUri('endpoints/:endpoint/adapters/:adapter')] = adapterToJSON;
	
	// bind the toJSON based functions to their respective route 
	// objects in the express framework
	app.decorateRoutes(routeMappings, 'filter');
};

/**
 * Load and bind saved endpoints on startup to restore
 * eveything we know about.
 */

EndpointModel.list(function(err, endpoints) {
	if (err) {
		// if we cant load endpoints on startup we are screwed
		throw err;
	}
	attachEndpoints(endpoints);
});
	
/**
 * Module exports.
 */

module.exports.model = EndpointModel;
module.exports.schema = EndpointSchema;
module.exports.setup = setup;
