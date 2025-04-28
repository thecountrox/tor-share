const { spawn, execSync } = require("child_process");
const path = require("path");
const fs = require("fs-extra");
const net = require("net");

let torProcess = null;
let status = "not started";
let controlSocket = null;
const CONTROL_PASSWORD_HASH =
  "16:872860B76453A77D60CA2BB8C1A7042072093276A3D701AD684053EC4C";

const startTor = async (torDataDir) => {
  if (torProcess) {
    console.log("[INFO] Tor has already started");
    return;
  }

  status = "starting";

  // Create Tor data directory if it doesn't exist
  await fs.ensureDir(torDataDir);

  // Create torrc file
  const torrcPath = path.join(torDataDir, "torrc");
  const hiddenServiceDir = path.join(torDataDir, "hidden_service");
  await fs.ensureDir(hiddenServiceDir);

  // Set proper permissions for the hidden service directory
  await fs.chmod(hiddenServiceDir, 0o700);

  await fs.writeFile(
    torrcPath,
    `
SocksPort 9055
ControlPort 9056
DataDirectory ${torDataDir}
HashedControlPassword ${CONTROL_PASSWORD_HASH}
HiddenServiceDir ${hiddenServiceDir}
HiddenServicePort 80 127.0.0.1:3000
AvoidDiskWrites 1
`,
  );

  // Find Tor binary
  const torBinary = path.join(
    __dirname,
    "../../resources/tor",
    process.platform,
    "tor",
  );
  console.log("Looking for Tor binary at:", torBinary);
  console.log("Starting Tor from:", torBinary);

  return new Promise((resolve, reject) => {
    torProcess = spawn(torBinary, ["-f", torrcPath]);

    torProcess.stdout.on("data", (data) => {
      console.log(data.toString());
      if (data.toString().includes("Bootstrapped 100%")) {
        status = "started";
        console.log("[INFO] Tor has started successfully.");
        resolve();
      }
    });

    torProcess.stderr.on("data", (data) => {
      console.error(data.toString());
    });

    torProcess.on("error", (error) => {
      console.error("Failed to start Tor:", error);
      status = "error";
      reject(error);
    });

    torProcess.on("exit", (code) => {
      console.log(`Tor process exited with code ${code}`);
      status = "not started";
      torProcess = null;
      if (controlSocket) {
        controlSocket.destroy();
        controlSocket = null;
      }
    });
  });
};

const stopTor = async () => {
  if (!torProcess || torProcess.killed) {
    console.log("[INFO] No Tor Process");
    return;
  }

  status = "stopping";
  console.log("Stopping Tor...");

  try {
    execSync(
      `${path.join(__dirname, "../../resources/tor", process.platform, "tor")} --controlport 9056 --hash-password ${CONTROL_PASSWORD_HASH} --signal halt`,
    );
    console.log("Sent HALT signal to Tor");
    torProcess = null;
    status = "not started";
  } catch (error) {
    console.error("[ERR] Error stopping Tor gracefully:", error);
    torProcess.kill();
    torProcess = null;
    status = "not started";
  }
};

const getTorStatus = () => {
  return status;
};

module.exports = {
  startTor,
  stopTor,
  getTorStatus,
};
