// Electron main process
// Dev mode: loads from Vite dev server (http://localhost:5173)
// Prod mode: loads bundled static web build (dist/index.html)

const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Showrunner',
    webPreferences: {
      contextIsolation: true,
    },
  });

  if (!app.isPackaged) {
    // Development: Vite dev server must be running on port 5173
    win.loadURL('http://localhost:5173');
  } else {
    // Production: load the bundled static web build
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    // Re-create window when dock icon is clicked and no windows are open (macOS)
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // On macOS, apps typically stay active until the user quits explicitly
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
