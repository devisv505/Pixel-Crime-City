function createAccumulator(initial = 0) {
  let value = Number(initial) || 0;
  return {
    get() {
      return value;
    },
    add(delta) {
      value += Number(delta) || 0;
      return value;
    },
    set(next) {
      value = Number(next) || 0;
      return value;
    },
  };
}

module.exports = {
  createAccumulator,
};

