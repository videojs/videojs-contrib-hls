import document from 'global/document';
/* eslint-disable max-len */
/**
 * Constructs a new URI by interpreting a path relative to another
 * URI.
 * @param basePath {string} a relative or absolute URI
 * @param path {string} a path part to combine with the base
 * @return {string} a URI that is equivalent to composing `base`
 * with `path`
 * @see http://stackoverflow.com/questions/470832/getting-an-absolute-url-from-a-relative-one-ie6-issue
 */
/* eslint-enable max-len */
const resolveUrl = function(basePath, path) {
  // use the base element to get the browser to handle URI resolution
  let oldBase = document.querySelector('base');
  let docHead = document.querySelector('head');
  let a = document.createElement('a');
  let base = oldBase;
  let oldHref;
  let result;

  // prep the document
  if (oldBase) {
    oldHref = oldBase.href;
  } else {
    base = docHead.appendChild(document.createElement('base'));
  }

  base.href = basePath;
  a.href = path;
  result = a.href;

  // clean up
  if (oldBase) {
    oldBase.href = oldHref;
  } else {
    docHead.removeChild(base);
  }
  return result;
};

export default resolveUrl;
