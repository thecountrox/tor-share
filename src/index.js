const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const { spawn, execSync } = require("child_process");
const fs = require("fs-extra");

let torProcess;
let torDataDir;

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require("electron-squirrel-startup")) {
  app.quit();
}

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });

  // and load the index.html of the app.
  mainWindow.loadFile(path.join(__dirname, "index.html"));

  // Open the DevTools.
  mainWindow.webContents.openDevTools();
};

function getTorPath() {
  const platform = process.platform;
  const torPath = path.join(
    "/home/thecount/basement/tor-real/resources/",
    "tor",
    platform === "win32"
      ? "win32/tor.exe"
      : platform === "darwin"
        ? "darwin/tor"
        : "linux/tor",
  );
  if (!fs.existsSync(torPath)) throw new Error("Tor binary missing");
  return torPath;
}

function startTor() {
  torDataDir = fs.mkdtempSync(path.join(app.getPath("temp"), "tor-")); // create a temp dir for torrc

  // Create minimal torrc file
  const torrcPath = path.join(torDataDir, "torrc"); // append torrc to temp dir
  fs.writeFileSync(
    torrcPath,
    `
      SocksPort 9050
      DataDirectory ${torDataDir}
      ControlPort 9051
      HashedControlPassword 16:872860B76453A77D60CA2BB8C1A7042072093276A3D701AD684053EC4C
    `,
  );

  torProcess = spawn(getTorPath(), [
    "-f",
    torrcPath, // Use config file instead
  ]);

  torProcess.stdout.pipe(process.stdout); //pipes output to console so u can actually see it
}

function stopTor() {
  if (torProcess) {
      try {
        execSync(
          `${getTorPath()} --controlport 9051 --hash-password 16:872860B76453A77D60CA2BB8C1A7042072093276A3D701AD684053EC4C --signal halt`,
        );
      } catch (error) {
        console.error("Error stopping Tor gracefully:", error);
        torProcess.kill();
      }
    }
  else{
    console.log('[INFO] No Tor Process');
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  startTor();
  createWindow();

  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    stopTor();
    app.quit();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
