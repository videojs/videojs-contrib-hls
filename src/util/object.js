/*
 * @file object.js - Utilities for javascript objects
 * /

/**
 * determine if an object a is different from
 * and object b. both only having one dimensional
 * properties
 *
 * @param {Object} a object one
 * @param {Object} b object two
 * @return {Boolean} if the object has changed or not
 */
export const objectChanged = function(a, b) {
  if (typeof a !== typeof b) {
    return true;
  }
  // if we have a different number of elements
  // something has changed
  if (Object.keys(a).length !== Object.keys(b).length) {
    return true;
  }

  for (let prop in a) {
    if (a[prop] !== b[prop]) {
      return true;
    }
  }
  return false;
};
