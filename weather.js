const WEATHER_URL = './weather.json';
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const STALE_AFTER_MS = 2 * 60 * 60 * 1000;
const STORAGE_KEY = 'melbl8-clock04-bom-weather-v1';

const block = document.querySelector('#weatherBlock');
const temperature = document.querySelector('#weatherTemperature');
const wind = document.querySelector('#weatherWind');

let refreshTimer = 0;
let hasRenderedWeather = false;

function finiteNumber(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function observationAge(data) {
  const timestamp = Date.parse(data?.observed_at || '');
  return Number.isFinite(timestamp) ? Date.now() - timestamp : Infinity;
}

function windLabel(data) {
  const speed = finiteNumber(data?.wind_speed_kmh);
  const direction = String(data?.wind_direction || '').trim().toUpperCase();

  if (speed === null) return 'BOM WEATHER';
  if (speed <= 1 || direction === 'CALM') return 'CALM';
  return `${direction || 'WIND'} WIND ${Math.round(speed)} KM/H`;
}

function renderWeather(data, source = 'live') {
  const temp = finiteNumber(data?.temperature_c);
  if (temp === null) return false;

  temperature.textContent = `${temp.toFixed(1)}°C`;
  wind.textContent = windLabel(data);

  const age = observationAge(data);
  block.classList.toggle('is-stale', age > STALE_AFTER_MS);
  block.dataset.source = source;

  const detail = [
    data?.station ? `BOM ${data.station}` : 'Bureau of Meteorology',
    data?.observed_at ? `observed ${new Date(data.observed_at).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne' })}` : '',
    finiteNumber(data?.apparent_temperature_c) !== null ? `feels like ${Number(data.apparent_temperature_c).toFixed(1)}°C` : '',
    finiteNumber(data?.humidity_pct) !== null ? `humidity ${Math.round(Number(data.humidity_pct))}%` : '',
    finiteNumber(data?.rain_since_9am_mm) !== null ? `rain since 9am ${Number(data.rain_since_9am_mm).toFixed(1)} mm` : ''
  ].filter(Boolean);

  block.title = detail.join(' · ');
  hasRenderedWeather = true;
  return true;
}

function readCachedWeather() {
  try {
    const cached = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (cached) renderWeather(cached, 'cache');
  } catch {
    // Ignore damaged local cache and wait for the repository feed.
  }
}

function cacheWeather(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Storage can be unavailable in restricted signage browsers.
  }
}

async function refreshWeather() {
  try {
    const response = await fetch(`${WEATHER_URL}?v=${Date.now()}`, {
      cache: 'no-store',
      credentials: 'same-origin'
    });

    if (!response.ok) throw new Error(`Weather request failed: ${response.status}`);
    const data = await response.json();
    if (!renderWeather(data, 'repository')) throw new Error('Weather payload has no temperature');
    cacheWeather(data);
  } catch {
    if (!hasRenderedWeather) {
      temperature.textContent = '--.-°C';
      wind.textContent = 'BOM WEATHER';
      block.classList.add('is-stale');
    }
  }
}

function scheduleRefresh() {
  window.clearInterval(refreshTimer);
  refreshTimer = window.setInterval(refreshWeather, REFRESH_INTERVAL_MS);
}

readCachedWeather();
refreshWeather();
scheduleRefresh();

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshWeather();
});
