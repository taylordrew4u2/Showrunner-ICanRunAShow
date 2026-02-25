const { app, BrowserWindow } = require('electron');
const path = require('path');

// Ensure userData path is the same in dev (`electron .`) and in packaged builds.
// Without this, dev resolves the name from package.json `name` ("showrunner"),
// while packaged builds use electron-builder's `productName` ("Showrunner").
app.setName('Showrunner');

// When packaged by electron-builder, app.isPackaged is true.
// In dev (launched via `electron .`), it is false.
const isDev = !app.isPackaged;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (isDev) {
    // Load the Vite dev server started by `npm run dev`
    win.loadURL('http://localhost:5173');
  } else {
    // Load the static Vite build bundled inside the packaged app
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    // On macOS, re-create a window when the dock icon is clicked and no windows are open
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // On macOS, apps typically stay open until explicitly quit (Cmd+Q)
  if (process.platform !== 'darwin') app.quit();
});
