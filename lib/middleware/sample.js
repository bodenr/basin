
exports.description = 'Sample middleware module';
exports.version = '1.0';
exports.configurationSchema = {
    properties: {
        echo: {
            type: "string",
            required: true,
            description: "The string to echo"
        },
        repeat: {
            type: "number",
            minimum: 1,
            required: true
        }
    }
};


exports.middleware = function(options) {
    
    return function(req, res, next) {
        var str = "";
        for (var i = 0; i < options.repeat; i++) {
            str += options.echo;
        }
        res.send(str);
        //res.write(str);
        //next();
    };
};
