const localtunnel = require("localtunnel");
(async () => {
  const tunnel = await localtunnel({ port: 3000, subdomain: "yumuchi" });
  console.log("✅ 公网地址: " + tunnel.url);
  console.log("按 Ctrl+C 停止隧道");
})();
