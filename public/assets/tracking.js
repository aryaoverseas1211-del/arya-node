(function initAryaTracking() {
  if (window.__aryaTrackingBooted) return;
  window.__aryaTrackingBooted = true;

  function loadScript(src) {
    return new Promise(function resolveScript(resolve, reject) {
      var script = document.createElement('script');
      script.async = true;
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  function setupGa4(measurementId) {
    if (!measurementId) return Promise.resolve();
    return loadScript('https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(measurementId))
      .then(function onGaLoaded() {
        window.dataLayer = window.dataLayer || [];
        function gtag() { window.dataLayer.push(arguments); }
        window.gtag = window.gtag || gtag;
        window.gtag('js', new Date());
        window.gtag('config', measurementId, { anonymize_ip: true });
      });
  }

  function setupClarity(projectId) {
    if (!projectId || window.clarity) return;
    (function clarityBootstrap(c, l, a, r, i, t, y) {
      c[a] = c[a] || function clarityQueue() { (c[a].q = c[a].q || []).push(arguments); };
      t = l.createElement(r);
      t.async = 1;
      t.src = 'https://www.clarity.ms/tag/' + i;
      y = l.getElementsByTagName(r)[0];
      y.parentNode.insertBefore(t, y);
    })(window, document, 'clarity', 'script', projectId);
  }

  fetch('/api/tracking-config', { credentials: 'same-origin', cache: 'no-store' })
    .then(function parseResponse(response) { return response.json(); })
    .then(function applyConfig(payload) {
      if (!payload || !payload.success) return;
      setupGa4(payload.ga4MeasurementId || '').catch(function onGaError() {});
      setupClarity(payload.clarityProjectId || '');
    })
    .catch(function ignoreTrackingErrors() {});
})();
