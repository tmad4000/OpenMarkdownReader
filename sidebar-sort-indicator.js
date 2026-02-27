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
        label: 'Sort: Recent',
        indicator: 'NEW',
        tooltip: 'Sorted by most recently modified first',
        buttonTitle: 'Sort mode: Recent first (click to switch to Name)'
      };
    }

    return {
      mode: 'name',
      label: 'Sort: Name',
      indicator: 'A-Z',
      tooltip: 'Sorted alphabetically (A to Z)',
      buttonTitle: 'Sort mode: Name (A-Z) (click to switch to Recent first)'
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
