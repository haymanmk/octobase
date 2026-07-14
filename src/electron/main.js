/**
 * Main process code (Entry point) for Electron app
 *
 * View topology: `appView` (the React shell — workspace, viewer chrome) spans
 * the whole window. The shell renders an empty "viewer slot" and streams its
 * rectangle over IPC; `browserView` (a live web page with the highlighter
 * injected) is docked into that slot by simply following the reported bounds.
 * `overlayView` is attached on top only while a highlight drag is in flight.
 */

import { app, BrowserWindow, dialog, ipcMain, net, protocol, WebContentsView } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createStore } from './highlights-store.js';
import { createCaptureServer } from './capture-server.js';
import { normalizeAddress } from './url-normalize.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Clip PNGs live on disk and are served to the renderer over this scheme
// (octobase-clip://c/<file>). Must be registered before app.whenReady.
protocol.registerSchemesAsPrivileged([
  { scheme: 'octobase-clip', privileges: { standard: true, secure: true, stream: true } },
  { scheme: 'octobase-pdf', privileges: { standard: true, secure: true, stream: true } },
]);

const defaultURL = "https://www.electronjs.org/docs/latest/api/web-contents#contentsexecutejavascriptcode-usergesture";
let parentWin = null;
let overlayView = null;
let appView = null;
let browserView = null;
let captureServer = null;

/**
 * One-shot region-selection overlay injected into the live page. Draws a
 * crosshair + rubber-band rect; Esc cancels. The overlay removes itself and
 * waits two frames before reporting, so the dim/selection chrome is never in
 * the captured pixels. Reports through the highlighter preload bridge.
 */
const CLIP_OVERLAY_JS = `(() => {
  if (document.getElementById('__octobase_clip')) return;
  const ov = document.createElement('div');
  ov.id = '__octobase_clip';
  Object.assign(ov.style, {
    position: 'fixed', inset: '0', zIndex: 2147483647,
    cursor: 'crosshair', background: 'rgba(15,18,24,0.18)',
  });
  const box = document.createElement('div');
  Object.assign(box.style, {
    position: 'fixed', border: '1.5px solid #4f7dc9',
    background: 'rgba(79,125,201,0.12)', display: 'none', pointerEvents: 'none',
  });
  ov.appendChild(box);
  let sx = 0, sy = 0, drag = false;
  const finish = (rect) => {
    ov.remove();
    window.removeEventListener('keydown', esc, true);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (rect) window.electronAPI.clipRegion(rect);
      else window.electronAPI.clipCancel();
    }));
  };
  const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); finish(null); } };
  const upd = (e) => {
    const x = Math.min(sx, e.clientX), y = Math.min(sy, e.clientY);
    Object.assign(box.style, {
      left: x + 'px', top: y + 'px',
      width: Math.abs(e.clientX - sx) + 'px', height: Math.abs(e.clientY - sy) + 'px',
    });
  };
  ov.addEventListener('pointerdown', (e) => {
    drag = true; sx = e.clientX; sy = e.clientY;
    box.style.display = 'block'; upd(e); e.preventDefault();
  });
  ov.addEventListener('pointermove', (e) => { if (drag) upd(e); });
  ov.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const w = Math.abs(e.clientX - sx), h = Math.abs(e.clientY - sy);
    finish(w > 3 && h > 3
      ? { x: Math.min(sx, e.clientX), y: Math.min(sy, e.clientY), width: w, height: h }
      : null);
  });
  window.addEventListener('keydown', esc, true);
  document.documentElement.appendChild(ov);
})();`;

// Push navigation state to the shell's URL bar.
const sendBrowserState = () => {
  if (!appView || !browserView) return;
  const wc = browserView.webContents;
  appView.webContents.send('browser:state', {
    url: wc.getURL(),
    title: wc.getTitle(),
    canGoBack: wc.navigationHistory.canGoBack(),
    canGoForward: wc.navigationHistory.canGoForward(),
    loading: wc.isLoading(),
  });
};

// Append diagnostics to userData/octobase.log — renderer crashes, hangs, GPU
// exits. The renderer paints white when these hit, so without a trail they
// are unexplainable after the fact.
let logFile = null;
const dlog = (...parts) => {
  const line = `${new Date().toISOString()} ${parts.join(' ')}`;
  console.log(line);
  try {
    if (logFile) fs.appendFileSync(logFile, line + '\n');
  } catch { /* logging must never break the app */ }
};

/** Watch a webContents for death/hangs; reload it when its process dies. */
const superviseView = (name, wc) => {
  wc.on('render-process-gone', (_e, details) => {
    dlog(`[${name}] renderer gone:`, details.reason, `exitCode=${details.exitCode}`, '— reloading');
    try { wc.reload(); } catch (err) { dlog(`[${name}] reload failed:`, err); }
  });
  wc.on('unresponsive', () => dlog(`[${name}] unresponsive`));
  wc.on('responsive', () => dlog(`[${name}] responsive again`));
  wc.on('console-message', (event) => {
    if (event.level === 'error') {
      dlog(`[${name}] console.error:`, event.message, `(${event.sourceId}:${event.lineNumber})`);
    }
  });
};

const createMainWindow = () => {
  parentWin = new BrowserWindow({
    width: 1440,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  appView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    }
  });
  browserView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-highlighter.js'),
      nodeIntegration: false,
      contextIsolation: true,
    }
  });
  overlayView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-overlay.js'),
      nodeIntegration: false,
      contextIsolation: true,
    }
  }); // For drag-and-drop overlays, attached only during a drag

  parentWin.contentView.addChildView(appView);
  parentWin.contentView.addChildView(browserView);

  appView.webContents.loadFile(path.join(__dirname, '../../dist/index.html'));
  browserView.webContents.loadURL(defaultURL);
  overlayView.webContents.loadFile(path.join(__dirname, '../../dist/src/components/overlay-canva/overlay-canva.html'));

  // Inject text selection monitoring script
  const highlighterScript = fs.readFileSync(path.join(__dirname, '../../dist/highlighter/highlighter.iife.js'), 'utf8');
  browserView.webContents.on('did-finish-load', () => {
    browserView.webContents.executeJavaScript(highlighterScript).catch(err => console.error('JS injection failed:', err));
  });

  for (const ev of ['did-navigate', 'did-navigate-in-page', 'page-title-updated', 'did-start-loading', 'did-stop-loading']) {
    browserView.webContents.on(ev, sendBrowserState);
  }

  // Main only sizes the full-window views; the browser pane follows the
  // shell's viewer slot via `pane:set-bounds`.
  const updateViewBounds = () => {
    const { width, height } = parentWin.getContentBounds();
    appView.setBounds({ x: 0, y: 0, width, height });
    overlayView.setBounds({ x: 0, y: 0, width, height });
  };

  browserView.setVisible(false); // hidden until the shell docks it
  updateViewBounds();
  parentWin.on('resize', updateViewBounds);

  superviseView('app', appView.webContents);
  superviseView('browser', browserView.webContents);
  superviseView('overlay', overlayView.webContents);
};

app.whenReady().then(() => {
  logFile = path.join(app.getPath('userData'), 'octobase.log');
  dlog('app ready, electron', process.versions.electron);
  // GPU-process exits leave every Chromium surface painted white while the
  // window chrome still works — exactly the "screen went blank" report.
  app.on('child-process-gone', (_event, details) => {
    dlog('child process gone:', details.type, details.reason, `exitCode=${details.exitCode}`);
  });

  createMainWindow();

  const store = createStore(app.getPath('userData'));

  // Viewer pane docking: the renderer owns the layout and streams the slot
  // rectangle; main just applies it to the native view.
  ipcMain.on('pane:set-bounds', (_event, r) => {
    if (!browserView || !r) return;
    browserView.setBounds({
      x: Math.round(r.x),
      y: Math.round(r.y),
      width: Math.max(0, Math.round(r.width)),
      height: Math.max(0, Math.round(r.height)),
    });
  });

  ipcMain.on('pane:set-visible', (_event, visible) => {
    browserView?.setVisible(!!visible);
    // A freshly remounted viewer has no navigation state yet — push it.
    if (visible) sendBrowserState();
  });

  // Browser chrome (URL bar / nav buttons live in the shell).
  ipcMain.on('browser:navigate', (_event, input) => {
    const url = normalizeAddress(input);
    if (url) browserView?.webContents.loadURL(url).catch((err) => console.warn('navigate failed:', err));
  });
  ipcMain.on('browser:back', () => {
    const nav = browserView?.webContents.navigationHistory;
    if (nav?.canGoBack()) nav.goBack();
  });
  ipcMain.on('browser:forward', () => {
    const nav = browserView?.webContents.navigationHistory;
    if (nav?.canGoForward()) nav.goForward();
  });
  ipcMain.on('browser:reload', () => {
    browserView?.webContents.reload();
  });

  // Clip a region of the live page as an image card. The renderer's ✂ button
  // starts it; the injected overlay reports the rect (page-view DIP coords,
  // exactly what capturePage wants); the PNG lands in userData/clips and the
  // app view turns the reference into an image card.
  const clipsDir = path.join(app.getPath('userData'), 'clips');
  fs.mkdirSync(clipsDir, { recursive: true });
  protocol.handle('octobase-clip', (req) => {
    const name = path.basename(new URL(req.url).pathname);
    return net.fetch(pathToFileURL(path.join(clipsDir, name)).toString());
  });

  // Imported PDFs live under userData/pdfs and are served over octobase-pdf://.
  const pdfsDir = path.join(app.getPath('userData'), 'pdfs');
  fs.mkdirSync(pdfsDir, { recursive: true });
  protocol.handle('octobase-pdf', (req) => {
    const name = path.basename(new URL(req.url).pathname);
    return net.fetch(pathToFileURL(path.join(pdfsDir, name)).toString());
  });

  // Import a PDF: native picker → copy into pdfs/ under a fresh name. The
  // renderer reads the page count via pdf.js, so main only needs to persist
  // the file. Returns { file, name } or null if cancelled.
  ipcMain.handle('pdf:open', async () => {
    const res = await dialog.showOpenDialog(parentWin, {
      title: 'Open PDF',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      properties: ['openFile'],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    return importPdf(res.filePaths[0]);
  });

  // Import a dropped PDF by absolute path (the renderer forwards File.path).
  ipcMain.handle('pdf:import', async (_event, srcPath) => {
    try {
      if (typeof srcPath !== 'string' || !srcPath.toLowerCase().endsWith('.pdf')) return null;
      return importPdf(srcPath);
    } catch (err) {
      dlog('pdf import failed:', err);
      return null;
    }
  });

  // Deleting a pdf card deletes its imported copy (and its parsed text).
  ipcMain.handle('pdf:delete', (_event, file) => {
    try {
      fs.rmSync(path.join(pdfsDir, path.basename(String(file))), { force: true });
      fs.rmSync(path.join(pdfTextDir, `${path.basename(String(file))}.md`), { force: true });
      return true;
    } catch (err) {
      dlog('pdf delete failed:', err);
      return false;
    }
  });

  // Parsed whole-document text (markdown) for the in-app AI, cached beside
  // the PDFs. The renderer extracts (pdf.js lives there); main persists.
  // PDFs are immutable after import, so a cache entry never invalidates.
  const pdfTextDir = path.join(app.getPath('userData'), 'pdf-text');
  fs.mkdirSync(pdfTextDir, { recursive: true });
  const pdfTextPath = (file) => path.join(pdfTextDir, `${path.basename(String(file))}.md`);

  ipcMain.handle('pdftext:save', (_event, { file, markdown }) => {
    try {
      fs.writeFileSync(pdfTextPath(file), String(markdown), 'utf8');
      return true;
    } catch (err) {
      dlog('pdf text save failed:', err);
      return false;
    }
  });

  ipcMain.handle('pdftext:load', (_event, file) => {
    try {
      return fs.readFileSync(pdfTextPath(file), 'utf8');
    } catch {
      return null; // not parsed yet
    }
  });

  function importPdf(srcPath) {
    const file = `${randomUUID()}.pdf`;
    fs.copyFileSync(srcPath, path.join(pdfsDir, file));
    return { file, name: path.basename(srcPath, path.extname(srcPath)) };
  }

  ipcMain.on('clip:start', () => {
    browserView?.webContents.executeJavaScript(CLIP_OVERLAY_JS).catch((err) => {
      dlog('clip overlay injection failed:', err);
      appView?.webContents.send('clip:cancelled');
    });
  });

  ipcMain.on('clip:cancel', () => appView?.webContents.send('clip:cancelled'));

  ipcMain.on('clip:region', async (_event, rect) => {
    try {
      if (!browserView || !rect || rect.width < 4 || rect.height < 4) {
        appView?.webContents.send('clip:cancelled');
        return;
      }
      const wc = browserView.webContents;
      const image = await wc.capturePage({
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
      const file = `${randomUUID()}.png`;
      fs.writeFileSync(path.join(clipsDir, file), image.toPNG());
      const size = image.getSize();
      appView?.webContents.send('clip:captured', {
        file,
        w: size.width,
        h: size.height,
        sourceUrl: wc.getURL(),
        title: wc.getTitle(),
      });
    } catch (err) {
      dlog('clip capture failed:', err);
      appView?.webContents.send('clip:cancelled');
    }
  });

  // PDF clips are cropped in the renderer (the page canvas is already there),
  // so main just persists the PNG data URL into the same clips store.
  ipcMain.handle('clip:save', async (_event, { dataUrl, w, h }) => {
    try {
      const base64 = String(dataUrl).replace(/^data:image\/png;base64,/, '');
      const file = `${randomUUID()}.png`;
      fs.writeFileSync(path.join(clipsDir, file), Buffer.from(base64, 'base64'));
      return { file, w, h };
    } catch (err) {
      dlog('clip save failed:', err);
      return null;
    }
  });

  // Highlights persistence (browser view ↔ main)
  ipcMain.handle('highlights:load', async (_event, { url }) => {
    return await store.loadHighlightsForUrl(url);
  });

  ipcMain.handle('highlights:save', async (_event, highlight) => {
    await store.saveHighlight(highlight);
    browserView?.webContents.send('highlight:updated', highlight);
    const card = await store.syncCardFromHighlight(highlight);
    if (card) appView?.webContents.send('card:updated', card);
    return { ok: true };
  });

  ipcMain.handle('highlights:delete', async (_event, { id }) => {
    await store.deleteHighlight(id);
    browserView?.webContents.send('highlight:deleted', { id });
    return { ok: true };
  });

  ipcMain.handle('tags:list', async () => await store.listTags());

  // Capture extension: localhost server forwards captures/highlights to the
  // knowledge-base renderer (app view), which adds them as inbox cards.
  // Persist the pairing token so it survives restarts (otherwise the user would
  // have to re-pair the extension every launch).
  const tokenFile = path.join(app.getPath('userData'), 'capture-token.txt');
  let captureToken;
  try {
    captureToken = fs.readFileSync(tokenFile, 'utf8').trim();
  } catch {
    captureToken = '';
  }
  if (!captureToken) {
    captureToken = randomUUID();
    try { fs.writeFileSync(tokenFile, captureToken); } catch (e) { console.warn('could not persist capture token:', e); }
  }

  captureServer = createCaptureServer({
    token: captureToken,
    onCapture: (data) => {
      appView?.webContents.send('capture:received', data);
      return { id: null };
    },
    onHighlight: (data) => {
      appView?.webContents.send('highlight:received', data);
      return { id: null };
    },
  });
  captureServer
    .start()
    .then((port) => console.log(`octobase capture server listening on http://127.0.0.1:${port}`))
    .catch((err) => console.error('capture server failed to start:', err));

  ipcMain.handle('extension:info', () => ({
    port: captureServer?.port ?? 7373,
    token: captureServer?.token ?? '',
  }));

  // Cards persistence (app view ↔ main)
  ipcMain.handle('cards:load', async () => await store.loadCards());

  ipcMain.handle('cards:save', async (_event, card) => {
    await store.saveCard(card);
    appView?.webContents.send('card:updated', card);
    // Bidirectional sync: propagate content edits (color/tags/notes) from
    // the card side back into the matching highlight, and broadcast so the
    // browser view can re-apply the highlight color if it changed.
    const updatedHighlight = await store.syncHighlightFromCard(card);
    if (updatedHighlight) {
      browserView?.webContents.send('highlight:updated', updatedHighlight);
    }
    return { ok: true };
  });

  ipcMain.handle('cards:delete', async (_event, { id }) => {
    await store.deleteCard(id);
    appView?.webContents.send('card:deleted', { id });
    return { ok: true };
  });

  // Monitor text selection in the browser view
  ipcMain.on('text-selection', (event, data) => {
    // Here you can implement logic to show a popup or context menu based on selection
  });

  ipcMain.on('drag-drop-text-selection', (event, data) => {
    if (data === '' || !data) return;
    // add overlay to parent window
    parentWin.contentView.addChildView(overlayView);
    // Make overlay non-transparent at native level so it captures cursor hit-testing
    // Format is #RRGGBBAA — alpha is the last two hex digits
    overlayView.setBackgroundColor('#00000001');
    // Translate cursor position from browser-view-local to window-global coordinates
    const browserBounds = browserView.getBounds();
    const adjustedData = {
      ...data,
      cursorX: (data.cursorX || 0) + browserBounds.x,
      cursorY: (data.cursorY || 0) + browserBounds.y,
    };
    // Send text data to overlay view
    overlayView.webContents.send('drag-drop-text-selection', adjustedData);
  });

  // Relay mouse position from browser view to overlay (translated to window coords)
  ipcMain.on('drag-drop-text-position', (event, data) => {
    const browserBounds = browserView.getBounds();
    overlayView.webContents.send('drag-position-update', {
      x: (data.x || 0) + browserBounds.x,
      y: (data.y || 0) + browserBounds.y,
    });
  });

  // Browser view signals drag ended — tell overlay to finalize
  ipcMain.on('drag-drop-text-end', (event, data) => {
    overlayView.webContents.send('drag-end');
  });

  ipcMain.on('highlight-dropped', async (event, data) => {
    // Restore overlay to fully transparent
    overlayView.setBackgroundColor('#00000000');
    // Remove overlay from parent window
    try {
      parentWin.contentView.removeChildView(overlayView);
    } catch (e) {
      console.warn('Failed to remove overlay view:', e);
    }

    if (!data || !appView) return;

    // Discard drops outside the window; the shell decides what an in-window
    // point means (canvas → placed card, viewer/divider → cancel, else inbox).
    const appBounds = appView.getBounds();
    const dropX = data.x;
    const dropY = data.y;

    if (
      dropX < appBounds.x || dropX > appBounds.x + appBounds.width ||
      dropY < appBounds.y || dropY > appBounds.y + appBounds.height
    ) {
      console.debug('Drop outside window, discarding.');
      return;
    }

    const localX = dropX - appBounds.x;
    const localY = dropY - appBounds.y;

    // Look up the originating highlight to copy color/tags/notes onto the card.
    const allHighlights = await store.loadAllHighlights();
    const highlight = allHighlights.find((h) => h.id === data.highlightId);

    // The workspace renderer owns card creation + placement: it knows the
    // canvas pan/zoom, so it converts the drop point to world coords itself.
    appView.webContents.send('highlight-dropped', {
      highlightId: data.highlightId,
      text: highlight?.text ?? data.text,
      sourceUrl: highlight?.sourceUrl ?? data.sourceUrl,
      color: highlight?.color ?? 'yellow',
      tags: highlight?.tags ?? [],
      notes: highlight?.notes ?? '',
      x: localX,
      y: localY,
    });
  });
});

app.on('will-quit', () => {
  captureServer?.stop();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});
