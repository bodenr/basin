
/**
 * Module dependencies.
 */

var db = require('mongoose'),
	utils = require('./utils.js'),
	bus = require('./bus.js'),
	log = require('./log.js').getLogger('store'),
	async = require('async');

/**
 * Mongodb url.
 */

var url = 'mongodb://localhost/r4';

/**
 * Create db connection.
 */

db.connect(url);

/**
 * Log connection created.
 */

db.connection.on('open', function(event) {
    log.info("Connected to " + url);
});

/**
 * Connection failed.
 */

db.connection.on('error', function(event) {
	log.error("Failed to create connection: " + event);
	throw new Error("Database connection failed: " + event);
});

/**
 * Bind schema statics to their respective model instance.
 */

var bindModel = function(schema, model) {
	for (var key in schema.statics) {
		model[key] = model[key].bind(model);
	}
};

/**
 * Decorate the given schema instance with
 * additional methods based on a set of options.
 */

var decorate = function(schema, opts) {
	opts.childKeys = opts.childKeys || [];
	opts.markModified = opts.markModified || [];
	opts.populateKeys = opts.populateKeys || [];

	/**
	 * Get the paths to populate based on a current field path.
	 */

	var _getPopulateKeys = function(curField) {
		if (!curField) {
			return opts.populateKeys;
		}
		var populateKeys = [];
		opts.populateKeys.forEach(function(key) {
			var childKeys = key.split('.');
			for(var i = 0; i < childKeys.length; i++) {
				if (childKeys[i] == curField && (i + 1) < childKeys.length) {
					populateKeys.push(childKeys[i + 1]);
					break;
				}
			}
		});
		return populateKeys;
	};

	/**
	 * Given an existing query, add populate calls to the query
	 * based on the populate keys from the options.
	 */

	var _populateQuery = function(query, curField, conditions) {
		var populateKeys = _getPopulateKeys(curField);
		for (var i = 0; i < populateKeys.length; i++) {
			query = query.populate(populateKeys[i], null, conditions);
		}
		return query;
	};

	/**
	 * Emit a store event onto the app bus.
	 */

	var emitEvent = function(operation, argument, subName) {
		subName = subName ? "." + subName : "";
		bus.emitEvent('store', operation, opts.name + subName, argument);
	};

	/**
	 * Support post creation hooks since mongoose is broken here.
	 * See https://github.com/LearnBoost/mongoose/issues/787
	 */

	var postInit = function(fn) {
		return function(err, resource) {
			if (opts.postInit) {
				return opts.postInit(err, resource, fn);
			}
			fn(err, resource);
		};
	};

	/**
	 * Create a new instance from schema.
	 */

	schema.statics.createNew = function(obj, fn) {
		fn(null, new this(obj));
	};

	/**
	 * Create a new instance based on a plain json object.
	 */

	schema.statics.create = function(obj, fn) {
		var resource = new this();
		for (var key in opts.keyMap) {
			if (opts.keyMap.hasOwnProperty(key)) {
				if (typeof opts.keyMap[key] === 'function') {
					// format value
					resource[key] = opts.keyMap[key](obj[key]);
				} else {
					resource[key] = obj[opts.keyMap[key]];
				}
			}
		}
		resource.save(function(err, resource) {
			if (err) {
				return fn(err);
			}
			emitEvent('create', resource);
			fn(err, resource);
		});
	};

	/**
	 * Update an instance based on a plain json object
	 * containing the delta changes.
	 */

	schema.statics.update = function(obj, fn) {
		this.findById(obj['_id'], function(err, resource) {
			if (err || !resource) {
				return fn(err, resource);
			}
			utils.merge(obj, resource);
			opts.markModified.forEach(function(mark) {
				resource.markModified(mark);
			});
			resource.save(function(err, resource) {
				if (err) {
					return fn(err);
				}
				emitEvent('update', resource);
				fn(err, resource);
			});
		});
	};

	/**
	 * List all resources.
	 */

	schema.statics.list = function(fn) {
		_populateQuery(this.find()).exec(fn);
	};

	/**
	 * Search all instances based on the given key/value.
	 */

	schema.statics.searchByKey = function(key, val, fn) {
		var selector = {};
		selector[key] = val;
		_populateQuery(this.find(selector)).exec(fn);
	};

	/**
	 * Find an instance based on its id.
	 */

	schema.statics.byId = function(id, fn) {
		_populateQuery(this.findById(id)).exec(postInit(fn));
	};

	/**
	 * Remove an instance by id.
	 */

	schema.statics.remove = function(id, fn) {
		this.findById(id, function(err, resource) {
			if (err || !resource) {
				return fn(err, resource);
			}
			resource.remove(function(err) {
				if (err) {
					return fn(err);
				}
				emitEvent('delete', resource);
				fn(null);
			});
		});
	};

	/**
	 * Add child based middleware.
	 */

	if (opts.childKeys.length) {

		/**
		 * Find a sub-resourve by its id.
		 */

		schema.statics.childById = function(thisId, childName, childId, fn) {
			_populateQuery(this.findById(thisId), null, {_id:childId})
			.exec(function(err, resource) {
				if (err || !resource) {
					fn(err, resource);
				}
				fn(null, typeof resource[childName].id == 'function' ?
						resource[childName].id(childId) : resource[childName][0]);
			});
		};

		/**
		 * Delete sub-resource based on id.
		 */

		schema.statics.deleteChildById = function(thisId, childName, childId, fn) {
			_populateQuery(this.findById(thisId)).exec(function(err, resource) {
				if (err || !resource) {
					return fn(err, resource);
				}
				// find and remove child ref
				for (var i = 0; i < resource[childName].length; i++) {
					if (resource[childName][i]._id == childId) {
						var child = resource[childName][i];

						// sub document support
						if (typeof child.remove == 'function') {
							child.remove();

						// reference support
						} else {
							resource[childName].splice(i, i);
						}
						return resource.save(function(err, resource) {
							if (err) {
								fn(err);
							}
							emitEvent('delete', {parent: resource, resource: child}, childName);
							fn(err, resource);
						});
					}
				}
				// child not found
				fn(null, null);
			});
		};

		/**
		 * Handle child deleted from external source.
		 */

		schema.statics.childDeleted = function(childName, childId, fn) {
			this.find({childName: childId}).populate(childName).exec(function(err, resources) {
				if (err || !resources) {
					return fn(err, resources);
				}

				var deleteChild = function(resource, cb) {
					for (var i = 0; i < resource[childName].length; i++) {
						if (resource[childName][i]._id == childId) {
							var child = resource[childName][i];

							// sub doc support
							if (typeof child.remove == 'function') {
								child.remove();

							// reference support
							} else {
								resource[childName].splice(i, i);
							}
							resource.save(function(err) {
								if (err) {
									cb(err);
								}
								emitEvent('delete', {parent: resource, resource: child}, childName);
								cb(null);
							});
						}
					}
				};

				async.forEach(resources, deleteChild, function(err) {
					fn(err);
				});
			});
		};

		/**
		 * Given a resource, find a sub-resouce based on its name and id.
		 */

		var findChildById = function(resource, childName, childId) {
			if (!resource[childName]) {
				return null;
			}

			// sub doc support
			if (typeof resource[childName].id == 'function') {
				return resource[childName].id(childId);
			}

			// reference support
			for (var i = 0; i < resource[childName].length; i++) {
				if (resource[childName][i]._id == childId) {
					return resource[childName][i];
				}
			}
			return null;
		};

		/**
		 * Update sub-resource based on plain json object containing delta.
		 */

		schema.statics.updateChild = function(thisId, childName, childId, childObj, fn) {
			var self = this;

			_populateQuery(self.findById(thisId)).exec(function(err, parent) {
				if (err || !parent) {
					return fn(err || new Error("Resource does not exist: " + thisId));
				}
				var child = findChildById(parent, childName, childId);
				if (!child) {
					return(new Error("Child does not exist on parent."));
				}

				utils.merge(childObj, child);
				opts.markModified.forEach(function(mark) {
					parent.markModified(mark);
				});

				parent.save(function(err, parent) {
					if (err) {
						return fn(err);
					}
					child = findChildById(parent, childName, childId);
					emitEvent('update', {parent: parent, resource: child}, childName);
					fn(err, child);
				});
			});
		};

		/**
		 * Reorder sub-resource based on an array.
		 */

		schema.statics.reorderChildren = function(thisId, childName, childArray, fn) {
			var self = this;
			_populateQuery(self.findById(thisId)).exec(function(err, parent) {
				if (err || !parent) {
					return fn(err || new Error("Resource does not exist: " + thisId));
				}
				if (!parent[childName] || parent[childName].length != childArray.length) {
					return fn(new Error("Invalid input"));
				}
				var reordered = [];
				for (var i = 0; i < childArray.length; i++) {
					var childId = childArray[i]._id || childArray[i],
							managedChild = parent[childName].id(childId);
					if (!managedChild) {
						return fn(new Error("Invalid child id: " + childId));
					}
					reordered.push(managedChild);
					managedChild.remove();
				}
				reordered.forEach(function(child) {
					parent[childName].push(child);
				});
				parent.save(function(err, parent) {
					if (err) {
						return fn(err);
					}
					_populateQuery(self.findById(thisId)).exec(function(err, parent) {
						emitEvent('reorder', {parent:parent, resource:parent[childName]}, childName);
						fn(err, parent);
					});
				});
			});
		};

		/**
		 * Create a new sub-resource based on a plain json object.
		 */

		schema.statics.createChild = function(thisId, childName, childObj, fn) {
			var self = this, createFn = opts['create' + utils.capitaliseFirstLetter(childName)];
			if (!createFn || typeof createFn != 'function') {
				return fn(new Error("No method provided to create child: " + childName));
			}

			async.waterfall([
			    function(cb) {
			    	// lookup parent
			    	_populateQuery(self.findById(thisId)).exec(function(err, resource) {
						if (err || !resource) {
							return cb(err || new Error("Resource does not exist: " + thisId));
						}
						cb(null, resource);
					});
			    }, function(parent, cb) {
			    	// create child
			    	createFn(childObj, function(err, resource) {
			    		if (err || !resource) {
			    			return cb(err || new Error("Could not create: " + childObj), null);
			    		}
			    		cb(null, parent, resource);
			    	});
			    }, function(parent, child, cb) {
			    	// add child to parent and save
			    	parent[childName].push(child);
			    	parent.save(function(err, resource) {
			    		if (err || !resource) {
			    			return cb(err || new Error("Unable to save resource: " + thisId));
			    		}
			    		_populateQuery(self.findById(thisId)).exec(function(err, resource) {
			    			if (err) {
			    				return cb(err);
			    			}
			    			emitEvent('add', {parent: resource, resource:
			    				findChildById(resource, childName, child._id)}, childName);
			    			cb(null, resource);
			    		});
			    	});
			    }

			    ], function(err, result) {
					fn(err, result);
			});
		};

		/**
		 * Add new children based on plain json objects.
		 */

		schema.statics.addChildren = function(thisId, childName, childs, fn) {
			var self = this;
			_populateQuery(this.findById(thisId)).exec(function(err, resource) {
				if (err || !resource) {
					return fn(err, resource);
				}
				resource[childName].push(childs);
				resource.save(function(err, resource) {
					if (err || !resource) {
						return fn(err, resource);
					}
					emitEvent('add', {parent: resource, resource: childs}, childName);
					_populateQuery(self.findById(thisId)).exec(fn);
				});
			});
		};
	}

	/**
	 * Add a list<ChildName> method for each child.
	 */
	opts.childKeys.forEach(function(childKey) {

		schema.statics["list" + utils.capitaliseFirstLetter(childKey)] = function(id, fn) {
			_populateQuery(this.findById(id)).exec(function(err, resource) {
				if (err || !resource) {
					return fn(err, resource);
				}
				fn(null, resource[childKey]);
			});
		};
	});
};


/**
 * Module exports.
 */

module.exports = db;
module.exports.decorate = decorate;
module.exports.bindModel = bindModel;

