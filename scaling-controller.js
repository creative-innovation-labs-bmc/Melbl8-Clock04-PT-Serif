(() => {
  'use strict';

  const STAGE_WIDTH = 3840;
  const SAFE_CONTENT_WIDTH = STAGE_WIDTH - 320;
  const BASE_FONT_SIZE = 220;
  const MIN_FONT_SIZE = 96;
  const MAX_FONT_SIZE = 410;
  const CURSOR_FIXED_WIDTH = 12;
  const CURSOR_EM_ALLOWANCE = 0.14;
  const WIDTH_SAFETY = 18;
  const GROW_DURATION = 96;
  const EPSILON = 0.35;

  const stage = document.querySelector('#stage');
  const frame = document.querySelector('#messageFrame');
  const line = document.querySelector('#singleLine');
  const measure = document.querySelector('#messageMeasure');

  if (!stage || !frame || !line || !measure) return;

  let internalWrite = false;
  let lastResult = null;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function measureSafeFontSize(text) {
    measure.style.fontSize = `${BASE_FONT_SIZE}px`;
    measure.textContent = text || ' ';

    // scrollWidth is measured in the fixed 3840px stage coordinate system.
    // It is unaffected by the viewport transform used for mobile preview.
    const textWidthAtBase = measure.scrollWidth;
    const textWidthPerPixel = textWidthAtBase / BASE_FONT_SIZE;
    const totalWidthPerPixel = textWidthPerPixel + CURSOR_EM_ALLOWANCE;
    const available = SAFE_CONTENT_WIDTH - CURSOR_FIXED_WIDTH - WIDTH_SAFETY;
    const exactSize = available / totalWidthPerPixel;

    return clamp(exactSize, MIN_FONT_SIZE, MAX_FONT_SIZE);
  }

  function currentFontSize() {
    return Number.parseFloat(getComputedStyle(line).fontSize) || BASE_FONT_SIZE;
  }

  function writeSize(size, immediate, reason) {
    const value = `${size.toFixed(2)}px`;

    internalWrite = true;
    line.style.transition = immediate
      ? 'none'
      : `font-size ${GROW_DURATION}ms linear`;
    frame.style.setProperty('--message-font-size', value);
    line.style.fontSize = value;
    line.dataset.scaleReason = reason;

    queueMicrotask(() => {
      internalWrite = false;
    });
  }

  function reconcile({ textChanged = false, force = false } = {}) {
    const text = line.textContent || '';
    if (!text) return null;

    const safeSize = measureSafeFontSize(text);
    const currentSize = currentFontSize();
    const requestedSize = Number.parseFloat(line.style.fontSize) || currentSize;

    // The clock engine may request the final, larger size before deletion begins.
    // Inspect the requested target as well as the current interpolated size so an
    // unsafe transition is cancelled before the browser paints an overflowing frame.
    const mustShrink = Math.max(currentSize, requestedSize) > safeSize + EPSILON;
    const mayGrow = safeSize > currentSize + EPSILON;

    if (mustShrink) {
      writeSize(safeSize, true, 'overflow-clamp');
    } else if (mayGrow && (textChanged || force)) {
      // Deletion creates more room. Follow it with a short linear transition so
      // the text grows smoothly without ever exceeding the current safe size.
      writeSize(safeSize, false, 'deletion-grow');
    } else if (force && Math.abs(currentSize - safeSize) > EPSILON) {
      writeSize(safeSize, true, 'force-fit');
    }

    lastResult = {
      text,
      safeSize,
      currentSize,
      requestedSize,
      mustShrink,
      mayGrow
    };

    return lastResult;
  }

  async function waitForInitialClock() {
    const deadline = performance.now() + 12000;

    while (performance.now() < deadline) {
      const clockReady = window.__clock?.fullText;
      const initialBusy = frame.dataset.busy === 'true';

      if (clockReady && !initialBusy && line.textContent) return;
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

    reconcile({ force: true });

    const observer = new MutationObserver((mutations) => {
      let textChanged = false;
      let externalStyleChanged = false;

      for (const mutation of mutations) {
        if (mutation.type === 'characterData' || mutation.type === 'childList') {
          textChanged = true;
        } else if (
          mutation.type === 'attributes' &&
          mutation.attributeName === 'style' &&
          !internalWrite
        ) {
          externalStyleChanged = true;
        }
      }

      if (textChanged || externalStyleChanged) {
        reconcile({ textChanged });
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
      attributeFilter: ['style']
    });
  }

  window.__scalingQC = Object.freeze({
    measureSafeFontSize,
    reconcile,
    get lastResult() {
      return lastResult;
    },
    get contentWidth() {
      return line.scrollWidth;
    },
    get safeWidth() {
      return SAFE_CONTENT_WIDTH;
    }
  });

  start();
})();
