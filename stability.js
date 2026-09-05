(() => {
  'use strict';

  const API_PREFIX = 'https://archive.org/advancedsearch.php';
  const MIN_YEAR = 1980;
  const MAX_YEAR = 2005;

  // If Archive.org reports results but a deep page is empty,
  // retry on a valid page instead of showing a false "no results" state.
  const previousFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await previousFetch(...args);
    const input = args[0];
    const requestUrl = typeof input === 'string' ? input : (input?.url || '');
    if (!requestUrl.startsWith(API_PREFIX) || !response.ok) return response;

    try {
      const url = new URL(requestUrl);
      const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
      const rows = Math.max(1, Number(url.searchParams.get('rows')) || 50);
      if (page <= 1) return response;

      const payload = await response.clone().json();
      const docs = payload?.response?.docs;
      const numFound = Number(payload?.response?.numFound) || 0;
      if (!Array.isArray(docs) || docs.length > 0 || numFound <= 0) return response;

      const maxPage = Math.max(1, Math.ceil(numFound / rows));
      const fallbackPage = page > maxPage ? 1 + ((page - 1) % maxPage) : 1;
      if (fallbackPage === page) return response;

      url.searchParams.set('page', String(fallbackPage));
      return previousFetch(url.toString(), ...args.slice(1));
    } catch {
      return response;
    }
  };

  // Avoid the surprising jump to 1997 if the mobile year field is left blank/partial.
  const yearInput = document.getElementById('yearInput');
  if (yearInput) {
    let lastValidYear = Number(yearInput.value) || 1994;
    let restoreOnBlur = false;

    yearInput.addEventListener('input', () => {
      const raw = String(yearInput.value || '').trim();
      const year = Number(raw);
      if (/^\d{4}$/.test(raw) && year >= MIN_YEAR && year <= MAX_YEAR) {
        lastValidYear = year;
        restoreOnBlur = false;
      } else {
        restoreOnBlur = !/^\d{4}$/.test(raw);
      }
    });

    yearInput.addEventListener('blur', () => {
      if (restoreOnBlur) {
        yearInput.value = String(lastValidYear);
        yearInput.dispatchEvent(new Event('change', { bubbles: true }));
        restoreOnBlur = false;
      } else {
        const year = Number(yearInput.value);
        if (year >= MIN_YEAR && year <= MAX_YEAR) lastValidYear = year;
      }
    });
  }

  // Prevent accidental double launches while a request is already running.
  const loader = document.getElementById('loader');
  const busyControls = [
    'openCapsuleBtn', 'travelModeBtn', 'todayExploreBtn',
    'homeDeeperBtn', 'deeperBtn', 'yearMinus', 'yearPlus'
  ].map(id => document.getElementById(id)).filter(Boolean);

  const syncBusyState = () => {
    if (!loader) return;
    const busy = !loader.hidden;
    busyControls.forEach(control => { control.disabled = busy; });
    const machine = document.querySelector('.machine');
    if (machine) machine.setAttribute('aria-busy', busy ? 'true' : 'false');
  };

  if (loader) {
    new MutationObserver(syncBusyState).observe(loader, { attributes: true, attributeFilter: ['hidden'] });
    syncBusyState();
  }

  // Replace broken thumbnails in the local favorites drawer with a clean ATM marker.
  document.addEventListener('error', event => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || !image.closest('.mini-item')) return;
    const fallback = document.createElement('span');
    fallback.className = 'mini-thumb-fallback';
    fallback.textContent = 'ATM';
    image.replaceWith(fallback);
  }, true);
})();
