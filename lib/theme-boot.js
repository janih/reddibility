/* Reddibility — pre-paint UI theme boot.
   Loaded synchronously from <head> in popup.html and options.html (external
   file, NOT inline: MV3's default extension-page CSP `script-src 'self'`
   blocks inline scripts, which silently killed the earlier inline version
   of this snippet). Sets the cached light/dark UI theme on <html> before
   the panel paints to avoid a theme flash. */
(function () {
  try {
    var m = localStorage.getItem("gr_ui");
    if (m !== "light" && m !== "dark") {
      m = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    document.documentElement.setAttribute("data-ui-theme", m);
  } catch (e) {}
})();
