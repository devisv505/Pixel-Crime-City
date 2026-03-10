function mod(value, by) {
  return ((value % by) + by) % by;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function createWorldMath(world) {
  function wrapCoord(value, size) {
    if (!Number.isFinite(value)) return 0;
    return mod(value, size);
  }

  function wrapWorldX(x) {
    return wrapCoord(x, world.width);
  }

  function wrapWorldY(y) {
    return wrapCoord(y, world.height);
  }

  function wrapWorldPosition(entity) {
    entity.x = wrapWorldX(entity.x);
    entity.y = wrapWorldY(entity.y);
  }

  function wrapDelta(delta, size) {
    return mod(delta + size * 0.5, size) - size * 0.5;
  }

  function wrappedLerp(from, to, t, size) {
    return wrapCoord(from + wrapDelta(to - from, size) * t, size);
  }

  function wrappedDistanceSq(x1, y1, x2, y2) {
    const dx = wrapDelta(x2 - x1, world.width);
    const dy = wrapDelta(y2 - y1, world.height);
    return dx * dx + dy * dy;
  }

  function wrappedVector(x1, y1, x2, y2) {
    const dx = wrapDelta(x2 - x1, world.width);
    const dy = wrapDelta(y2 - y1, world.height);
    return {
      dx,
      dy,
      distSq: dx * dx + dy * dy,
      dist: Math.hypot(dx, dy),
    };
  }

  function wrappedDirection(fromX, fromY, toX, toY) {
    const v = wrappedVector(fromX, fromY, toX, toY);
    return Math.atan2(v.dy, v.dx);
  }

  return {
    wrapCoord,
    wrapWorldX,
    wrapWorldY,
    wrapWorldPosition,
    wrapDelta,
    wrappedLerp,
    wrappedDistanceSq,
    wrappedVector,
    wrappedDirection,
  };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function approach(value, target, amount) {
  if (value < target) {
    return Math.min(value + amount, target);
  }
  return Math.max(value - amount, target);
}

function angleWrap(value) {
  let v = value;
  while (v > Math.PI) v -= Math.PI * 2;
  while (v < -Math.PI) v += Math.PI * 2;
  return v;
}

function angleApproach(current, target, maxStep) {
  const delta = angleWrap(target - current);
  if (Math.abs(delta) <= maxStep) {
    return target;
  }
  return current + Math.sign(delta) * maxStep;
}

function snapToRightAngle(angle) {
  const quarter = Math.PI / 2;
  return Math.round(angle / quarter) * quarter;
}

function randRange(min, max) {
  return Math.random() * (max - min) + min;
}

function randInt(min, maxExclusive) {
  return Math.floor(randRange(min, maxExclusive));
}

function hash2D(x, y) {
  let n = x * 374761393 + y * 668265263;
  n = (n ^ (n >> 13)) * 1274126177;
  n ^= n >> 16;
  return (n >>> 0) / 4294967295;
}

function quantized(value, precision = 100) {
  return Math.round(value * precision) / precision;
}

function pushMetricSample(buffer, value, max = 240) {
  if (!Number.isFinite(value)) return;
  buffer.push(value);
  if (buffer.length > max) {
    buffer.splice(0, buffer.length - max);
  }
}

function percentile(values, p) {
  if (!values || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p)));
  return sorted[idx];
}

function idPhase(id) {
  if (!id) return 0;
  let h = 0;
  const s = String(id);
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

module.exports = {
  mod,
  clamp,
  createWorldMath,
  lerp,
  approach,
  angleWrap,
  angleApproach,
  snapToRightAngle,
  randRange,
  randInt,
  hash2D,
  quantized,
  pushMetricSample,
  percentile,
  idPhase,
};
