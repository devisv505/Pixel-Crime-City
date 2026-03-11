(function setupGoogleFundingChoices() {
  const cfg = window.__PCC_RUNTIME_CONFIG__ || {};
  const consentCfg = cfg.consent || {};
  const publisher = String(consentCfg.googleFcPublisher || '').trim().toLowerCase();
  if (!consentCfg.enabled || !/^pub-\d{10,24}$/.test(publisher)) {
    return;
  }
  if (document.querySelector('script[data-pcc-fc="1"]')) {
    return;
  }

  window.googlefc = window.googlefc || {};
  if (!Array.isArray(window.googlefc.callbackQueue)) {
    window.googlefc.callbackQueue = [];
  }

  const fcScript = document.createElement('script');
  fcScript.async = true;
  fcScript.dataset.pccFc = '1';
  fcScript.src = `https://fundingchoicesmessages.google.com/i/${publisher}?ers=1`;
  document.head.appendChild(fcScript);

})();
