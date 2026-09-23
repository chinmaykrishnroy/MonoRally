/**
 * MonoRally Share Modal Controller
 * Displays the high-resolution match result card preview with one-click export actions.
 */

import {
  copyCardImageToClipboard,
  downloadCardImage,
  shareResultCard
} from "./result-card.js";

export function createShareModalController({
  modalEl,
  previewImg,
  copyBtn,
  downloadBtn,
  shareNativeBtn,
  closeBtn,
  toastEl
}) {
  let activeCanvas = null;
  let activeData = null;

  function showToast(message, durationMs = 2500) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.remove("hidden");
    toastEl.classList.add("visible");
    clearTimeout(toastEl._timer);
    toastEl._timer = setTimeout(() => {
      toastEl.classList.remove("visible");
      setTimeout(() => toastEl.classList.add("hidden"), 300);
    }, durationMs);
  }

  function open(canvas, matchData) {
    activeCanvas = canvas;
    activeData = matchData;
    if (previewImg && canvas) {
      previewImg.src = canvas.toDataURL("image/png");
    }
    if (modalEl) {
      modalEl.classList.remove("hidden");
    }
  }

  function close() {
    if (modalEl) {
      modalEl.classList.add("hidden");
    }
  }

  async function handleCopy() {
    if (!activeCanvas) return;
    try {
      if (copyBtn) copyBtn.disabled = true;
      await copyCardImageToClipboard(activeCanvas);
      showToast("Card image copied to clipboard!");
    } catch {
      // Fallback: download if clipboard image copy not supported in browser
      try {
        downloadCardImage(activeCanvas, `monorally-match-${Date.now()}.png`);
        showToast("Downloaded card image!");
      } catch (err2) {
        showToast(`Could not copy: ${err2.message}`);
      }
    } finally {
      if (copyBtn) copyBtn.disabled = false;
    }
  }

  function handleDownload() {
    if (!activeCanvas) return;
    try {
      const mode = activeData?.mode || "match";
      const filename = `monorally-${mode}-${Date.now()}.png`;
      downloadCardImage(activeCanvas, filename);
      showToast("Downloaded match card!");
    } catch (err) {
      showToast(`Download failed: ${err.message}`);
    }
  }

  async function handleShare() {
    if (!activeCanvas) return;
    try {
      const title = `MonoRally ${activeData?.mode || "1v1"} - ${activeData?.outcome || "Match Result"}`;
      const outcomeText = activeData?.outcome || "Played";
      const duration = activeData?.duration || "1m";
      const speed = activeData?.stats?.peakSpeed ? ` Peak speed ${activeData.stats.peakSpeed} px/s.` : "";
      const text = `${outcomeText} a ${activeData?.mode || "1v1"} rally in ${duration}.${speed}`;
      const res = await shareResultCard(activeCanvas, { title, text, url: window.location.origin });
      if (res === "copied_text") {
        showToast("Match summary copied to clipboard!");
      } else {
        showToast("Shared match card!");
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        showToast(`Share failed: ${err.message}`);
      }
    }
  }

  // Bind event listeners
  if (copyBtn) copyBtn.addEventListener("click", handleCopy);
  if (downloadBtn) downloadBtn.addEventListener("click", handleDownload);
  if (shareNativeBtn) shareNativeBtn.addEventListener("click", handleShare);
  if (closeBtn) closeBtn.addEventListener("click", close);

  return {
    open,
    close,
    isOpen: () => modalEl && !modalEl.classList.contains("hidden")
  };
}
