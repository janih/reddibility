/* Reddibility options controller — edits the global default profile
   and manages per-site overrides. */
document.addEventListener("DOMContentLoaded", init);

var state;

async function init() {
  state = await GR.load();
  state.global.reddit = state.global.reddit || Object.assign({}, GR.DEFAULTS.reddit);
  state.prefs = state.prefs || Object.assign({}, GR.DEFAULT_PREFS);
  applyUiTheme();

  var mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  if (mq) {
    var mqHandler = function () { if (currentUiMode() === "auto") applyUiTheme(); };
    if (mq.addEventListener) mq.addEventListener("change", mqHandler);
    else if (mq.addListener) mq.addListener(mqHandler);
  }

  document.querySelectorAll("[data-theme]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      state.global.theme = btn.dataset.theme;
      save();
    });
  });
  document.getElementById("fontFamily").addEventListener("change", function (e) {
    state.global.fontFamily = e.target.value; save();
  });
  bindSlider("fontSize", 80, 160, 1);
  bindSlider("lineHeight", 1.2, 2.2, 0.05);
  bindSlider("letterSpacing", -0.05, 0.1, 0.005);
  bindSlider("wordSpacing", 0, 0.2, 0.01);
  bindSlider("textWidth", 40, 120, 1);
  document.getElementById("hideDistractions").addEventListener("change", function (e) {
    state.global.hideDistractions = e.target.checked; save();
  });
  document.getElementById("rd-enabled").addEventListener("change", function (e) {
    state.global.reddit.enabled = e.target.checked; save();
  });
  document.querySelectorAll("[data-rd]").forEach(function (el) {
    el.addEventListener("change", function () {
      state.global.reddit[el.dataset.rd] = el.checked; save();
    });
  });
  document.querySelectorAll("[data-ui]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      state.prefs.uiMode = btn.dataset.ui;
      applyUiTheme();
      save();
    });
  });
  document.getElementById("resetAll").addEventListener("click", async function () {
    if (!confirm("Reset all Reddibility settings, including per-site overrides?")) return;
    // Capture the overridden domains first: reset must also revoke the
    // opt-in site access they granted (unregistering their dynamic
    // content scripts via GR.revokeSiteAccess).
    Object.keys(state.perDomain).forEach(function (d) {
      GR.revokeSiteAccess(d);
    });
    state = GR.emptyState();
    await GR.save(state);
    render();
    notifyAll();
  });

  render();
}

function currentUiMode() {
  return (state && state.prefs && state.prefs.uiMode) || "auto";
}
function applyUiTheme() {
  var resolved = GR.resolveUiMode(currentUiMode());
  document.documentElement.setAttribute("data-ui-theme", resolved);
  try { localStorage.setItem("gr_ui", resolved); } catch (e) {}
}

function bindSlider(id, min, max, step) {
  var el = document.getElementById(id);
  var out = document.getElementById(id + "-val");
  el.min = min; el.max = max; el.step = step;
  el.addEventListener("input", function () { out.textContent = GR.formatValue(id, el.value); });
  el.addEventListener("change", function () {
    state.global[id] = parseFloat(el.value); save();
  });
}

async function save() {
  await GR.save(state);
  render();
  notifyAll();
}

async function notifyAll() {
  var tabs = await browser.tabs.query({});
  tabs.forEach(function (t) {
    if (!/^https?:/.test(t.url || "")) return;
    var settings = GR.effective(state, GR.getDomain(t.url));
    GR.applyToTab(t.id, settings).catch(function () {});
    GR.updateBadge(t.id, settings.enabled);
  });
}

function render() {
  var g = state.global;
  document.querySelectorAll("[data-theme]").forEach(function (btn) {
    btn.classList.toggle("selected", btn.dataset.theme === g.theme);
    var t = GR.THEMES[btn.dataset.theme] || {};
    btn.style.setProperty("--sw-bg", t.bg);
    btn.style.setProperty("--sw-tx", t.text);
  });
  document.getElementById("fontFamily").value = g.fontFamily;
  ["fontSize", "lineHeight", "letterSpacing", "wordSpacing", "textWidth"].forEach(function (id) {
    document.getElementById(id).value = g[id];
    document.getElementById(id + "-val").textContent = GR.formatValue(id, g[id]);
  });
  document.getElementById("hideDistractions").checked = !!g.hideDistractions;

  var rd = g.reddit || {};
  document.getElementById("rd-enabled").checked = !!rd.enabled;
  document.querySelectorAll("[data-rd]").forEach(function (el) {
    el.checked = !!rd[el.dataset.rd];
  });

  document.querySelectorAll("[data-ui]").forEach(function (btn) {
    btn.classList.toggle("active", btn.dataset.ui === (state.prefs.uiMode || "auto"));
  });

  var list = document.getElementById("domain-list");
  var domains = Object.keys(state.perDomain);
  if (!domains.length) {
    list.innerHTML = '<li class="muted">No per-site overrides yet.</li>';
    return;
  }
  list.innerHTML = "";
  domains.forEach(function (d) {
    var ov = state.perDomain[d];
    var li = document.createElement("li");

    var left = document.createElement("div");
    left.style.display = "flex";
    left.style.flexDirection = "column";
    var name = document.createElement("span");
    name.className = "dom"; name.textContent = d;
    var meta = document.createElement("span");
    meta.className = "muted";
    meta.textContent = (ov.enabled ? "on" : "off") + " · " + (ov.theme || "default theme");
    left.appendChild(name); left.appendChild(meta);

    var btn = document.createElement("button");
    btn.textContent = "Remove";
    btn.addEventListener("click", async function () {
      delete state.perDomain[d];
      // Also drop the opt-in site access this override granted (revoking
      // the origin permission unregisters its dynamic content script —
      // without this, the site would keep working until Firefox restart).
      GR.revokeSiteAccess(d);
      await GR.save(state);
      render();
      notifyAll();
    });

    li.appendChild(left);
    li.appendChild(btn);
    list.appendChild(li);
  });
}
