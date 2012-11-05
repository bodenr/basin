
/**
 * Module dependencies. 
 */

var respond = require('./respond.js'),
    path = require('path'),
    basename = path.basename,
    fs = require('fs'),
    util = require('util'),
    bus = require('./bus.js'),
    log = require('./log.js').getLogger('middleware'),
    utils = require('./utils.js'),
    configurations = require('./configurations.js'),
    async = require('async');

/**
 * Initialize, validate and construct a user module
 * definition.
 */

var initModule = function(dir, fileName, pkg) {
	var fullPath = 'file://' + dir + path.sep + fileName,
			module = require(dir + path.sep + fileName),
			pkgName = pkg.substr(-1) === '.' ? pkg.substring(0, pkg.length - 1) : pkg,
			shortName = basename(fileName, '.js');

	// user modules must have middleware function to create
	// an instance of the module
	if (!(typeof module.middleware === 'function')) {
		throw new Error(util.format("Can't load %s due to missing middleware() function.", 
				fullPath));
	}
	
	// default version if not specified in module
	if (!module.version) {
		module.__defineGetter__('version', function() {
			return '1.0.0';
		});
	}
	
	// default description if not specified in module
	if (!module.description) {
		module._defineGetter__('description', function() {
			return 'Middleware module ' + fileName;
		});
	}
	module.__defineGetter__('name', function() {
		return shortName;
	});
	module.__defineGetter__('package', function() {
		return pkgName;
	});
	module.__defineGetter__('location', function() {
		return fullPath;
	});
	module.__defineGetter__('canonicalName', function() {
		return pkg + shortName;
	});
	module.configurations = [];
	
	return module;
};

/**
 * Cache a modules JSON representation indexed by
 * its canonical name.
 */

var cacheModule = function(module) {
	var json = utils.toJSON(module, 'middleware');
	if (!cache._all) {
		cache._all = [];
	}
	cache._all.push(json);
	cache[json.canonicalName] = json;
};

/**
 * Cache of concrete middleware objects.
 */

var middleware = {};

/**
 * The number of modules loaded.
 */

var moduleCount = 0;

/**
 * Internal cache of modules JSON representation.
 */

var cache = {};

/**
 * Internal cache of middleware instances for configurations.
 * Indexed by module canonical name / configuration id.
 */

var instanceCache = {};

/**
 * Load all js files as middleware modules from the given directory 
 * and using the given package name used to build the canonical 
 * name of the middleware module.
 */

var loadMiddleware = function(dir, pkg) {
	fs.readdirSync(dir).forEach(function(fileName) {
		if (/\.js$/.test(fileName)) {
			try {	
				var module = initModule(dir, fileName, pkg);
				log.trace("Loaded middleware module: " + module.canonicalName);
				cacheModule(module);
				middleware.__defineGetter__(module.canonicalName, function() {
					return module;
				});
				moduleCount++;
			} catch (err) {
				log.error(err);
			}
		} else if (fs.statSync(dir + path.sep + fileName).isDirectory()) {
			loadMiddleware(dir + path.sep + fileName, path.basename(fileName) + '.');
		}
	});
};

/**
 * Cache a concrete middleware module instance which 
 * is created with the given configurations parameters.
 */

var cacheInstance = function(cfg) {
	if (!instanceCache[cfg.module]) {
		instanceCache[cfg.module] = {};
	}
	instanceCache[cfg.module][cfg._id.toString()] = 
			middleware[cfg.module].middleware(cfg.parameters);
};

/**
 * Remove the cached concrete middleware module instance
 * indexed by the given configuration.
 */

var removeCacheInstance = function(cfg) {
	delete instanceCache[cfg.module][cfg._id.toString()];
};

/**
 * Load all configurations from the store and create/cache middleware
 * instances with them.
 */

var loadConfigurations = function() {
	async.waterfall([
	    function(fn) {
	    	configurations.model.list(function(err, cfgs) {
	    		if (err) {
	    			fn(err, null);
	    		}
	    		cfgs.forEach(function(cfg) {
	    			if (!cache[cfg.module]) {
	    				log.warn(util.format("No middleware module %s for configuration %s." + 
	    						" The module was likely removed.", cfg.module, cfg.name));
	    			} else {
	    				cache[cfg.module].configurations.push(cfg);
	    				cacheInstance(cfg);
	    			}
	    		});
	    		
	    		fn(null, cache);
	    	});
	    }
	], function(err, result) {
		if (err) {
			log.error(err);
		}
	});
};

/**
 * Load middleware on startup using the ./middleware directory
 * as the starting path.
 */

loadMiddleware(__dirname + path.sep + 'middleware', '');

/**
 * Load stored configurations and create/cache them.
 */

loadConfigurations();
log.info(util.format("Loaded %s middleware modules", moduleCount));

/**
 * Handle configuration deleted.
 */

bus.on('store.delete.Configuration', function(cfg) {
	if (cache[cfg.module]) {
		utils.removeFromArray(cfg, cache[cfg.module].configurations, utils.idsEqual);
		removeCacheInstance(cfg);
	}
});

/**
 * Handle configuration created.
 */

bus.on('store.create.Configuration', function(cfg) {
	if (cache[cfg.module]) {
		cache[cfg.module].configurations.push(cfg);
		cacheInstance(cfg);
	}
});

/**
 * Handle configuration updated.
 */

bus.on('store.update.Configuration', function(cfg) {
	if (cache[cfg.module]) {
		var configs = cache[cfg.module].configurations;
		for (var i = 0; i < configs.length; i++) {
			if (utils.idsEqual(configs[i], cfg)) {
				configs.splice(i, 1, cfg);
				cacheInstance(cfg); // TODO only update when params change
				break;
			}
		}
	}
});

/**
 * Find and return the cached module JSON corresponding to the
 * given canonial module name and configuration id.
 */

var findModuleConfiguration = function(moduleName, cfgId) {
	if (!cache[moduleName]) {
		return null;
	}
	var configs = cache[moduleName].configurations;
	for (var i = 0; i < configs.length; i++) {
		if (configs[i]._id.toString() == cfgId) {
			return configs[i];
		}
	}
	return null;
};

/**
 * Build and return web compatiable JSON for the given
 * module name.
 */

exports.moduleToJSON = function(moduleName, req) {
	return {
		'_id' : moduleName,
		'url' : req.getAdminUrl('/middleware/') + moduleName
	};
};

/**
 * Replace toJSON() method of bindings with a web
 * response compatable version.
 */

var wrapToJSON = exports.wrapToJSON = function(modules, req) {
	var moduleArray = utils.asArray(modules),
		formatted = [];
	moduleArray.forEach(function(module) {
		var clone = utils.clonePlainObject(module),
			configs = clone.configurations;
		clone.url = req.getAdminUrl('/middleware/') + module.name;
		clone.configurations = configurations.wrapToJSON(configs, req);
		clone.toJSON = function() {
			return clone;
		};
		formatted.push(clone);
	});
	return modules instanceof Array ? formatted : formatted[0];
};

/**
 * Bind routes.
 */

exports.setup = function(app) {
	app.get(app.buildAdminUri('middleware'), respond.json.list(function(fn) {
		fn(null, cache._all);
	}));

	app.get(app.buildAdminUri('middleware/:canonicalName'),
		respond.json.get(function(id, fn) {
			fn(null, cache[id]);
		}, 'canonicalName'));
	
	app.get(app.buildAdminUri('middleware/:canonicalName/configurations'),
		respond.json.get(function(moduleName, fn) {
			return fn(null, cache[moduleName] ? cache[moduleName].configurations : null);
		}, 'canonicalName'));
	
	app.post(app.buildAdminUri('middleware/:canonicalName/configurations'),
		respond.json.create(function(cfg, fn, canonicalName) {
			if (cfg) {
				cfg.module = canonicalName;
			}
			configurations.model.create(cfg, fn);
		}, 'canonicalName'));

	app.delete(app.buildAdminUri('middleware/:canonicalName/configurations/:configuration'),
		respond.json.deleteChild(function(moduleName, childName, cfgId, fn) {
			// verify cfg exists for given module
			var moduleConfig = findModuleConfiguration(moduleName, cfgId);
			if (!moduleConfig) {
				return fn(null, null);
			}
			// remove from store
			configurations.model.remove(cfgId, fn);
		}, 'canonicalName', 'configurations', 'configuration'));

	app.put(app.buildAdminUri('middleware/:canonicalName/configurations/:configuration'),
		respond.json.updateChild(function(moduleName, childName, cfgId, cfg, fn) {
			// verify cfg exists for given module
			var moduleConfig = findModuleConfiguration(moduleName, cfgId);
			if (!moduleConfig) {
				return fn(null, null);
			}
			if (!cfg) {
				return fn(new Error("Malformed request body"), null);
			}
			if (!moduleName == cfg.module) {
				return fn(new Error("Configuration module does not match module in URI"), null);
			}
			cfg._id = cfgId;
			// update in store
			configurations.model.update(cfg, fn);
		}, 'canonicalName', 'configurations', 'configuration'));

	app.get(app.buildAdminUri('middleware/:canonicalName/configurations/:configuration'),
		respond.json.getChild(function(moduleName, childName, cfgId, fn) {
			return fn(null, findModuleConfiguration(moduleName, cfgId));
		}, 'canonicalName', 'configuration', 'configuration'));
	
	// setup and attach filter to express routes
	var routeMappings = {};
	routeMappings[app.buildAdminUri('middleware')] = wrapToJSON;
	routeMappings[app.buildAdminUri('middleware/:canonicalName')] = wrapToJSON;
	routeMappings[app.buildAdminUri('middleware/:canonicalName/configurations')] = 
			configurations.wrapToJSON;
	routeMappings[app.buildAdminUri('middleware/:canonicalName/configurations/:configuration')] = 
			configurations.wrapToJSON;
	app.decorateRoutes(routeMappings, 'filter');
};

/**
 * Create and return a new instance of a middleware module for 
 * the given configuration.
 */

exports.newInstance = function(config) {
	//console.log("NEW INSTNACE", instanceCache, "\n----\n", config);
	if (!instanceCache[config.module][config._id]) {
		throw new Error(utils.format("Middleware module configuration does not exist: %s", config));
	}
	// return a proxy function so the backing function
	// can change without impact to consumers
	return function(req, res, next) {
		if (!instanceCache[config.module] || !instanceCache[config.module][config._id]) {
			throw new Error(utils.format("Middleware module configuration does not exist: %s", config));
		}
		return instanceCache[config.module][config._id](req, res, next);
	};
};

/**
 * Module exports.
 */

exports.modules = middleware;
