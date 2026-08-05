const STAGE_WIDTH = 3840;
const STAGE_HEIGHT = 804;
const SAFE_CONTENT_WIDTH = STAGE_WIDTH - 320;
const BASE_FONT_SIZE = 220;
const MIN_FONT_SIZE = 96;
const MAX_FONT_SIZE = 410;
const CURSOR_FIXED_WIDTH = 12;
const CURSOR_EM_ALLOWANCE = 0.14;
const FINAL_EDGE_GAP = 2;

const LEAD_INS = Object.freeze([
  'The time now is',
  'Right now, it is',
  'At this moment, it is',
  'The current time is',
  'Here in Melbourne, it is',
  'Melbourne time is',
  'The clock says',
  'It is currently',
  'As of now, it is'
]);

const params = new URLSearchParams(window.location.search);
const demoMode = params.get('demo') === '1';
const noAnimation = params.get('noanim') === '1';
const debugMode = params.get('debug') === '1';
const previewTime = parsePreviewTime(params.get('time'));
const demoInterval = clamp(Number(params.get('interval')) || 5000, 1800, 30000);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const timings = Object.freeze({
  initialType: 31,
  cursorTravel: 10,
  delete: 34,
  type: 41,
  settle: 90
});

const stage = document.querySelector('#stage');
const frame = document.querySelector('#messageFrame');
const line = document.querySelector('#singleLine');
const measure = document.querySelector('#messageMeasure');
const beforeCursor = document.querySelector('#beforeCursor');
const cursor = document.querySelector('#cursor');
const afterCursor = document.querySelector('#afterCursor');
const dateLabel = document.querySelector('#dateLabel');
const progressFill = document.querySelector('#progressFill');
const rotatePrompt = document.querySelector('#rotatePrompt');
const modeLabel = document.querySelector('#modeLabel');
const statusLabel = document.querySelector('#statusLabel');

let renderedText = '';
let currentLead = '';
let currentTime = '';
let targetLead = '';
let targetTime = '';
let activeMinuteKey = '';
let requestedMinuteKey = '';
let animationToken = 0;
let queuedState = null;
let leadDeck = [];
let previousLead = '';
let demoHour = previewTime?.hour ?? 18;
let demoMinute = previewTime?.minute ?? 6;
let demoLastAdvance = performance.now();
let scaleEvents = [];

if (debugMode) document.body.classList.add('debug');
if (demoMode) {
  modeLabel.hidden = false;
  statusLabel.textContent = 'Preview';
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function parsePreviewTime(value) {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function sleep(ms, token) {
  return new Promise((resolve, reject) => {
    if (token !== animationToken) {
      reject(new DOMException('Superseded', 'AbortError'));
      return;
    }
    window.setTimeout(() => {
      if (token !== animationToken) reject(new DOMException('Superseded', 'AbortError'));
      else resolve();
    }, ms);
  });
}

function shuffle(values) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function refillLeadDeck() {
  leadDeck = shuffle(LEAD_INS);
  if (leadDeck.length > 1 && leadDeck[0] === previousLead) {
    [leadDeck[0], leadDeck[1]] = [leadDeck[1], leadDeck[0]];
  }
}

function nextLeadIn() {
  if (leadDeck.length === 0) refillLeadDeck();
  previousLead = leadDeck.shift();
  return previousLead;
}

const ONES = Object.freeze([
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen'
]);

const TENS = Object.freeze({ 20: 'twenty', 30: 'thirty', 40: 'forty', 50: 'fifty' });

function numberToWords(value) {
  if (value < 20) return ONES[value];
  const tens = Math.floor(value / 10) * 10;
  const ones = value % 10;
  return ones === 0 ? TENS[tens] : `${TENS[tens]}-${ONES[ones]}`;
}

function hourToWords(hour24) {
  return ONES[hour24 % 12 || 12];
}

function timeToPhrase(hour, minute) {
  if (minute === 0) return `${hourToWords(hour)} o'clock`;
  if (minute === 15) return `quarter past ${hourToWords(hour)}`;
  if (minute === 30) return `half past ${hourToWords(hour)}`;
  if (minute === 45) return `quarter to ${hourToWords(hour + 1)}`;
  if (minute < 30) {
    const unit = minute === 1 ? 'minute' : 'minutes';
    return `${numberToWords(minute)} ${unit} past ${hourToWords(hour)}`;
  }
  const remaining = 60 - minute;
  const unit = remaining === 1 ? 'minute' : 'minutes';
  return `${numberToWords(remaining)} ${unit} to ${hourToWords(hour + 1)}`;
}

function getMelbourneState(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Melbourne',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = Number(values.hour);
  const minute = Number(values.minute);
  return {
    hour,
    minute,
    second: Number(values.second),
    phrase: timeToPhrase(hour, minute),
    minuteKey: `${values.year}-${values.month}-${values.day}-${hour}-${minute}`,
    dateLabel: `${values.weekday} ${values.day} ${values.month} ${values.year}`
  };
}

function getDemoState(now) {
  const elapsed = now - demoLastAdvance;
  if (elapsed >= demoInterval) {
    const steps = Math.floor(elapsed / demoInterval);
    const totalMinutes = demoHour * 60 + demoMinute + steps;
    demoHour = Math.floor((totalMinutes % 1440) / 60);
    demoMinute = totalMinutes % 60;
    demoLastAdvance += steps * demoInterval;
  }
  const second = Math.floor(((now - demoLastAdvance) / demoInterval) * 60) % 60;
  return {
    hour: demoHour,
    minute: demoMinute,
    second,
    phrase: timeToPhrase(demoHour, demoMinute),
    minuteKey: `demo-${demoHour}-${demoMinute}`,
    dateLabel: 'Tuesday 04 August 2026'
  };
}

function getCurrentState(now = performance.now()) {
  if (demoMode) return getDemoState(now);
  if (previewTime) {
    return {
      hour: previewTime.hour,
      minute: previewTime.minute,
      second: 0,
      phrase: timeToPhrase(previewTime.hour, previewTime.minute),
      minuteKey: `preview-${previewTime.hour}-${previewTime.minute}`,
      dateLabel: 'Tuesday 04 August 2026'
    };
  }
  return getMelbourneState();
}

function composeSentence(lead, time) {
  return `${lead} ${time}`.trim();
}

function findTimeRange(text) {
  const candidates = [targetTime, currentTime].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const candidate of candidates) {
    const index = text.toLowerCase().lastIndexOf(candidate.toLowerCase());
    if (index >= 0) return { start: index, end: index + candidate.length };
  }
  const leads = [targetLead, currentLead].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const lead of leads) {
    if (text.startsWith(`${lead} `)) return { start: lead.length + 1, end: text.length };
  }
  return null;
}

function appendColouredText(root, text, offset, range) {
  root.replaceChildren();
  if (!text) return;
  if (!range || offset >= range.end || offset + text.length <= range.start) {
    root.textContent = text;
    return;
  }
  const localStart = clamp(range.start - offset, 0, text.length);
  const localEnd = clamp(range.end - offset, 0, text.length);
  if (localStart > 0) root.append(document.createTextNode(text.slice(0, localStart)));
  if (localEnd > localStart) {
    const accent = document.createElement('span');
    accent.className = 'time-fragment';
    accent.textContent = text.slice(localStart, localEnd);
    root.append(accent);
  }
  if (localEnd < text.length) root.append(document.createTextNode(text.slice(localEnd)));
}

function render(before, after) {
  const full = before + after;
  const range = findTimeRange(full);
  appendColouredText(beforeCursor, before, 0, range);
  appendColouredText(afterCursor, after, before.length, range);
}

function setCursorWorking(working) {
  cursor.hidden = false;
  cursor.classList.toggle('is-working', working);
  cursor.classList.toggle('is-blinking', !working);
}

function measureFontSize(text) {
  measure.style.fontSize = `${BASE_FONT_SIZE}px`;
  measure.textContent = text || ' ';
  const textWidth = measure.scrollWidth;
  const textWidthPerPixel = textWidth / BASE_FONT_SIZE;
  const totalWidthPerPixel = textWidthPerPixel + CURSOR_EM_ALLOWANCE;
  const exactSize = (SAFE_CONTENT_WIDTH - CURSOR_FIXED_WIDTH - FINAL_EDGE_GAP) / totalWidthPerPixel;
  return clamp(exactSize, MIN_FONT_SIZE, MAX_FONT_SIZE);
}

function applyFontSize(size, duration = 0, reason = 'instant') {
  const easing = 'cubic-bezier(0.22, 0.61, 0.36, 1)';
  line.style.transition = duration > 0 ? `font-size ${duration}ms ${easing}` : 'none';
  const value = `${size.toFixed(2)}px`;
  frame.style.setProperty('--message-font-size', value);
  line.style.fontSize = value;
  scaleEvents.push({ reason, size, duration, at: performance.now() });
  if (scaleEvents.length > 40) scaleEvents = scaleEvents.slice(-40);
}

function buildEditPlan(from, to) {
  let prefix = 0;
  while (prefix < Math.min(from.length, to.length) && from[prefix] === to[prefix]) prefix += 1;
  let suffix = 0;
  const maxSuffix = Math.min(from.length - prefix, to.length - prefix);
  while (suffix < maxSuffix && from[from.length - 1 - suffix] === to[to.length - 1 - suffix]) suffix += 1;
  return {
    cursorTravelLeft: suffix,
    deleteCount: from.length - prefix - suffix,
    targetMiddle: to.slice(prefix, to.length - suffix)
  };
}

async function typeInitial(target, token) {
  applyFontSize(measureFontSize(target), 0, 'initial');
  setCursorWorking(true);
  render('', '');
  if (noAnimation || reducedMotion) {
    render(target, '');
    renderedText = target;
    setCursorWorking(false);
    return;
  }
  let typed = '';
  for (const character of target) {
    typed += character;
    render(typed, '');
    await sleep(timings.initialType, token);
  }
  renderedText = target;
  render(target, '');
  await sleep(timings.settle, token);
  setCursorWorking(false);
}

async function editSentence(target, token) {
  if (target === renderedText) return;
  if (!renderedText) {
    await typeInitial(target, token);
    return;
  }

  setCursorWorking(true);
  const plan = buildEditPlan(renderedText, target);
  let before = renderedText;
  let after = '';
  const targetSize = measureFontSize(target);
  const startingSize = Number.parseFloat(getComputedStyle(line).fontSize) || targetSize;
  const growing = targetSize > startingSize + 0.25;

  if (noAnimation || reducedMotion) {
    applyFontSize(targetSize, 0, 'reduced');
    render(target, '');
    renderedText = target;
    setCursorWorking(false);
    return;
  }

  for (let index = 0; index < plan.cursorTravelLeft; index += 1) {
    after = before.slice(-1) + after;
    before = before.slice(0, -1);
    render(before, after);
    await sleep(timings.cursorTravel, token);
  }

  const totalEditMs =
    plan.deleteCount * timings.delete +
    plan.targetMiddle.length * timings.type +
    plan.cursorTravelLeft * timings.cursorTravel;

  if (!growing) {
    const duration = clamp(Math.round(totalEditMs * 0.55), 180, 620);
    applyFontSize(targetSize, duration, 'transition-shrink');
  }

  for (let index = 0; index < plan.deleteCount; index += 1) {
    before = before.slice(0, -1);
    render(before, after);
    if (growing) {
      const safeSize = measureFontSize(before + after);
      const desiredSize = Math.min(targetSize, safeSize);
      applyFontSize(desiredSize, 150, 'transition-delete');
    }
    await sleep(timings.delete, token);
  }

  if (growing) {
    const typeInMs = plan.targetMiddle.length * timings.type + plan.cursorTravelLeft * timings.cursorTravel;
    const duration = typeInMs > 90 ? clamp(Math.round(typeInMs * 0.55), 80, 360) : 0;
    applyFontSize(targetSize, duration, 'transition-type-in');
  }

  for (const character of plan.targetMiddle) {
    before += character;
    render(before, after);
    await sleep(timings.type, token);
  }

  while (after.length > 0) {
    before += after[0];
    after = after.slice(1);
    render(before, after);
    await sleep(timings.cursorTravel, token);
  }

  renderedText = target;
  render(target, '');
  await sleep(timings.settle, token);
  setCursorWorking(false);
}

async function updateSentence(lead, time, token) {
  targetLead = lead;
  targetTime = time;
  const target = composeSentence(lead, time);
  if (!renderedText) {
    currentLead = lead;
    currentTime = time;
    await typeInitial(target, token);
    return;
  }
  await editSentence(target, token);
  currentLead = lead;
  currentTime = time;
  targetLead = lead;
  targetTime = time;
  render(target, '');
}

async function requestMessageUpdate(state) {
  queuedState = state;
  if (frame.dataset.busy === 'true') return;
  frame.dataset.busy = 'true';
  try {
    while (queuedState) {
      const next = queuedState;
      queuedState = null;
      const token = ++animationToken;
      try {
        await updateSentence(next.leadIn, next.phrase, token);
        activeMinuteKey = next.minuteKey;
      } catch (error) {
        if (error?.name !== 'AbortError') throw error;
      }
    }
  } finally {
    frame.dataset.busy = 'false';
  }
}

function updateClock(now = performance.now()) {
  const state = getCurrentState(now);
  dateLabel.textContent = state.dateLabel;
  const fractionalSecond = demoMode ? 0 : (Date.now() % 1000) / 1000;
  progressFill.style.transform = `scaleX(${clamp((state.second + fractionalSecond) / 60, 0, 1)})`;
  if (state.minuteKey !== requestedMinuteKey) {
    requestedMinuteKey = state.minuteKey;
    requestMessageUpdate({ ...state, leadIn: nextLeadIn() });
  }
}

function scaleStage() {
  const viewport = window.visualViewport;
  const width = viewport?.width ?? window.innerWidth;
  const height = viewport?.height ?? window.innerHeight;
  const scale = Math.min(width / STAGE_WIDTH, height / STAGE_HEIGHT);
  stage.style.transform = `translate(-50%, -50%) scale(${scale})`;
  rotatePrompt.hidden = !(width < height && width < 900);
}

function animationLoop(now) {
  updateClock(now);
  window.requestAnimationFrame(animationLoop);
}

window.addEventListener('resize', scaleStage, { passive: true });
window.addEventListener('orientationchange', scaleStage, { passive: true });
window.visualViewport?.addEventListener('resize', scaleStage, { passive: true });
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    activeMinuteKey = '';
    requestedMinuteKey = '';
    updateClock();
    scaleStage();
  }
});

await Promise.allSettled([
  document.fonts.load('700 220px "PT Serif Local"'),
  document.fonts.load('400 31px "Open Sans Local"'),
  document.fonts.load('600 31px "Open Sans Local"')
]);
await document.fonts.ready;
scaleStage();
updateClock();
window.requestAnimationFrame(animationLoop);

window.__clock = Object.freeze({
  get layout() { return 'single'; },
  get fullText() { return renderedText; },
  get leadText() { return currentLead; },
  get renderedText() { return currentTime; },
  get activeMinuteKey() { return activeMinuteKey; },
  get messageFontSize() { return Number.parseFloat(getComputedStyle(line).fontSize); },
  get stageScale() {
    const match = /scale\(([^)]+)\)/.exec(stage.style.transform);
    return match ? Number(match[1]) : 1;
  },
  get scaleEvents() { return [...scaleEvents]; },
  measureFontSize,
  forceState: async (lead, time) => {
    const token = ++animationToken;
    targetLead = String(lead);
    targetTime = String(time);
    await updateSentence(targetLead, targetTime, token);
    currentLead = targetLead;
    currentTime = targetTime;
    return renderedText;
  }
});
