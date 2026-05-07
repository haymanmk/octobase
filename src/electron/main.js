/**
 * Main process code (Entry point) for Electron app
 */

import { app, BrowserWindow, ipcMain, WebContentsView } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const defaultURL = "https://www.electronjs.org/docs/latest/api/web-contents#contentsexecutejavascriptcode-usergesture";
let parentWin = null;
let overlayView = null;
let leftView = null;
let rightView = null;

const createSplitView = () => {
  // Parent window
  parentWin = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Create WebContentsViews
  leftView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    }
  });
  const searchBarView = new WebContentsView();
  rightView = new WebContentsView({
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
  }); // For drag-and-drop overlays, if needed

  // Add views to the parent window
  parentWin.contentView.addChildView(leftView);
  parentWin.contentView.addChildView(searchBarView);
  parentWin.contentView.addChildView(rightView);
  // parentWin.contentView.addChildView(overlayView);

  // Load content into each view
  leftView.webContents.loadFile(path.join(__dirname, '../../dist/index.html'));
  searchBarView.webContents.loadFile(path.join(__dirname, '../../dist/src/components/searchbar/searchbar.html'));
  rightView.webContents.loadURL(defaultURL);
  overlayView.webContents.loadFile(path.join(__dirname, '../../dist/src/components/overlay-canva/overlay-canva.html'));

  // Inject text selection monitoring script
  // Read inject script
  const highlighterScript = fs.readFileSync(path.join(__dirname, '../../dist/highlighter/highlighter.iife.js'), 'utf8');
  // console.log('Highlighter Script Loaded:');
  // console.log(highlighterScript);
  rightView.webContents.on('did-finish-load', () => {
    // Inject JavaScript bundle
    rightView.webContents.executeJavaScript(highlighterScript).catch(err => console.error('JS injection failed:', err));
  });

  // Function to update view bounds based on window size
  const updateViewBounds = () => {
    const bounds = parentWin.getBounds();
    const width = bounds.width;
    const height = bounds.height;
    const searchBarHeight = 50; // Fixed height for search bar
    
    // Split window 50/50
    leftView.setBounds({ 
      x: 0, 
      y: 0, 
      width: Math.floor(width / 2), 
      height: height 
    });
    searchBarView.setBounds({
      x: Math.floor(width / 2),
      y: 0,
      width: Math.floor(width / 2),
      height: searchBarHeight
    });
    rightView.setBounds({ 
      x: Math.floor(width / 2),
      y: searchBarHeight,
      width: Math.floor(width / 2),
      height: height - searchBarHeight
    });
    overlayView.setBounds({ 
      x: 0, 
      y: 0, 
      width: width, 
      height: height 
    });
  };

  // Initial bounds
  updateViewBounds();

  // Update bounds when window is resized
  parentWin.on('resize', updateViewBounds);

  // Open devtools for debugging
  leftView.webContents.openDevTools();
  rightView.webContents.openDevTools();
  overlayView.webContents.openDevTools();
};

app.whenReady().then(() => {
  // createWindow()
  createSplitView();

  // Monitor text selection in the right view
  ipcMain.on('text-selection', (event, data) => {
    console.log('Selected Text:', data.text);
    console.log('Bounding Rect:', data.rect);
    // Here you can implement logic to show a popup or context menu based on selection
  });

  ipcMain.on('drag-drop-text-selection', (event, data) => {
    console.log('Drag-Drop Selected Text:', data);
    if (data === '' || !data) return;
    // add overlay to parent window
    parentWin.contentView.addChildView(overlayView);
    // Make overlay non-transparent at native level so it captures cursor hit-testing
    // Format is #RRGGBBAA — alpha is the last two hex digits
    overlayView.setBackgroundColor('#00000001');
    // Translate cursor position from right-view-local to window-global coordinates
    const rightBounds = rightView.getBounds();
    const adjustedData = {
      ...data,
      cursorX: (data.cursorX || 0) + rightBounds.x,
      cursorY: (data.cursorY || 0) + rightBounds.y,
    };
    // Send text data to overlay view
    overlayView.webContents.send('drag-drop-text-selection', adjustedData);
  });

  // Relay mouse position from right view to overlay (translated to window coords)
  ipcMain.on('drag-drop-text-position', (event, data) => {
    const rightBounds = rightView.getBounds();
    overlayView.webContents.send('drag-position-update', {
      x: (data.x || 0) + rightBounds.x,
      y: (data.y || 0) + rightBounds.y,
    });
  });

  // Right view signals drag ended — tell overlay to finalize
  ipcMain.on('drag-drop-text-end', (event, data) => {
    overlayView.webContents.send('drag-end');
  });

  ipcMain.on('highlight-dropped', (event, data) => {
    console.log('Highlight Dropped:', data);
    // Restore overlay to fully transparent
    overlayView.setBackgroundColor('#00000000');
    // Remove overlay from parent window
    try {
      parentWin.contentView.removeChildView(overlayView);
    } catch (e) {
      console.warn('Failed to remove overlay view:', e);
    }

    if (!data || !leftView) return;

    // Get leftView bounds to check if drop is within the whiteboard
    const leftBounds = leftView.getBounds();
    const dropX = data.x;
    const dropY = data.y;

    if (dropX >= leftBounds.x && dropX <= leftBounds.x + leftBounds.width &&
        dropY >= leftBounds.y && dropY <= leftBounds.y + leftBounds.height) {
      // Translate to left view's local coordinates
      const adjustedData = {
        text: data.text,
        sourceUrl: data.sourceUrl,
        highlightId: data.highlightId,
        x: dropX - leftBounds.x,
        y: dropY - leftBounds.y,
      };
      console.log('Forwarding to whiteboard:', adjustedData);
      leftView.webContents.send('highlight-dropped', adjustedData);
    } else {
      console.log('Drop outside whiteboard, discarding.');
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    // createWindow()
    createSplitView();
  }
});