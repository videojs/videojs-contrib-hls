/**
 * @file resolve-url.js
 */

import URLToolkit from 'url-toolkit';
import window from 'global/window';

const resolveUrl = function(baseURL, relativeURL) {
  // return early if we don't need to resolve
  if ((/^[a-z]+:/i).test(relativeURL)) {
    return relativeURL;
  }

  // if the base URL is relative then combine with the current location
  if (!(/\/\//i).test(baseURL)) {
    baseURL = URLToolkit.buildAbsoluteURL(window.location.href, baseURL);
  }

  return URLToolkit.buildAbsoluteURL(baseURL, relativeURL);
};

export default resolveUrl;
