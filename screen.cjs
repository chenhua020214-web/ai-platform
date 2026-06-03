const screenshot = require("screenshot-desktop");
screenshot({ filename: "E:/codex/screen.png" }).then(() => {
  console.log("OK");
}).catch(e => console.log("FAIL: " + e.message));
