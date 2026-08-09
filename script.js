(function () {
  "use strict";

  var STORAGE_SAVED = "smc_saved_checklists";
  var STORAGE_CURRENT = "smc_current_checklist";
  var STORAGE_THEME = "smc_theme";

  var BEST_PRACTICES = [
    "Identify and document all possible states",
    "Identify and document all triggering events",
    "Designate and verify a single, unambiguous initial state",
    "Verify every state has at least one outgoing transition, or is a documented terminal state",
    "Handle unexpected or invalid events gracefully in every state",
    "Document side effects / actions triggered on each transition",
    "Check for and resolve duplicate transitions (same from-state and event, different targets)",
    "Check for unreachable states (no incoming transitions and not the initial state)",
    "Write tests covering every defined transition path",
    "Write tests covering invalid/unexpected event handling"
  ];

  var NAMING_CONVENTIONS = [
    "Use verbs for event names (e.g. 'start', 'stop', 'submit')",
    "Use nouns or adjectives for state names (e.g. 'idle', 'running', 'active')",
    "Avoid single-letter or overly abbreviated state and event names",
    "Use consistent casing across all names (e.g. always lowerCamelCase or always kebab-case)",
    "Avoid names that could apply to either a state or an event — keep the two vocabularies distinct"
  ];

  var state = {
    name: "",
    states: [],
    events: [],
    transitions: [],
    checked: {}
  };

  function $(id) {
    return document.getElementById(id);
  }

  var els = {
    btnThemeToggle: $("btn-theme-toggle"),

    checklistName: $("checklist-name"),
    btnSave: $("btn-save"),
    btnNew: $("btn-new"),
    savedSelect: $("saved-select"),
    btnLoad: $("btn-load"),
    btnDelete: $("btn-delete"),
    saveStatus: $("save-status"),

    stateInput: $("state-input"),
    btnAddState: $("btn-add-state"),
    statesList: $("states-list"),

    eventInput: $("event-input"),
    btnAddEvent: $("btn-add-event"),
    eventsList: $("events-list"),

    transFrom: $("trans-from"),
    transEvent: $("trans-event"),
    transTo: $("trans-to"),
    btnAddTrans: $("btn-add-trans"),
    transList: $("trans-list"),

    checklistOutput: $("checklist-output"),
    btnDownload: $("btn-download")
  };

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  function slugify(str) {
    return String(str).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "checklist";
  }

  function transKey(t) {
    return t.from + "|" + t.event + "|" + t.to;
  }

  // ---------- Theme ----------

  function applyTheme(theme) {
    document.body.classList.toggle("light-theme", theme === "light");
    els.btnThemeToggle.textContent = theme === "light" ? "Dark mode" : "Light mode";
    els.btnThemeToggle.setAttribute("aria-pressed", theme === "light" ? "true" : "false");
  }

  function loadTheme() {
    var theme = "dark";
    try {
      theme = localStorage.getItem(STORAGE_THEME) || "dark";
    } catch (e) {
      /* storage unavailable; default to dark */
    }
    applyTheme(theme);
  }

  function toggleTheme() {
    var next = document.body.classList.contains("light-theme") ? "dark" : "light";
    applyTheme(next);
    try {
      localStorage.setItem(STORAGE_THEME, next);
    } catch (e) {
      /* fail silently */
    }
  }

  // ---------- Persistence ----------

  function loadCurrent() {
    try {
      var raw = localStorage.getItem(STORAGE_CURRENT);
      if (!raw) return;
      var data = JSON.parse(raw);
      if (data && typeof data === "object") {
        state.name = data.name || "";
        state.states = Array.isArray(data.states) ? data.states : [];
        state.events = Array.isArray(data.events) ? data.events : [];
        state.transitions = Array.isArray(data.transitions) ? data.transitions : [];
        state.checked = data.checked && typeof data.checked === "object" ? data.checked : {};
      }
    } catch (e) {
      /* ignore corrupt data */
    }
  }

  function persistCurrent() {
    try {
      localStorage.setItem(STORAGE_CURRENT, JSON.stringify(state));
    } catch (e) {
      /* storage may be full or unavailable; fail silently */
    }
  }

  function getSaved() {
    try {
      var raw = localStorage.getItem(STORAGE_SAVED);
      var data = raw ? JSON.parse(raw) : {};
      return data && typeof data === "object" ? data : {};
    } catch (e) {
      return {};
    }
  }

  function setSaved(map) {
    try {
      localStorage.setItem(STORAGE_SAVED, JSON.stringify(map));
      return true;
    } catch (e) {
      return false;
    }
  }

  function refreshSavedSelect() {
    var saved = getSaved();
    var names = Object.keys(saved).sort(function (a, b) {
      return a.localeCompare(b);
    });
    els.savedSelect.innerHTML = '<option value="">— Saved checklists —</option>';
    names.forEach(function (name) {
      var opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      els.savedSelect.appendChild(opt);
    });
  }

  function setStatus(msg) {
    els.saveStatus.textContent = msg;
    if (msg) {
      window.clearTimeout(setStatus._t);
      setStatus._t = window.setTimeout(function () {
        els.saveStatus.textContent = "";
      }, 4000);
    }
  }

  // ---------- Mutations ----------

  function addState() {
    var name = els.stateInput.value.trim();
    if (!name) return;
    if (state.states.indexOf(name) !== -1) {
      setStatus('State "' + name + '" already exists.');
      return;
    }
    state.states.push(name);
    els.stateInput.value = "";
    els.stateInput.focus();
    onDataChanged();
  }

  function removeState(index) {
    var removed = state.states[index];
    state.states.splice(index, 1);
    state.transitions = state.transitions.filter(function (t) {
      return t.from !== removed && t.to !== removed;
    });
    onDataChanged();
  }

  function addEvent() {
    var name = els.eventInput.value.trim();
    if (!name) return;
    if (state.events.indexOf(name) !== -1) {
      setStatus('Event "' + name + '" already exists.');
      return;
    }
    state.events.push(name);
    els.eventInput.value = "";
    els.eventInput.focus();
    onDataChanged();
  }

  function removeEvent(index) {
    var removed = state.events[index];
    state.events.splice(index, 1);
    state.transitions = state.transitions.filter(function (t) {
      return t.event !== removed;
    });
    onDataChanged();
  }

  function addTransition() {
    if (!state.states.length || !state.events.length) return;
    var from = els.transFrom.value;
    var event = els.transEvent.value;
    var to = els.transTo.value;
    if (!from || !event || !to) return;
    var exists = state.transitions.some(function (t) {
      return t.from === from && t.event === event && t.to === to;
    });
    if (exists) {
      setStatus("That transition already exists.");
      return;
    }
    state.transitions.push({ from: from, event: event, to: to });
    onDataChanged();
  }

  function removeTransition(index) {
    state.transitions.splice(index, 1);
    onDataChanged();
  }

  function onDataChanged() {
    persistCurrent();
    renderAll();
  }

  // ---------- Rendering: builder lists ----------

  function renderStatesList() {
    els.statesList.innerHTML = "";
    state.states.forEach(function (s, i) {
      var li = document.createElement("li");
      li.className = "chip";
      var span = document.createElement("span");
      span.textContent = s;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "×";
      btn.setAttribute("aria-label", "Remove state " + s);
      btn.addEventListener("click", function () {
        removeState(i);
      });
      li.appendChild(span);
      li.appendChild(btn);
      els.statesList.appendChild(li);
    });
  }

  function renderEventsList() {
    els.eventsList.innerHTML = "";
    state.events.forEach(function (ev, i) {
      var li = document.createElement("li");
      li.className = "chip";
      var span = document.createElement("span");
      span.textContent = ev;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "×";
      btn.setAttribute("aria-label", "Remove event " + ev);
      btn.addEventListener("click", function () {
        removeEvent(i);
      });
      li.appendChild(span);
      li.appendChild(btn);
      els.eventsList.appendChild(li);
    });
  }

  function renderTransSelects() {
    function fill(select, items, placeholder) {
      var prev = select.value;
      select.innerHTML = "";
      if (!items.length) {
        var opt = document.createElement("option");
        opt.value = "";
        opt.textContent = placeholder;
        select.appendChild(opt);
        select.disabled = true;
        return;
      }
      select.disabled = false;
      items.forEach(function (item) {
        var opt = document.createElement("option");
        opt.value = item;
        opt.textContent = item;
        select.appendChild(opt);
      });
      if (items.indexOf(prev) !== -1) select.value = prev;
    }
    fill(els.transFrom, state.states, "No states yet");
    fill(els.transEvent, state.events, "No events yet");
    fill(els.transTo, state.states, "No states yet");
    els.btnAddTrans.disabled = !(state.states.length && state.events.length);
  }

  function renderTransList() {
    els.transList.innerHTML = "";
    state.transitions.forEach(function (t, i) {
      var li = document.createElement("li");
      li.className = "chip";
      var span = document.createElement("span");
      span.textContent = t.from + " --(" + t.event + ")--> " + t.to;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "×";
      btn.setAttribute("aria-label", "Remove transition " + span.textContent);
      btn.addEventListener("click", function () {
        removeTransition(i);
      });
      li.appendChild(span);
      li.appendChild(btn);
      els.transList.appendChild(li);
    });
  }

  // ---------- Checklist computation ----------

  function buildChecklistItems() {
    var items = [];

    state.states.forEach(function (s) {
      items.push({ key: "state:" + s, label: "Define behavior and data for state: " + s, group: "States" });
    });

    state.events.forEach(function (ev) {
      items.push({ key: "event:" + ev, label: "Define handling for event: " + ev, group: "Events" });
    });

    state.transitions.forEach(function (t) {
      items.push({
        key: "trans:" + transKey(t),
        label: "Implement transition: " + t.from + " --(" + t.event + ")--> " + t.to,
        group: "Transitions"
      });
    });

    NAMING_CONVENTIONS.forEach(function (label, i) {
      items.push({ key: "naming:" + i, label: label, group: "Naming conventions" });
    });

    BEST_PRACTICES.forEach(function (label, i) {
      items.push({ key: "best:" + i, label: label, group: "Best practices" });
    });

    return items;
  }

  function computeAutoChecks() {
    var checks = [];
    var hasStates = state.states.length > 0;
    var hasEvents = state.events.length > 0;

    if (hasStates) {
      var reachable = {};
      reachable[state.states[0]] = true;
      state.transitions.forEach(function (t) {
        reachable[t.to] = true;
      });
      var unreachable = state.states.filter(function (s) {
        return !reachable[s];
      });
      if (unreachable.length) {
        checks.push({ ok: false, text: "Unreachable states (no incoming transitions): " + unreachable.join(", ") });
      } else {
        checks.push({ ok: true, text: "Every state is reachable by at least one transition (or is the first state)." });
      }

      var noOutgoing = state.states.filter(function (s) {
        return !state.transitions.some(function (t) {
          return t.from === s;
        });
      });
      if (noOutgoing.length) {
        checks.push({ ok: false, text: "States with no outgoing transitions (verify these are intentional terminal states): " + noOutgoing.join(", ") });
      } else {
        checks.push({ ok: true, text: "Every state has at least one outgoing transition." });
      }
    }

    if (hasEvents) {
      var unusedEvents = state.events.filter(function (ev) {
        return !state.transitions.some(function (t) {
          return t.event === ev;
        });
      });
      if (unusedEvents.length) {
        checks.push({ ok: false, text: "Events not used in any transition: " + unusedEvents.join(", ") });
      } else {
        checks.push({ ok: true, text: "Every defined event is used in at least one transition." });
      }
    }

    if (state.transitions.length) {
      var seen = {};
      var dupes = {};
      state.transitions.forEach(function (t) {
        var k = t.from + "|" + t.event;
        if (seen[k] && seen[k] !== t.to) {
          dupes[k] = true;
        }
        seen[k] = t.to;
      });
      var dupeKeys = Object.keys(dupes);
      if (dupeKeys.length) {
        checks.push({ ok: false, text: "Ambiguous transitions (same state/event pair, different targets): " + dupeKeys.map(function (k) { return k.replace("|", " on "); }).join(", ") });
      } else {
        checks.push({ ok: true, text: "No ambiguous transitions detected." });
      }
    }

    return checks;
  }

  function renderPreview() {
    var items = buildChecklistItems();
    var container = els.checklistOutput;
    container.innerHTML = "";

    if (!state.states.length && !state.events.length && !state.transitions.length) {
      var p = document.createElement("p");
      p.className = "empty-msg";
      p.textContent = "Add states, events, and transitions to generate your checklist.";
      container.appendChild(p);
      return;
    }

    var groups = ["States", "Events", "Transitions", "Naming conventions", "Best practices"];
    groups.forEach(function (groupName) {
      var groupItems = items.filter(function (it) {
        return it.group === groupName;
      });
      if (!groupItems.length) return;

      var section = document.createElement("div");
      section.className = "checklist-section";
      var h3 = document.createElement("h3");
      h3.textContent = groupName;
      section.appendChild(h3);

      var ul = document.createElement("ul");
      ul.className = "check-list";
      groupItems.forEach(function (it) {
        var li = document.createElement("li");
        var isChecked = !!state.checked[it.key];
        li.className = "checklist-item" + (isChecked ? " checked" : "");

        var checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        var id = "chk-" + slugify(it.key);
        checkbox.id = id;
        checkbox.checked = isChecked;
        checkbox.addEventListener("change", function () {
          state.checked[it.key] = checkbox.checked;
          persistCurrent();
          li.className = "checklist-item" + (checkbox.checked ? " checked" : "");
        });

        var label = document.createElement("label");
        label.setAttribute("for", id);
        label.textContent = it.label;

        li.appendChild(checkbox);
        li.appendChild(label);
        ul.appendChild(li);
      });
      section.appendChild(ul);
      container.appendChild(section);
    });

    var checks = computeAutoChecks();
    if (checks.length) {
      var checkSection = document.createElement("div");
      checkSection.className = "checklist-section";
      var h3c = document.createElement("h3");
      h3c.textContent = "Automated checks";
      checkSection.appendChild(h3c);
      var ulc = document.createElement("ul");
      ulc.className = "check-list";
      checks.forEach(function (c) {
        var li = document.createElement("li");
        li.className = c.ok ? "checks-pass" : "checks-warn";
        li.textContent = (c.ok ? "✓ " : "⚠ ") + c.text;
        ulc.appendChild(li);
      });
      checkSection.appendChild(ulc);
      container.appendChild(checkSection);
    }
  }

  function renderAll() {
    renderStatesList();
    renderEventsList();
    renderTransSelects();
    renderTransList();
    renderPreview();
  }

  // ---------- Save / Load / Delete / New ----------

  function handleSave() {
    var name = els.checklistName.value.trim();
    if (!name) {
      setStatus("Enter a checklist name before saving.");
      els.checklistName.focus();
      return;
    }
    state.name = name;
    var saved = getSaved();
    saved[name] = {
      name: name,
      states: state.states,
      events: state.events,
      transitions: state.transitions,
      checked: state.checked
    };
    if (setSaved(saved)) {
      refreshSavedSelect();
      els.savedSelect.value = name;
      persistCurrent();
      setStatus('Saved "' + name + '".');
    } else {
      setStatus("Could not save — storage may be full.");
    }
  }

  function handleLoad() {
    var name = els.savedSelect.value;
    if (!name) {
      setStatus("Choose a saved checklist to load.");
      return;
    }
    var saved = getSaved();
    var data = saved[name];
    if (!data) {
      setStatus("That checklist could not be found.");
      return;
    }
    state.name = data.name || name;
    state.states = Array.isArray(data.states) ? data.states.slice() : [];
    state.events = Array.isArray(data.events) ? data.events.slice() : [];
    state.transitions = Array.isArray(data.transitions) ? data.transitions.slice() : [];
    state.checked = data.checked && typeof data.checked === "object" ? Object.assign({}, data.checked) : {};
    els.checklistName.value = state.name;
    persistCurrent();
    renderAll();
    setStatus('Loaded "' + name + '".');
  }

  function handleDelete() {
    var name = els.savedSelect.value;
    if (!name) {
      setStatus("Choose a saved checklist to delete.");
      return;
    }
    var saved = getSaved();
    delete saved[name];
    setSaved(saved);
    refreshSavedSelect();
    setStatus('Deleted "' + name + '".');
  }

  function handleNew() {
    state.name = "";
    state.states = [];
    state.events = [];
    state.transitions = [];
    state.checked = {};
    els.checklistName.value = "";
    els.savedSelect.value = "";
    persistCurrent();
    renderAll();
    setStatus("Started a new checklist.");
  }

  // ---------- Download ----------

  function buildDownloadHtml() {
    var title = state.name || "State Machine Checklist";
    var items = buildChecklistItems();
    var checks = computeAutoChecks();
    var groups = ["States", "Events", "Transitions", "Naming conventions", "Best practices"];

    var sectionsHtml = groups.map(function (groupName) {
      var groupItems = items.filter(function (it) { return it.group === groupName; });
      if (!groupItems.length) return "";
      var rows = groupItems.map(function (it) {
        var id = "chk-" + slugify(it.key);
        var checkedAttr = state.checked[it.key] ? " checked" : "";
        return '<li class="checklist-item"><input type="checkbox" id="' + id + '" data-key="' + escapeHtml(it.key) + '"' + checkedAttr + '>' +
          '<label for="' + id + '">' + escapeHtml(it.label) + "</label></li>";
      }).join("\n");
      return '<div class="checklist-section"><h3>' + escapeHtml(groupName) + '</h3><ul class="check-list">' + rows + "</ul></div>";
    }).join("\n");

    var checksHtml = "";
    if (checks.length) {
      var checkRows = checks.map(function (c) {
        return '<li class="' + (c.ok ? "checks-pass" : "checks-warn") + '">' + (c.ok ? "&#10003; " : "&#9888; ") + escapeHtml(c.text) + "</li>";
      }).join("\n");
      checksHtml = '<div class="checklist-section"><h3>Automated checks (at time of export)</h3><ul class="check-list">' + checkRows + "</ul></div>";
    }

    var storageKey = "smc_export_" + slugify(title);

    return "<!DOCTYPE html>\n" +
      '<html lang="en">\n<head>\n<meta charset="UTF-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
      "<title>" + escapeHtml(title) + " — State Machine Checklist</title>\n" +
      "<style>\n" +
      "body{background:#0f1115;color:#e4e6eb;font-family:SFMono-Regular,Consolas,'Liberation Mono',Menlo,Courier,monospace;line-height:1.5;max-width:760px;margin:0 auto;padding:2rem 1.25rem;}\n" +
      "h1{font-size:1.5rem;} h3{font-size:0.9rem;color:#9aa0ac;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #2a2e38;padding-bottom:0.3rem;}\n" +
      ".checklist-section{margin-top:1.25rem;} ul.check-list{list-style:none;margin:0;padding:0;}\n" +
      ".checklist-item{display:flex;gap:0.5rem;align-items:flex-start;padding:0.35rem 0;font-size:0.95rem;}\n" +
      ".checklist-item input{margin-top:0.2rem;accent-color:#5fd3a4;}\n" +
      ".checklist-item.checked label{color:#9aa0ac;text-decoration:line-through;}\n" +
      ".checks-pass{color:#5fd3a4;padding:0.3rem 0;font-size:0.85rem;} .checks-warn{color:#e0b85f;padding:0.3rem 0;font-size:0.85rem;}\n" +
      "footer{margin-top:2rem;color:#9aa0ac;font-size:0.85rem;text-align:center;border-top:1px solid #2a2e38;padding-top:1rem;}\n" +
      "</style>\n</head>\n<body>\n" +
      "<h1>" + escapeHtml(title) + "</h1>\n" +
      "<p>Exported state machine checklist. Progress on this page is saved to this browser only.</p>\n" +
      sectionsHtml + "\n" + checksHtml + "\n" +
      "<footer><p>Made by Eli</p></footer>\n" +
      "<script>\n" +
      "(function(){\n" +
      'var STORAGE_KEY = "' + storageKey + '";\n' +
      "var saved = {};\n" +
      "try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || \"{}\") || {}; } catch(e) { saved = {}; }\n" +
      'document.querySelectorAll(".checklist-item input[type=checkbox]").forEach(function(cb){\n' +
      "  var key = cb.getAttribute('data-key');\n" +
      "  if (Object.prototype.hasOwnProperty.call(saved, key)) { cb.checked = !!saved[key]; }\n" +
      "  var li = cb.closest('.checklist-item');\n" +
      "  if (cb.checked) li.classList.add('checked');\n" +
      "  cb.addEventListener('change', function(){\n" +
      "    saved[key] = cb.checked;\n" +
      "    li.classList.toggle('checked', cb.checked);\n" +
      "    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); } catch(e) {}\n" +
      "  });\n" +
      "});\n" +
      "})();\n" +
      "</script>\n" +
      "</body>\n</html>\n";
  }

  function handleDownload() {
    var html = buildDownloadHtml();
    var blob = new Blob([html], { type: "text/html" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    var filename = slugify(state.name || "state-machine-checklist") + ".html";
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setStatus("Downloaded " + filename);
  }

  // ---------- Init ----------

  function attachEvents() {
    els.btnThemeToggle.addEventListener("click", toggleTheme);

    els.btnAddState.addEventListener("click", addState);
    els.stateInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); addState(); }
    });

    els.btnAddEvent.addEventListener("click", addEvent);
    els.eventInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); addEvent(); }
    });

    els.btnAddTrans.addEventListener("click", addTransition);

    els.btnSave.addEventListener("click", handleSave);
    els.btnLoad.addEventListener("click", handleLoad);
    els.btnDelete.addEventListener("click", handleDelete);
    els.btnNew.addEventListener("click", handleNew);
    els.btnDownload.addEventListener("click", handleDownload);
  }

  function init() {
    loadTheme();
    loadCurrent();
    els.checklistName.value = state.name || "";
    refreshSavedSelect();
    attachEvents();
    renderAll();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
