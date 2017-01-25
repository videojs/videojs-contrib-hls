/**
 * @file key.js
 *
 * 
 * Store the unique key for the video data;
 * @type {Object}
 * @private
 */

let keyObject = {};

/**
 * Test if wo have stored the key
 *
 * @param  {String}  The uri of the key which we need to load;
 * @return {Boolean} do we have stored the key which we want to load;
 * @function getStoredKey
 */
export function getStoredKey(uri) {
    if (keyObject[uri]) {
        return keyObject[uri];
    }
    return false;
}

/**
 * Store the key and uri
 * @param {String} uri The uri of the key
 * @param {Unit32Array} key The data of key in Uint32Array Typed Array
 */
export function setStoredKey(uri, key) {
    keyObject[uri] = key;
}
