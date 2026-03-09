const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 900,
    icon: path.join(__dirname, 'favicon.ico'), // Opcional
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    }
  });

  // En Electron, podemos cargar el archivo localmente
  win.loadFile('index.html');

  // Opcional: abrir herramientas de desarrollo
  // win.webContents.openDevTools();
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
