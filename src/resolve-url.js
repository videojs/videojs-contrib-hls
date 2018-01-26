/**
 * @file resolve-url.js
 */

import URLToolkit from 'url-toolkit';
import window from 'global/window';

const resolveUrl = function(baseURL, relativeURL) {
  return URLToolkit.buildAbsoluteURL(
    URLToolkit.buildAbsoluteURL(window.location.href, baseURL), relativeURL
  );
};

export default resolveUrl;
