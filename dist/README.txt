UI24R CUSTOM LAYOUT — Player Tab + Custom Hotkeys + Tap Tempo
================================================================

WHAT THIS IS
------------
A self-contained, offline copy of Soundcraft's Ui24R web control interface
with three things added on top of the stock app:

  1. A working "PLAYER" tab under EDIT VIEW (front-panel / Big-Display style),
     based on the community script at github.com/ndikanov/ui24, but with six
     real bugs in that script fixed (see BUGS FIXED below) - most importantly,
     pressing Tab now correctly cycles through the Player tab along with the
     other Edit View tabs, and it no longer visually overlaps the Info tab.
  2. A full custom-hotkeys settings page (Settings > HOTKEYS) - every keyboard
     shortcut is listed, shows its current key, and can be re-bound to any
     key you like by clicking its badge and pressing a new key.
  3. Tap Tempo, bound to the Space bar by default, changeable from that same
     HOTKEYS page like any other shortcut.
  4. A CUSTOM MENU right in the Edit View sidebar, below MASTERS, with SWITCH
     and SETUP buttons styled to match the mixer's own buttons - both take you
     back to the mode-picker screen (Demo Mode / Connect to My Mixer) without
     ever leaving the mixer's own screen.
  5. A real PLAYER L channel strip - fader, mute, solo, VU meter - docked to
     the left of the Player tab, so you can control the player's volume right
     there instead of hunting for it back in the normal channel view.
  6. "CUSTOM MADE BY: SKATI ARREGLO" on the mixer's own Settings > ABOUT page,
     right under the UNIQUE ID line.

HOW TO RUN IT
-------------
1. Unzip this entire folder somewhere on your computer. Keep everything
   together - the HTML file needs vendor-app.js, the img1x/ folder, fonts/,
   js/ and the two ui24r-custom-*.js files sitting right next to it.
2. Double-click Ui24R-Custom.html. It opens directly in your browser -
   no server, no install, no internet connection required for Demo Mode.
3. You'll see two choices:

     DEMO MODE
       Runs entirely offline, right there in the tab. This is the same
       simulator Soundcraft runs on their own website, with the Player tab
       and Hotkeys already wired in. Good for trying everything out first.

     CONNECT TO MY MIXER
       Type your real Ui24R's address (10.10.2.1 if you're on its own Wi-Fi
       hotspot, or your normal network IP/hostname) and it opens your actual
       mixer's own control page in a new tab - exactly like typing the
       address into your browser normally. Optionally, this screen also
       gives you two ways to layer the same Player tab + Hotkeys on top of
       that live session (see APPLYING THIS TO YOUR REAL MIXER below).

   There's also a checkbox to turn the custom layout on/off - leave it
   checked for the Player tab + Hotkeys, or untick it to run the plain,
   unmodified mixer interface.

4. Whatever you pick, it's remembered. Refreshing or reopening the page
   drops you straight back into the same mode - it will NOT ask you again.
   To change your mind later, open the Edit View sidebar (front-panel/
   Big-Display view) and look below the MASTERS section for CUSTOM MENU:
     - SWITCH and SETUP both take you back to the mode-picker screen shown
       in step 3, so you can pick a different mode or turn the custom
       layout off from the checkbox there.
   Both ask you to confirm before reloading the page. This menu works the
   same way whether you're in Demo Mode or connected to your real mixer.

APPLYING THIS TO YOUR REAL MIXER
---------------------------------
Opening "My Mixer" from the Connect screen always gives you the normal,
unmodified control page for your hardware - that part needs nothing extra.
To ALSO see the Player tab and Hotkeys there, pick one:

  Option A - quick test (resets if you reload the mixer's page):
    1. Click "Open My Mixer".
    2. On that page, open the browser console (Ctrl+Shift+J on
       Windows/Linux, Cmd+Option+J on Mac).
    3. Back on this Connect screen, click "Copy Script to Clipboard",
       paste it into that console, press Enter, then close the console.

  Option B - set & forget (survives page reloads):
    1. Install the free Tampermonkey extension (Chrome, Edge, Firefox and
       Safari all support it).
    2. Click "Download Auto-Install Script" and open the downloaded file -
       Tampermonkey offers to install it.
    3. Edit its one @match line to your mixer's actual address if it isn't
       10.10.2.1 (Tampermonkey's own editor shows you exactly where).
    4. From then on, every time you visit your mixer it loads automatically.

There's no third way to make this "permanent on the hardware itself" - the
Ui24R's firmware doesn't have a slot for loading extra scripts on its own,
so Option B (a browser userscript) is the closest thing to "install it once
and forget about it" that actually exists for this hardware.

Either option adds the same CUSTOM MENU (SWITCH / SETUP) described above,
below MASTERS in the Edit View sidebar - so on your real mixer you can turn
the custom layout off and back on the same way. One thing worth knowing if
you use Tampermonkey and turn it off: since the SWITCH button only exists
as part of the custom layout, turning it off removes your way back to it
from that button alone. To switch it on again, open the browser console
(same shortcut as Option A) and run:
   localStorage.setItem("ui24r.customView", "1")
then reload the page - Tampermonkey will re-apply everything.

CUSTOM HOTKEYS
---------------
Settings > HOTKEYS lists every shortcut with its current key. Click a key
badge and press any key to rebind it; click the small "x" to clear one;
"RESET ALL TO DEFAULTS" puts everything back the way it started. Your
choices are remembered in the browser (this is per-browser/per-computer,
same as the mode choice above).

Tap Tempo is on Space bar by default and works from any main view.

BUGS FIXED (vs. the ndikanov/ui24 reference script this was based on)
------------------------------------------------------------------------
  A. A global-variable collision silently broke the stock multi-track
     recorder panel whenever the Player tab's own recorder widget was used.
  B. A missing "break" meant selecting the Info tab also showed the Player
     tab stacked underneath it.
  C. The Player tab's side session-list panel could pop back over the main
     player on narrower windows even after being correctly hidden once.
  D. Two widgets had incorrect internal names, which some code paths rely on.
  E. Re-opening the custom layout could create duplicate, invisible copies
     of several widgets, and could orphan the previous Edit View panel
     instead of properly hiding it.
  F. The Tab-key shortcut for cycling Edit View tabs never included the new
     Player tab at all - fixed, and it now wraps around correctly in both
     directions.

FILES IN THIS FOLDER
---------------------
  Ui24R-Custom.html         The launcher - open this one.
  vendor-app.js             Soundcraft's own mixer engine (unmodified).
  ui24r-custom-inject.js    The Player tab + Hotkeys code (plain version).
  ui24r-custom.user.js      Same code, packaged as a Tampermonkey userscript.
  img1x/, fonts/, js/       Art and data assets the app needs.
