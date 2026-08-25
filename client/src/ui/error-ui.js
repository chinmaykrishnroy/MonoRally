const ISSUE_URL = "https://github.com/chinmaykrishnroy/MonoRally/issues/new";

export function createErrorUi({ config, state }) {
  const overlay = document.getElementById("errorOverlay");
  const message = document.getElementById("errorMessage");
  const details = document.getElementById("errorDetails");
  const report = document.getElementById("reportError");
  const dismiss = document.getElementById("dismissError");
  const copy = document.getElementById("copyError");
  let lastDetails = "";

  const close = () => overlay.classList.add("hidden");
  dismiss.addEventListener("click", close);
  overlay.addEventListener("pointerdown", (event) => {
    if (event.target === overlay) close();
  });
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(lastDetails);
      copy.textContent = "Copied";
      window.setTimeout(() => (copy.textContent = "Copy details"), 1200);
    } catch {
      details.focus();
    }
  });

  function show(error, context = {}) {
    const text = safeMessage(error);
    const errorId = String(context.errorId || makeErrorId()).slice(0, 40);
    const lines = [
      `Error ID: ${errorId}`,
      `Message: ${text}`,
      `Time: ${new Date().toISOString()}`,
      `Version: ${config.appVersion || "unknown"}`,
      `Page: ${location.origin}${location.pathname}`,
      `Mode: ${state.lastNetState?.mode || (state.local ? "practice" : "menu")}`,
      `Connection: ${navigator.onLine ? "online" : "offline"}`,
      `Browser: ${navigator.userAgent.slice(0, 240)}`
    ];
    lastDetails = lines.join("\n");
    message.textContent = `${text} (${errorId})`;
    details.textContent = lastDetails;
    report.href = `${ISSUE_URL}?title=${encodeURIComponent(`[Bug] ${text.slice(0, 80)}`)}&body=${encodeURIComponent(`What happened?\n\n\nDiagnostic details\n\n\`\`\`text\n${lastDetails}\n\`\`\``)}`;
    overlay.classList.remove("hidden");
    dismiss.focus();
  }

  window.addEventListener("error", (event) => show(event.error || event.message || "Unexpected client error"));
  window.addEventListener("unhandledrejection", (event) => show(event.reason || "Unexpected asynchronous error"));

  return { close, show };
}

function safeMessage(error) {
  const raw = error instanceof Error ? error.message : String(error || "Unexpected error");
  return raw.replace(/[\r\n]+/g, " ").slice(0, 300) || "Unexpected error";
}

function makeErrorId() {
  const random = globalThis.crypto?.getRandomValues ? globalThis.crypto.getRandomValues(new Uint32Array(1))[0].toString(36) : Math.random().toString(36).slice(2, 9);
  return `CLIENT-${Date.now().toString(36)}-${random}`.toUpperCase();
}
