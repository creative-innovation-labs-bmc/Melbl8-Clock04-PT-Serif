(() => {
  'use strict';

  const STAGE_WIDTH = 3840;
  const SAFE_CONTENT_WIDTH = STAGE_WIDTH - 320;
  const BASE_FONT_SIZE = 220;
  const MIN_FONT_SIZE = 96;
  const MAX_FONT_SIZE = 330;
  const CURSOR_FIXED_WIDTH = 12;
  const CURSOR_EM_ALLOWANCE = 0.14;
  const FINAL_EDGE_GAP = 2;
  const EPSILON = 0.35;
  const GROW_DURATION = 280;
  const SHRINK_DURATION = 260;
  const FINAL_DURATION = 420;

  const stage = document.querySelector('#stage');
  const frame = document.querySelector('#messageFrame');
  const line = document.querySelector('#singleLine');
  const measure = document.querySelector('#messageMeasure');

  if (!stage || !frame || !line || !measure) return;

  let engineTargetSize = null;
  let lastWrittenSize = null;
  let finalFitTimer = 0;
  let lastResult = null;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function measureSafeFontSize(text) {
    measure.style.fontSize = `${BASE_FONT_SIZE}px`;
    measure.textContent = text || ' ';

    const stageScale = stage.getBoundingClientRect().width / STAGE_WIDTH || 1;
    const textWidthAtBase = measure.getBoundingClientRect().width / stageScale;
    const textWidthPerPixel = textWidthAtBase / BASE_FONT_SIZE;
    const totalWidthPerPixel = textWidthPerPixel + CURSOR_EM_ALLOWANCE;
    const available = SAFE_CONTENT_WIDTH - CURSOR_FIXED_WIDTH - FINAL_EDGE_GAP;
    const exactSize = available / totalWidthPerPixel;

    return clamp(exactSize, MIN_FONT_SIZE, MAX_FONT_SIZE);
  }

  function currentFontSize() {
    return Number.parseFloat(getComputedStyle(line).fontSize) || BASE_FONT_SIZE;
  }

  function inlineFontSize() {
    return Number.parseFloat(line.style.fontSize);
  }

  function writeSize(size, { immediate = false, duration = GROW_DURATION, reason = 'fit' } = {}) {
    const bounded = clamp(size, MIN_FONT_SIZE, MAX_FONT_SIZE);
    const value = `${bounded.toFixed(2)}px`;
    lastWrittenSize = bounded;

    line.style.transition = immediate
      ? 'none'
      : `font-size ${duration}ms cubic-bezier(0.22, 0.61, 0.36, 1)`;
    frame.style.setProperty('--message-font-size', value);
    line.style.fontSize = value;
    line.dataset.scaleReason = reason;
  }

  function captureEngineTarget() {
    const inline = inlineFontSize();
    if (!Number.isFinite(inline)) return false;
    if (Number.isFinite(lastWrittenSize) && Math.abs(inline - lastWrittenSize) <= EPSILON) return false;
    engineTargetSize = clamp(inline, MIN_FONT_SIZE, MAX_FONT_SIZE);
    return true;
  }

  function reconcile({ textChanged = false, styleChanged = false, forceFinal = false } = {}) {
    if (styleChanged) captureEngineTarget();

    const text = line.textContent || '';
    if (!text) return null;

    const safeSize = measureSafeFontSize(text);
    const currentSize = currentFontSize();
    const requestedInline = inlineFontSize();
    const busy = frame.dataset.busy === 'true';

    let desiredSize;
    let immediate = false;
    let duration = GROW_DURATION;
    let reason = 'hold';

    if (!busy || forceFinal) {
      desiredSize = safeSize;
      engineTargetSize = safeSize;
      duration = FINAL_DURATION;
      reason = 'final-fit';
    } else {
      const finalTarget = Number.isFinite(engineTargetSize)
        ? engineTargetSize
        : safeSize;

      // Do not scale to the temporary maximum of a half-deleted sentence.
      // Only move towards the completed next sentence's measured size.
      desiredSize = Math.min(finalTarget, safeSize);

      const unsafeNow = currentSize > safeSize + EPSILON;
      const unsafeRequested = Number.isFinite(requestedInline) && requestedInline > safeSize + EPSILON;

      if (unsafeNow || unsafeRequested) {
        desiredSize = Math.min(desiredSize, safeSize);
        immediate = true;
        reason = 'overflow-clamp';
      } else if (desiredSize > currentSize + EPSILON) {
        duration = GROW_DURATION;
        reason = textChanged ? 'gentle-delete-grow' : 'gentle-grow';
      } else if (desiredSize < currentSize - EPSILON) {
        duration = SHRINK_DURATION;
        reason = 'gentle-shrink';
      }
    }

    if (Math.abs(currentSize - desiredSize) > EPSILON || forceFinal) {
      writeSize(desiredSize, { immediate, duration, reason });
    }

    lastResult = {
      text,
      busy,
      safeSize,
      currentSize,
      requestedInline,
      engineTargetSize,
      desiredSize,
      immediate,
      reason
    };

    return lastResult;
  }

  function scheduleFinalFit() {
    window.clearTimeout(finalFitTimer);
    finalFitTimer = window.setTimeout(() => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        reconcile({ forceFinal: true });
      }));
    }, 0);
  }

  async function waitForInitialClock() {
    const deadline = performance.now() + 12000;
    while (performance.now() < deadline) {
      if (line.textContent && frame.dataset.busy !== 'true') return;
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  }

  async function start() {
    await Promise.allSettled([
      document.fonts.load('700 220px "PT Serif Local"'),
      document.fonts.load('400 31px "Open Sans Local"')
    ]);
    await document.fonts.ready;
    await waitForInitialClock();

    reconcile({ forceFinal: true });

    const observer = new MutationObserver((mutations) => {
      let textChanged = false;
      let styleChanged = false;
      let busyChanged = false;

      for (const mutation of mutations) {
        if (mutation.type === 'characterData' || mutation.type === 'childList') {
          textChanged = true;
        } else if (mutation.type === 'attributes') {
          if (mutation.target === line && mutation.attributeName === 'style') styleChanged = true;
          if (mutation.target === frame && mutation.attributeName === 'data-busy') busyChanged = true;
        }
      }

      if (busyChanged && frame.dataset.busy !== 'true') {
        scheduleFinalFit();
      }

      if (textChanged || styleChanged || busyChanged) {
        reconcile({ textChanged, styleChanged });
      }
    });

    observer.observe(line, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['style']
    });

    observer.observe(frame, {
      attributes: true,
      attributeFilter: ['data-busy']
    });
  }

  window.__scalingQC = Object.freeze({
    measureSafeFontSize,
    reconcile,
    get lastResult() { return lastResult; },
    get engineTargetSize() { return engineTargetSize; },
    get contentWidth() { return line.scrollWidth; },
    get safeWidth() { return SAFE_CONTENT_WIDTH; }
  });

  start();
})();