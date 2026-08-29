// ==UserScript==
// @name         Ui24R Custom Layout (Player Tab + Hotkeys)
// @namespace    ui24r-custom.skati
// @version      1.0.0
// @description  Adds the fixed "Player" tab under Edit View and a fully rebindable Hotkeys system (incl. Tap Tempo on Space bar) to the Soundcraft Ui24R web control interface. Runs automatically every time you open the mixer's page.
// @author       Skati
// @match        http://10.10.2.1/*
// @match        http://ui24r.local/*
// @match        http://ui24r/*
// -- Add one more @match line for your mixer's own IP on your regular Wi-Fi network,
// -- e.g.  // @match  http://192.168.1.50/*
// -- (Tampermonkey's dashboard -> this script -> Edit lets you add it any time.)
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  function mixerReady() {
    return typeof window.Widget !== "undefined" &&
           typeof window.Class !== "undefined" &&
           typeof window.guiReady !== "undefined";
  }

  function run() {
    /* =====================================================================================
     * Ui24R CUSTOM LAYOUT — Player tab (Edit View) fixes + Custom Hotkeys / Tap Tempo
     * -------------------------------------------------------------------------------------
     * Built for: Skati
     * Based on / inspired by: https://raw.githubusercontent.com/ndikanov/ui24/master/custom.min.js
     *
     * WHAT THIS FILE DOES
     *   1) Re-creates the "PLAYER" tab that the reference script adds under EDIT VIEW
     *      (Big-Display / front-panel style UI), fixing several real bugs found in it:
     *
     *        BUG A - Global variable collision:
     *          The reference script's BM_MTK_PLAY widget reassigned the shared global
     *          `mtkPlay`, which the STOCK app already uses for the normal multi-track
     *          recorder panel (F-key handling + incoming MTK_GET_SESSIONS / MTK_GET_FILES
     *          socket messages). That silently broke the stock MTK recorder. Fixed by
     *          using a dedicated global (`bmMtkPlay`) instead.
     *
     *        BUG B - Missing `break` in the patched setMode():
     *          The reference script copies the huge stock setMode() function to add a
     *          "case 5" (Player) branch inside the BIG-mode switch, but forgot to add a
     *          `break;` after the existing "case 4" (Info) branch. Result: selecting the
     *          Info tab also showed the Player page stacked underneath it. Fixed.
     *
     *        BUG C - Player/MTK panel show-state bug:
     *          BM_CUSTOM.onResize() correctly hides the side-by-side "MTK session"
     *          panel on screens narrower than 1680px, but BM_CUSTOM.upd() (called every
     *          time the tab is shown) unconditionally re-showed it anyway, so on any
     *          normal-sized screen the MTK panel would pop back over the player. Fixed
     *          by making a single `layout()` helper the source of truth for both.
     *
     *        BUG D - Widget name typos:
     *          BM_PLAYER never set `widgetName` (only `name`), and BM_MTK_PLAY set its
     *          widgetName to the wrong string ("BM_MTK_REC"). Fixed for consistency with
     *          the rest of the framework (some code paths key off widgetName).
     *
     *        BUG E - Orphaned / duplicated widgets:
     *          The reference script re-runs the whole
     *          `settings.bigD && (infoMixer = new InfoMixer, ...)` boot line a second
     *          time and also replaces `slideOutWidget` without hiding the widget it
     *          replaces. Both leave old, invisible-but-still-registered widget instances
     *          sitting in the global widgets[] array (duplicate draw/update work, and in
     *          the worst case they can still intercept clicks). Fixed by only creating
     *          each BM widget if it doesn't already exist, and by explicitly hiding
     *          whatever slideOutWidget instance we are replacing.
     *
     *        BUG F - Tab key never reaches the Player tab:
     *          This is the bug reported by name: pressing Tab while in Edit View
     *          (BIG mode) cycles tabs via the stock nextBMode() function - but that
     *          function's cycle list is `[0,1,2,4,3,0]` / `[0,1,2,4,0]` and simply does
     *          not know mode 5 (Player) exists, because the reference script never
     *          patched it. So Tab would cycle Gain -> Dyn/EQ -> Sends -> Info -> (UDP) ->
     *          Gain, forever skipping Player. Fixed by patching nextBMode() to include it.
     *
     *   2) Adds a brand-new "HOTKEYS" tab under SETTINGS where every keyboard shortcut
     *      in the app can be viewed and rebound to a different key, live, with the
     *      bindings persisted in this browser via localStorage. Includes a new
     *      "Tap Tempo" action, bound to Space bar by default (configurable).
     *
     * COMPATIBILITY / SAFETY NOTES
     *   - This script must be loaded AFTER the main Soundcraft Ui app script has run.
     *     It works by (a) defining a few brand new widget classes, and (b) redefining a
     *     small number of existing global functions (setMode, setBMode, nextBMode,
     *     handleKey) - a plain `function foo(){}` declared later simply replaces the
     *     earlier one in JavaScript, which is exactly how the reference project's mod
     *     works too. Nothing here edits the original app file.
     *   - It works both when the underlying app already booted with `settings.bigD`
     *     true (our own launcher forces this before boot, see Ui24R-Custom.html) and
     *     when it is being pasted/injected into an already-running session that booted
     *     with bigD off (e.g. a real Ui24R opened as a normal remote-control page) - in
     *     that second case it builds the missing Big-Display widgets on the fly.
     * ===================================================================================== */

    (function () {
      "use strict";

      if (typeof Widget === "undefined" || typeof Class === "undefined") {
        console.error("[Ui24R Custom] Main mixer app is not loaded yet - aborting.");
        return;
      }

      /* ----------------------------------------------------------------------------- *
       * SECTION 0 - small helpers
       * ----------------------------------------------------------------------------- */

      function safe(fn) {
        try { return fn(); } catch (e) { console.error("[Ui24R Custom]", e); }
      }

      // A couple of extra display strings. `lang` is a plain object, safe to extend.
      if (typeof lang !== "undefined") {
        lang.HOTKEYS = lang.HOTKEYS || "HOTKEYS";
        lang.TAP_TEMPO_ACTION = lang.TAP_TEMPO_ACTION || "TAP TEMPO";
        lang.CUSTOM_VIEW = lang.CUSTOM_VIEW || "CUSTOM";
      }

      // ---------------------------------------------------------------------------------
      // "CUSTOM MENU" - on-screen Switch / Setup, shown in the Edit View sidebar right
      // below the MASTERS section (see CustomSlideOut2 below). This reads/writes the SAME
      // localStorage key our own launcher (Ui24R-Custom.html) uses for its "Enable Custom
      // Layout" choice, so:
      //   - In Demo Mode / Connect Mode opened through our launcher, this is just another
      //     way to reach the exact same toggle the launcher's own floating badge offered.
      //   - Pasted straight into console, or installed via Tampermonkey on a real mixer
      //     with no launcher present at all, it still works standalone: SWITCH flips the
      //     flag itself and reloads, and the boot check further below skips re-enabling
      //     the custom layout on the next load when it's off.
      // ---------------------------------------------------------------------------------
      var LS_CUSTOM_VIEW = "ui24r.customView";
      var LS_LAUNCHER_MODE = "ui24r.mode";

      function isCustomViewEnabled() {
        try {
          var v = localStorage.getItem(LS_CUSTOM_VIEW);
          return v === null ? true : v === "1";
        } catch (e) { return true; }
      }

      function uiSwitchCustomView() {
        // Per Skati's request, SWITCH now sends you back to the launcher's chooser
        // page (Demo Mode / Connect to My Mixer picker) instead of silently
        // toggling the flag in place - same destination as SETUP below. Only
        // meaningful when our own launcher HTML is present (it re-shows its
        // mode-picker when this key is gone); harmless no-op otherwise - the
        // reload still happens, which is the same "start over" gesture either way.
        try { localStorage.removeItem(LS_LAUNCHER_MODE); } catch (e) {}
        location.reload();
      }

      function uiOpenSetup() {
        // Only meaningful when our own launcher HTML is present (it re-shows its
        // mode-picker when this key is gone); harmless no-op otherwise - the reload
        // still happens, which is the same "start over" gesture either way.
        try { localStorage.removeItem(LS_LAUNCHER_MODE); } catch (e) {}
        location.reload();
      }

      window.Ui24RCustom = window.Ui24RCustom || {};
      window.Ui24RCustom.customMenu = { isEnabled: isCustomViewEnabled, switchView: uiSwitchCustomView, openSetup: uiOpenSetup };

      /* ================================================================================
       * ABOUT page credit line (Skati request) - adds "CUSTOM MADE BY: SKATI ARREGLO"
       * below the stock UNIQUE ID line. Done as a monkey-patch of just ABOUTPage's own
       * paint() method (a faithful copy of the stock method, plus one appended line) so
       * vendor-app.js itself never needs to be touched.
       * ================================================================================ */
      safe(function () {
        if (typeof ABOUTPage !== "undefined" && ABOUTPage.prototype && ABOUTPage.prototype.paint) {
          ABOUTPage.prototype.paint = function () {
            ctx.fillStyle = "#020203";
            ctx.fillRect(0, 0, this.w, this.h);
            ctx.fillStyle = this.grd;
            ctx.fillRect(0, 0, this.w, this.h);
            var a = res.about.w(), b = res.about.h(), c = (this.h - b) / 2 - 100;
            drawImage(res.about, (this.w - a) / 2 + 3, c);
            ctx.textAlign = "right";
            ctx.fillStyle = color.tabText;
            ctx.font = "12pt open_sans_condensedbold";
            ctx.drawText(
              "MODEL: " + (netConfig.model || "unknown") +
                "\nSERIAL: " + (netConfig.serial || "unknown") +
                "\nFIRMWARE: " + (netConfig.firmware || "unknown") +
                "\n\nUNIQUE ID: " + (netConfig.uid || "unknown") +
                "\nCUSTOM MADE BY: SKATI ARREGLO",
              this.w / 2 | 0, c + (b + 20),
              { align: "center", color: color.white, shadow: Shadow.main }
            );
            c = this.h - 120;
            a = lang.COPYRIGHT_MSG;
            b = ctx.measureText(
              "All third party marks are the trademarks of their respective owners. These marks are used to identify"
            ).width;
            drawText(a, (this.w - b) / 2 | 0, c, { align: "left", color: color.white });
          };
        }
      });

      /* ================================================================================
       * Bottom channel-name ribbon (BottomWidget2) - keep it from also listing PLAYER L
       * while it's docked in the Player tab (Skati report: "still there below CH1... goes
       * away if I move CH1's fader"). BottomWidget2.upd() decides its own channel order/
       * labels independently of mixerWidget.strips - with settings.mediaFirst on, it just
       * checks mediaStrips[0]/[1].enabled directly and lists both up front. We already
       * flip mediaStrips[0].enabled to true so BM_PLAYER can render it, which made this
       * ribbon list it a second time as its own leftmost channel. Wrap upd() so that,
       * only while genuinely docked here, mediaStrips[0] briefly reports disabled for the
       * one synchronous call that builds this ribbon's list - restored immediately after.
       * ================================================================================ */
      safe(function () {
        if (typeof BottomWidget2 !== "undefined" && BottomWidget2.prototype && BottomWidget2.prototype.upd) {
          var stockBottomWidgetUpd = BottomWidget2.prototype.upd;
          BottomWidget2.prototype.upd = function () {
            var hideIt = typeof bmCustom !== "undefined" && bmCustom && bmCustom.player &&
              bmCustom.player.strip === mediaStrips[0];
            var wasEnabled;
            if (hideIt) { wasEnabled = mediaStrips[0].enabled; mediaStrips[0].enabled = false; }
            try {
              stockBottomWidgetUpd.call(this);
            } finally {
              if (hideIt) mediaStrips[0].enabled = wasEnabled;
            }
          };
        }
      });

      /* ================================================================================
       * SECTION 1 - BM_CUSTOM / BM_PLAYER / BM_MTK_PLAY  (the "Player" tab under Edit View)
       * ================================================================================ */

      var BM_CUSTOM = Class.create(Widget, {
        initialize: function ($super, b) {
          $super(b);
          this.widgetName = "BM_CUSTOM";
          this.h = BM_BOT_H;
          this.w = screenWidth - BM_SO_W;
          this.setAnchors(0, measures.topWidgetHeight + BM_TOP_H, BM_SO_W, null);
          this.mode = 0;
          this.initWidgets();
          this.setMode(0);
          this.onResize();
        },

        // Single source of truth for the "wide screen -> show both panels side by side,
        // narrow screen -> show only the file browser" rule. Both onResize() (called on
        // window resize) and upd()/onShow() (called every time the tab becomes active)
        // now go through this, instead of upd() unconditionally re-showing the MTK panel
        // (that was BUG C).
        layout: function () {
          var wide = this.w >= 1680;
          this.mtkplayer.setAnchors(this.w / 2, 0, 0, 0);
          if (wide) { this.mtkplayer.show(); this.player.setAnchors(0, 0, this.w / 2, 0); }
          else { this.mtkplayer.hide(); this.player.setAnchors(0, 0, 0, 0); }
        },

        onResize: function () { this.layout(); },

        onShow: function () {
          this.upd();
          if (this.mtkplayer.enabled) this.mtkplayer.onShow();
          this.player.onShow();
        },

        // Mirrors onShow() above so the PLAYER L strip we dock into this.player gets
        // properly un-docked (back to the normal mixer) the moment this tab is left -
        // this.player never gets its own hide()/show() calls from setBMode/setMode
        // (only bmCustom itself does), so this is the one reliable "leaving" hook.
        onHide: function () {
          if (this.mtkplayer.enabled) this.mtkplayer.onHide();
          this.player.onHide();
        },

        upd: function () {
          this.layout();
          this.player.calcGeometry();
          this.player.show();
        },

        setMode: function (a) { this.mode = a; regUpdate(this); },

        initWidgets: function () {
          this.mtkplayer = new BM_MTK_PLAY(this);
          this.player = new BM_PLAYER(this);
        },

        paint: function () {
          ctx.fillStyle = color.eqBg;
          ctx.fillRect(this.offsetX, 0, this.w, this.h);
        }
      });

      var BM_PLAYER = Class.create(Widget, {
        initialize: function ($super, b) {
          $super(b);
          this.widgetName = "BM_PLAYER";   // BUG D fix (was only `this.name`, never widgetName)
          this.name = "BM_PLAYER";
          this.y = measures.topWidgetHeight;
          this.color = color.media;
          this.mode = 0;
          this.initWidgets();
          player2track = this;
        },

        setMode: function (a) { this.mode = a; regUpdate(this); },

        initWidgets: function () {
          this.regKey("settings.playMode");
          this.regKey("settings.cue");
          this.regKey("var.present");
          var a = this;

          this.SWITCH = new SWITCHBOX(this);
          this.SWITCH.setItems([lang.PLAYER, lang.PADS]);
          this.SWITCH.setItemWidth(70);
          this.SWITCH.color = color.media;
          this.SWITCH.hide();

          this.RENAME = new MENUBUTTON(this);
          this.RENAME.text = lang.RENAME;
          this.RENAME.setAnchors(null, null, 300, 5);
          this.RENAME.w = 90;
          this.RENAME.getState = function () { this.disabled = "Recordings" != a.PLISTS.selItem(); };
          this.RENAME.onPress = function () {
            if ("Recordings" == a.PLISTS.selItem()) {
              var b = a.FLIST.selItem() || "";
              if (b) {
                editOk.valueFunc = function () {
                  var a = editBox2.value;
                  a && b != a && sendMessage("RENAME^" + b + "^" + a);
                };
                showEditBox2(lang.RENAME + " (" + b + ")", b, 60);
              }
            }
          };

          this.ORDER = new SWITCHBOX(this);
          this.ORDER.setAnchors(10 + measures.mixerStripWidth, null, null, 5);
          this.ORDER.color = color.media;
          this.ORDER.setItems([lang.MANUAL, lang.AUTO]);
          this.ORDER.setItemWidth(80);
          this.ORDER.getState = function () {
            switch (getValue("settings.playMode")) {
              case 0: this.state = 0; break;
              case 1: this.state = 0; break;
              case 2: this.state = 1; break;
              case 3: this.state = 1;
            }
            this.text = this.state ? lang.AUTO : lang.MANUAL;
          };
          this.ORDER.valueFunc = function () {
            isBlocked("player") ? showPopupMsg(lang.LOCKED, 800)
              : (setValue("settings.playMode", 0 == this.state ? 0 : 3), regUpdate(a));
          };

          this.TIME = new TIME_LABEL(this);
          this.TIME.regKey("var.currentTrackPos");

          this.SEEKBAR = new SEEKBAR(this);
          this.SEEKBAR.setPos(10 + measures.mixerStripWidth, 66);
          this.SEEKBAR.regKey("var.currentTrackPos");
          this.SEEKBAR.ondown = function () { a.TIME.setMode(1); };
          this.SEEKBAR.onup = function () { a.TIME.setMode(0); };
          this.SEEKBAR.onmove = function (b) { a.TIME.setValue2(b); regUpdate(a.TIME); };
          this.SEEKBAR.onChange = function (a2) {
            isBlocked("player") ? showPopupMsg(lang.LOCKED, 800)
              : sendMessage(E_COMMANDS.MEDIA_JUMP_TO + "^" + a2);
          };

          this.PREV = new Button(this);
          this.PREV.setImages(res.player_prev_off, res.player_prev_on);
          this.PREV.opaque = false;
          this.PREV.disabledHide = false;
          this.PREV.getState = function () { this.disabled = 0 == getValue("var.present"); };
          this.PREV.valueFunc = function () {
            EMULATE ? showPopupMsg(lang.DEMO_VERSION)
              : isBlocked("player") ? showPopupMsg(lang.LOCKED, 800)
              : sendMessage(E_COMMANDS.MEDIA_PREV);
          };

          this.PLAY = new CheckBox(this);
          this.PLAY.setImages(res.player_play, res.player_pause);
          this.PLAY.opaque = false;
          this.PLAY.disabledHide = false;
          this.PLAY.getState = function () {
            this.state = 2 == getValue("var.currentState") ? 1 : 0;
            this.disabled = 0 == getValue("var.present");
          };
          this.PLAY.onToggleUp = function () {
            if (EMULATE) { showPopupMsg(lang.DEMO_VERSION); return; }
            if (isBlocked("player")) { showPopupMsg(lang.LOCKED, 800); return; }
            var b = a.FLIST.selItem(), d = a.PLISTS.selItem(),
              e = getValue("var.currentTrack"), f = getValue("var.currentPlaylist");
            if (null != b && b != e) {
              if (null == d || 0 == d.length) d = f;
              null != d && 0 != d.length && null != b && 0 != b.length &&
                sendMessage(E_COMMANDS.MEDIA_SWITCH_TRACK + "^" + d + "^" + b);
            } else if (getValue("settings.cue")) sendMessage(E_COMMANDS.MEDIA_NEXT);
            sendMessage(E_COMMANDS.MEDIA_PLAY);
          };
          this.PLAY.onToggleDown = function () {
            isBlocked("player") ? showPopupMsg(lang.LOCKED, 800) : sendMessage(E_COMMANDS.MEDIA_PAUSE);
          };

          this.NEXT = new Button(this);
          this.NEXT.setImages(res.player_next_off, res.player_next_on);
          this.NEXT.opaque = false;
          this.NEXT.disabledHide = false;
          this.NEXT.getState = function () { this.disabled = 0 == getValue("var.present"); };
          this.NEXT.onPress = function () {
            EMULATE ? showPopupMsg(lang.DEMO_VERSION)
              : isBlocked("player") ? showPopupMsg(lang.LOCKED, 800)
              : sendMessage(E_COMMANDS.MEDIA_NEXT);
          };

          this.STOP = new Button(this);
          this.STOP.setImages(res.player_stop_off, res.player_stop_on);
          this.STOP.opaque = false;
          this.STOP.disabledHide = false;
          this.STOP.getState = function () { this.disabled = 0 == getValue("var.present"); };
          this.STOP.onPress = function () {
            EMULATE ? showPopupMsg(lang.DEMO_VERSION)
              : isBlocked("player") ? showPopupMsg(lang.LOCKED, 800)
              : sendMessage(E_COMMANDS.MEDIA_STOP);
          };

          if (HAVE_REC) {
            this.REC = new CheckBox(this);
            this.REC.setImages(res.player_rec_off, res.player_rec_on);
            this.REC.opaque = false;
            this.REC.disabledHide = false;
            this.REC.getState = function () {
              this.state = getValue("var.isRecording");
              this.disabled = 0 == getValue("var.present") || 0.5 < getValue("var.recBusy");
            };
            this.REC.onToggle = function () { toggleRec(); };
          }

          this.PLISTS = new PLISTS(this);
          this.PLISTS.setPos(10 + measures.mixerStripWidth, 100);
          this.PLISTS.setSize(200, 400);
          this.PLISTS.onSelect = function () {
            if (!EMULATE) {
              var b = this.selItem();
              sendMessage(E_COMMANDS.MEDIA_GET_PLIST_TRACKS + "^" + b);
              a.FLIST.clearSelection();
              regUpdate(a);
            }
          };
          this.PLISTS.onDClick = function () {
            if (isBlocked("player")) { showPopupMsg(lang.LOCKED, 800); return; }
            var a2 = this.selItem();
            null != a2 && 0 != a2.length && sendMessage(E_COMMANDS.MEDIA_SWITCH_PLIST + "^" + a2);
          };
          this.PLISTS.getActiveItem = function () {
            var a2 = getValue("var.currentPlaylist");
            a2 = this.items.indexOf(a2);
            this.activeItemIdx = 0 <= a2 ? a2 : -1;
          };

          this.FLIST = new PLISTS(this);
          this.FLIST.label = lang.FILES;
          this.FLIST.setPos(410, 100);
          this.FLIST.setSize(400, 400);
          this.FLIST.plistName = "";
          this.FLIST.onDClick = function () {
            if (isBlocked("player")) { showPopupMsg(lang.LOCKED, 800); return; }
            var b = this.selItem();
            if (null != b && 0 != b.length) {
              var d = a.PLISTS.selItem();
              if (null == d || 0 == d.length) d = getValue("var.currentPlaylist");
              null != d && 0 != d.length && sendMessage(E_COMMANDS.MEDIA_SWITCH_TRACK + "^" + d + "^" + b);
            }
          };
          this.FLIST.getActiveItem = function () {
            var a2 = getValue("var.currentPlaylist");
            if (this.plistName != a2) this.activeItemIdx = -1;
            else { a2 = getValue("var.currentTrack"); this.activeItemIdx = this.items.indexOf(a2); }
          };

          if (EMULATE) {
            var demoTracks = $A($R("TRACK A", "TRACK Z"));
            this.PLISTS.setItems($A($R("PLIST A", "PLIST Z")));
            this.FLIST.setItems(demoTracks);
          }

          this.mutefx = new CHECKBUTTON(this);
          this.mutefx.text = lang.MUTE_FX;
          this.mutefx.color = this.mutefx.textColor = color.tvMuteFX;
          this.mutefx.textColor2 = color.white;
          this.mutefx.w = 85;
          this.mutefx.setAnchors(null, null, 205, 5);
          this.mutefx.getState = function () { this.state = checkBit(getValue("mgmask"), MUTEFX_BIT_IDX) ? 1 : 0; };
          this.mutefx.onToggleUp = function () { mixerWidget.muteFX(); regUpdate(slideOutWidget); };
          this.mutefx.onToggleDown = function () { mixerWidget.unMuteFX(); regUpdate(slideOutWidget); };

          this.muteall = new CHECKBUTTON(this);
          this.muteall.text = lang.MUTE_ALL;
          this.muteall.color = this.muteall.textColor = color.tvMuteALL;
          this.muteall.textColor2 = color.white;
          this.muteall.w = 85;
          this.muteall.setAnchors(null, null, 110, 5);
          this.muteall.getState = function () { this.state = checkBit(getValue("mgmask"), MUTEALL_BIT_IDX) ? 1 : 0; };
          this.muteall.onToggleUp = function () { mixerWidget.muteAll(); };
          this.muteall.onToggleDown = function () { mixerWidget.cancelMuteAll(); };

          this.CUE = new CHECKBUTTON(this);
          this.CUE.setAnchors(null, null, 10, 5);
          this.CUE.text = lang.CUE;
          this.CUE.w = 90;
          this.CUE.getState = function () { this.state = getValue("settings.cue") ? 1 : 0; };
          this.CUE.onToggle = function () {
            isBlocked("player") ? showPopupMsg(lang.LOCKED, 800) : setValue("settings.cue", this.state ? 1 : 0);
          };

          this.SHUFFLE = new CHECKBUTTON(this);
          this.SHUFFLE.setAnchors(180 + measures.mixerStripWidth, null, null, 5);
          this.SHUFFLE.text = lang.SHUFFLE;
          this.SHUFFLE.w = 90;
          this.SHUFFLE.regKey("settings.shuffle");
          this.SHUFFLE.regKey("settings.playMode");
          this.SHUFFLE.getState = function () {
            this.disabled = 2 > getValue("settings.playMode");
            this.state = getValue("settings.shuffle") ? 1 : 0;
          };
          this.SHUFFLE.onToggle = function () {
            isBlocked("player") ? showPopupMsg(lang.LOCKED, 800) : setValue("settings.shuffle", this.state ? 1 : 0);
          };
        },

        onShow: function () { this.setStrip(); this.updateLists(); },

        updateLists: function () {
          if (!EMULATE) {
            sendMessage(E_COMMANDS.MEDIA_GET_PLISTS);
            var a = this.PLISTS.selItem();
            if (null == a) a = getValue("var.currentPlaylist");
            a && sendMessage(E_COMMANDS.MEDIA_GET_PLIST_TRACKS + "^" + a);
          }
        },

        onHide: function () { this.unStrip(); },

        // ---- PLAYER L channel strip, docked to the left of this tab (Skati request) --------
        // Mirrors the stock MEDIA_STRIPS.setStrip()/unStrip() reparenting technique, but pulls
        // in only mediaStrips[0] ("PLAYER L") instead of the stock left+right pair.
        //
        // mixerWidget (the normal MIX-mode channel-strip row) stays "shown" underneath every
        // Edit View tab, including this one. Every Strip - mediaStrips[0] included - was
        // pushed into BOTH mixerWidget.strips (its own layout/paint bookkeeping) AND
        // mixerWidget.widgets (the generic Widget child list every parent gets for free) the
        // moment it was created, and neither array is normally touched again once made. The
        // stock MEDIA_STRIPS class only reassigns `.parent`, which is enough in its own real
        // use (a totally separate top-level PLAYER mode where mixerWidget is never shown at
        // the same time) - but here mixerWidget stays enabled the whole time, so anything
        // still sitting in either of its arrays keeps getting painted by it regardless of
        // `.parent`. We have to flip mediaStrips[0].enabled to true for our own copy to
        // render, so without removing it from BOTH arrays mixerWidget renders that same
        // enabled strip a second (and via the generic .widgets loop, functionally identical)
        // time - the two stacked "PLAYER L" strips Skati reported. Pulling it out of both
        // arrays while docked here, and restoring it at its original index in each on the
        // way out, stops the duplicate without touching mixerWidget itself.
        setStrip: function () {
          if (this.strip) return;
          this.strip = mediaStrips[0];
          this.stripBuf = [this.strip.x, this.strip.enabled];
          this.stripIdx = mixerWidget.strips.indexOf(this.strip);
          if (this.stripIdx >= 0) mixerWidget.strips.splice(this.stripIdx, 1);
          this.stripWidgetsIdx = mixerWidget.widgets.indexOf(this.strip);
          if (this.stripWidgetsIdx >= 0) mixerWidget.widgets.splice(this.stripWidgetsIdx, 1);
          this.strip.parent = this;
          this.strip.x = 0;
          this.strip.enabled = true;
          this.strip.updateGeometry();
          this.widgets.push(this.strip);
          // setMode()'s own bottomWidget.upd() call can run BEFORE this dock happens
          // (e.g. it fires once for the plain BIG-mode switch, then setBMode(5) docks the
          // strip afterward with no further upd() of its own) - force one now so the
          // bottom channel-name ribbon picks up the BottomWidget2 patch above immediately,
          // instead of showing PLAYER L until the next unrelated refresh.
          if (typeof bottomWidget !== "undefined" && bottomWidget.upd) bottomWidget.upd();
        },

        unStrip: function () {
          if (!this.strip) return;
          var idx = this.widgets.indexOf(this.strip);
          if (idx >= 0) this.widgets.splice(idx, 1);
          this.strip.parent = mixerWidget;
          if (this.stripBuf) {
            this.strip.x = this.stripBuf[0];
            this.strip.enabled = this.stripBuf[1];
          }
          if (this.stripIdx >= 0 && mixerWidget.strips.indexOf(this.strip) === -1) {
            mixerWidget.strips.splice(Math.min(this.stripIdx, mixerWidget.strips.length), 0, this.strip);
          }
          if (this.stripWidgetsIdx >= 0 && mixerWidget.widgets.indexOf(this.strip) === -1) {
            mixerWidget.widgets.splice(Math.min(this.stripWidgetsIdx, mixerWidget.widgets.length), 0, this.strip);
          }
          this.stripBuf = null;
          this.stripIdx = -1;
          this.stripWidgetsIdx = -1;
          this.strip = null;
          if (typeof bottomWidget !== "undefined" && bottomWidget.upd) bottomWidget.upd();
        },

        calcGeometry: function () {
          this.SWITCH.setPos(10, 21);
          this.SEEKBAR.w = this.w - this.SEEKBAR.x - 10;
          var recW = this.REC ? this.REC.w : 0;
          var a = (this.w - measures.mixerStripWidth - this.PREV.w - this.PLAY.w - this.NEXT.w - this.STOP.w - recW - 6) / 2 | 0;
          a += measures.mixerStripWidth;
          this.TIME.setPos(this.w - this.TIME.w - 10, 10);
          this.PREV.setPos(a, 15);
          this.PLAY.setPos(this.PREV.x + this.PREV.w + 2, 15);
          this.STOP.setPos(this.PLAY.x + this.PLAY.w + 2, 15);
          this.NEXT.setPos(this.STOP.x + this.STOP.w + 2, 15);
          if (HAVE_REC && this.REC) this.REC.setPos(this.NEXT.x + this.NEXT.w + 2 + 6, 15);
          a = this.h - this.PLISTS.y - 10 - 32;
          this.PLISTS.setSize(700 < this.w ? 300 : 270, a);
          this.FLIST.x = this.PLISTS.x + this.PLISTS.w + 2;
          this.FLIST.setSize(this.w - this.FLIST.x - 10, a);
        },

        paint: function () {
          ctx.fillStyle = color.eqBg;
          ctx.fillRect(0, 0, this.w, this.h);
        }
      });

      // NOTE: renamed from the reference project's "BM_MTK_PLAY" internal global usage of
      // `mtkPlay` -> `bmMtkPlay` (BUG A fix). Also widgetName corrected (BUG D fix).
      var BM_MTK_PLAY = Class.create(Widget, {
        initialize: function ($super, b) {
          $super(b);
          this.widgetName = "BM_MTK_PLAY";
          this.color = color.yellow;
          this.regKey("var.mtk.present");
          this.initWidgets();
          window.bmMtkPlay = this;   // was `mtkPlay = this` in the reference script - BUG A
        },

        onShow: function () { this.updateLists(); },

        updateLists: function () {
          if (!EMULATE) { sendMessage(E_COMMANDS.MTK_GET_SESSIONS); sendMessage(E_COMMANDS.MTK_GET_FILES); }
        },

        initWidgets: function () {
          var a = this;
          this.regKey("var.mtk.rec.busy");

          this.overview = new MENUBUTTON(this);
          this.overview.text = lang.OVERVIEW;
          this.overview.color = this.overview.textColor = "#e44";
          this.overview.setPos(10, 15);
          this.overview.setSize(100, 40);
          this.overview.onPress = function () {
            settingsWidget.setMode(4);
            setMode(E_MODE.SETTINGS);
            if (settingsWidget.pages[4]) { settingsWidget.pages[4].setSrc && settingsWidget.pages[4].setSrc(2); settingsWidget.pages[4].setMode && settingsWidget.pages[4].setMode(0); }
          };

          this.scheck = new CHECKBUTTON(this);
          this.scheck.setAnchors(120, 15);
          this.scheck.setSize(101, 40);
          this.scheck.text = formatButtonText(lang.ACTIVATE_SOUNDCHECK);
          this.scheck.textColor = this.scheck.color = color.green;
          this.scheck.textColor2 = color.white;
          this.scheck.setKey("var.mtk.soundcheck");
          this.scheck.regKey("var.mtk.soundcheck");
          this.scheck.onToggle = function () { updateByKey("var.mtk.soundcheck"); regUpdate(a); };

          this.PLAY = new CheckBox(this);
          this.PLAY.setImages(res.player_play, res.player_pause);
          this.PLAY.setAnchors(null, 15, 266, null);
          this.PLAY.regKey("var.mtk.currentState");
          this.PLAY.regKey("var.mtk.rec.currentState");
          this.PLAY.regKey("var.mtk.present");
          this.PLAY.opaque = false;
          this.PLAY.disabledHide = false;
          this.PLAY.getState = function () {
            this.state = 2 == getValue("var.mtk.currentState") ? 1 : 0;
            this.disabled = 0 == getValue("var.mtk.present") || 0.5 < getValue("var.mtk.rec.busy") || 0.5 < getValue("var.mtk.rec.currentState");
          };
          this.PLAY.onToggleUp = function () {
            if (isBlocked("player")) { showPopupMsg(lang.LOCKED, 800); return; }
            var a2 = getValue("var.mtk.rec.busy");
            (0.5 < a2 && 2 > a2) ? showPopupMsg(lang.ERR_BUSYBUFFER) : sendMessage(E_COMMANDS.MTK_PLAY);
          };
          this.PLAY.onToggleDown = function () {
            isBlocked("player") ? showPopupMsg(lang.LOCKED, 800) : sendMessage(E_COMMANDS.MTK_PAUSE);
          };

          this.STOP = new Button(this);
          this.STOP.setImages(res.player_stop_off, res.player_stop_on);
          this.STOP.setAnchors(null, 15, 194, null);
          this.STOP.regKey("var.mtk.rec.currentState");
          this.STOP.regKey("var.mtk.present");
          this.STOP.opaque = false;
          this.STOP.disabledHide = false;
          this.STOP.getState = function () {
            this.disabled = 0 == getValue("var.mtk.present") || 0.5 < getValue("var.mtk.rec.busy") || 0.5 < getValue("var.mtk.rec.currentState");
          };
          this.STOP.onPress = function () {
            if (isBlocked("player")) { showPopupMsg(lang.LOCKED, 800); return; }
            var a2 = getValue("var.mtk.rec.busy");
            if (0.5 < a2 && 2 > a2) showPopupMsg(lang.ERR_BUSYBUFFER);
            else { sendMessage(E_COMMANDS.MTK_STOP); 0.5 < getValue("var.mtk.rec.currentState") && showPopupMsg(lang.MTK_USB_REMOVE_WARNING); }
          };

          this.REC = new CheckBox(this);
          this.REC.setImages(res.player_rec_off, res.player_rec_on);
          this.REC.setAnchors(null, 15, 116, null);
          this.REC.regKey("var.mtk.rec.currentState");
          this.REC.regKey("var.mtk.currentState");
          this.REC.regKey("var.mtk.present");
          this.REC.opaque = false;
          this.REC.disabledHide = false;
          this.REC.getState = function () {
            this.state = getValue("var.mtk.rec.currentState");
            this.disabled = 0 == getValue("var.mtk.present") || 0.5 < getValue("var.mtk.rec.busy") || 0 != getValue("var.mtk.currentState");
          };
          this.REC.onToggle = toggleMTKRec;

          this.TIME = new MTK_TIME(this);
          this.TIME.setAnchors(null, 10, 10, null);

          this.SEEKBAR = new SEEKBAR(this);
          this.SEEKBAR.setAnchors(10, 66, 10, null);
          this.SEEKBAR.setKey("var.mtk.currentTrackPos", true);
          this.SEEKBAR.onChange = function (a2) {
            isBlocked("player") ? showPopupMsg(lang.LOCKED, 800) : sendMessage(E_COMMANDS.MTK_JUMP_TO + "^" + a2);
          };

          this.cap_a = new Label(this);
          this.cap_a.font = "15px open_sans_condensedbold";
          this.cap_a.color = "#88b";
          this.cap_a.setAnchors(390, 19, null, null);
          this.cap_a.w = 110;
          this.cap_a.align = "center";
          this.cap_a.regKey("var.mtk.freespace");
          this.cap_a.getState = function () {
            var a2 = getValue("var.mtk.freespace");
            this.text = 0 > a2 ? lang.NOT_AVAILABLE : "" + formatValue(a2, 2, " " + lang.GB, false);
          };

          this.buffer = new BufferLine(this);
          this.buffer.setAnchors(390, 46, null, null);
          this.buffer.setKey("var.mtk.bufferfill", true);

          this.sessions = new PLISTS(this);
          this.sessions.setAnchors(10, 100, null, 98);
          this.sessions.setSize(160, 400);
          this.sessions.label = lang.SESSIONS;
          this.sessions.regKey("var.mtk.playsession");
          this.sessions.regKey("var.mtk.session");
          this.sessions.activeTextColor = "#2a2";
          if (EMULATE) { this.sessions.setItems($A($R("SESSION A", "SESSION C"))); this.sessions.select(0); }
          else {
            this.sessions.onSelect = function () {
              if (!isBlocked("player")) { var a2 = this.selItem(); a2 && sendMessage(E_COMMANDS.MTK_SET_SESSION + "^" + a2); }
            };
            this.sessions.getState = function () {
              var a2 = getValue("var.mtk.session");
              this.selectedIdx = this.selected = a2 = this.items.indexOf(a2);
              this.selectedItem = this.items[a2];
            };
          }
          this.sessions.getActiveItem = function () {
            var a2 = getValue("var.mtk.playsession");
            this.activeItemIdx = this.items.indexOf(a2);
          };

          this.renam = new MENUBUTTON(this);
          this.renam.text = lang.RENAME_SESSION;
          this.renam.setAnchors(10, null, null, 53);
          this.renam.setSize(160, 40);
          this.renam.opaque = false;
          this.renam.onPress = function () {
            var b = a.sessions.selItem();
            if (b) {
              editOk.valueFunc = function () {
                var a2 = editBox2.value;
                a2 && b != a2 && sendMessage(E_COMMANDS.MTK_REN_SESSION + "^" + b + "^" + a2);
              };
              showEditBox2(lang.RENAME + " '" + b + "'", b);
            }
          };

          this.delet = new MENUBUTTON(this);
          this.delet.text = lang.DELETE_SESSION;
          this.delet.setAnchors(10, null, null, 9);
          this.delet.setSize(160, 40);
          this.delet.regKey("var.mtk.currentState");
          this.delet.regKey("var.mtk.rec.currentState");
          this.delet.opaque = false;
          this.delet.getState = function () {
            this.dimmed = !!getValue("var.mtk.rec.currentState") || !!getValue("var.mtk.currentState");
          };
          this.delet.onPress = function () {
            var b = a.sessions.selItem();
            if (b) { confOk.valueFunc = function () { sendMessage(E_COMMANDS.MTK_DEL_SESSION + "^" + b); }; showConfBox(lang.DELETE + " '" + b + "'?"); }
          };

          this.patch = new PLISTS(this);
          this.patch.setAnchors(172, 100, null, 10);
          this.patch.setSize(160, 400);
          this.patch.regKey("var.mtk.soundcheck");
          this.patch.label = lang.MIXER_PATCH;
          this.patch.maxTextLengthAuto = false;
          this.patch.font = "12pt open_sans_condensedbold";
          this.patch.setItems(Array(22));
          this.patch.getState = function () {
            var a2 = getValue("var.mtk.soundcheck"), b = [];
            for (var c = 0; 22 > c; c++) {
              var g = "", h = "ua." + c;
              for (var k = 0, m = allStrips.length; k < m; k++) {
                var l = allStrips[k];
                if (l.getNameValue(a2 ? "scsrc" : "src") == h) g += l.getLabel() + " ";
              }
              if (!g) g = "---";
              g = "" + (c + 1) + (9 > c ? " " : "") + " : " + g;
              if (18 > g.length) g = lang.SLOT + (9 > c ? "  " : " ") + g;
              b.push(g);
            }
            this.items = b;
          };
          this.patch.onDClick = function () {
            var arr = inStrips.concat(lineinStrips).filter(function (a2) { return 20 > a2.subId; });
            var popup = new CH_SEL_POPUP(arr);
            popup.slot = this.selectedIdx;
            popup.valueFunc = function (a2) {
              var b2 = getValue("var.mtk.soundcheck"), c2 = b2 ? "scsrc" : "src";
              for (var d2 = 0; d2 < this.arr.length; d2++) {
                var e2 = this.arr[d2], m2 = e2.getNameValue(c2), l2 = "ua." + this.slot;
                if ((!b2 && m2 == l2) || (b2 && m2 == l2 && -1 == a2)) e2.setNameValue(c2, "none");
              }
              -1 != a2 && this.arr[a2].setNameValue(c2, "ua." + this.slot);
            };
          };

          this.files = new PLISTS(this);
          this.files.setAnchors(334, 100, 10, 10);
          this.files.label = lang.FILES;
          this.files.noSelection = true;
          if (EMULATE) {
            var demoFiles = [];
            for (var c = 0; 22 > c; c++) demoFiles.push("Track_" + (c + 1) + ".wav");
            this.files.setItems(demoFiles, false);
          }
        },

        calcGeometry: function () {},

        paint: function () {
          ctx.fillStyle = color.eqBg;
          ctx.fillRect(0, 0, this.w, this.h);
          var a = this.cap_a.x - 10;
          ctx.drawText(lang.SPACE_REMAINING + ":", a, 29, { font: "15px open_sans_condensedbold", color: color.white, align: "right", valign: "middle" });
          ctx.drawText(lang.BUFFER + ":", a, 50, { font: "15px open_sans_condensedbold", color: color.white, align: "right", valign: "middle" });
          if (CASCADE_MODE) ctx.drawText(lang.REMOTE + ":", a, 50, { font: "15px open_sans_condensedbold", color: color.white, align: "right", valign: "middle" });
        }
      });

      /* ================================================================================
       * SECTION 2 - CustomSlideOut2: the "EDIT VIEW" right-hand panel with the new
       * PLAYER button (bottom-right of the Gain/EQ/Sends/Info grid).
       * ================================================================================ */

      var CustomSlideOut2 = Class.create(SlideOut2, {
        initialize: function ($super, b) {
          $super(b);
          this.widgetName = "CustomSlideOut2";
          this.y = measures.topWidgetHeight;
          this.w = 2 * measures.mixerStripWidth;
          this.view = 0;
          this.color = "#1593C0";
          this.cachedStrip = null;
          this.cachedStripHeight = 0;
          this.condensed = 740 > Math.min(screenHeight, screenWidth);
          this.initWidgets();
          this.mode = 0;
          this.enabled = false;
        },

        setView: function (a) {
          this.view = a;
          this.BANKS_B.each(function (b) { b.hide(); });
          this.PLAYER_B.each(function (b) { b.hide(); });
          this.FUNCS_B.each(function (b) { b.hide(); });
          switch (a) {
            case 0: this.BANKS_B.each(function (b) { b.show(); }); break;
            case 1:
              this.PLAYER_B.each(function (b) { b.show(); });
              if (!IS_UI_24) { this.mtkpl.hide(); this.mtkrec.hide(); }
              break;
            case 2: this.FUNCS_B.each(function (b) { b.show(); }); break;
          }
          regUpdate(this);
        },

        calcGeometry: function () {
          this.x = screenWidth - this.w;
          this.y = topWidget.enabled ? topWidget.h : 0;
          if (mode == E_MODE.BIG) this.y = measures.topWidgetHeight + BM_TOP_H;
          this.h = screenHeight - this.y;
        },

        clearGotoButtons: function () { regUpdate(this); },
        clearViewButtons: function () { regUpdate(this); },
        setMode: function (a) { this.mode = a; regUpdate(this); },

        // Cycles the BANKS / PLAYER / FUNCTIONS quick-switch buttons at the top of the
        // panel (used when NOT in BIG/Edit-View mode). Left intact from the reference
        // script; no bug found here.
        nextMode: function () {
          for (var a = this.view + 1; a < this.buttons.length; a++) {
            if (this.buttons[a].enabled) { this.buttons[a].click(); return; }
          }
          for (a = 0; a < this.view; a++) if (this.buttons[a].enabled) this.buttons[a].click();
        },

        onShow: function () {
          this.startBPM();
          if (this.gain) {
            if (mode != E_MODE.BIG) {
              this.udp.disabled = true; this.gain.disabled = true; this.eqdyn.disabled = true;
              this.sends.disabled = true; this.info.disabled = true;
            } else {
              this.udp.disabled = false; this.gain.disabled = false; this.eqdyn.disabled = false;
              this.sends.disabled = false; this.info.disabled = false;
            }
          }
          if (mode == E_MODE.BIG) { settings.udp ? this.udp.show() : this.udp.hide(); }
        },

        onHide: function () { this.stopBPM(); },

        startBPM: function () { this.bpmTimer = null; this.calcBPM(); },
        calcBPM: function () {
          var a = getGlobalBpm(true);
          this.lastbpmValue = a;
          this.beepTime = 60000 / a;
          if (80 > this.beepTime) this.beepTime = 80;
          if (3000 < this.beepTime) this.beepTime = 3000;
          if (1 > a) this.beepTime = 500;
          setTimeout(this.beginBPM.bind(this), Util.getBpmSyncOffset(this.beepTime));
        },
        beginBPM: function () {
          var a = this;
          clearInterval(this.bpmTimer);
          this.bpmTimer = setInterval(function () {
            var b = getGlobalBpm(true);
            if (1 < b) a.tap.doBeep();
            if (b != a.lastbpmValue) a.calcBPM();
          }, this.beepTime);
        },
        stopBPM: function () { clearInterval(this.bpmTimer); this.lastbpmValue = -1; },

        initWidgets: function () {
          var a = this, b = 6, c = 7;

          this.banks = new CHECKBUTTON(this);
          this.banks.text = lang.BANKS;
          this.banks.setAnchors(c, b);
          this.banks.w = 65;
          this.banks.color = "#1FC8F2"; this.banks.bgColor = "#2555A4"; this.banks.strokeColor = "#1AA6C9"; this.banks.textColor = "#e9e9f9";
          this.banks.idx = 0;
          this.banks.getState = function () { this.state = a.view == this.idx; };
          this.banks.onToggleUp = function () { a.setView(this.idx); };

          this.player = new CHECKBUTTON(this);
          this.player.setAnchors(c + this.banks.w + 2, b);
          this.player.w = 65;
          this.player.text = lang.PLAYER;
          this.player.color = "#1FC8F2"; this.player.bgColor = "#2555A4"; this.player.strokeColor = "#1AA6C9"; this.player.textColor = "#e9e9f9";
          this.player.idx = 1;
          this.player.getState = function () { this.state = a.view == this.idx; };
          this.player.onToggleUp = function () { a.setView(this.idx); };

          this.funcs = new CHECKBUTTON(this);
          this.funcs.setAnchors(c + this.banks.w + 2 + this.player.w + 2, b);
          this.funcs.w = 76;
          this.funcs.text = lang.FUNCTIONS;
          this.funcs.color = "#1FC8F2"; this.funcs.bgColor = "#2555A4"; this.funcs.strokeColor = "#1AA6C9"; this.funcs.textColor = "#e9e9f9";
          this.funcs.idx = 2;
          this.funcs.getState = function () { this.state = a.view == this.idx; };
          this.funcs.onToggleUp = function () { a.setView(this.idx); };

          this.buttons = [this.banks, this.player, this.funcs];

          var rowB = 50, rowD = 41, rowC = 40;
          this.BANKS_B = []; this.PLAYER_B = []; this.FUNCS_B = [];
          rowC = 41;

          this.bank_l = new TButton(this);
          this.bank_l.setAnchors(rowC, rowB + rowD + 1);
          this.bank_l.setImages(res.FFUNC_B_OFF, res.FFUNC_B_YLW);
          this.bank_l.text = "<";
          this.bank_l.onPress = function () { bottomWidget.goLeft(); };
          this.bank_l.enabled = false;

          this.bank_r = new TButton(this);
          this.bank_r.setAnchors(null, rowB + rowD + 1, rowC);
          this.bank_r.setImages(res.FFUNC_B_OFF, res.FFUNC_B_YLW);
          this.bank_r.text = ">";
          this.bank_r.onPress = function () { bottomWidget.goRight(); };
          this.bank_r.enabled = false;

          this.bank_s = new TButton(this);
          this.bank_s.setAnchors(rowC, rowB + 1);
          this.bank_s.setImages(res.FFUNC_B_OFF, res.FFUNC_B_YLW);
          this.bank_s.text = lang.START;
          this.bank_s.onPress = function () { bottomWidget.gotoStart(); };
          this.bank_s.enabled = false;

          this.bank_e = new TButton(this);
          this.bank_e.setAnchors(null, rowB + 1, rowC);
          this.bank_e.setImages(res.FFUNC_B_OFF, res.FFUNC_B_YLW);
          this.bank_e.text = lang.END;
          this.bank_e.onPress = function () { bottomWidget.gotoEnd(); };
          this.bank_e.enabled = false;

          this.BANKS_B.push(this.bank_l, this.bank_r, this.bank_s, this.bank_e);

          rowC = 40;
          this.pl = new CheckBox(this);
          this.pl.setAnchors(rowC, rowB + rowD);
          this.pl.setImages(res.PLAYS_OFF, res.PLAYS_STOP);
          this.pl.regKey("var.currentState"); this.pl.regKey("var.present");
          this.pl.getState = function () { this.disabled = 0 == getValue("var.present"); this.state = 2 == getValue("var.currentState") ? 1 : 0; };
          this.pl.onToggle = function () { doFfunc(E_FFUNC.PLAY); };

          this.rec = new CheckBox(this);
          this.rec.setAnchors(null, rowB + rowD, rowC);
          this.rec.setImages(res.RECS_OFF, res.RECS_STOP);
          this.rec.regKey("var.recBusy"); this.rec.regKey("var.isRecording"); this.rec.regKey("var.present");
          this.rec.getState = function () { this.state = getValue("var.isRecording"); this.disabled = 0 == getValue("var.present") || 0.5 < getValue("var.recBusy"); };
          this.rec.onToggle = function () { doFfunc(E_FFUNC.REC); };

          this.mtkpl = new CheckBox(this);
          this.mtkpl.setAnchors(rowC, rowB);
          this.mtkpl.setImages(res.MTK_PLAY, res.MTK_STOP);
          this.mtkpl.regKey("var.mtk.currentState"); this.mtkpl.regKey("var.mtk.rec.currentState"); this.mtkpl.regKey("var.mtk.rec.busy"); this.mtkpl.regKey("var.mtk.present");
          this.mtkpl.getState = function () {
            this.state = 2 == getValue("var.mtk.currentState") ? 1 : 0;
            this.disabled = 0 == getValue("var.mtk.present") || 0.5 < getValue("var.mtk.rec.busy") || 0.5 < getValue("var.mtk.rec.currentState");
          };
          this.mtkpl.onToggle = function () { doFfunc(E_FFUNC.MTK_PLAY); };

          this.mtkrec = new CheckBox(this);
          this.mtkrec.setAnchors(null, rowB, rowC);
          this.mtkrec.setImages(res.MTK_REC_OFF, res.MTK_REC_ON);
          this.mtkrec.regKey("var.mtk.rec.currentState"); this.mtkrec.regKey("var.mtk.rec.busy"); this.mtkrec.regKey("var.mtk.currentState"); this.mtkrec.regKey("var.mtk.present");
          this.mtkrec.getState = function () {
            this.state = getValue("var.mtk.rec.currentState");
            this.disabled = 0 == getValue("var.mtk.present") || 0.5 < getValue("var.mtk.rec.busy") || 0 != getValue("var.mtk.currentState");
          };
          this.mtkrec.onToggle = function () { doFfunc(E_FFUNC.MTK_REC); };

          this.PLAYER_B.push(this.pl, this.rec, this.mtkpl, this.mtkrec);

          this.newsnap = new Button(this);
          this.newsnap.setAnchors(null, rowB, rowC);
          this.newsnap.setImages(res.SS_OFF, res.SS_ON);
          this.newsnap.onPress = function () { doFfunc(E_FFUNC.NEWSNAP); };

          this.updsnap = new Button(this);
          this.updsnap.setAnchors(rowC, rowB);
          this.updsnap.setImages(res.SSUPD_OFF, res.SSUPD_ON);
          this.updsnap.onPress = function () { doFfunc(E_FFUNC.UPDCURSNAP); };

          this.nextsnap = new Button(this);
          this.nextsnap.setAnchors(null, rowB + rowD, rowC);
          this.nextsnap.setImages(res.NXT_SNP_OFF, res.NXT_SNP_ON);
          this.nextsnap.onPress = function () { doFfunc(E_FFUNC.NEXT_SNAP); };

          this.prevsnap = new Button(this);
          this.prevsnap.setAnchors(rowC, rowB + rowD);
          this.prevsnap.setImages(res.PRV_SNP_OFF, res.PRV_SNP_ON);
          this.prevsnap.onPress = function () { doFfunc(E_FFUNC.PREV_SNAP); };

          this.FUNCS_B.push(this.newsnap, this.nextsnap, this.updsnap, this.prevsnap);

          if (HAVE_CUE) {
            this.newsnap.setAnchors(rowC - 20, rowB);
            this.updsnap.setAnchors(rowC - 20, rowB + rowD);
            this.nextsnap.setAnchors(85, rowB);
            this.prevsnap.setAnchors(85, rowB + rowD);

            this.nextcue = new Button(this);
            this.nextcue.setAnchors(null, rowB + 1, rowC - 21);
            this.nextcue.setImages(res.FFUNC_B_OFF, res.FFUNC_B_GRE);
            this.nextcue.text = lang.NEXT_CUE.replace(" ", "\n");
            this.nextcue.font = "14px open_sans_condensedbold";
            this.nextcue.textColor = color.black2;
            this.nextcue.textColorActive = color.white;
            this.nextcue.shadowColorActive = "#333";
            this.nextcue.shadowColor = "#ccc";
            this.nextcue.textParam = { font: "14px open_sans_condensedbold", x: null, y: null, offsetX: -1, offsetY: -3, pressOffsetX: 0, pressOffsetY: 1, align: "center", valign: "middle", shadow: ["#ccc", 0, 1, 1], dy: 12 };
            this.nextcue.onPress = function () { doFfunc(E_FFUNC.NEXT_CUE); };

            this.prevcue = new Button(this);
            this.prevcue.setAnchors(null, rowB + rowD + 1, rowC - 21);
            this.prevcue.setImages(res.FFUNC_B_OFF, res.FFUNC_B_GRE);
            this.prevcue.text = lang.PREV_CUE.replace(" ", "\n");
            this.prevcue.font = "14px open_sans_condensedbold";
            this.prevcue.textColor = color.black2;
            this.prevcue.textColorActive = color.white;
            this.prevcue.shadowColorActive = "#333";
            this.prevcue.shadowColor = "#ccc";
            this.prevcue.textParam = { font: "14px open_sans_condensedbold", x: null, y: null, offsetX: -1, offsetY: -3, pressOffsetX: 0, pressOffsetY: 1, align: "center", valign: "middle", shadow: ["#ccc", 0, 1, 1], dy: 12 };
            this.prevcue.onPress = function () { doFfunc(E_FFUNC.PREV_CUE); };

            this.FUNCS_B.push(this.nextcue, this.prevcue);
          }

          this.PLAYER_B.each(function (w) { w.hide(); });
          this.FUNCS_B.each(function (w) { w.hide(); });

          // ---- The Big-Display "EDIT VIEW" button grid (Gain / EQ-Dyn / Sends / Info / *Player*) ----
          if (settings.bigD) {
            var gx = 16, gy = 173, gd = 43;

            this.gain = new CheckBox(this);
            this.gain.setPos(gx, gy);
            this.gain.setImages(res.SO_M_BTN_OFF, res.SO_M_BTN_TUR);
            this.gain.text = lang.GAIN;
            this.gain.textParam.offsetY = -3;
            this.gain.getState = function () { this.state = 0 == bmMode; };
            this.gain.onToggleUp = function () { setBMode(0); };

            this.eqdyn = new CheckBox(this);
            gy += gd;
            this.eqdyn.setPos(gx, gy);
            this.eqdyn.setImages(res.SO_M_BTN_OFF, res.SO_M_BTN_TUR);
            this.eqdyn.text = lang.DYN + " / " + lang.EQ;
            this.eqdyn.textParam.offsetY = -3;
            this.eqdyn.getState = function () { this.state = 1 == bmMode; };
            this.eqdyn.onToggleUp = function () { setBMode(1); };

            this.sends = new CheckBox(this);
            this.sends.setPos(gx + 104, gy - gd);
            this.sends.setImages(res.SO_M_BTN_OFF, res.SO_M_BTN_TUR);
            this.sends.text = lang.SENDS;
            this.sends.textParam.offsetY = -3;
            this.sends.getState = function () { this.state = 2 == bmMode; };
            this.sends.onToggleUp = function () { setBMode(2); };

            this.info = new CheckBox(this);
            this.info.setPos(gx + 104, gy);
            this.info.setImages(res.SO_M_BTN_OFF, res.SO_M_BTN_TUR);
            this.info.text = lang.INFO;
            this.info.textParam.offsetY = -3;
            this.info.getState = function () { this.state = 4 == bmMode; };
            this.info.onToggleUp = function () { setBMode(4); };

            this.udp = new CheckBox(this);
            gy += gd;
            this.udp.setPos(gx, gy);
            this.udp.setImages(res.SO_M_BTN_OFF, res.SO_M_BTN_TUR);
            this.udp.text = lang.UDP;
            this.udp.textParam.offsetY = -3;
            this.udp.getState = function () { this.state = 3 == bmMode; };
            this.udp.onToggleUp = function () { setBMode(3); };
            this.udp.hide();

            // *** THE NEW PLAYER BUTTON ***
            this.custom = new CheckBox(this);
            this.custom.setPos(gx + 104, gy);
            this.custom.setImages(res.SO_M_BTN_OFF, res.SO_M_BTN_TUR);
            this.custom.text = lang.PLAYER;
            this.custom.textParam.offsetY = -3;
            this.custom.getState = function () { this.state = 5 == bmMode; };
            this.custom.onToggleUp = function () { setBMode(5); };
          }

          var c2 = 16, b2 = 164;
          if (this.condensed) b2 = 158;
          if (settings.bigD) b2 += 165;
          var d2 = 40;
          if (settings.bigD) d2 = 42;
          this.MGS = []; this.VGS = [];
          for (var e = 0; 6 > e; e++) {
            var f = new CheckBox(this);
            f.setImages(res.SO_M_BTN_OFF, res.SO_M_BTN_TUR);
            f.setPos(c2, b2 + d2 * e);
            f.idx = e; f.clickOnUp = true; f.longClickMark = true;
            f.textParam.offsetY = -3; f.textParam.font = "11pt open_sans_condensedbold";
            f.text = "NAMED GROUP " + e;
            f.getState = function () {
              var empty = 0 == getVG(this.idx).length;
              this.state = activeViewGroup == this.idx ? 1 : 0;
              this.text = getVGName(this.idx) || lang.VIEW_GROUP + " " + (this.idx + 1);
              if (13 < this.text.length) this.text = cropText(this.text, 12);
              this.textColor = empty ? color.gray : color.vgText;
            };
            f.onToggleUp = function () {
              if (0 == getVG(this.idx).length) { showPopupMsg(lang.NO_ASSIGNED_VIEWGROUP.format(this.idx + 1), 800); this.state = 0; }
              else mixerWidget.showViewGroup(this.idx);
            };
            f.onToggleDown = function () { mixerWidget.showAll(); };
            f.onHold = function () { modalsWidget.setMode(E_MODAL_MODE.VIEWS); modalsWidget.pages[E_MODAL_MODE.VIEWS].setMode(this.idx); setMode(E_MODE.MODALS); };
            this.MGS.push(f);

            f = new CheckBox(this);
            f.setImages(res.SO_M_BTN_OFF, res.SO_M_BTN_RED);
            f.setPos(c2 + 104, b2 + d2 * e);
            f.idx = e; f.clickOnUp = true; f.longClickMark = true;
            f.textParam.offsetY = -3; f.textParam.font = "11pt open_sans_condensedbold";
            f.text = "NAMED GROUP " + e;
            f.getState = function () {
              var empty = muteGroupEmpty(this.idx);
              this.state = getMGroupState(this.idx);
              this.text = getValue("mg." + this.idx + ".name") || lang.MUTE + " " + (this.idx + 1);
              if (13 < this.text.length) this.text = cropText(this.text, 12);
              this.textColor = empty ? color.gray : color.mgText;
            };
            f.onToggleUp = function () { muteGroupON(this.idx); };
            f.onToggleDown = function () { muteGroupOFF(this.idx); };
            f.onHold = function () { modalsWidget.setMode(E_MODAL_MODE.MUTES); modalsWidget.pages[E_MODAL_MODE.MUTES].setMode(this.idx); setMode(E_MODE.MODALS); };
            this.VGS.push(f);
          }

          var bb = 432;
          if (this.condensed) bb = 420;
          bb = settings.bigD ? bb + 183 : bb - 13;

          this.mutefx = new CheckBox(this);
          this.mutefx.setPos(c2, bb);
          this.mutefx.setImages(res.SO_M_BTN_OFF, res.SO_M_BTN_BLU);
          this.mutefx.text = lang.MUTE_FX;
          this.mutefx.textParam.offsetY = -3;
          this.mutefx.textParam.font = "12pt open_sans_condensedbold";
          this.mutefx.getState = function () { this.state = checkBit(getValue("mgmask"), MUTEFX_BIT_IDX) ? 1 : 0; };
          this.mutefx.onToggleUp = function () { mixerWidget.muteFX(); if (typeof bmCustom !== "undefined" && bmCustom.player) regUpdate(bmCustom.player.mutefx); };
          this.mutefx.onToggleDown = function () { mixerWidget.unMuteFX(); if (typeof bmCustom !== "undefined" && bmCustom.player) regUpdate(bmCustom.player.mutefx); };

          this.tap = new Button(this);
          this.tap.setAnchors(null, bb, c2);
          this.tap.lastTapTime = 0;
          this.tap.longClickMark = true;
          this.tap.textParam.offsetY = -3;
          this.tap.setImages(res.SO_M_BTN_OFF, res.SO_M_BTN_RED);
          this.tap.text = lang.TAP_TEMPO;
          this.tap.valueFunc = bpmTapHandler;
          this.tap.onHold = askBpm;
          this.tap.opaque = false;
          this.tap.textParam.font = "12pt open_sans_condensedbold";
          this.tap.doBeep = function () {
            var a2 = this;
            this.longClickMarkColor = "#2ee"; this.longClickMarkColor2 = "#066";
            regUpdate(this);
            clearTimeout(this.beepTimer);
            this.beepTimer = setTimeout(function () { a2.longClickMarkColor = color.longClickMark; a2.longClickMarkColor2 = color.longClickMark2; regUpdate(a2); }, 80);
          };

          bb += 47;
          this.clearsolo = new Button(this);
          this.clearsolo.setImages(res.SO_M_BTN_OFF, res.SO_M_BTN_RED);
          this.clearsolo.setAnchors(c2, bb, null, null);
          this.clearsolo.text = lang.CLEAR_SOLO;
          this.clearsolo.textColor = "#D6C560";
          this.clearsolo.textParam.offsetY = -3;
          this.clearsolo.textParam.font = "12pt open_sans_condensedbold";
          this.clearsolo.onPress = function () { mixerWidget.clearSolos(); regUpdate(a); };

          this.clearmute = new Button(this);
          this.clearmute.setImages(res.SO_M_BTN_OFF, res.SO_M_BTN_RED);
          this.clearmute.setAnchors(null, bb, c2, null);
          this.clearmute.text = lang.CLEAR_MUTE;
          this.clearmute.textColor = "#D66D60";
          this.clearmute.textParam.offsetY = -3;
          this.clearmute.textParam.font = "12pt open_sans_condensedbold";
          this.clearmute.onPress = function () { mixerWidget.clearMutes(); regUpdate(a); };

          var bb2 = 539;
          if (this.condensed) bb2 = 513;
          if (settings.bigD) bb2 += 207;

          this.inp = new CheckBox(this);
          this.inp.setImages(res.SO_B_BTN_OFF, res.SO_B_BTN_YLW);
          this.inp.setAnchors(c2, bb2);
          this.inp.text = lang.INPUTS;
          this.inp.textColor = color.INPUT;
          this.inp.idx = E_VG.INPUTS;
          this.inp.textParam.offsetY = -3;
          this.inp.textParam.font = "12pt open_sans_condensedbold";
          this.inp.getState = function () { this.state = activeViewGroup == this.idx ? 1 : 0; };
          this.inp.onToggleUp = function () { if (mode != E_MODE.MIX) setMode(E_MODE.MIX); mixerWidget.showInputsGroup(); };
          this.inp.onToggleDown = function () { resumeLastActiveVG(); };
          this.inp.hide();

          this.fx = new CheckBox(this);
          this.fx.setImages(res.AUXM_OFF, res.AUXM_ON);
          this.fx.setAnchors(c2, bb2);
          this.fx.textColor = "#76A8D6";
          this.fx.text = formatButtonText(lang.FX_MASTERS);
          this.fx.textParam.font = "12pt open_sans_condensedbold";
          this.fx.textParam.offsetX = -1; this.fx.textParam.offsetY = -4;
          this.fx.idx = E_VG.FXS;
          this.fx.getState = function () { this.state = activeViewGroup == this.idx ? 1 : 0; };
          this.fx.onToggleUp = function () { if (mode != E_MODE.MIX) setMode(E_MODE.MIX); mixerWidget.showFxGroup(); };
          this.fx.onToggleDown = function () { resumeLastActiveVG(); };
          this.fx.contains = function (bx, by) {
            if (!this.enabled || !this.visible) return false;
            var dx = bx - a.home.x, dy = by - a.home.y, hw = a.home.w / 2, hh = a.home.h / 2;
            return (this.enabled && this.visible) ? (this.x <= bx && this.x + this.w > bx && this.y <= by && this.y + this.h > by && !isInCircle(hw, hh, 24, dx, dy)) : false;
          };

          this.sub = new CheckBox(this);
          this.sub.setImages(res.FXM_OFF, res.FXM_ON);
          this.sub.setAnchors(null, bb2, c2);
          this.sub.textColor = "#D8A5B9";
          this.sub.textParam.font = "12pt open_sans_condensedbold";
          this.sub.textParam.offsetX = 1; this.sub.textParam.offsetY = -4;
          this.sub.idx = E_VG.SUBS;
          this.sub.text = formatButtonText(lang.SUB_GROUPS);
          this.sub.getState = function () { this.state = activeViewGroup == this.idx ? 1 : 0; };
          this.sub.onToggleUp = function () { if (mode != E_MODE.MIX) setMode(E_MODE.MIX); mixerWidget.showSubGroup(); };
          this.sub.onToggleDown = function () { resumeLastActiveVG(); };
          this.sub.onHold = function () { modalsWidget.setMode(E_MODAL_MODE.SUBS); setMode(E_MODE.MODALS); };
          this.sub.contains = function (bx, by) {
            if (!this.enabled || !this.visible) return false;
            var dx = bx - a.home.x, dy = by - a.home.y, hw = a.home.w / 2, hh = a.home.h / 2;
            return (this.enabled && this.visible) ? (this.x <= bx && this.x + this.w > bx && this.y <= by && this.y + this.h > by && !isInCircle(hw, hh, 24, dx, dy)) : false;
          };

          this.aux = new CheckBox(this);
          this.aux.setImages(res.SUBG_OFF, res.SUBG_ON);
          this.aux.setAnchors(c2, bb2 + 71);
          this.aux.textColor = "#DBCB7A";
          this.aux.textParam.font = "12pt open_sans_condensedbold";
          this.aux.textParam.offsetX = -1; this.aux.textParam.offsetY = -4;
          this.aux.idx = E_VG.AUXS;
          this.aux.text = formatButtonText(lang.AUX_MASTERS);
          this.aux.getState = function () { this.state = activeViewGroup == this.idx ? 1 : 0; };
          this.aux.onToggleUp = function () { if (mode != E_MODE.MIX) setMode(E_MODE.MIX); mixerWidget.showAuxGroup(); };
          this.aux.onToggleDown = function () { resumeLastActiveVG(); };
          this.aux.contains = function (bx, by) {
            if (!this.enabled || !this.visible) return false;
            var dx = bx - a.home.x, dy = by - a.home.y, hw = a.home.w / 2, hh = a.home.h / 2;
            return (this.enabled && this.visible) ? (this.x <= bx && this.x + this.w > bx && this.y <= by && this.y + this.h > by && !isInCircle(hw, hh, 24, dx, dy)) : false;
          };

          this.vca = new CheckBox(this);
          this.vca.setImages(res.VCA_OFF, res.VCA_ON);
          this.vca.setAnchors(null, bb2 + 71, c2);
          this.vca.textColor = "#8BD08B";
          this.vca.textParam.font = "12pt open_sans_condensedbold";
          if ("cn" == settings.lang) this.vca.textParam.font = "11pt open_sans_condensedbold";
          this.vca.textParam.offsetX = 1; this.vca.textParam.offsetY = -4;
          this.vca.idx = E_VG.VCAS;
          this.vca.text = formatButtonText(lang.VCA_MASTERS);
          if (!IS_UI_24) { this.vca.text = formatButtonText(lang.INPUTS); this.vca.idx = E_VG.INPUTS; }
          this.vca.getState = function () { this.state = activeViewGroup == this.idx ? 1 : 0; };
          this.vca.onToggleUp = function () { if (mode != E_MODE.MIX) setMode(E_MODE.MIX); IS_UI_24 ? mixerWidget.showVCAGroup() : mixerWidget.showInputsGroup(); };
          this.vca.onToggleDown = function () { resumeLastActiveVG(); };
          this.vca.contains = function (bx, by) {
            if (!this.enabled || !this.visible) return false;
            var dx = bx - a.home.x, dy = by - a.home.y, hw = a.home.w / 2, hh = a.home.h / 2;
            return (this.enabled && this.visible) ? (this.x <= bx && this.x + this.w > bx && this.y <= by && this.y + this.h > by && !isInCircle(hw, hh, 24, dx, dy)) : false;
          };

          this.home = new Button(this);
          this.home.setImages(res.HOME_OFF, res.HOME_ON);
          this.home.setAnchors(c2 + 71, bb2 + 37);
          this.home.contains = function (bx, by) {
            return (this.enabled && this.visible) ? isInCircle(this.w / 2, this.h / 2, 24, bx - this.x, by - this.y) : false;
          };
          this.home.onPress = function () { if (mode != E_MODE.MIX) setMode(E_MODE.MIX); mixerWidget.showAll(); };

          // ---- CUSTOM MENU: Switch / Setup, right below the MASTERS grid above -----------
          // Same red "clear button" style as CLEAR SOLO / CLEAR MUTE further up this panel
          // (see cachePaint() below for the "CUSTOM MENU" header line that goes with this).
          // NOTE: computed from `bb2` (the same local var used to position aux/vca just
          // above), not by reading aux.y back - widget x/y here are plain numbers set once
          // at construction time, not live/resolved anchors, so aux.y would still be its
          // pre-layout default (0) at this point in initWidgets().
          var customMenuY = bb2 + 71 + 56 + 48;
          var customMenuRed = "#E4605C";

          this.uiSwitch = new Button(this);
          this.uiSwitch.setImages(res.SO_M_BTN_OFF, res.SO_M_BTN_RED);
          this.uiSwitch.setAnchors(c2, customMenuY, null, null);
          this.uiSwitch.text = "SWITCH";
          this.uiSwitch.textColor = customMenuRed;
          this.uiSwitch.textParam.offsetY = -3;
          this.uiSwitch.textParam.font = "12pt open_sans_condensedbold";
          this.uiSwitch.onPress = function () {
            confOk.valueFunc = function () { window.Ui24RCustom.customMenu.switchView(); };
            showConfBox(lang.RELOAD_UI);
          };

          this.uiSetup = new Button(this);
          this.uiSetup.setImages(res.SO_M_BTN_OFF, res.SO_M_BTN_RED);
          this.uiSetup.setAnchors(null, customMenuY, c2, null);
          this.uiSetup.text = "SETUP";
          this.uiSetup.textColor = customMenuRed;
          this.uiSetup.textParam.offsetY = -3;
          this.uiSetup.textParam.font = "12pt open_sans_condensedbold";
          this.uiSetup.onPress = function () {
            confOk.valueFunc = function () { window.Ui24RCustom.customMenu.openSetup(); };
            showConfBox(lang.RELOAD_UI);
          };
        },

        paint: function () {
          if (this.cachedStripHeight != this.h) this.cachePaint();
          ctx.drawImage(this.cachedStrip, 0, 0, this.w, this.h);
          if (this.banks.enabled) { ctx.fillStyle = "#1FC8F2"; ctx.fillRect(7, this.banks.y + this.banks.h + 1, this.w - 14, 3); }
          if (settings.bigD) this.drawHeader(lang.EDIT_VIEW, this.gain.y - 18, ctx);
        },

        drawHeader: function (a, b, c) {
          c.font = "12pt open_sans_condensedbold";
          var textW = c.measureText(a).width, w = this.w, d = (w - textW - 20 - 34) / 2 | 0;
          if (!a || 0 == a.length) d = (w - 34) / 2;
          c.fillStyle = "#0A1957";
          c.fillRect(17, b - 2, d, 2);
          c.fillRect(this.w - 17, b - 2, -d, 2);
          c.fillStyle = "#3A88E1";
          c.fillRect(17, b, d, 1);
          c.fillRect(this.w - 17, b, -d, 1);
          if (a && 0 != a.length) c.drawText(a, this.w / 2, b + 10 - 6, { shadow: [color.black, 0, 1, 1], color: "#E0E0E0", align: "center", font: "12pt open_sans_condensedbold" });
        },

        cachePaint: function () {
          if (null != this.cachedStrip) delete this.cachedStrip;
          this.cachedStrip = document.createElement("canvas");
          var a = this.cachedStrip.getContext("2d");
          if (isRetina) { this.cachedStrip.width = 2 * this.w; this.cachedStrip.height = 2 * this.h; a.scale(2, 2); }
          else { this.cachedStrip.width = this.w; this.cachedStrip.height = this.h; }
          a.fillStyle = "#2353A2";
          a.fillRect(0, 0, this.w, this.h);
          fillVertPatternCtx(res.SO2_TILE, this.h, a);
          drawImageCtx(res.SO2_BOTTOM, 0, this.h - res.soBottom.h(), a);
          drawImageCtx(res.SO2_TOP, 0, 0, a);
          a.fillStyle = "#010101";
          a.fillRect(0, this.h - 1, this.w, 1);
          if (settings.bigD) {
            this.drawHeader(lang.GROUPS, this.MGS[0].y - 18, a);
            this.drawHeader(lang.MASTERS, this.fx.y - 18, a);
            this.drawHeader("", this.mutefx.y - 22, a);
          } else if (this.condensed) {
            var b1 = 144; if (settings.bigD) b1 -= 144;
            if (!settings.bigD) this.drawHeader(lang.GROUPS, b1, a);
            var b2 = 500; if (settings.bigD) b2 -= 144;
            this.drawHeader(lang.MASTERS, b2, a);
          } else {
            this.drawHeader(lang.GROUPS, this.MGS[0].y - 16, a);
            this.drawHeader(lang.MASTERS, this.fx.y - 16, a);
            this.drawHeader("", this.mutefx.y - 10, a);
          }
          // "CUSTOM MENU" header for the Switch/Setup buttons added in initWidgets() above -
          // always positioned the same 18px above them regardless of which branch just ran.
          if (this.uiSwitch) this.drawHeader("CUSTOM MENU", this.uiSwitch.y - 18, a);
          this.cachedStripHeight = this.h;
        }
      });

      /* ================================================================================
       * SECTION 3 - setBMode / nextBMode / setMode patches
       * (rebuilt from the CURRENT stock functions so nothing else in the app drifts;
       *  only the minimal lines needed for the Player tab were added)
       * ================================================================================ */

      // Case 5 added; both places already have matching `break;` statements
      // (this one was fine in stock - no bug here).
      window.setBMode = function (a) {
        bmMode = a;
        if (mode == E_MODE.BIG) {
          gainMixer.hide(); bmEqdyn.hide(); bmSends.hide(); bmUdp.hide(); infoMixer.hide(); infoMaster.hide();
          if (typeof bmCustom !== "undefined") bmCustom.hide();
          switch (a) {
            case 0: gainMixer.show(); break;
            case 1: bmEqdyn.show(); break;
            case 2: bmSends.show(); break;
            case 3: bmUdp.show(); break;
            case 4: infoMaster.show(); infoMixer.show(); break;
            case 5: if (typeof bmCustom !== "undefined") bmCustom.show(); break;
          }
          drawAll();
        }
      };

      // THE FIX FOR "PRESSING TAB SKIPS THE PLAYER TAB": mode 5 added to the cycle.
      window.nextBMode = function () {
        var seq = settings.udp ? [0, 1, 2, 4, 3, 5] : [0, 1, 2, 4, 5];
        var i = seq.indexOf(bmMode);
        setBMode(seq[(i + 1) % seq.length]);
      };

      // Full stock setMode(), with:
      //   - a `case 5: bmCustom.show();` branch added inside the BIG-mode switch
      //   - a `break;` added after `case 4` right before it (BUG B fix - in the
      //     reference script that break was missing, so picking the Info tab also
      //     revealed the Player tab underneath it)
      window.setMode = function (a, b) {
        if (settings.bigD && a == E_MODE.MIX) a = E_MODE.BIG;
        log("=== " + objKeyByValue(E_MODE, mode) + " -> " + objKeyByValue(E_MODE, a));
        if (null != mixerWidget) {
          if (isPortrait) {
            switch (a) {
              case E_MODE.MIX: case E_MODE.BIG: case E_MODE.GAIN: case E_MODE.AUX: case E_MODE.FXSENDS: case E_MODE.MOREME: break;
              default: return;
            }
          }
          lastMode = mode;
          modeHistory.push(mode);
          mode = a;
          clearInterval(ticker);
          for (var c = 0; c < widgets.length; c++) widgets[c].hide();
          topWidget.show();
          masterWidget.show();
          bottomWidget.show();
          if (mixerWidget.mode != E_MODE.MIX) mixerWidget.setMode(E_MODE.MIX);
          switch (a) {
            case E_MODE.UDP:
              masterWidget.hide(); bottomWidget.hide(); udpPage.show();
              break;
            case E_MODE.BIG:
              bmMeters.show();
              switch (bmMode) {
                case 0: gainMixer.show(); break;
                case 1: bmEqdyn.show(); break;
                case 2: bmSends.show(); break;
                case 3: bmUdp.show(); break;
                case 4: infoMaster.show(); infoMixer.show(); break;   // <- added missing break (BUG B)
                case 5: if (typeof bmCustom !== "undefined") bmCustom.show(); break;
              }
              slideOutWidget.show();
              mixerWidget.show();
              break;
            case E_MODE.MIX:
              mixerWidget.show();
              if (settings.masterHide) masterWidget.hide();
              if (settings.pinSlideOut || (isDefined(b) && 2 != b)) { if (settings.masterHide) masterWidget.show(); slideOutWidget.show(); }
              break;
            case E_MODE.GAIN:
              if (settings.masterHide) masterWidget.hide();
              gainMixer.show();
              break;
            case E_MODE.EDIT:
              editStripWidget.show(); editWidget.show();
              break;
            case E_MODE.AUX:
              if (settings.masterHide) masterWidget.hide();
              if (settings.pinSlideOutX || (isDefined(b) && 2 != b)) { if (settings.masterHide) masterWidget.show(); slideOutWidget.show(); }
              auxoutWidget.show(); auxWidget.show();
              break;
            case E_MODE.FXSENDS:
              if (settings.masterHide) masterWidget.hide();
              if (settings.pinSlideOutX || (isDefined(b) && 2 != b)) { if (settings.masterHide) masterWidget.show(); slideOutWidget.show(); }
              fxSendsWidget.show(); fxoutWidget.show();
              break;
            case E_MODE.SETTINGS:
              masterWidget.hide(); bottomWidget.hide(); settingsWidget.show();
              break;
            case E_MODE.MODALS:
              bottomWidget.hide(); modalsWidget.show();
              break;
            case E_MODE.PLAYER:
              bottomWidget.hide(); playerWidget.show();
              if (IS_UI_24) { if (0 == playerWidget.mode) { playerStrips.show(); playerLabels.show(); } }
              else { playerStrips.show(); playerLabels.show(); }
              break;
            case E_MODE.PONG:
              pongGame.show();
              break;
            case E_MODE.MOREME:
              slideOutWidget.hide(); bottomWidget.hide(); masterWidget.hide();
              if (isDefined(b) && 2 == b) topWidget.hide();
              auxoutWidget.show(); moremeWidget.show();
          }
          geomAll();
          bottomWidget.upd();
          drawAll("setMode(" + objKeyByValue(E_MODE, a) + ")");
        }
      };

      /* ================================================================================
       * SECTION 4 - Boot glue: build/attach the Big-Display Player widgets exactly once,
       * whether we started with settings.bigD already on (our own launcher pre-seeds
       * this) or we are being injected live into a session that booted with it off.
       * ================================================================================ */

      function ensureBigDisplayWidgets() {
        settings.bigD = true;
        if (typeof settingsStorage !== "undefined" && settingsStorage.set) safe(function () { settingsStorage.set("bigD", true); });
        settings.bigSlideOut = true;

        if (typeof infoMixer === "undefined" || !infoMixer) window.infoMixer = new InfoMixer();
        if (typeof infoMaster === "undefined" || !infoMaster) window.infoMaster = new InfoMasterStrip();
        if (typeof bmEqdyn === "undefined" || !bmEqdyn) window.bmEqdyn = new BM_EQDYN();
        if (typeof bmSends === "undefined" || !bmSends) window.bmSends = new BM_SENDS();
        if (typeof bmMeters === "undefined" || !bmMeters) window.bmMeters = new BM_METERS();
        if (typeof bmUdp === "undefined" || !bmUdp) window.bmUdp = new UDP_CUSTOM_PAGE2();
        if (typeof bmCustom === "undefined" || !bmCustom) window.bmCustom = new BM_CUSTOM();   // BUG E fix: never recreate

        if (!(slideOutWidget instanceof CustomSlideOut2)) {
          if (slideOutWidget && typeof slideOutWidget.hide === "function") slideOutWidget.hide();  // BUG E fix: don't orphan the old one
          window.slideOutWidget = new CustomSlideOut2();
          slideOutWidget.setView(0);
        }

        geomAll();
        // If we were injected live (bigD was off, so we may still be sitting in plain
        // MIX mode), re-enter the current mode so the BIG-mode widgets actually appear.
        setMode(mode);
        drawAll("Ui24R Custom: enabled");
      }

      window.Ui24RCustom = window.Ui24RCustom || {};
      window.Ui24RCustom.enablePlayerView = ensureBigDisplayWidgets;

      // The main app boots asynchronously (it waits for all its images to finish
      // loading before calling initGUI()), so `mixerWidget`, `settingsWidget` etc. may
      // not exist the instant this script runs - whether we're loaded right after the
      // app on a fresh page, or injected into an already-open tab. Wait for the app's
      // own `guiReady` flag before touching anything.
      (function waitForGui(attempt) {
        if (typeof guiReady !== "undefined" && guiReady) {
          if (isCustomViewEnabled()) safe(ensureBigDisplayWidgets);
          return;
        }
        if (attempt > 300) { console.error("[Ui24R Custom] Gave up waiting for the mixer app to finish booting."); return; }
        setTimeout(function () { waitForGui((attempt || 0) + 1); }, 100);
      })(0);

      /* ================================================================================
       * SECTION 5 + 6 - Custom Hotkeys engine + Settings page  (see hotkeys.js)
       * Kept in a second IIFE appended right after this one in the bundle; see
       * Ui24R-Custom.html for load order. Split out only for readability while editing -
       * functionally this is one script.
       * ================================================================================ */

    })();

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

  }

  var tries = 0;
  (function poll() {
    if (mixerReady()) { run(); return; }
    if (++tries > 150) { console.error("[Ui24R Custom] Mixer app never became ready - giving up."); return; }
    setTimeout(poll, 200);
  })();
})();
