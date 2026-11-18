const shellCSS = `html, body, .layout, .frame, iframe {background: transparent !important}
  .bar, .panel {background: rgba(20,24,30,.4) !important}`;
const artifactCSS = `html {background: transparent !important}
  body {background: color-mix(in srgb, var(--paper, #101318) 40%, transparent) !important}
  body > main {background: transparent !important}`;
const styleId = 'lavish-private-app-background';

function applyWindowAppearance(window, settings) {
  window.setBackgroundColor(settings.transparent ? '#00000000' : '#101318');
  // Opacity stays at 100%: fading the whole window would also fade the native
  // blur and the text. Transparency (60%) lives in the 40%-alpha backgrounds.
  window.setOpacity(1);
  if (process.platform === 'darwin') window.setVibrancy(settings.transparent ? 'under-window' : null);
}

// No preload or privileged API is added to an artifact. The temporary style is
// removed on toggle, and reapplied after a frame reload without navigating it.
function watchAppearance(view, getSettings, onError = error => console.error('Lavish appearance:', error.message)) {
  let chain = Promise.resolve(), cssKey = null;
  const contents = view.webContents;
  view.applyAppearance = () => {
    const run = chain.then(async () => {
      if (contents.isDestroyed()) return;
      const settings = getSettings(), enabled = settings.transparent;
      // This top-level app-owned value is forwarded by chrome-addon through the existing bound bridge.
      // Old artifactBackground/web-storage values must not create a second transparency state.
      await contents.executeJavaScript(`document.documentElement.dataset.mbAppMode = ${JSON.stringify(enabled ? 'transparent' : 'dark')}`);
      view.setBackgroundColor(enabled ? '#00000000' : '#101318');
      if (cssKey) {await contents.removeInsertedCSS(cssKey).catch(() => {});cssKey = null;}
      if (enabled) cssKey = await contents.insertCSS(shellCSS, {cssOrigin: 'user'});
      for (const frame of contents.mainFrame.framesInSubtree) {
        if (frame === contents.mainFrame || frame.detached) continue;
        try {
          await frame.executeJavaScript(`(() => {
            const old = document.getElementById(${JSON.stringify(styleId)});
            if (old) old.remove();
            if (${Boolean(enabled)}) {
              const style = document.createElement('style');
              style.id = ${JSON.stringify(styleId)};
              style.textContent = ${JSON.stringify(artifactCSS)};
              document.documentElement.append(style);
            }
          })()`);
        } catch (error) {if (!contents.isDestroyed() && !frame.detached) throw error;}
      }
    });
    chain = run.catch(onError);
    return run;
  };
  contents.on('dom-ready', () => {void view.applyAppearance().catch(() => {});});
  contents.on('did-frame-finish-load', () => {void view.applyAppearance().catch(() => {});});
  contents.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => {if (mainFrame) cssKey = null;});
}
module.exports = {applyWindowAppearance, watchAppearance};
