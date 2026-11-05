/* Demand needs network/city inputs, not checkpoint histories or operating ledgers. */
(function(root) {
  'use strict';

  function capture(state) {
    const {
      ridership,
      economy,
      operationsReview,
      log,
      ...inputs
    } = state;
    return {
      ...inputs,
      economy: economy ? {
        minute: economy.minute
      } : undefined,
      ridership: ridership ? {
        version: ridership.version,
        model: ridership.model,
        lines: ridership.lines
      } : undefined
    };
  }
  const api = {
    capture
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RailDemandSnapshot = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
