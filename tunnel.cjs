const localtunnel = require("localtunnel");
(async () => {
  const tunnel = await localtunnel({ port: 3000, subdomain: "yumuchi" });
  console.log("✅ " + tunnel.url);
})();
