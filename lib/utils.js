
/**
 * Module dependencies.
 */

var _util = require('util');

/**
 * Capitalise the first letter of the given string.
 */

exports.capitaliseFirstLetter = function(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
};

/**
 * Clone a plain json object.
 */

exports.clonePlainObject = function(obj) {
    if (!obj) {
        return obj;
    }
    return JSON.parse(JSON.stringify(obj));
};

/**
 * Return object in json format.
 */

exports.objectToJSON = function(obj) {
    return typeof obj.toJSON == 'function' ? obj.toJSON() : obj;
};

/**
 * Return the argument as an array.
 */

exports.asArray = function(resources) {
    return resources instanceof Array ? resources : [resources];
};

/**
 * Extract keys from a json object.
 */

exports.extractKeys = function(json, key) {
    var keys = [];
    if (!(json instanceof Array)) {
        json = [json];
    }
    json.forEach(function(elem) {
        if (elem[key] !== null && elem[key] !== undefined) {
            keys.push(elem[key]);
        } else {
            throw new Error(_util.format("Missing %s in %s", key, elem));
        }
    });
    return keys.length ? keys : null;
};

/**
 * Create a json object from the given plain object
 * optionally skipped one or more keys.
 */

exports.toJSON = function(obj, keysToSkip) {
    var json = {}, keysToSkip = keysToSkip || [];
    for (var key in obj) {
        if (obj.hasOwnProperty(key) && keysToSkip.indexOf(key) === -1) {
            json[key] = obj[key];
        }
    }
    return json;
};

/**
 * Determine if tow object are equal based on their
 * _id property.
 */

var idsEqual = exports.idsEqual = function(a, b) {
    if (!(a && b) || !(a._id && b._id)) {
        return false;
    }
    return a._id.toString() == b._id.toString();
};

/**
 * Find a given item in an array based on _id equivelance.
 */

var findById = exports.findById = function(arr, item) {
    for (var i = 0; i < arr.length; i++) {
        if (idsEqual(arr[i], item)) {
            return arr[i];
        }
    }
    return null;
};

/**
 * Determine if two objects are equal base on the == operator.
 */

var almostEqual = exports.almostEqual = function(a, b) {
    return a == b;
};

/**
 * Remove an item from an array given an optional
 * match function.
 */

exports.removeFromArray = function(item, array, isMatchFn) {
    isMatchFn = isMatchFn || almostEqual;
    for (var i = 0; i < array.length; i++) {
        if (isMatchFn(item, array[i])) {
            return array.splice(i, 1);
        }
    }
    return null;
};

/**
 * Determine if an object is a plain js object.
 */

var isPlainObject = exports.isPlainObject = function(obj) {
    return typeof obj == 'object' && obj.constructor == Object;
};

/**
 * Merge source object into dest.
 */

var merge = exports.merge = function(src, dest) {
    dest = dest || {}, src = src || {};
    Object.keys(src).forEach(function(key) {
        if (isPlainObject(src[key]) && isPlainObject(dest[key])) {
            merge(src[key], dest[key]);
        } else {
            dest[key] = src[key];
        }
    });
    return dest;
};

