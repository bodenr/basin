
/**
 * Module dependencies.
 */

var util = require('util')
	, http = require('http');

// error constructors indexed by code

var codes = {};

// error constructors indexed by name

var names = {};

/**
 * Cache the given error constructor for the given
 * name and code.
 *
 * @param name {String} name
 * @param code {Number} code
 * @param err {Function} err
 * @api private
 */

function cache(name, code, err) {
	names[name] = err;
	codes[code] = err;
};

// next free error code

var freeCode = 600;

/**
 * Returns the next free error code.
 *
 * @returns {Number}
 * @api private
 */

function nextCode() {
	while(codes[freeCode]) {
		freeCode += 1;
	}
	return freeCode;
};

/**
 * Returns the error constructor by the given code or
 * name.
 *
 * @param {String|Number} err
 * @returns {Function}
 * @api public
 */

exports.find = function(err) {
	return (typeof err == 'number') ? codes[err] : names[err];
};

/**
 * Create a new `Error` with the given `name`,
 * and error `code`. Optionally inherit the
 * new error from the given `parent` and bind it
 * to the given `scope` permitting errors to be
 * created in different name spaces.
 *
 * If not specified, `parent` defaults to `Error`
 * and `scope` defaults to this modules `exports`.
 *
 * @param {String} name
 * @param {Number} code
 * @param {Object} parent
 * @param {Object} scope
 * @param {String} defaultMessage
 * @return {Function} the newly created error
 * @api public
 */

var create = exports.create = function(options) {
	var options = options || {}
		, scope = options.scope || exports
		, parent = options.parent || Error
		, defaultMessage = options.defaultMessage || 'Unexpected ' + options.name + ' error.'
		, name = options.name
		, code = options.code || nextCode();

	scope[name] = function(msg) {
		msg = msg || defaultMessage;
		parent.call(this, msg);

		this.__defineGetter__('code', function() {
			return code;
		});

		// normalize for http status codes and connect compat
		this.__defineGetter__('status', function() {
			return http.STATUS_CODES[code] ? code : 500;
		});

		this.__defineGetter__('name', function() {
			return name;
		});

		this.__defineGetter__('message', function() {
			return msg;
		});
	};

	util.inherits(scope[name], parent);

	scope[name].prototype.toString = function() {
		return util.format("%s: %s\nCode: %s", this.name, this.message, this.code);
	};

	scope[name].prototype.toJSON = function() {
		return {
			code: this.code,
			name: this.name,
			message: this.message,
			status: this.status
		};
	};

	cache(name, code, scope[name]);

	return scope[name];
};

// base http error

create({
	name: 'HttpError',
	code: 1000
});

/**
 * Create `HttpError`s for all 4xx-5xx HTTP status codes
 * as `Http[code]Error`.
 */

for (code in http.STATUS_CODES) {
	if (http.STATUS_CODES.hasOwnProperty(code) && code >= 400) {
		create({
			name: 'Http' + code + 'Error',
			code: code,
			parent: exports.HttpError,
			defaultMessage: http.STATUS_CODES[code]
		});
	}
}

var response;

try {
	response = require('express').response;
} catch (e) {
	// assume express not installed
}

if (response) {
	response._send = response.send;
	response.send = function(err) {
		if (arguments.length == 1
				&& err instanceof Error && err.hasOwnProperty('status')) {
			if (this.req.accepts(['html', 'text', 'json'])) {
				this.set('Content-Type', this.req.get('Accept'));
				return this._send(err.status,
						this.req.accepts('json') ? err : err.message);
			} else {
				return this._send(406, http.STATUS_CODES[406]);
			}
		}
		return this._send.apply(this, arguments);
	};
}

