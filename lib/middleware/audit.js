
exports.description = 'Audit logging middleware';
exports.version = '1.0';
exports.configurationSchema = {
	properties: {
		echo: {
			type: "string",
			required: true,
			description: "The log level to use"
		}
	}
};


exports.middleware = function(options) {
	
	return function(req, res, next) {
		console.log("[audit] " + options.echo + " > " + req.body);
		next();
	};
};
