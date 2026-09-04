(() => {
  'use strict';

  const nativeFetch = window.fetch.bind(window);
  const apiPrefix = 'https://archive.org/advancedsearch.php';

  const isValidExactDate = value => {
    const raw = String(value ?? '').trim();
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
    if (!match) return false;
    const [, year, month, day] = match;
    const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === `${year}-${month}-${day}`;
  };

  const normalizeDate = value => {
    if (!Array.isArray(value)) return value;
    const values = value.filter(v => v != null && String(v).trim()).map(v => String(v).trim());
    return values.find(isValidExactDate)
      || values.find(v => /^\d{4}-\d{2}$/.test(v))
      || values.find(v => /^\d{4}$/.test(v))
      || values[0]
      || '';
  };

  window.fetch = async (...args) => {
    const response = await nativeFetch(...args);
    const requestUrl = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
    if (!requestUrl.startsWith(apiPrefix)) return response;

    try {
      const payload = await response.clone().json();
      if (!Array.isArray(payload?.response?.docs)) return response;
      payload.response.docs.forEach(doc => { doc.date = normalizeDate(doc.date); });
      return new Response(JSON.stringify(payload), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch {
      return response;
    }
  };
})();
