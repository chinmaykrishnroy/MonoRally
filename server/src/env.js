export function envNumber(name, fallback, min = -Infinity, max = Infinity) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

export function envText(name, fallback, allowed) {
  const value = String(process.env[name] || fallback).toLowerCase().trim();
  return allowed.includes(value) ? value : fallback;
}

export function envBoolean(name, fallback = false) {
  const value = String(process.env[name] ?? "").toLowerCase().trim();
  if (!value) return fallback;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return fallback;
}
