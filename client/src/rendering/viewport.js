import { H, W, clamp } from "../core/shared.js";

export function createCourtViewport(ctx, usesMobileVisuals) {
  const viewport = { dpr: 1, height: H, scale: 1, sideRail: false, width: W, x: 0, y: 0 };
  let canvasPixelWidth = 0;
  let canvasPixelHeight = 0;
  let layoutSignature = "";
  let layoutDirty = true;

  if ("ResizeObserver" in window) {
    const observer = new ResizeObserver(() => {
      layoutDirty = true;
    });
    const hud = document.querySelector(".hud");
    const status = document.querySelector(".status");
    if (hud) observer.observe(hud);
    if (status) observer.observe(status);
  }
  window.addEventListener("resize", () => {
    layoutDirty = true;
  });

  function prepareCanvas(inverted) {
    const canvas = ctx.canvas;
    const dprLimit = usesMobileVisuals() ? 1.75 : 2;
    const dpr = Math.min(window.devicePixelRatio || 1, dprLimit);
    const pixelWidth = Math.max(1, Math.round(window.innerWidth * dpr));
    const pixelHeight = Math.max(1, Math.round(window.innerHeight * dpr));

    if (pixelWidth !== canvasPixelWidth || pixelHeight !== canvasPixelHeight) {
      canvasPixelWidth = pixelWidth;
      canvasPixelHeight = pixelHeight;
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      ctx.imageSmoothingEnabled = false;
      layoutDirty = true;
    }

    if (layoutDirty) {
      computeViewport(pixelWidth, pixelHeight, dpr);
      syncCourtLayout(pixelWidth, pixelHeight, dpr);
      layoutDirty = false;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pixelWidth, pixelHeight);
    ctx.fillStyle = inverted ? "#fff" : "#000";
    ctx.fillRect(0, 0, pixelWidth, pixelHeight);
    drawOuterField(pixelWidth, pixelHeight, inverted);

    if (window.__MONORALLY_DEBUG__) {
      window.__MONORALLY_VIEWPORT__ = {
        dpr,
        height: viewport.height / dpr,
        scale: viewport.scale / dpr,
        width: viewport.width / dpr,
        x: viewport.x / dpr,
        y: viewport.y / dpr
      };
    }
  }

  function computeViewport(pixelWidth, pixelHeight, dpr) {
    const courtRatio = W / H;
    const fullHeightWidth = pixelHeight * courtRatio;
    const sideGutter = (pixelWidth - fullHeightWidth) / (2 * dpr);
    const sideRail = window.innerHeight >= 600 && fullHeightWidth <= pixelWidth && sideGutter >= 145;
    document.body.classList.toggle("court-side-rail", sideRail);

    let availableX = 0;
    let availableY = 0;
    let availableWidth = pixelWidth;
    let availableHeight = pixelHeight;
    if (!sideRail) {
      const hudRect = document.querySelector(".hud")?.getBoundingClientRect();
      const statusRect = document.querySelector(".status")?.getBoundingClientRect();
      const margin = 8 * dpr;
      availableX = margin;
      availableWidth = Math.max(1, pixelWidth - margin * 2);
      availableY = Math.min(pixelHeight * 0.45, ((hudRect?.bottom || 0) + 8) * dpr);
      const safeBottom = Math.max(availableY + 1, ((statusRect?.top ?? window.innerHeight) - 8) * dpr);
      availableHeight = Math.max(1, safeBottom - availableY);
    }

    let width;
    let height;
    if (availableWidth / availableHeight > courtRatio) {
      height = availableHeight;
      width = height * courtRatio;
    } else {
      width = availableWidth;
      height = width / courtRatio;
    }

    viewport.dpr = dpr;
    viewport.sideRail = sideRail;
    viewport.width = width;
    viewport.height = height;
    viewport.scale = width / W;
    viewport.x = availableX + (availableWidth - width) / 2;
    const topAlignForThumbControl = !sideRail && usesMobileVisuals() && window.innerHeight > window.innerWidth;
    viewport.y = topAlignForThumbControl ? availableY : availableY + (availableHeight - height) / 2;
  }

  function drawOuterField(pixelWidth, pixelHeight, inverted) {
    const gutter = inverted ? "rgba(0,0,0,0.14)" : "rgba(255,255,255,0.12)";
    ctx.save();
    ctx.strokeStyle = gutter;
    ctx.lineWidth = Math.max(1, viewport.dpr);
    ctx.strokeRect(viewport.x + ctx.lineWidth / 2, viewport.y + ctx.lineWidth / 2, viewport.width - ctx.lineWidth, viewport.height - ctx.lineWidth);
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(viewport.x, viewport.y + viewport.height / 2);
    ctx.lineTo(viewport.x + viewport.width, viewport.y + viewport.height / 2);
    ctx.stroke();
    ctx.restore();
  }

  function syncCourtLayout(pixelWidth, pixelHeight, dpr) {
    const css = {
      bottom: (viewport.y + viewport.height) / dpr,
      height: viewport.height / dpr,
      left: viewport.x / dpr,
      right: (viewport.x + viewport.width) / dpr,
      top: viewport.y / dpr,
      width: viewport.width / dpr
    };
    const heightFit = Math.abs(viewport.height - pixelHeight) <= dpr;
    const widthFit = Math.abs(viewport.width - pixelWidth) <= dpr;
    const signature = [
      Math.round(css.left),
      Math.round(css.top),
      Math.round(css.width),
      Math.round(css.height),
      heightFit ? "h" : "",
      widthFit ? "w" : "",
      viewport.sideRail ? "s" : ""
    ].join(":");
    if (signature === layoutSignature) return;
    layoutSignature = signature;
    const style = document.documentElement.style;
    style.setProperty("--court-left", `${css.left}px`);
    style.setProperty("--court-right", `${css.right}px`);
    style.setProperty("--court-top", `${css.top}px`);
    style.setProperty("--court-bottom", `${css.bottom}px`);
    style.setProperty("--court-width", `${css.width}px`);
    style.setProperty("--court-height", `${css.height}px`);
    document.body.classList.toggle("court-height-fit", heightFit);
    document.body.classList.toggle("court-width-fit", widthFit);
    document.body.classList.toggle("court-side-rail", viewport.sideRail);
  }

  function cssPxToCourt(px) {
    return (px * viewport.dpr) / Math.max(viewport.scale, 1);
  }

  function clientToCourt(clientX, clientY) {
    const rect = ctx.canvas.getBoundingClientRect();
    const dpr = viewport.dpr || window.devicePixelRatio || 1;
    const x = (clientX - rect.left) * dpr;
    const y = (clientY - rect.top) * dpr;
    return {
      x: clamp((x - viewport.x) / viewport.scale, 0, W),
      y: clamp((y - viewport.y) / viewport.scale, 0, H)
    };
  }

  return { clientToCourt, cssPxToCourt, prepareCanvas, viewport };
}
