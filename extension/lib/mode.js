// Decides where the AI opens: the small window, or Chrome's side panel.
// Classic script (content scripts can't import modules); also loaded by tests.

(function () {
  /**
   * @param {'auto'|'window'|'sidepanel'} openIn  the user's setting
   * @param {{isMac:boolean, isFullscreen:boolean}} env
   */
  function chooseOpenIn(openIn, env) {
    if (openIn === 'window' || openIn === 'sidepanel') return openIn;
    // On macOS a fullscreen app has its own Space; a new window can't appear on
    // top of it and would yank you to the desktop. The side panel lives inside
    // the fullscreen window instead.
    return env.isMac && env.isFullscreen ? 'sidepanel' : 'window';
  }

  /** Read the environment from a page (window/screen/navigator/document). */
  function detectEnv(w) {
    const nav = w.navigator || {};
    const platform = String(nav.userAgentData?.platform || nav.platform || nav.userAgent || '');
    const isMac = /mac/i.test(platform) && !/iphone|ipad/i.test(platform);
    const s = w.screen || {};
    const doc = w.document || {};
    const browserFullscreen = w.outerWidth >= s.width && w.outerHeight >= s.height; // green button / Cmd+Ctrl+F
    const pageFullscreen = !!doc.fullscreenElement; // e.g. a video or slides in fullscreen
    return { isMac, isFullscreen: browserFullscreen || pageFullscreen };
  }

  const api = { chooseOpenIn, detectEnv };
  globalThis.AskHereMode = api;
})();
