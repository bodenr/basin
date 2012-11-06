
/**
 * Module dependencies.
 */

var express = require('express'),
    http = require('http'),
    path = require('path'),
    log = require('./lib/log.js').getLogger('app'),
    util = require('util'),
    stylus = require('stylus'),
    nib = require('nib'),
    verbs = require('./lib/respond.js').verbs;   

/**
 * Create and expose express app.
 */

var app = exports.app = express();

/**
 * Extend IncomingMessage to provide base url which
 * consists of protocol, subdomain, domain, top-level
 * domain and port.
 */

http.IncomingMessage.prototype.__defineGetter__('baseUrl', function() {
    if (this.hostUrl) {
        return this.hostUrl;
    }
    // cache it so its only built once per request
    this.hostUrl = util.format("%s://%s:%s", this.protocol, this.host, app.get('port'));
    return this.hostUrl;
});

/**
 * Extend IncomingMessage to expose admin uri.
 */

http.IncomingMessage.prototype.getAdminUrl = function(path) {
    return this.baseUrl + (("/admin/" + path).replace(/\/\//g,'/'));
};

/**
 * Extend IncomingMessage to expose full url of request.
 */

http.IncomingMessage.prototype.__defineGetter__('fullUrl', function() {
    if (this.qualifiedUrl) {
        return this.qualifiedUrl;
    }
    // cache so we only build once per request
    this.qualifiedUrl = util.format("%s%s", this.baseUrl, this.url);
    return this.qualifiedUrl;
});

/**
 * Extend String to provide endsWith method.
 */

String.prototype.endsWith = function(suffix) {
    return this.indexOf(suffix, this.length - suffix.length) !== -1;
};

/**
 * Expose method on express to build our admin urls.
 */

app.buildAdminUri = function(path) {
    return ("/admin/" + path).replace(/\/\//g,'/');
};

/**
 * Map key/value pairs onto express routes
 * with the given name.
 */

app.decorateRoutes = function(mappings, name) {
    verbs.forEach(function(verb) {
        var routes = app.routes[verb.toLowerCase()] || [];
        routes.forEach(function(route) {
            if (mappings[route.path]) {
                route[name] = mappings[route.path];
            }
        });
    });
};

var compile = function(str, path) {
    return stylus(str)
            .set('filename', path)
            .set('compress', false)
            .use(nib()).import('nib');
};

/**
 * Configure express app middleware. 
 */

app.configure(function() {    
    // log4js logging support
    app.use(require('./lib/log.js').getExpressLogger());
    app.set('port', process.env.PORT || 3000);
    app.set('views', __dirname + '/views');
    app.set('view engine', 'jade');
    app.engine('jade', require('jade').__express);
    app.use(express.favicon());
    app.use(express.bodyParser());
    app.use(express.methodOverride());
    app.use(app.router);
    
    var publicDir = path.join(__dirname, 'public');
    
    app.use(stylus.middleware({
        src: publicDir,
        compile: compile
    }));
    app.use(express.static(publicDir));
});

app.configure('development', function() {
    app.use(express.errorHandler());
});


app.get('/index', function(req, res) {
    res.render('index', {title: 'Sample Title'}, function(err, html) {
        res.send(html);
    });
});
    
/**
 * Initialize top level resources.
 */

require('./lib/endpoints.js').setup(app);
require('./lib/middleware.js').setup(app);
require('./lib/configurations.js').setup(app);

/**
 * Create and start the server.
 */

http.createServer(app).listen(app.get('port'), function() {
    log.info("Express server listening on port " + app.get('port'));
});

