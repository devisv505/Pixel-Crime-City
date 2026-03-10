function envFlag(name, defaultValue) {
  const raw = process.env[name];
  if (raw == null) return defaultValue;
  const value = String(raw).trim().toLowerCase();
  if (!value) return defaultValue;
  return !(value === '0' || value === 'false' || value === 'off' || value === 'no');
}

module.exports = {
  envFlag,
};
