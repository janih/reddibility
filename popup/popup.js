/* GoodReddit popup controller. */
document.addEventListener("DOMContentLoaded", init);

var currentDomain = "";
var currentState = null;
var editingScope = "global"; // "global" | "domain"
var notifyTimer = null;

async function init() {
  var tabs = await browser.tabs.query({ active: true, currentWindow: true });
  var tab = tabs[0];
  currentDomain = tab ? GR.getDomain(tab.url) : "";
  currentState = await GR.load();
  applyUiTheme();

  var mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  if (mq) {
    var mqHandler = function () { if (currentUiMode() === "auto") applyUiTheme(); };
    if (mq.addEventListener) mq.addEventListener("change", mqHandler);
    else if (mq.addListener) mq.addListener(mqHandler);
  }

  var scopeToggle = document.getElementById("scope");
  // Default to per-site ("This site only") so enabling affects just the current
  // site instead of every site.
  editingScope = currentDomain ? "domain" : "global";
  scopeToggle.checked = editingScope === "domain";
  if (!currentDomain) {
    scopeToggle.disabled = true;
  }

  scopeToggle.addEventListener("change", async function () {
    if (scopeToggle.checked) {
      if (!currentDomain) { scopeToggle.checked = false; return; }
      editingScope = "domain";
      // GR.effective returns a fully detached copy (nested reddit object
      // included), so the seeded override never aliases global settings.
      currentState.perDomain[currentDomain] = GR.effective(currentState, currentDomain);
    } else {
      editingScope = "global";
      delete currentState.perDomain[currentDomain];
    }
    await GR.save(currentState);
    render();
    notifyTab();
  });

  document.getElementById("enable").addEventListener("change", function (e) {
    getEditable().enabled = e.target.checked;
    GR.save(currentState).then(render);
    notifyTab();
  });

  document.querySelectorAll("[data-theme]").forEach(function (btn) {
    btn.addEventListener("click", function () { updateSetting("theme", btn.dataset.theme); });
  });

  document.getElementById("fontFamily").addEventListener("change", function (e) {
    updateSetting("fontFamily", e.target.value);
  });

  bindSlider("fontSize", 80, 160, 1);
  bindSlider("lineHeight", 1.2, 2.2, 0.05);
  bindSlider("letterSpacing", -0.05, 0.1, 0.005);
  bindSlider("wordSpacing", 0, 0.2, 0.01);
  bindSlider("textWidth", 40, 120, 1);

  document.getElementById("hideDistractions").addEventListener("change", function (e) {
    updateSetting("hideDistractions", e.target.checked);
  });

  document.getElementById("rd-enabled").addEventListener("change", function (e) {
    GR.ensureReddit(getEditable()).enabled = e.target.checked;
    GR.save(currentState).then(render);
    notifyTab();
  });
  document.querySelectorAll("[data-rd]").forEach(function (el) {
    el.addEventListener("change", function () {
      GR.ensureReddit(getEditable())[el.dataset.rd] = el.checked;
      GR.save(currentState).then(render);
      notifyTab();
    });
  });

  document.querySelectorAll("[data-ui]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      currentState.prefs = currentState.prefs || {};
      currentState.prefs.uiMode = btn.dataset.ui;
      GR.save(currentState).then(function () { applyUiTheme(); render(); });
    });
  });

  document.getElementById("reset").addEventListener("click", onReset);
  document.getElementById("options").addEventListener("click", function () {
    browser.runtime.openOptionsPage();
  });

  render();
}

function getEditable() {
  if (editingScope === "domain" && currentDomain) {
    // Lazily create a per-site profile seeded from the current effective settings.
    if (!currentState.perDomain[currentDomain]) {
      currentState.perDomain[currentDomain] = GR.effective(currentState, currentDomain);
    }
    GR.ensureReddit(currentState.perDomain[currentDomain]);
    return currentState.perDomain[currentDomain];
  }
  GR.ensureReddit(currentState.global);
  return currentState.global;
}

function currentUiMode() {
  return (currentState && currentState.prefs && currentState.prefs.uiMode) || "auto";
}
function applyUiTheme() {
  var resolved = GR.resolveUiMode(currentUiMode());
  document.documentElement.setAttribute("data-ui-theme", resolved);
  try { localStorage.setItem("gr_ui", resolved); } catch (e) {}
}

function effectiveNow() {
  return GR.effective(currentState, currentDomain);
}

function updateSetting(key, value) {
  getEditable()[key] = value;
  GR.save(currentState).then(render);
  notifyTab();
}

function bindSlider(id, min, max, step) {
  var el = document.getElementById(id);
  var out = document.getElementById(id + "-val");
  el.min = min; el.max = max; el.step = step;
  el.addEventListener("input", function () {
    var v = parseFloat(el.value);
    out.textContent = GR.formatValue(id, v);
    getEditable()[id] = v;
    notifyTabDebounced();
  });
  el.addEventListener("change", function () {
    getEditable()[id] = parseFloat(el.value);
    GR.save(currentState);
    notifyTab();
  });
}

function notifyTabDebounced() {
  if (notifyTimer) clearTimeout(notifyTimer);
  notifyTimer = setTimeout(notifyTab, 60);
}

async function notifyTab() {
  var tabs = await browser.tabs.query({ active: true, currentWindow: true });
  var tab = tabs[0];
  if (!tab) return;
  var settings = effectiveNow();
  // Shared delivery helper (injects the content script + CSS first if the
  // page predates the extension); also refresh the badge so toggling from
  // the popup doesn't leave a stale indicator (previously only Alt+R and
  // page loads updated it).
  await GR.applyToTab(tab.id, settings).catch(function () { /* restricted page */ });
  GR.updateBadge(tab.id, settings.enabled);
}

function onReset() {
  if (editingScope === "domain" && currentDomain) {
    delete currentState.perDomain[currentDomain];
    editingScope = "global";
    document.getElementById("scope").checked = false;
  } else {
    currentState.global = GR.emptyState().global; // deep copy — never alias DEFAULTS.reddit
  }
  GR.save(currentState).then(function () { render(); notifyTab(); });
}

function render() {
  var eff = effectiveNow();
  document.getElementById("domain-label").textContent = currentDomain || "—";
  document.getElementById("enable").checked = !!eff.enabled;
  document.getElementById("scope-label").textContent =
    editingScope === "domain" ? "This site only — " + currentDomain : "All sites (default)";

  document.querySelectorAll("[data-theme]").forEach(function (btn) {
    btn.classList.toggle("selected", btn.dataset.theme === eff.theme);
    var t = GR.THEMES[btn.dataset.theme] || {};
    btn.style.setProperty("--sw-bg", t.bg);
    btn.style.setProperty("--sw-tx", t.text);
  });

  document.getElementById("fontFamily").value = eff.fontFamily;
  setSlider("fontSize", eff.fontSize);
  setSlider("lineHeight", eff.lineHeight);
  setSlider("letterSpacing", eff.letterSpacing);
  setSlider("wordSpacing", eff.wordSpacing);
  setSlider("textWidth", eff.textWidth);
  document.getElementById("hideDistractions").checked = !!eff.hideDistractions;

  var rd = eff.reddit || {};
  document.getElementById("rd-enabled").checked = !!rd.enabled;
  document.querySelectorAll("[data-rd]").forEach(function (el) {
    el.checked = !!rd[el.dataset.rd];
  });

  document.querySelectorAll("[data-ui]").forEach(function (btn) {
    btn.classList.toggle("active", btn.dataset.ui === currentUiMode());
  });
}

function setSlider(id, val) {
  document.getElementById(id).value = val;
  document.getElementById(id + "-val").textContent = GR.formatValue(id, val);
}
