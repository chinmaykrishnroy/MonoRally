import { RESUME_KEY, SESSION_KEY } from "../core/shared.js";

export function sessionId() {
  const existing = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_KEY}=`))
    ?.split("=")[1];
  if (existing) return existing;

  const generated = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  document.cookie = `${SESSION_KEY}=${generated}; max-age=2592000; path=/; SameSite=Lax`;
  return generated;
}

export function saveResumeRoom(code) {
  localStorage.setItem(RESUME_KEY, JSON.stringify({ code, at: Date.now() }));
}

export function clearResumeRoom() {
  localStorage.removeItem(RESUME_KEY);
}

export function readResumeRoom(maxAgeMs = 10 * 60 * 1000) {
  try {
    const saved = JSON.parse(localStorage.getItem(RESUME_KEY) || "{}");
    if (!saved.code || Date.now() - Number(saved.at || 0) > maxAgeMs) return "";
    return saved.code;
  } catch {
    clearResumeRoom();
    return "";
  }
}
