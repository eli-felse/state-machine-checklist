#!/usr/bin/env node
/*
 * Dependency-free tests for State Machine Checklist.
 *
 *   node tests/run-tests.js
 *
 * script.js is loaded unmodified into a Node `vm` context with a minimal fake
 * DOM, then driven through the same buttons/inputs a user would use.
 * Covers:
 *   1. The "unreachable states" automated check.
 *   2. The downloaded HTML export always using the dark theme.
 */
"use strict";

var fs = require("fs");
var path = require("path");
var vm = require("vm");
var assert = require("assert");

var ROOT = path.join(__dirname, "..");
var SCRIPT_SRC = fs.readFileSync(path.join(ROOT, "script.js"), "utf8");
var CSS_SRC = fs.readFileSync(path.join(ROOT, "style.css"), "utf8");

// ---------- Minimal fake DOM ----------

function FakeElement(tag, id) {
  this.tagName = String(tag || "div").toUpperCase();
  this.id = id || "";
  this.children = [];
  this.parent = null;
  this.listeners = {};
  this.attributes = {};
  this.className = "";
  this.value = "";
  this.checked = false;
  this.disabled = false;
  this.style = {};
  this._text = null;
  var self = this;
  this.classList = {
    contains: function (c) { return self.className.split(/\s+/).indexOf(c) !== -1; },
    add: function (c) { if (!this.contains(c)) self.className = (self.className + " " + c).trim(); },
    remove: function (c) {
      self.className = self.className.split(/\s+/).filter(function (x) { return x && x !== c; }).join(" ");
    },
    toggle: function (c, force) {
      var on = force === undefined ? !this.contains(c) : !!force;
      if (on) this.add(c); else this.remove(c);
      return on;
    }
  };
}

Object.defineProperty(FakeElement.prototype, "textContent", {
  get: function () {
    if (this._text !== null) return this._text;
    return this.children.map(function (c) { return c.textContent; }).join("");
  },
  set: function (v) {
    this.children = [];
    this._text = String(v);
  }
});

Object.defineProperty(FakeElement.prototype, "innerHTML", {
  get: function () { return ""; },
  set: function () {
    // The app only ever assigns markup to reset a container.
    this.children = [];
    this._text = null;
    if (this.tagName === "SELECT") this.value = "";
  }
});

FakeElement.prototype.appendChild = function (child) {
  child.parent = this;
  this._text = null;
  this.children.push(child);
  // A real <select> selects its first option by default.
  if (this.tagName === "SELECT" && child.tagName === "OPTION" && this.children.length === 1) {
    this.value = child.value;
  }
  return child;
};
FakeElement.prototype.removeChild = function (child) {
  this.children = this.children.filter(function (c) { return c !== child; });
  return child;
};
FakeElement.prototype.setAttribute = function (k, v) { this.attributes[k] = String(v); };
FakeElement.prototype.getAttribute = function (k) {
  return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null;
};
FakeElement.prototype.addEventListener = function (type, fn) {
  (this.listeners[type] = this.listeners[type] || []).push(fn);
};
FakeElement.prototype.dispatch = function (type, extra) {
  var ev = Object.assign({ type: type, target: this, preventDefault: function () {} }, extra || {});
  (this.listeners[type] || []).slice().forEach(function (fn) { fn(ev); });
};
FakeElement.prototype.click = function () { this.dispatch("click"); };
FakeElement.prototype.focus = function () {};

function findAll(root, pred, out) {
  out = out || [];
  if (pred(root)) out.push(root);
  root.children.forEach(function (c) { findAll(c, pred, out); });
  return out;
}

// ---------- App harness ----------

function makeStorage(initial) {
  var data = Object.assign({}, initial || {});
  return {
    data: data,
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
    setItem: function (k, v) { data[k] = String(v); },
    removeItem: function (k) { delete data[k]; }
  };
}

/** Load script.js into a fresh fake page. Pass a storage object to simulate a reload. */
var SELECT_IDS = ["saved-select", "trans-from", "trans-event", "trans-to"];

function createApp(storage) {
  storage = storage || makeStorage();
  var elements = {};
  var body = new FakeElement("body");
  var domReady = [];
  var downloads = [];

  var document = {
    body: body,
    getElementById: function (id) {
      return elements[id] || (elements[id] = new FakeElement(SELECT_IDS.indexOf(id) !== -1 ? "select" : "div", id));
    },
    createElement: function (tag) { return new FakeElement(tag); },
    createTextNode: function (text) {
      var n = new FakeElement("#text");
      n._text = String(text);
      return n;
    },
    addEventListener: function (type, fn) { if (type === "DOMContentLoaded") domReady.push(fn); }
  };

  var realCreate = document.createElement;
  document.createElement = function (tag) {
    var el = realCreate(tag);
    if (String(tag).toLowerCase() === "a") {
      el.click = function () { downloads.push({ filename: el.download, href: el.href }); };
    }
    return el;
  };

  var blobs = {};
  var blobCount = 0;
  function FakeBlob(parts, opts) { this.parts = parts; this.type = opts && opts.type; }

  var sandbox = {
    document: document,
    window: { setTimeout: function () { return 0; }, clearTimeout: function () {} },
    localStorage: storage,
    Blob: FakeBlob,
    URL: {
      createObjectURL: function (blob) { var u = "blob:test/" + (++blobCount); blobs[u] = blob; return u; },
      revokeObjectURL: function () {}
    },
    console: console
  };
  vm.runInNewContext(SCRIPT_SRC, sandbox, { filename: "script.js" });
  domReady.forEach(function (fn) { fn(); });

  var $ = function (id) { return document.getElementById(id); };

  var app = {
    storage: storage,
    body: body,
    $: $,
    downloads: downloads,
    addState: function (name) { $("state-input").value = name; $("btn-add-state").click(); },
    addEvent: function (name) { $("event-input").value = name; $("btn-add-event").click(); },
    addTransition: function (from, event, to) {
      $("trans-from").value = from;
      $("trans-event").value = event;
      $("trans-to").value = to;
      $("btn-add-trans").click();
    },
    removeTransitionAt: function (i) {
      var btns = findAll($("trans-list"), function (n) { return n.tagName === "BUTTON"; });
      btns[i].click();
    },
    removeStateAt: function (i) {
      var btns = findAll($("states-list"), function (n) { return n.tagName === "BUTTON"; });
      btns[i].click();
    },
    setTerminal: function (name, on) {
      var boxes = findAll($("states-list"), function (n) {
        return n.tagName === "INPUT" && n.getAttribute("aria-label") === "Mark state " + name + " as terminal";
      });
      boxes[0].checked = on;
      boxes[0].dispatch("change");
    },
    toggleTheme: function () { $("btn-theme-toggle").click(); },
    /** Automated-check rows currently shown: [{ ok, text }] */
    checks: function () {
      return findAll($("checklist-output"), function (n) {
        return n.className === "checks-pass" || n.className === "checks-warn";
      }).map(function (n) { return { ok: n.className === "checks-pass", text: n.textContent }; });
    },
    unreachableCheck: function () {
      var all = app.checks().filter(function (c) {
        return /Unreachable states|Every state is reachable/.test(c.text);
      });
      return all[0] || null;
    },
    checkItem: function (key) {
      var id = "chk-" + key.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      var box = findAll($("checklist-output"), function (n) { return n.id === id; })[0];
      assert.ok(box, "checkbox " + id + " should exist");
      box.checked = true;
      box.dispatch("change");
    },
    /** Click "Download as HTML" and return the exported document text. */
    exportHtml: function () {
      var before = downloads.length;
      $("btn-download").click();
      assert.strictEqual(downloads.length, before + 1, "download should have been triggered");
      var d = downloads[downloads.length - 1];
      return { html: blobs[d.href].parts.join(""), filename: d.filename, type: blobs[d.href].type };
    },
    save: function (name) { $("checklist-name").value = name; $("btn-save").click(); },
    load: function (name) { $("saved-select").value = name; $("btn-load").click(); }
  };
  return app;
}

// ---------- Tiny test runner ----------

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

// ---------- Helpers for the dark/light palette ----------

function cssVars(blockRegex) {
  var m = CSS_SRC.match(blockRegex);
  assert.ok(m, "style.css block not found: " + blockRegex);
  var vars = {};
  m[1].replace(/(--[a-z-]+)\s*:\s*([^;]+);/g, function (_, k, v) { vars[k] = v.trim().toLowerCase(); });
  return vars;
}
var DARK = cssVars(/:root\s*\{([^}]*)\}/);
var LIGHT = cssVars(/body\.light-theme\s*\{([^}]*)\}/);
var EXPORT_VARS = ["--bg", "--panel-border", "--text", "--text-dim", "--accent", "--warn"];

function exportedVars(html) {
  var m = html.match(/:root\{([^}]*)\}/);
  assert.ok(m, "export should declare :root variables");
  var vars = {};
  m[1].replace(/(--[a-z-]+)\s*:\s*([^;]+);/g, function (_, k, v) { vars[k] = v.trim().toLowerCase(); });
  return vars;
}

function buildSampleMachine(app) {
  app.addState("Idle");
  app.addState("Running");
  app.addState("Done");
  app.addEvent("start");
  app.addEvent("finish");
  app.addTransition("Idle", "start", "Running");
  app.addTransition("Running", "finish", "Done");
  app.setTerminal("Done", true);
}

// =====================================================================
// Unreachable states
// =====================================================================

test("unreachable: no states -> no reachability check is shown", function () {
  var app = createApp();
  assert.strictEqual(app.unreachableCheck(), null);
  app.addEvent("go");
  assert.strictEqual(app.unreachableCheck(), null, "events alone must not produce a reachability check");
});

test("unreachable: a single state is the initial state and is reachable", function () {
  var app = createApp();
  app.addState("Idle");
  var c = app.unreachableCheck();
  assert.ok(c && c.ok, "lone first state should pass");
});

test("unreachable: first state is the initial state; later states with no incoming transitions are flagged", function () {
  var app = createApp();
  app.addState("Idle");
  app.addState("Running");
  var c = app.unreachableCheck();
  assert.ok(c && !c.ok);
  assert.ok(/Unreachable states/.test(c.text));
  assert.ok(/Running/.test(c.text), "Running should be listed");
  assert.ok(!/Idle/.test(c.text), "initial state Idle must not be listed");
});

test("unreachable: an incoming transition makes the target reachable", function () {
  var app = createApp();
  app.addState("Idle");
  app.addState("Running");
  app.addEvent("start");
  app.addTransition("Idle", "start", "Running");
  var c = app.unreachableCheck();
  assert.ok(c.ok, "check should pass once Running has an incoming transition");
  assert.ok(/reachable/.test(c.text));
});

test("unreachable: initial state A transitions to B, but C is never targeted by any transition", function () {
  var app = createApp();
  app.addState("A");
  app.addState("B");
  app.addState("C");
  app.addEvent("go");
  app.addTransition("A", "go", "B");
  var c = app.unreachableCheck();
  assert.ok(!c.ok);
  assert.ok(/Unreachable states/.test(c.text));
  assert.ok(/\bC\b/.test(c.text), "C has no incoming transition, so it should be flagged");
  assert.ok(!/\bA\b/.test(c.text), "initial state A must not be flagged");
  assert.ok(!/\bB\b/.test(c.text), "B has an incoming transition from A, so it must not be flagged");
});

test("unreachable: a non-terminal state whose only transition is a self-loop can't make progress toward a terminal state", function () {
  var app = createApp();
  app.addState("A");
  app.addState("Done");
  app.addEvent("spin");
  app.addTransition("A", "spin", "A");
  app.setTerminal("Done", true);
  var c = app.unreachableCheck();
  assert.ok(!c.ok, "Done has no incoming transition, so it must stay flagged as unreachable");
  assert.ok(/\bDone\b/.test(c.text));
  assert.ok(!/\bA\b/.test(c.text), "A is the initial state, so its self-loop must not cause it to be flagged");
});

test("unreachable: every unreachable state is listed, comma-separated, in definition order", function () {
  var app = createApp();
  ["Start", "Orphan1", "Mid", "Orphan2"].forEach(app.addState);
  app.addEvent("go");
  app.addTransition("Start", "go", "Mid");
  var c = app.unreachableCheck();
  assert.ok(!c.ok);
  assert.ok(/: Orphan1, Orphan2$/.test(c.text), "got: " + c.text);
  assert.ok(!/Mid/.test(c.text));
  assert.ok(!/Start/.test(c.text));
});

test("unreachable: terminal flag does not make an unreachable state reachable", function () {
  var app = createApp();
  app.addState("Idle");
  app.addState("Done");
  app.setTerminal("Done", true);
  var c = app.unreachableCheck();
  assert.ok(!c.ok && /Done/.test(c.text));
});

test("unreachable: a transition out of a state does not make that state reachable", function () {
  var app = createApp();
  app.addState("Idle");
  app.addState("Island");
  app.addState("Target");
  app.addEvent("go");
  app.addTransition("Island", "go", "Target");
  var c = app.unreachableCheck();
  assert.ok(!c.ok);
  assert.ok(/Island/.test(c.text), "Island has only outgoing transitions");
  assert.ok(/Target/.test(c.text) === false, "Target has an incoming transition (the check reports missing incoming transitions)");
});

test("unreachable: removing the only incoming transition flags the state again", function () {
  var app = createApp();
  app.addState("Idle");
  app.addState("Running");
  app.addEvent("start");
  app.addTransition("Idle", "start", "Running");
  assert.ok(app.unreachableCheck().ok);
  app.removeTransitionAt(0);
  var c = app.unreachableCheck();
  assert.ok(!c.ok && /Running/.test(c.text));
});

test("unreachable: removing an event drops its transitions and re-flags the target", function () {
  var app = createApp();
  app.addState("Idle");
  app.addState("Running");
  app.addEvent("start");
  app.addTransition("Idle", "start", "Running");
  app.$("events-list");
  var removeBtn = findAll(app.$("events-list"), function (n) { return n.tagName === "BUTTON"; })[0];
  removeBtn.click();
  var c = app.unreachableCheck();
  assert.ok(!c.ok && /Running/.test(c.text));
});

test("unreachable: removing the first state promotes the next state to initial", function () {
  var app = createApp();
  app.addState("Idle");
  app.addState("Running");
  assert.ok(/Running/.test(app.unreachableCheck().text));
  app.removeStateAt(0);
  var c = app.unreachableCheck();
  assert.ok(c.ok, "Running is now the first (initial) state, so it is reachable");
});

test("unreachable: removing a state removes transitions that targeted it", function () {
  var app = createApp();
  ["Idle", "A", "B"].forEach(app.addState);
  app.addEvent("go");
  app.addTransition("Idle", "go", "A");
  app.addTransition("A", "go", "B");
  assert.ok(app.unreachableCheck().ok);
  app.removeStateAt(1); // remove A, which also removes Idle->A and A->B
  var c = app.unreachableCheck();
  assert.ok(!c.ok && /B/.test(c.text), "B lost its incoming transition");
});

test("unreachable: result survives save / new / load", function () {
  var app = createApp();
  app.addState("Idle");
  app.addState("Orphan");
  app.save("Demo");
  app.$("btn-new").click();
  assert.strictEqual(app.unreachableCheck(), null, "new checklist is empty");
  app.load("Demo");
  var c = app.unreachableCheck();
  assert.ok(!c.ok && /Orphan/.test(c.text));
});

test("unreachable: result survives a page reload (current checklist is persisted)", function () {
  var first = createApp();
  first.addState("Idle");
  first.addState("Orphan");
  var second = createApp(first.storage);
  var c = second.unreachableCheck();
  assert.ok(c && !c.ok && /Orphan/.test(c.text));
});

test("unreachable: state names containing HTML are shown as text", function () {
  var app = createApp();
  app.addState("Idle");
  app.addState("<b>x</b>");
  var c = app.unreachableCheck();
  assert.ok(c.text.indexOf("<b>x</b>") !== -1, "name displayed verbatim via textContent");
});

test("unreachable: warning appears in the exported HTML, with names escaped", function () {
  var app = createApp();
  app.addState("Idle");
  app.addState("<img src=x onerror=alert(1)>");
  var out = app.exportHtml().html;
  assert.ok(/class="checks-warn">&#9888; Unreachable states/.test(out), "warning row exported");
  assert.ok(out.indexOf("<img src=x") === -1, "raw HTML from state names must be escaped");
  assert.ok(out.indexOf("&lt;img src=x onerror=alert(1)&gt;") !== -1);
});

test("unreachable: passing check is exported as a pass row", function () {
  var app = createApp();
  buildSampleMachine(app);
  var out = app.exportHtml().html;
  assert.ok(/class="checks-pass">&#10003; Every state is reachable/.test(out));
  assert.ok(!/Unreachable states/.test(out));
});

// =====================================================================
// Dark-mode export
// =====================================================================

test("export: filename is a slug of the checklist name and type is text/html", function () {
  var app = createApp();
  buildSampleMachine(app);
  app.$("checklist-name").value = "Traffic Light!";
  app.save("Traffic Light!");
  var out = app.exportHtml();
  assert.strictEqual(out.filename, "traffic-light.html");
  assert.strictEqual(out.type, "text/html");
});

test("export (dark editor): declares the dark palette and color-scheme", function () {
  var app = createApp();
  buildSampleMachine(app);
  assert.ok(!app.body.classList.contains("light-theme"), "editor starts dark");
  var html = app.exportHtml().html;
  assert.ok(/color-scheme:\s*dark/.test(html), "color-scheme: dark");
  assert.ok(!/color-scheme:\s*light/.test(html));
  var vars = exportedVars(html);
  EXPORT_VARS.forEach(function (k) {
    assert.strictEqual(vars[k], DARK[k], k + " in export should equal the dark value in style.css");
  });
});

test("export (light editor): still uses the dark palette", function () {
  var app = createApp();
  buildSampleMachine(app);
  app.toggleTheme();
  assert.ok(app.body.classList.contains("light-theme"), "editor is now light");
  assert.strictEqual(app.$("btn-theme-toggle").textContent, "Dark mode");
  var html = app.exportHtml().html;
  var vars = exportedVars(html);
  EXPORT_VARS.forEach(function (k) {
    assert.strictEqual(vars[k], DARK[k], k + " must be the dark value even from light mode");
    assert.notStrictEqual(vars[k], LIGHT[k], k + " must not be the light value");
  });
  assert.ok(/color-scheme:\s*dark/.test(html));
});

test("export: byte-identical whether exported from light or dark editor theme", function () {
  var app = createApp();
  buildSampleMachine(app);
  var dark = app.exportHtml().html;
  app.toggleTheme();
  var light = app.exportHtml().html;
  app.toggleTheme();
  var darkAgain = app.exportHtml().html;
  assert.strictEqual(light, dark);
  assert.strictEqual(darkAgain, dark);
});

test("export: contains no light-theme class or light palette colours", function () {
  var app = createApp();
  buildSampleMachine(app);
  app.toggleTheme();
  var html = app.exportHtml().html.toLowerCase();
  assert.ok(html.indexOf("light-theme") === -1);
  EXPORT_VARS.forEach(function (k) {
    if (LIGHT[k] !== DARK[k]) {
      assert.ok(html.indexOf(LIGHT[k]) === -1, "light colour " + LIGHT[k] + " leaked into export");
    }
  });
});

test("export: dark background is applied to both html and body", function () {
  var app = createApp();
  buildSampleMachine(app);
  var html = app.exportHtml().html;
  assert.ok(/html\{background:var\(--bg\);?\}/.test(html));
  assert.ok(/body\{[^}]*background:var\(--bg\)/.test(html));
  assert.ok(/body\{[^}]*color:var\(--text\)/.test(html));
});

test("export: dark even when light theme is restored from storage on reload", function () {
  var first = createApp();
  buildSampleMachine(first);
  first.toggleTheme();
  assert.strictEqual(first.storage.getItem("smc_theme"), "light");
  var reloaded = createApp(first.storage);
  assert.ok(reloaded.body.classList.contains("light-theme"), "reload restores light theme");
  var vars = exportedVars(reloaded.exportHtml().html);
  assert.strictEqual(vars["--bg"], DARK["--bg"]);
  assert.strictEqual(vars["--text"], DARK["--text"]);
});

test("export: toggling the editor theme does not change the stored export content or checklist data", function () {
  var app = createApp();
  buildSampleMachine(app);
  var before = JSON.parse(app.storage.getItem("smc_current_checklist"));
  app.toggleTheme();
  app.toggleTheme();
  var after = JSON.parse(app.storage.getItem("smc_current_checklist"));
  assert.deepStrictEqual(after, before);
  assert.strictEqual(app.storage.getItem("smc_theme"), "dark");
});

test("export: is self-contained (inline style + script, no external resources)", function () {
  var app = createApp();
  buildSampleMachine(app);
  var html = app.exportHtml().html;
  assert.ok(/^<!DOCTYPE html>/.test(html));
  assert.strictEqual((html.match(/<style>/g) || []).length, 1);
  assert.strictEqual((html.match(/<script>/g) || []).length, 1);
  assert.ok(!/<link\b/i.test(html), "no <link> tags");
  assert.ok(!/<script[^>]+src=/i.test(html), "no external scripts");
  assert.ok(!/@import/i.test(html), "no CSS imports");
  assert.ok(!/https?:\/\//i.test(html), "no absolute URLs");
  assert.ok(!/style\.css|script\.js/.test(html), "no references to app files");
});

test("export: keeps the Made by Eli footer", function () {
  var app = createApp();
  buildSampleMachine(app);
  assert.ok(/<footer><p>Made by Eli<\/p><\/footer>/.test(app.exportHtml().html));
});

test("export: contains all checklist sections, states, events and transitions", function () {
  var app = createApp();
  buildSampleMachine(app);
  var html = app.exportHtml().html;
  ["States", "Events", "Transitions", "Naming conventions", "Best practices"].forEach(function (g) {
    assert.ok(html.indexOf("<h3>" + g + "</h3>") !== -1, "section " + g);
  });
  assert.ok(html.indexOf("Define behavior and data for state: Running") !== -1);
  assert.ok(html.indexOf("Define handling for event: finish") !== -1);
  assert.ok(html.indexOf("Implement transition: Idle --(start)--&gt; Running") !== -1);
  assert.ok(html.indexOf("Automated checks (at time of export)") !== -1);
});

test("export: ticked items are exported as checked, unticked are not", function () {
  var app = createApp();
  buildSampleMachine(app);
  app.checkItem("state:Idle");
  var html = app.exportHtml().html;
  assert.ok(/id="chk-state-idle" data-key="state:Idle" checked>/.test(html));
  assert.ok(/id="chk-state-running" data-key="state:Running">/.test(html));
});

test("export: checklist name is escaped in title and heading", function () {
  var app = createApp();
  buildSampleMachine(app);
  app.save('</title><script>alert(1)</script>');
  var html = app.exportHtml().html;
  assert.ok(html.indexOf("</title><script>alert(1)") === -1, "raw markup from name must not appear");
  assert.ok(html.indexOf("&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;") !== -1);
});

test("export: empty checklist still exports a valid dark page with a default title", function () {
  var app = createApp();
  var out = app.exportHtml();
  assert.strictEqual(out.filename, "state-machine-checklist.html");
  assert.ok(out.html.indexOf("<h1>State Machine Checklist</h1>") !== -1);
  assert.ok(/color-scheme:\s*dark/.test(out.html));
  assert.strictEqual(exportedVars(out.html)["--bg"], DARK["--bg"]);
});

test("export: embedded script is syntactically valid JavaScript", function () {
  var app = createApp();
  buildSampleMachine(app);
  var html = app.exportHtml().html;
  var m = html.match(/<script>\n([\s\S]*?)<\/script>/);
  assert.ok(m, "inline script present");
  assert.doesNotThrow(function () { new vm.Script(m[1]); });
});

// ---------- Run ----------

var passed = 0;
var failed = 0;
tests.forEach(function (t) {
  try {
    t.fn();
    passed++;
    console.log("  ok   - " + t.name);
  } catch (e) {
    failed++;
    console.log("  FAIL - " + t.name);
    console.log("         " + String(e && e.stack || e).split("\n").slice(0, 4).join("\n         "));
  }
});
console.log("\n" + passed + " passed, " + failed + " failed (" + tests.length + " total)");
process.exit(failed ? 1 : 0);
