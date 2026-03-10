function createIdGenerator(start = 1) {
  let nextId = Number.isInteger(start) && start > 0 ? start : 1;
  return function makeId(prefix) {
    return `${prefix}_${nextId++}`;
  };
}

module.exports = {
  createIdGenerator,
};

