const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));

  page.on('requestfailed', req => console.log('REQUEST FAILED:', req.url(), req.failure()?.errorText));
  const bad = [];
  page.on('response', res => { if (!res.ok()) bad.push(res.status() + ' ' + res.url()); });
  page.on('close', () => { require('fs').writeFileSync('/tmp/ui24/bad_responses.json', JSON.stringify(bad, null, 2)); });

  await page.goto('http://127.0.0.1:8099/Ui24R-Custom.html', { waitUntil: 'load' });
  await page.screenshot({ path: '/tmp/ui24/shots/01-chooser.png' });

  const chooserTextCheck = await page.evaluate(() => ({
    subText: document.querySelector('#u24-chooser p.sub')?.textContent || null,
    creditText: document.querySelector('.u24-credit')?.textContent || null,
  }));
  console.log('Chooser subtitle + credit text:', JSON.stringify(chooserTextCheck));

  // Click Demo Mode
  await page.click('#u24-pick-demo');
  try {
    await page.waitForFunction(() => window.guiReady === true, { timeout: 20000 });
  } catch (e) {
    console.log('BAD RESPONSES:', JSON.stringify(bad, null, 2));
    console.log('TIMED OUT waiting for guiReady. Recent console errors:', JSON.stringify(errors.slice(-20), null, 2));
    await page.screenshot({ path: '/tmp/ui24/shots/02-timeout.png' });
    const dbg = await page.evaluate(() => ({
      hasWidget: typeof window.Widget,
      hasSettings: typeof window.settings,
      hasGuiReady: typeof window.guiReady,
      guiReady: window.guiReady,
      scripts: Array.from(document.scripts).map(s => s.src || '(inline)'),
    }));
    console.log('DEBUG STATE:', JSON.stringify(dbg, null, 2));
    throw e;
  }
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/tmp/ui24/shots/02-booted.png' });

  const state1 = await page.evaluate(() => ({
    bigD: settings.bigD,
    hasBmCustom: typeof bmCustom !== 'undefined',
    slideOutIsCustom: slideOutWidget.widgetName,
    mode: mode,
    E_MODE_BIG: E_MODE.BIG,
  }));
  console.log('STATE AFTER BOOT:', JSON.stringify(state1));

  // Force BIG/edit-view mode and go to gain tab, then screenshot
  await page.evaluate(() => { setMode(E_MODE.BIG); setBMode(0); drawAll(); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/tmp/ui24/shots/03-big-gain.png' });

  // Click the "custom" (Player) button that CustomSlideOut2 added
  const hasCustomBtn = await page.evaluate(() => !!(slideOutWidget.custom));
  console.log('has custom (Player) button on slideOutWidget:', hasCustomBtn);

  await page.evaluate(() => { slideOutWidget.custom.onToggleUp(); drawAll(); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/tmp/ui24/shots/04-player-tab.png' });

  const bmModeAfterClick = await page.evaluate(() => bmMode);
  console.log('bmMode after clicking Player button (expect 5):', bmModeAfterClick);

  // Now test Tab-key cycling includes mode 5. Start at bmMode 4 (info), press Tab, expect 5.
  await page.evaluate(() => { setBMode(4); });
  await page.keyboard.press('Tab');
  await page.waitForTimeout(200);
  let bmModeAfterTab = await page.evaluate(() => bmMode);
  console.log('bmMode after Tab from 4 (expect 5):', bmModeAfterTab);
  await page.screenshot({ path: '/tmp/ui24/shots/05-after-tab-from-info.png' });

  await page.keyboard.press('Tab');
  await page.waitForTimeout(200);
  let bmModeAfterTab2 = await page.evaluate(() => bmMode);
  console.log('bmMode after 2nd Tab (expect wrap to 0):', bmModeAfterTab2);

  // Confirm info+player no longer overlap: after selecting info (case4), custom widget should be hidden
  await page.evaluate(() => { setMode(E_MODE.MIX); setMode(E_MODE.BIG); setBMode(4); });
  await page.waitForTimeout(200);
  const overlapCheck = await page.evaluate(() => ({ infoEnabled: infoMaster.enabled, customEnabled: bmCustom.enabled }));
  console.log('overlap check at bmMode=4 (expect customEnabled:false):', JSON.stringify(overlapCheck));

  // Test mtkplayer show/hide bug fix: shrink screen width virtually by checking BM_CUSTOM.w vs 1680
  const layoutCheck = await page.evaluate(() => {
    setBMode(5);
    bmCustom.upd();
    return { w: bmCustom.w, mtkEnabled: bmCustom.mtkplayer.enabled };
  });
  console.log('BM_CUSTOM width vs mtkplayer visibility (should hide mtk when w<1680):', JSON.stringify(layoutCheck));
  await page.screenshot({ path: '/tmp/ui24/shots/06-player-final.png' });

  // Test hotkeys settings page presence
  await page.evaluate(() => { setMode(E_MODE.SETTINGS); settingsWidget.setMode(settingsWidget.pages.length - 1); drawAll(); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/tmp/ui24/shots/07-hotkeys-page.png' });

  const hkState = await page.evaluate(() => ({
    hasHotkeysTab: settingsWidget.tabButtons.some(t => t.text === 'HOTKEYS'),
    bindings: window.Ui24RCustom.hotkeys.getBindings(),
  }));
  console.log('hotkeys page installed + bindings:', JSON.stringify(hkState));

  // Test Space => tap tempo (not logo)
  await page.evaluate(() => { setMode(E_MODE.MIX); });
  const beforeTapArr = await page.evaluate(() => (window.BPM_TAP_ARRAY || []).length);
  await page.keyboard.press('Space');
  await page.waitForTimeout(100);
  const afterTapArr = await page.evaluate(() => (window.BPM_TAP_ARRAY || []).length);
  console.log('BPM_TAP_ARRAY length before/after Space press (expect increment):', beforeTapArr, afterTapArr);

  // Test rebinding: rebind 'viewMix' action to key 'K' programmatically via simulated click+keydown
  await page.evaluate(() => { setMode(E_MODE.SETTINGS); settingsWidget.setMode(settingsWidget.pages.length - 1); });
  await page.waitForTimeout(200);

  // ---- NEW: PLAYER L channel strip docked to the left of the custom Player tab ----
  await page.evaluate(() => { setMode(E_MODE.MIX); setMode(E_MODE.BIG); setBMode(5); drawAll(); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/tmp/ui24/shots/08-player-strip.png' });
  const stripCheck = await page.evaluate(() => {
    const p = bmCustom.player;
    return {
      hasStrip: !!p.strip,
      stripIsMediaStrips0: p.strip === mediaStrips[0],
      stripX: p.strip ? p.strip.x : null,
      stripParentIsPlayer: p.strip ? p.strip.parent === p : null,
      stripEnabled: p.strip ? p.strip.enabled : null,
      stripInWidgets: p.strip ? p.widgets.indexOf(p.strip) !== -1 : null,
      plistsX: p.PLISTS.x,
      mixerStripWidth: measures.mixerStripWidth,
    };
  });
  console.log('PLAYER L strip check (expect hasStrip:true, stripIsMediaStrips0:true, stripX:0, plistsX:10+112=122):', JSON.stringify(stripCheck));

  // Regression: with settings.mediaFirst on (real mixers can have this set), mixerWidget's
  // own regular bottom strip row must NOT also render mediaStrips[0] a second time.
  // mediaStrips[0] gets pushed into BOTH mixerWidget.strips (layout bookkeeping) AND
  // mixerWidget.widgets (the generic Widget child list, used by its own recursive
  // paint/update) the moment it's created - both have to be checked, since either one
  // alone painting it a second time reproduces Skati's "two stacked PLAYER L" report.
  // Reproduce with the EXACT real navigation sequence (no manual bottomWidget.upd()
  // calls) since setMode()'s own upd() can run before setBMode(5) actually docks the
  // strip, which is what let the bug slip past an earlier, less faithful version of
  // this same check.
  const dupCheck = await page.evaluate(() => {
    settings.mediaFirst = true;
    setMode(E_MODE.MIX); // redirects to BIG via settings.bigD, mirrors the real "MIX/GAIN" nav click
    setMode(E_MODE.BIG);
    setBMode(5);
    return {
      strippedFromMixerStrips: mixerWidget.strips.indexOf(mediaStrips[0]) === -1,
      strippedFromMixerWidgets: mixerWidget.widgets.indexOf(mediaStrips[0]) === -1,
      excludedFromBottomRibbon: bottomWidget.IDS.indexOf(mediaStrips[0].id) === -1,
      stillDockedInPlayer: bmCustom.player.widgets.indexOf(mediaStrips[0]) !== -1,
    };
  });
  console.log('mediaFirst duplicate-row check (expect all four true):', JSON.stringify(dupCheck));
  await page.screenshot({ path: '/tmp/ui24/shots/08b-player-strip-mediafirst.png' });

  const restoreCheck = await page.evaluate(() => {
    setBMode(0); // leave Player tab again
    return {
      restoredToMixerStrips: mixerWidget.strips.indexOf(mediaStrips[0]) !== -1,
      restoredToMixerWidgets: mixerWidget.widgets.indexOf(mediaStrips[0]) !== -1,
      backInBottomRibbon: bottomWidget.IDS.indexOf(mediaStrips[0].id) !== -1,
      noLongerInPlayerWidgets: bmCustom.player.widgets.indexOf(mediaStrips[0]) === -1,
    };
    // (settings.mediaFirst left "true" from the check above is fine - it just mirrors a
    // real mixer that has that option enabled; doesn't affect anything after this point.)
  });
  console.log('restored to mixerWidget after leaving Player tab (expect all four true):', JSON.stringify(restoreCheck));

  // Same check again at a wide viewport (>=1680px), where BM_CUSTOM also shows the MTK
  // panel side-by-side with the Player panel - the layout Skati's actual screenshot was
  // taken from, and where this bug was actually caught.
  await page.setViewportSize({ width: 2000, height: 1000 });
  await page.evaluate(() => { onResize(); geomAll(); setMode(E_MODE.MIX); setMode(E_MODE.BIG); setBMode(5); drawAll(); });
  await page.waitForTimeout(300);
  const wideDupCheck = await page.evaluate(() => ({
    mtkEnabled: bmCustom.mtkplayer.enabled,
    strippedFromMixerStrips: mixerWidget.strips.indexOf(mediaStrips[0]) === -1,
    strippedFromMixerWidgets: mixerWidget.widgets.indexOf(mediaStrips[0]) === -1,
    excludedFromBottomRibbon: bottomWidget.IDS.indexOf(mediaStrips[0].id) === -1,
  }));
  console.log('wide-layout (mtkplayer side-by-side) duplicate check (expect all true):', JSON.stringify(wideDupCheck));
  await page.screenshot({ path: '/tmp/ui24/shots/08c-player-strip-wide.png' });
  await page.setViewportSize({ width: 1400, height: 900 });

  // Leaving the Player tab should restore mediaStrips[0] back to the normal mixer.
  await page.evaluate(() => { setBMode(0); });
  await page.waitForTimeout(200);
  const unstripCheck = await page.evaluate(() => ({
    playerStripCleared: bmCustom.player.strip === null,
    mediaStrip0ParentRestored: mediaStrips[0].parent === mixerWidget,
  }));
  console.log('unStrip on hide check (expect both true):', JSON.stringify(unstripCheck));

  // ---- NEW: ABOUT page credit line ----
  await page.evaluate(() => {
    setMode(E_MODE.SETTINGS);
    const idx = settingsWidget.pages.findIndex(p => p.widgetName === 'ABOUT');
    settingsWidget.setMode(idx);
    drawAll();
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/tmp/ui24/shots/09-about-page.png' });
  const aboutPatchCheck = await page.evaluate(() => ABOUTPage.prototype.paint.toString().includes('CUSTOM MADE BY: SKATI ARREGLO'));
  console.log('ABOUTPage.paint patched with credit line (expect true):', aboutPatchCheck);

  console.log('CONSOLE/PAGE ERRORS (before SWITCH navigation test):', errors.length ? JSON.stringify(errors, null, 2) : 'none');

  // ---- NEW: SWITCH button now sends you to the chooser page instead of toggling in place ----
  // This genuinely triggers location.reload(), which destroys the current page's JS context -
  // keep this as the LAST step and just wait for the chooser HTML to reappear.
  await page.evaluate(() => { localStorage.setItem('ui24r.mode', 'demo'); });
  await page.evaluate(() => { window.Ui24RCustom.customMenu.switchView(); });
  await page.waitForSelector('#u24-pick-demo', { timeout: 10000 });
  const switchDestCheck = await page.evaluate(() => ({
    lsMode: localStorage.getItem('ui24r.mode'),
    chooserVisible: getComputedStyle(document.getElementById('u24-chooser')).display !== 'none',
  }));
  console.log('After SWITCH -> reload (expect lsMode:null, chooserVisible:true):', JSON.stringify(switchDestCheck));

  await browser.close();
})().catch(e => { console.error('TEST SCRIPT FAILED:', e); process.exit(1); });
