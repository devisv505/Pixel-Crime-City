(function setupMenuAdSense() {
  const joinOverlay = document.getElementById('joinOverlay');
  const adWrap = document.getElementById('menuAdWrap');
  const adSlotHost = document.getElementById('menuAdSlot');
  if (!joinOverlay || !adWrap || !adSlotHost) return;

  const runtimeCfg = window.__PCC_RUNTIME_CONFIG__ || {};
  const adsenseCfg = runtimeCfg.adsense || {};
  const client = String(adsenseCfg.client || '').trim();
  const joinSlot = String(adsenseCfg.joinSlot || '').trim();
  const enabled = !!adsenseCfg.enabled;
  const validClient = /^ca-pub-\d{10,24}$/.test(client);
  const validSlot = /^\d{5,16}$/.test(joinSlot);
  if (!enabled || !validClient || !validSlot) {
    adWrap.classList.add('hidden');
    return;
  }

  let adInitStarted = false;
  let adInitDone = false;
  let adRequestPushed = false;

  function isAdEligibleViewport() {
    return window.innerWidth >= 880 && window.innerHeight >= 580;
  }

  function canShowAd() {
    return !joinOverlay.classList.contains('hidden') && isAdEligibleViewport();
  }

  function ensureAdScript() {
    const existing = document.querySelector('script[data-pcc-adsense="1"]');
    const anyAdSenseScript = document.querySelector(
      'script[src*="pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"]'
    );
    if (existing || anyAdSenseScript) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.async = true;
      script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
      script.crossOrigin = 'anonymous';
      script.dataset.pccAdsense = '1';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('adsense_script_load_failed'));
      document.head.appendChild(script);
    });
  }

  function ensureAdInitialized() {
    if (adInitDone || adInitStarted) return;
    adInitStarted = true;
    const ins = document.createElement('ins');
    ins.className = 'adsbygoogle';
    ins.style.display = 'block';
    ins.style.minHeight = '90px';
    ins.style.maxHeight = '120px';
    ins.setAttribute('data-ad-client', client);
    ins.setAttribute('data-ad-slot', joinSlot);
    ins.setAttribute('data-ad-format', 'auto');
    ins.setAttribute('data-full-width-responsive', 'true');
    adSlotHost.innerHTML = '';
    adSlotHost.appendChild(ins);

    ensureAdScript()
      .then(() => {
        if (adRequestPushed) return;
        adRequestPushed = true;
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      })
      .catch(() => {
        adWrap.classList.add('hidden');
      })
      .finally(() => {
        adInitDone = true;
      });
  }

  function refreshVisibility() {
    const show = canShowAd();
    adWrap.classList.toggle('hidden', !show);
    if (show) {
      ensureAdInitialized();
    }
  }

  const observer = new MutationObserver(() => refreshVisibility());
  observer.observe(joinOverlay, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('resize', refreshVisibility);
  window.addEventListener('orientationchange', refreshVisibility);
  refreshVisibility();
})();
