function createEventsFeature(state) {
  if (!state || typeof state !== 'object') {
    throw new Error('events feature requires a mutable state object');
  }
  if (!Array.isArray(state.pending)) {
    state.pending = [];
  }
  if (!Number.isInteger(state.nextEventId) || state.nextEventId < 1) {
    state.nextEventId = 1;
  }

  function emitEvent(type, payload) {
    state.pending.push({
      id: state.nextEventId++,
      type,
      at: Date.now(),
      ...payload,
    });
  }

  function drainPendingEvents() {
    const events = state.pending;
    state.pending = [];
    return events;
  }

  function clearPendingEvents() {
    state.pending = [];
  }

  return {
    emitEvent,
    drainPendingEvents,
    clearPendingEvents,
  };
}

module.exports = {
  createEventsFeature,
};

