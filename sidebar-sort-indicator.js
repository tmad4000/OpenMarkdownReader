(function initSidebarSortIndicator(globalScope) {
  'use strict';

  function normalizeSidebarSortMode(mode) {
    return mode === 'date' ? 'date' : 'name';
  }

  function getSidebarSortIndicatorState(mode) {
    const normalizedMode = normalizeSidebarSortMode(mode);

    if (normalizedMode === 'date') {
      return {
        mode: 'date',
        label: 'Sort: Modified',
        indicator: 'NEW',
        tooltip: 'Sorted by most recently modified first',
        buttonTitle: 'Change sort order'
      };
    }

    return {
      mode: 'name',
      label: 'Sort: Name',
      indicator: 'A-Z',
      tooltip: 'Sorted alphabetically (A to Z)',
      buttonTitle: 'Change sort order'
    };
  }

  const api = {
    normalizeSidebarSortMode,
    getSidebarSortIndicatorState
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  globalScope.SidebarSortIndicator = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
