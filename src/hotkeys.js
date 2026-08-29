/* =====================================================================================
 * Ui24R CUSTOM LAYOUT — Custom Hotkeys engine + Settings > HOTKEYS page
 * -------------------------------------------------------------------------------------
 * Load this AFTER custom.js (which fixes/adds the Player tab) and after the main
 * mixer app script.
 *
 * WHAT THIS ADDS
 *   - A fully rebindable keyboard-shortcut layer sitting in front of the app's own
 *     `handleKey()`. Anything not explicitly rebound behaves exactly like stock.
 *   - A brand new action, "Tap Tempo", bound to the Space bar by default (stock used
 *     Space as a second shortcut for the Home/Logo button - that's moved off Space
 *     but is still available on the "8" key, so nothing is lost).
 *   - A new SETTINGS > HOTKEYS tab that lists every shortcut with its current key and
 *     a "click, then press a key" rebind control, plus a reset-to-defaults button.
 *   - Bindings are saved in this browser's localStorage (key: "ui24rCustomHotkeys")
 *     and reloaded automatically next time the page runs.
 * ===================================================================================== */

(function () {
  "use strict";

  if (typeof handleKey !== "function") {
    console.error("[Ui24R Hotkeys] handleKey() not found - main app not loaded yet.");
    return;
  }

  var STORAGE_KEY = "ui24rCustomHotkeys";

  function safe(fn) {
    try { return fn(); } catch (e) { console.error("[Ui24R Hotkeys]", e); }
  }

  /* ----------------------------------------------------------------------------- *
   * Key helpers
   * ----------------------------------------------------------------------------- */

  // Turns a KeyboardEvent into a stable, human-readable id like "Space", "Q", "Tab",
  // "ArrowLeft", "Ctrl+Z". Used both for storage and for the on-screen badge text.
  function keyIdFromEvent(e) {
    var k = e.key;
    if (k === " ") k = "Space";
    else if (k.length === 1) k = k.toUpperCase();
    var mods = "";
    if (e.ctrlKey) mods += "Ctrl+";
    if (e.altKey) mods += "Alt+";
    if (e.shiftKey && k.length > 1) mods += "Shift+"; // ignore shift for plain letters/digits
    return mods + k;
  }

  function prettyKey(id) {
    return id ? id.replace(/Arrow/g, "") : "—";
  }

  /* ----------------------------------------------------------------------------- *
   * Action guards (copied 1:1 from the stock handleKey() switch bodies so behaviour
   * matches exactly - only *which key* triggers them is now configurable)
   * ----------------------------------------------------------------------------- */

  function inChannelModes() {
    switch (mode) {
      case E_MODE.BIG: case E_MODE.MIX: case E_MODE.GAIN: case E_MODE.EDIT:
      case E_MODE.AUX: case E_MODE.FXSENDS:
        return true;
      default:
        return false;
    }
  }

  function doCycleTabs() {
    switch (mode) {
      case E_MODE.BIG: nextBMode(); break;
      case E_MODE.MIX: if (slideOutWidget.enabled && "SlideOut2" == slideOutWidget.widgetName) slideOutWidget.nextMode(); break;
      case E_MODE.EDIT: editWidget.nextMode(); break;
      case E_MODE.AUX: auxWidget.nextMode(); break;
      case E_MODE.FXSENDS: fxSendsWidget.nextMode(); break;
      case E_MODE.SETTINGS: settingsWidget.nextMode(); break;
      case E_MODE.MODALS: modalsWidget.nextMode(); break;
      case E_MODE.PLAYER: if (IS_UI_24) playerWidget.nextMode(); break;
    }
  }

  function doMuteSelected() {
    switch (mode) {
      case E_MODE.MIX: case E_MODE.BIG: case E_MODE.EDIT:
        selectedStrip.mute && selectedStrip.mute.click();
        break;
      case E_MODE.AUX: {
        var s = (1 == auxStrips[auxWidget.mode].getNameValue("matrix"))
          ? findByID(mtxSendStrips, selectedStrip.id)
          : findByID(auxSendStrips, selectedStrip.id);
        s && s.mute && s.mute.click();
        break;
      }
      case E_MODE.FXSENDS: {
        var s2 = findByID(fxSendStrips, selectedStrip.id);
        s2 && s2.mute && s2.mute.click();
        break;
      }
    }
  }

  function doSoloSelected() {
    switch (mode) {
      case E_MODE.MIX: case E_MODE.BIG: case E_MODE.EDIT: break;
      default: return;
    }
    if (selectedStrip.solo) {
      selectedStrip.solo.click();
      if (mode == E_MODE.MODALS) regUpdate(tvWidget);
    }
  }

  function doPresetsMenu() {
    if (mode == E_MODE.EDIT) {
      if (null != currentPresetWindow) currentPresetWindow.close();
      else editWidget.showPresets();
    }
    if (mode == E_MODE.MIX || mode == E_MODE.BIG) {
      switch (selectedStrip.type) {
        case E_STRIP_TYPE.MASTER: case E_STRIP_TYPE.VCA: return;
      }
      if (mWidgets.length) { if ("PRESET_MENU" == mWidgets[0].widgetName) clearModals(); }
      else { clearModals(); mixerWidget.showPresets(); }
    }
  }

  function doToggleUdp() {
    if (!settings.udp) return;
    if (mode != E_MODE.MODALS || modalsWidget.mode != E_MODAL_MODE.UDP) {
      setMode(E_MODE.MODALS);
      modalsWidget.setMode(E_MODAL_MODE.UDP);
    } else setMode(E_MODE.MIX);
  }

  function doRenameChannel() {
    switch (mode) {
      case E_MODE.BIG: case E_MODE.MIX: case E_MODE.GAIN: case E_MODE.EDIT:
      case E_MODE.AUX: case E_MODE.FXSENDS:
        break;
      default: return;
    }
    callChannelRename();
  }

  /* ----------------------------------------------------------------------------- *
   * Default action list. `run` fires the action; `enabled` (optional) hides it from
   * rebinding attempts firing when it wouldn't make sense (kept minimal on purpose -
   * the guards above already make each action a safe no-op in the wrong mode).
   * ----------------------------------------------------------------------------- */

  var ACTIONS = [
    { id: "tapTempo", label: "Tap Tempo", def: "Space", run: function () { bpmTapHandler(-1); } },
    { id: "home", label: "Home / Resume", def: "8", run: function () { topWidget.bLogo.click(); } },

    { id: "viewMeters", label: "View: Meters", def: "1", run: function () { topWidget.bTOTAL.click(); } },
    { id: "viewMix", label: "View: Mix", def: "2", run: function () { topWidget.bMix.click(); } },
    { id: "viewEdit", label: "View: Edit", def: "3", run: function () { topWidget.bEDIT.click(); } },
    { id: "viewAux", label: "View: Aux", def: "4", run: function () { topWidget.bAUX.click(); } },
    { id: "viewFx", label: "View: FX", def: "5", run: function () { topWidget.bFX.click(); } },
    { id: "viewPlayer", label: "View: Player", def: "6", run: function () { topWidget.bPlayer.click(); } },
    { id: "viewSettings", label: "View: Settings", def: "7", run: function () { topWidget.bSet.click(); } },

    { id: "groupInputs", label: "Group: Inputs", def: "Q", run: function () { slideOutWidget.inp.click(); } },
    { id: "groupFxMasters", label: "Group: FX Masters", def: "W", run: function () { slideOutWidget.fx.click(); } },
    { id: "groupSubs", label: "Group: Sub Groups", def: "E", run: function () { slideOutWidget.sub.click(); } },
    { id: "groupAuxMasters", label: "Group: Aux Masters", def: "R", run: function () { slideOutWidget.aux.click(); } },
    { id: "groupVca", label: "Group: VCA Masters", def: "T", run: function () { if (IS_UI_24) slideOutWidget.vca.click(); } },

    { id: "toggleUdp", label: "Toggle UDP Panel", def: "U", run: doToggleUdp },
    { id: "muteFx", label: "Toggle Mute FX", def: "F", run: function () { toggleMuteFX(); } },
    { id: "muteAll", label: "Toggle Mute All", def: "A", run: function () { toggleMuteAll(); } },
    { id: "muteSelected", label: "Mute Selected Channel", def: "M", run: doMuteSelected },
    { id: "soloSelected", label: "Solo Selected Channel", def: "S", run: doSoloSelected },
    { id: "renameChannel", label: "Rename Selected Channel", def: "N", run: doRenameChannel },
    { id: "presetsMenu", label: "Presets Menu", def: "P", run: doPresetsMenu },

    { id: "fn1", label: "Function Key 1 (F1)", def: "Z", run: function () { doFfunc(settings.f1func); } },
    { id: "fn2", label: "Function Key 2 (F2)", def: "X", run: function () { doFfunc(settings.f2func); } },

    { id: "cycleTabs", label: "Cycle Edit View Tabs", def: "Tab", run: doCycleTabs, note: "Gain / EQ / Sends / Info / Player" },
    { id: "backLast", label: "Back to Previous View", def: "Backspace", run: function () { setMode(lastMode); } },
    { id: "showAll", label: "Show All (Escape)", def: "Escape", run: function () { mixerWidget.showAll(); } },

    { id: "selectPrev", label: "Select Previous Channel", def: "ArrowLeft", run: function () { if (inChannelModes()) selectPrevChannel(); } },
    { id: "selectNext", label: "Select Next Channel", def: "ArrowRight", run: function () { if (inChannelModes()) selectNextChannel(); } },
    { id: "bankLeft", label: "Scroll Channels Left", def: "ArrowDown", run: function () { if (inChannelModes()) bottomWidget.goLeft(); } },
    { id: "bankRight", label: "Scroll Channels Right", def: "ArrowUp", run: function () { if (inChannelModes()) bottomWidget.goRight(); } },

    { id: "muteGroup1", label: "Mute Group 1", def: null, run: function () { muteGroupToggle(0); } },
    { id: "muteGroup2", label: "Mute Group 2", def: null, run: function () { muteGroupToggle(1); } },
    { id: "muteGroup3", label: "Mute Group 3", def: null, run: function () { muteGroupToggle(2); } },
    { id: "muteGroup4", label: "Mute Group 4", def: null, run: function () { muteGroupToggle(3); } },
    { id: "muteGroup5", label: "Mute Group 5", def: null, run: function () { muteGroupToggle(4); } },
    { id: "muteGroup6", label: "Mute Group 6", def: null, run: function () { muteGroupToggle(5); } }
  ];

  var actionsById = {};
  ACTIONS.forEach(function (a) { actionsById[a.id] = a; });

  /* ----------------------------------------------------------------------------- *
   * Bindings: { actionId: "KeyId" }  - loaded from / saved to localStorage
   * ----------------------------------------------------------------------------- */

  function loadBindings() {
    var out = {};
    ACTIONS.forEach(function (a) { out[a.id] = a.def; });
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var saved = JSON.parse(raw);
        Object.keys(saved).forEach(function (id) {
          if (actionsById[id]) out[id] = saved[id];
        });
      }
    } catch (e) { console.error("[Ui24R Hotkeys] failed to load bindings", e); }
    return out;
  }

  function saveBindings() {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings)); }
    catch (e) { console.error("[Ui24R Hotkeys] failed to save bindings", e); }
  }

  var bindings = loadBindings();

  // key id -> action id, rebuilt whenever bindings change
  var keyToAction = {};
  function rebuildLookup() {
    keyToAction = {};
    Object.keys(bindings).forEach(function (id) {
      var k = bindings[id];
      if (k) keyToAction[k] = id;
    });
  }
  rebuildLookup();

  function resetToDefaults() {
    bindings = {};
    ACTIONS.forEach(function (a) { bindings[a.id] = a.def; });
    saveBindings();
    rebuildLookup();
  }

  /* ----------------------------------------------------------------------------- *
   * Rebind ("listening for a key") state, driven by a capture-phase window listener
   * so it always wins over the stock handler and works regardless of focus.
   * ----------------------------------------------------------------------------- */

  var listeningActionId = null;
  var listeningRow = null; // HOTKEYS_ROW instance currently showing "press a key..."

  function startListening(actionId, row) {
    if (listeningRow) listeningRow.stopListening();
    listeningActionId = actionId;
    listeningRow = row;
    row.startListening();
  }

  function stopListening() {
    listeningActionId = null;
    if (listeningRow) listeningRow.stopListening();
    listeningRow = null;
  }

  window.addEventListener("keydown", function (e) {
    if (!listeningActionId) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.key === "Escape") { stopListening(); return; }
    var keyId = keyIdFromEvent(e);
    // free up the key from whatever action currently owns it
    if (keyToAction[keyId] && keyToAction[keyId] !== listeningActionId) {
      bindings[keyToAction[keyId]] = null;
    }
    bindings[listeningActionId] = keyId;
    saveBindings();
    rebuildLookup();
    stopListening();
    regUpdate(hotkeysPageInstance);
  }, true);

  /* ----------------------------------------------------------------------------- *
   * Patch handleKey(): try a custom binding first, otherwise fall back to stock.
   * ----------------------------------------------------------------------------- */

  var stockHandleKey = window.handleKey;

  window.handleKey = function (a, b, c) {
    // Custom View switched off (via the in-app "CUSTOM MENU" > SWITCH button, or the
    // launcher's own toggle) - behave exactly like the stock, unmodified app.
    try {
      if (window.Ui24RCustom && window.Ui24RCustom.customMenu && !window.Ui24RCustom.customMenu.isEnabled()) {
        return stockHandleKey(a, b, c);
      }
    } catch (e) {}

    if (listeningActionId) return; // swallowed by the capture-phase listener above

    // Respect the same "not typing in a text field" guard the stock handler uses.
    var typing = (typeof editBox !== "undefined" && editBox && editBox.style.display === "block") ||
                 (typeof editContainer !== "undefined" && editContainer && editContainer.style.display === "block");
    if (!guiReady || typing) return stockHandleKey(a, b, c);

    var keyId = keyIdFromEvent(c);
    var actionId = keyToAction[keyId];
    if (actionId && actionsById[actionId]) {
      // Consuming the key ourselves - always suppress the browser default (Space
      // scrolling the page, Tab shifting focus, arrow keys scrolling, etc.)
      if (c && c.preventDefault) c.preventDefault();
      safeRun(actionsById[actionId]);
      return;
    }
    return stockHandleKey(a, b, c);
  };

  function safeRun(action) {
    try { action.run(); } catch (e) { console.error("[Ui24R Hotkeys] action failed:", action.id, e); }
  }

  /* ================================================================================
   * SETTINGS > HOTKEYS page
   * ================================================================================ */

  var ROW_H = 32, ROW_GAP = 4;

  var HOTKEYS_PAGE = Class.create(SETTINGS_SUBPAGE, {
    initialize: function ($super, b) {
      $super(b);
      this.widgetName = "HOTKEYS_PAGE";
      this.initWidgets();
    },

    initWidgets: function () {
      var self = this;

      this.title = new Label(this);
      this.title.text = "CUSTOM HOTKEYS";
      this.title.font = "16px open_sans_condensedbold";
      this.title.color = "#fff";
      this.title.setPos(15, 12);

      this.hint = new Label(this);
      this.hint.text = "Click a key, then press the new key on your keyboard. Esc cancels. × clears.";
      this.hint.font = "12px open_sans_condensed";
      this.hint.color = "#9ab";
      this.hint.setPos(15, 34);

      this.resetBtn = new MENUBUTTON(this);
      this.resetBtn.text = "RESET ALL TO DEFAULTS";
      this.resetBtn.w = 190;
      this.resetBtn.h = 28;
      this.resetBtn.onPress = function () {
        confOk.valueFunc = function () { resetToDefaults(); self.rebuildRows(); regUpdate(self); };
        showConfBox("Reset every hotkey to its default?");
      };

      this.rows = [];
      ACTIONS.forEach(function (action) { self.rows.push(new HOTKEYS_ROW(self, action)); });

      this.calcGeometry();
    },

    rebuildRows: function () { this.rows.forEach(function (r) { r.refresh(); }); },

    calcGeometry: function () {
      this.w = this.parent.w - this.x;
      this.h = this.parent.h - this.y;

      this.resetBtn.setPos(this.w - this.resetBtn.w - 15, 10);

      var top = 56;
      var colW = 320;
      var cols = Math.max(1, Math.min(4, (this.w - 20) / colW | 0));
      colW = (this.w - 20) / cols | 0;
      var rowsPerCol = Math.max(1, Math.ceil((this.h - top - 10) / (ROW_H + ROW_GAP)));

      this.rows.forEach(function (row, i) {
        var col = (i / rowsPerCol) | 0;
        var rowIdx = i % rowsPerCol;
        row.layout(10 + col * colW, top + rowIdx * (ROW_H + ROW_GAP), colW - 10);
      });
    },

    paint: function () {
      ctx.fillStyle = this.bgColor;
      ctx.fillRect(0, 0, this.w, this.h);
    }
  });

  var HOTKEYS_ROW = Class.create({
    initialize: function (page, action) {
      this.page = page;
      this.action = action;
      var self = this;

      this.label = new Label(page);
      this.label.text = action.label + (action.note ? " (" + action.note + ")" : "");
      this.label.font = "12px open_sans_condensedbold";
      this.label.color = action.id === "tapTempo" ? "#ffd24d" : "#dde";

      this.keyBtn = new MENUBUTTON(page);
      this.keyBtn.h = ROW_H - 6;
      this.keyBtn.onPress = function () { startListening(action.id, self); };

      this.clearBtn = new MENUBUTTON(page);
      this.clearBtn.text = "×";
      this.clearBtn.w = 24;
      this.clearBtn.h = ROW_H - 6;
      this.clearBtn.onPress = function () {
        bindings[action.id] = null;
        saveBindings();
        rebuildLookup();
        self.refresh();
      };

      this.refresh();
    },

    layout: function (x, y, w) {
      this.x = x; this.y = y; this.w = w;
      this.label.setPos(x, y + 6);
      this.label.w = w - 130;
      this.clearBtn.setPos(x + w - 24, y);
      this.keyBtn.w = 96;
      this.keyBtn.setPos(x + w - 24 - 6 - 96, y);
    },

    refresh: function () {
      var k = bindings[this.action.id];
      this.keyBtn.text = k ? prettyKey(k) : "UNASSIGNED";
      this.keyBtn.color = this.keyBtn.textColor = k ? "#2a2" : "#a55";
    },

    startListening: function () {
      this._prevText = this.keyBtn.text;
      this.keyBtn.text = "PRESS A KEY…";
      this.keyBtn.color = this.keyBtn.textColor = "#ffb400";
      regUpdate(this.page);
    },

    stopListening: function () {
      this.refresh();
      regUpdate(this.page);
    }
  });

  /* ----------------------------------------------------------------------------- *
   * Wire the page into the existing SETTINGS widget (adds a new tab at the end).
   * ----------------------------------------------------------------------------- */

  var hotkeysPageInstance = null;

  function installHotkeysPage() {
    if (typeof settingsWidget === "undefined" || !settingsWidget) {
      console.error("[Ui24R Hotkeys] settingsWidget not ready yet.");
      return;
    }
    if (settingsWidget.pages.some(function (p) { return p.widgetName === "HOTKEYS_PAGE"; })) return; // already installed

    hotkeysPageInstance = new HOTKEYS_PAGE(settingsWidget);
    settingsWidget.pages.push(hotkeysPageInstance);

    var tabIdx = settingsWidget.pages.length - 1;
    var tab = new TabButton(settingsWidget);
    tab.color = tab.textColor = "hsl(" + (32 * (tabIdx + 1)) + ",50%,45%)";
    tab.mode = tabIdx;
    tab.text = lang.HOTKEYS || "HOTKEYS";
    tab.setSize(100, 30);
    settingsWidget.tabButtons.push(tab);

    hotkeysPageInstance.hide();
    settingsWidget.calcGeometry();
    regUpdate(settingsWidget);
  }

  (function waitForGui(attempt) {
    if (typeof guiReady !== "undefined" && guiReady) {
      // Same on/off flag as custom.js's "CUSTOM MENU" / launcher toggle - keep the
      // HOTKEYS settings page and Tap Tempo bundled with the rest of the custom layout.
      var enabled = true;
      try { if (window.Ui24RCustom && window.Ui24RCustom.customMenu) enabled = window.Ui24RCustom.customMenu.isEnabled(); } catch (e) {}
      if (enabled) safe(installHotkeysPage);
      return;
    }
    if (attempt > 300) { console.error("[Ui24R Hotkeys] Gave up waiting for the mixer app to finish booting."); return; }
    setTimeout(function () { waitForGui((attempt || 0) + 1); }, 100);
  })(0);

  window.Ui24RCustom = window.Ui24RCustom || {};
  window.Ui24RCustom.hotkeys = {
    actions: ACTIONS,
    getBindings: function () { return Object.assign({}, bindings); },
    resetToDefaults: function () { resetToDefaults(); if (hotkeysPageInstance) hotkeysPageInstance.rebuildRows(); }
  };

})();
