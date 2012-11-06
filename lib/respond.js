
/**
 * Module dependencies.
 */

var utils = require('./utils.js'),
    async = require('async'),
    log = require('./log.js').getLogger('respond'),
    path = require('path'),
    methods = require('methods');

/**
 * HTTP response codes.
 */

var codes = exports.codes = {
    OK: 200,
    CREATED: 201,
    BAD_REQUEST: 400,
    NOT_FOUND: 404,
    INTERNAL_ERROR: 500
};

/**
 * Re-export node supported methods under verbs alias.
 */

var verbs = exports.verbs = methods;

/**
 * Format verb string.
 */

module.exports.formatVerb = function(verb) {
    return (verb || "").toLowerCase();
};


/**
 * Normalize error into string.
 */

var normalizeError = function(err) {
    return typeof err === 'object' ? err.toString() : err;
};

var json = exports.json = {
    
    /**
     * Lookup and call route bound filter with the given resource.
     */

    _filter: function(resource, req) {
        return req.route.filter ? req.route.filter(resource, req) : resource;
    },
    
    /**
     * Handle list resources.
     */

    list: function(listFn) {
    
        return function(req, res) {
            
            listFn(function(err, resources) {
                if (err) {
                    log.error(err);
                    return res.send(normalizeError(err), codes.INTERNAL_ERROR);
                }
                resources = json._filter(resources, req);
                log.trace("list", resources);
                return res.json(resources, codes.OK);
            });
        };
    },
    
    /**
     * Handle create resource.
     */

    create: function(createFn, idParam) {
        
        return function(req, res) {
            log.trace("create", req.body);
            createFn(req.body, function(err, resource) {
                if (err) {
                    log.error(err);
                    return res.send(normalizeError(err), codes.BAD_REQUEST);
                }
                resource = json._filter(resource, req);
                log.trace("create", resource);          
                return res.json(resource, codes.CREATED);
            }, (idParam ? req.params[idParam] : null));
        };
    },
    
    /**
     * Handle get resource.
     */

    get: function(getFn, idParam, filterSegment) {
        var idParam = idParam || 'id';
        
        return function(req, res) {
            log.trace("get", idParam);
            getFn(req.params[idParam], function(err, resource) {
                if (err || !resource) {
                    log.error(err);
                    return res.send(codes.NOT_FOUND);
                }
                resource = json._filter(resource, req);
                return res.json(resource, codes.OK);
            });
        };
    },
    
    /**
     * Handle get sub-resource.
     */

    getChild: function(getFn, idParam, childName, childIdParam) {
        var idParam = idParam || 'id',
                childIdParam = childIdParam || 'id';
        
        return function(req, res) {
            log.trace("getChild", idParam, childName, childIdParam);
            getFn(req.params[idParam], childName, req.params[childIdParam], 
                function(err, resource) {
                    if (err || !resource) {
                        log.error(err);
                        return res.send(codes.NOT_FOUND);
                    }
                    resource = json._filter(resource, req);
                    return res.json(resource, codes.OK);
            });
        };
    },
    
    /**
     * Handle update sub-resource.
     */

    updateChild: function(updateFn, idParam, childName, childIdParam) {
        var idParam = idParam || 'id',
                childIdParam = childIdParam || '_id';
        
        return function(req, res) {
            log.trace("updateChild", req.body);
            updateFn(req.params[idParam], childName, req.params[childIdParam], req.body,
                function(err, resource) {
                    if (err || !resource) {
                        log.error(err);
                        return res.send(codes.NOT_FOUND);
                    }
                    resource = json._filter(resource, req);
                    return res.json(resource, codes.OK);
                });
        };
    },
    
    /**
     * Handle reorder sub-resource.
     */

    reorderChildren: function(reorderFn, idParam, childName) {
        var idParam = idParam || 'id';
        
        return function(req, res) {
            log.trace("reorderChildren", req.body);
            reorderFn(req.params[idParam], childName, req.body,
                function(err, resource) {
                    if (err || !resource) {
                        log.error(err);
                        return res.send(codes.BAD_REQUEST, err.message);// TODO better handling
                    }
                    resource = json._filter(resource, req);
                    return res.json(resource, codes.OK);
                });
        };
    },
    
    /**
     * Handle create sub-resource.
     */

    createChild: function(createFn, idParam, childName) {
        var idParam = idParam || 'id';
        
        return function(req, res) {
            log.trace("createChild", req.body);
            createFn(req.params[idParam], childName, req.body, function(err, resource) {
                if (err || !resource) {
                    log.error(err);
                    return res.send(codes.BAD_REQUEST, err.message); // TODO fix this
                }
                resource = json._filter(resource, req);
                return res.json(resource, codes.OK);
            });
        };
    },
    
    /**
     * Handle add sub-resources.
     */

    addChildren: function(getChildFn, idParam, childName, childIdParam, addFn) {
        var idParam = idParam || 'id',
            childIdParam = childIdParam || '_id';
        
        return function(req, res) {
            log.trace("addChildren", req.body);
            var childIds;
            try {
                childIds = utils.extractKeys(req.body, childIdParam);
            } catch (e) {
                return res.send(normalizeError(e), codes.BAD_REQUEST);
            }
            if (!childIds) {
                res.send('Malformed request', codes.BAD_REQUEST);
            }
            
            var findChild = function(item, fn) {
                getChildFn(item, function(err, child) {
                    if (err || !child) {
                        fn(err || new Error("Resource not found: " + item));
                    }
                    fn(null);
                });
            };
            
            async.waterfall([
                // make sure all children exist             
                function(fn) {
                    log.trace("Look-up children: ", childIds);
                    async.forEach(childIds, findChild, function(err) {
                        if (err) {
                            fn(err); // missing child
                        } else {
                            fn(null); // all children found
                        }
                    });
                },
                // add children to parent
                function(fn) {
                    log.trace("Adding children...");
                    addFn(req.params[idParam], childName, childIds, function(err, resource) {
                        if (err || !resource) {
                            fn(err || new Error("Resource not found: " + req.params[idParam]));
                        }
                        fn(null, resource);
                    });
                }
            
            ], function(err, result) {
                if (err) {
                    res.send(err.message, codes.BAD_REQUEST);
                } else {
                    result = json._filter(result, req);
                    res.json(result);
                }
            });
        };
    },
    
    /**
     * Handle delete sub-resource.
     */

    deleteChild: function(deleteFn, idParam, childName, childIdParam) {
        var idParam = idParam || 'id',
                childIdParam = childIdParam || 'id';

        return function(req, res) {
            log.trace("deleteChild", idParam, childName, childIdParam);
            deleteFn(req.params[idParam], childName, req.params[childIdParam], 
                function(err) {
                    if (err) {
                        log.error(err);
                        return res.send(codes.NOT_FOUND);
                    }
                    return res.json("Deleted resource: " + req.params[childIdParam], codes.OK);
            });
        };
    },
    
    /**
     * Handle update resource.
     */
    
    update: function(updateFn, idParam, objIdKey) {
        var idParam = idParam || 'id',
                objIdKey = objIdKey || '_id';
        
        return function(req, res) {
            req.body[objIdKey] = req.params[idParam];
            log.trace("update", req.body);
            updateFn(req.body, function(err, resource) {
                if (err) {
                    log.error(err);
                    return res.send(normalizeError(err), codes.BAD_REQUEST);
                }
                resource = json._filter(resource, req);
                return res.json(resource, codes.OK);
            });
        };
    },
    
    /**
     * Handle delete resource.
     */

    remove: function(deleteFn, idParam) {
        var idParam = idParam || 'id';
    
        return function(req, res) {
            deleteFn(req.params[idParam], function(err) {
                if (err) {
                    log.error(err);
                    return res.send(normalizeError(err), codes.BAD_REQUEST);
                }
                return res.send("Deleted resource: " + req.params[idParam], codes.OK);
            });
        };
    }
};
