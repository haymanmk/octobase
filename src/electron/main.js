import { app, BaseWindow, BrowserWindow, WebContentsView } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const createWindow = () => {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js')
    }
  })

  const view1 = new WebContentsView()
  win.contentView.addChildView(view1)
  view1.webContents.loadURL('https://www.google.com')

  // Function to update view bounds based on window size
  const updateViewBounds = () => {
    const bounds = win.getBounds()
    const width = bounds.width
    const height = bounds.height
    
    // Example: Split window 50/50
    view1.setBounds({ 
      x: Math.floor(width / 2), 
      y: 0, 
      width: Math.floor(width / 2), 
      height: height 
    })
  }

  // Initial bounds
  updateViewBounds()

  // Update bounds when window is resized
  win.on('resize', updateViewBounds)

  win.loadFile(path.join(__dirname, '../../dist/index.html'))
}

const createSplitView = () => {
  // Parent window
  const parentWin = new BaseWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js')
    }
  })

  // Create two WebContentsViews
  const leftView = new WebContentsView()
  const rightView = new WebContentsView()

  // Add views to the parent window
  parentWin.contentView.addChildView(leftView)
  parentWin.contentView.addChildView(rightView)

  // Load content into each view
  leftView.webContents.loadFile(path.join(__dirname, '../../dist/index.html'))
  rightView.webContents.loadURL('https://www.google.com')

  // Function to update view bounds based on window size
  const updateViewBounds = () => {
    const bounds = parentWin.getBounds()
    const width = bounds.width
    const height = bounds.height
    
    // Split window 50/50
    leftView.setBounds({ 
      x: 0, 
      y: 0, 
      width: Math.floor(width / 2), 
      height: height 
    })
    rightView.setBounds({ 
      x: Math.floor(width / 2), 
      y: 0, 
      width: Math.floor(width / 2), 
      height: height 
    })
  }

  // Initial bounds
  updateViewBounds()

  // Update bounds when window is resized
  parentWin.on('resize', updateViewBounds)

  // Open devtools for debugging
  leftView.webContents.openDevTools()

  // parentWin.loadFile(path.join(__dirname, '../../dist/index.html'))
}

app.whenReady().then(() => {
  // createWindow()
  createSplitView()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    // createWindow()
    createSplitView()
  }
})