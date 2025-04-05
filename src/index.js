// Imports
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const { spawn, execSync } = require("child_process");
const fs = require("fs-extra");
const tor_axios = require("tor-axios");

// Declarations
let torProcess;
let torDataDir;
let torStatus = "not started"; // Values : 'not started', 'starting', 'started'
let axiosInstance = null;

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
      nodeIntegration: true,
    },
  });

  // and load the index.html of the app.
  mainWindow.loadFile(path.join(__dirname, "index.html"));

  // Open the DevTools.
  mainWindow.webContents.openDevTools();
};

function getTorPath() {
  const platform = process.platform;
  console.log(fs.readdirSync(app.getAppPath() + "/resources/tor/linux"));
  const torPath = path.join(
    app.getAppPath(),
    "resources",
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
  if (torProcess && !torProcess.killed) {
    console.log("[INFO] Tor has already started");
  } else {
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
    torStatus = "starting";
  }

  torProcess.stdout.on("data", (data) => {
    const output = data.toString();
    console.log(output); // Log Tor's stdout to the console

    if (output.includes("Bootstrapped 100% (done): Done")) {
      console.log("[INFO] Tor has started successfully.");
      torStatus = "started";
    }
  });

  torProcess.stderr.on("data", (data) => {
    console.error("[ERROR] Tor stderr:", data.toString());
  });

  torProcess.on("close", (code) => {
    console.log(`[INFO] Tor process exited with code ${code}`);
  });
}

function stopTor() {
  if (!torProcess || torProcess.killed) {
    console.log("[INFO] No Tor Process");
  } else {
    try {
      execSync(
        `${getTorPath()} --controlport 9051 --hash-password 16:872860B76453A77D60CA2BB8C1A7042072093276A3D701AD684053EC4C --signal halt`,
      );
      torProcess = null; //deinit the object that holds tor process info
      torStatus = "not started";
    } catch (error) {
      console.error("[ERR] Error stopping Tor gracefully:", error);
      torProcess.kill();
      torProcess = null;
      torStatus = "not started";
    }
  }
}

ipcMain.handle("statusTor", (event) => {
  switch (torStatus) {
    case "not started":
      console.log("[INFO] ✗ Tor not started");
      return torStatus;
    case "starting":
      console.log("[INFO] ⏲ Tor process is starting...");
      return torStatus;
    case "started":
      console.log("[INFO] ✓ Tor started successfully!");
      return torStatus;
  }
});

function connectTor() {
  axiosInstance = tor_axios.torSetup({
    ip: "localhost",
    port: 9050,
  });
  console.log("[INFO] Axios instance configured with SOCKS5 proxy:", proxyUrl);
}

ipcMain.handle("getRequest", async (event, url) => {
  if (!url || typeof url !== "string") {
    console.error("[ERROR] Invalid URL:", url);
    throw new Error("Invalid URL");
  }

  if (!axiosInstance) {
    connectTor();
  }

  try {
    console.log("[INFO] Sending GET request to:", url);
    const response = await axiosInstance.get(url);
    console.log("[INFO] Response received:", response.data);
    return response.data;
  } catch (error) {
    console.error("[ERROR] Request failed:", error.message);
    throw error;
  }
});

app.whenReady().then(() => {
  // This method will be called when Electron has finished
  // initialization and is ready to create browser windows.
  startTor();
  createWindow();

  ipcMain.handle("startTor", startTor);
  ipcMain.handle("stopTor", stopTor);
  ipcMain.handle("connectTor", connectTor);

  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  // Quit when all windows are closed, except on macOS. There, it's common
  // for applications and their menu bar to stay active until the user quits
  // explicitly with Cmd + Q.
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("quit", () => {
  stopTor();
});
