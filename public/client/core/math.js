export function mod(value, by) {
  return ((value % by) + by) % by;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function angleLerp(a, b, t) {
  let delta = b - a;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return a + delta * t;
}

export function normalizeAngle(angle) {
  let a = Number.isFinite(angle) ? angle : 0;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function approach(value, target, amount) {
  if (value < target) {
    return Math.min(target, value + amount);
  }
  if (value > target) {
    return Math.max(target, value - amount);
  }
  return value;
}

export function hash2D(x, y) {
  let n = x * 374761393 + y * 668265263;
  n = (n ^ (n >> 13)) * 1274126177;
  n ^= n >> 16;
  return (n >>> 0) / 4294967295;
}

export function createWorldMath(world) {
  function wrapDelta(value, size) {
    if (value > size * 0.5) return value - size;
    if (value < -size * 0.5) return value + size;
    return value;
  }

  function wrapCoord(value, size) {
    if (!Number.isFinite(value)) return 0;
    return mod(value, size);
  }

  function wrapWorldX(value) {
    return wrapCoord(value, world.width);
  }

  function wrapWorldY(value) {
    return wrapCoord(value, world.height);
  }

  function wrappedLerp(from, to, t, size) {
    return wrapCoord(from + wrapDelta(to - from, size) * t, size);
  }

  return {
    wrapDelta,
    wrapCoord,
    wrapWorldX,
    wrapWorldY,
    wrappedLerp,
  };
}
