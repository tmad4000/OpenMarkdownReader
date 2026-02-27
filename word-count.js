(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.WordCountUtils = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  function countWords(text) {
    if (typeof text !== 'string' || text.length === 0) {
      return 0;
    }

    const matches = text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu);
    return matches ? matches.length : 0;
  }

  return { countWords };
});
