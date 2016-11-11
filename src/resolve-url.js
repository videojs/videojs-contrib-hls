/**
 * @file resolve-url.js
 */
import document from 'global/document';

/**
 * Creates an iframe to contain our base and anchor elements for url resolving function
 */
const createResolverElements = () => {
  const iframe = document.createElement('iframe');

  iframe.style.display = 'none';
  iframe.src = 'about:blank';
  document.body.appendChild(iframe);

  const iframeDoc = iframe.contentWindow.document;

  iframeDoc.open();
  iframeDoc.write('<html><head><base></base></head><body><a></a></body></html>');
  iframeDoc.close();

  const base = iframeDoc.querySelector('base');
  const anchor = iframeDoc.querySelector('a');

  document.body.removeChild(iframe);

  return [base, anchor];
};

/**
 * Build a new URI resolver by adding an iframe for resolving and returning a resolving function
 * that can be disposed
 */
const resolveUrlFactory = () => {
  const [base, anchor] = createResolverElements();

  /**
   * Constructs a new URI by interpreting a path relative to another
   * URI.
   *
   * @see http://stackoverflow.com/questions/470832/getting-an-absolute-url-from-a-relative-one-ie6-issue
   * @param {String} basePath a relative or absolute URI
   * @param {String} path a path part to combine with the base
   * @return {String} a URI that is equivalent to composing `base`
   * with `path`
   */
  const resolveUrl = (basePath, path) => {
    if (basePath !== base.href) {
      base.href = basePath;
    }
    anchor.href = path;
    return anchor.href;
  };

  return resolveUrl;
};

export default resolveUrlFactory;
