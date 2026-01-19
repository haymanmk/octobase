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

const createSplitView = () => {
  // Parent window
  const parentWin = new BrowserWindow({
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
  const leftView = new WebContentsView();
  const searchBarView = new WebContentsView();
  const rightView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    }
  });
  const overlayView = new WebContentsView({
    webPreferences: {
      transparent: true,
      frame: false,
    }
  }); // For drag-and-drop overlays, if needed
  overlayView.setBackgroundColor('#00000000'); // Transparent background

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
  // overlayView.webContents.openDevTools();
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
    // Here you can implement logic to handle drag-and-drop text selection
    // add overlay to parent window
    parentWin.contentView.addChildView(overlayView);
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