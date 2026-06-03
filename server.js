const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");
require("dotenv/config");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const DATA_DIR = path.join(__dirname, "data");

// 数据层
function readJSON(file) {
  const p = path.join(DATA_DIR, file);
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return []; }
}
function writeJSON(file, data) {
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2), "utf-8");
}

function getUsers() { return readJSON("users.json"); }
function saveUsers(u) { writeJSON("users.json", u); }
function getApiKeys() { return readJSON("api-keys.json"); }
function saveApiKeys(k) { writeJSON("api-keys.json", k); }
function getUsage() { return readJSON("usage.json"); }
function saveUsage(u) { writeJSON("usage.json", u); }
function getVideoTasks() { return readJSON("videos.json"); }
function saveVideoTasks(v) { writeJSON("videos.json", v); }

// 初始化数据文件
for (const f of ["users.json", "api-keys.json", "usage.json", "videos.json"]) {
  const p = path.join(DATA_DIR, f);
  if (!fs.existsSync(p)) fs.writeFileSync(p, "[]", "utf-8");
}

// 确保 data 目录存在
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// 添加初始管理员用户
(() => {
  const users = getUsers();
  if (!users.find(u => u.username === "admin")) {
    users.push({
      id: "admin",
      username: "admin",
      password: "$2a$10$dummy", // 实际验证走 ADMIN_PASSWORD
      name: "管理员",
      isAdmin: true,
      quota: { chatDaily: 9999, imageDaily: 999, videoDaily: 999 },
      createdAt: new Date().toISOString()
    });
    saveUsers(users);
  }
})();

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname, "public")));

// JWT 中间件
function auth(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "未登录" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch { return res.status(401).json({ error: "token 过期" }); }
}

function adminOnly(req, res, next) {
  if (!req.user?.isAdmin) return res.status(403).json({ error: "需要管理员权限" });
  next();
}

// API Key
function getModelKeys() {
  return {
    deepseek: process.env.DEEPSEEK_API_KEY || "",
    openai: process.env.OPENAI_API_KEY || "",
    aliyun: process.env.ALIYUN_API_KEY || "",
    kling: process.env.KLING_API_KEY || "",
    klingSecret: process.env.KLING_SECRET_KEY || "",
  };
}

// 用量追踪
async function trackUsage(userId, model, type, cost = 0) {
  const usage = getUsage();
  usage.push({ id: uuidv4(), userId, model, type, cost, timestamp: new Date().toISOString() });
  saveUsage(usage);
}

function getUsageStats(userId, period = "month") {
  const all = getUsage().filter(u => u.userId === userId);
  const now = new Date();
  const start = period === "month"
    ? new Date(now.getFullYear(), now.getMonth(), 1)
    : new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return all.filter(u => new Date(u.timestamp) >= start);
}

// DeepSeek
async function callDeepSeek(messages, temperature = 0.7) {
  const key = getModelKeys().deepseek;
  if (!key) throw new Error("DeepSeek API Key 未配置");
  const resp = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: "deepseek-chat", messages, temperature, max_tokens: 4096 }),
  });
  if (!resp.ok) throw new Error(`DeepSeek 错误: ${await resp.text()}`);
  const data = await resp.json();
  return data.choices[0].message.content;
}

// 通义千问
async function callQwen(messages, temperature = 0.7) {
  const key = getModelKeys().aliyun;
  if (!key) throw new Error("阿里云 API Key 未配置");
  const resp = await fetch("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: "qwen-plus", messages, temperature, max_tokens: 4096 }),
  });
  if (!resp.ok) throw new Error(`通义千问错误: ${await resp.text()}`);
  const data = await resp.json();
  return data.choices[0].message.content;
}

// OpenAI
async function callOpenAI(messages, temperature = 0.7) {
  const key = getModelKeys().openai;
  if (!key) throw new Error("OpenAI API Key 未配置");
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: "gpt-4o", messages, temperature, max_tokens: 4096 }),
  });
  if (!resp.ok) throw new Error(`OpenAI 错误: ${await resp.text()}`);
  const data = await resp.json();
  return data.choices[0].message.content;
}

// DALL·E
async function callDalle(prompt) {
  const key = getModelKeys().openai;
  if (!key) throw new Error("OpenAI API Key 未配置");
  const resp = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: "dall-e-3", prompt, n: 1, size: "1024x1024" }),
  });
  if (!resp.ok) throw new Error(`DALL·E 错误: ${await resp.text()}`);
  const data = await resp.json();
  return data.data.map(i => i.url);
}

// 通义万相
async function callTongyiImage(prompt) {
  const key = getModelKeys().aliyun;
  if (!key) throw new Error("阿里云 API Key 未配置");
  const resp = await fetch("https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "wanx-v1", input: { prompt },
      parameters: { size: "1024*1024", n: 1 },
    }),
  });
  if (!resp.ok) throw new Error(`通义万相错误: ${await resp.text()}`);
  const data = await resp.json();
  return [data.output?.results?.[0]?.url].filter(Boolean);
}

// ============ API 路由 ============

// 注册
app.post("/api/auth/register", async (req, res) => {
  try {
    const { username, password, name } = req.body;
    if (!username || !password) return res.status(400).json({ error: "用户名和密码必填" });
    const users = getUsers();
    if (users.find(u => u.username === username)) return res.status(400).json({ error: "用户名已存在" });
    const hashed = await bcrypt.hash(password, 10);
    const user = { id: uuidv4(), username, password: hashed, name: name || username, isAdmin: false, quota: { chatDaily: 200, imageDaily: 50, videoDaily: 10 }, createdAt: new Date().toISOString() };
    users.push(user);
    saveUsers(users);
    res.json({ message: "注册成功", userId: user.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 登录（支持管理员和普通用户）
app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "用户名和密码必填" });
    
    // 管理员登录
    if (username === "admin") {
      const adminPwd = process.env.ADMIN_PASSWORD || "admin123";
      if (password !== adminPwd) return res.status(400).json({ error: "密码错误" });
      const token = jwt.sign({ id: "admin", username: "admin", isAdmin: true }, JWT_SECRET, { expiresIn: "7d" });
      return res.json({ token, user: { id: "admin", username: "admin", isAdmin: true } });
    }
    
    // 普通用户登录
    const users = getUsers();
    const user = users.find(u => u.username === username);
    if (!user || !(await bcrypt.compare(password, user.password))) return res.status(400).json({ error: "用户名或密码错误" });
    const token = jwt.sign({ id: user.id, username: user.username, isAdmin: false }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, user: { ...user, password: undefined } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 获取用户信息
app.get("/api/user/me", auth, (req, res) => {
  if (req.user.isAdmin) return res.json({ id: "admin", username: "admin", isAdmin: true, quota: { chatDaily: 9999, imageDaily: 999, videoDaily: 999 }, usage: { chat: 0, image: 0, video: 0 } });
  const user = getUsers().find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: "用户不存在" });
  const chatUsage = getUsageStats(req.user.id, "day").filter(s => s.type === "chat").length;
  const imageUsage = getUsageStats(req.user.id, "day").filter(s => s.type === "image").length;
  const videoUsage = getUsageStats(req.user.id, "day").filter(s => s.type === "video").length;
  res.json({ id: user.id, username: user.username, name: user.name, isAdmin: false, quota: user.quota, usage: { chat: chatUsage, image: imageUsage, video: videoUsage } });
});

// 管理员 - 用户列表
app.get("/api/admin/users", auth, adminOnly, (req, res) => {
  const users = getUsers().map(u => ({ id: u.id, username: u.username, name: u.name, quota: u.quota, createdAt: u.createdAt }));
  res.json(users);
});

// 管理员 - 设置配额
app.post("/api/admin/user/quota", auth, adminOnly, (req, res) => {
  const { userId, quota } = req.body;
  const users = getUsers();
  const user = users.find(u => u.id === userId);
  if (!user) return res.status(404).json({ error: "用户不存在" });
  user.quota = { ...user.quota, ...quota };
  saveUsers(users);
  res.json({ message: "已更新" });
});

// 管理员 - 用量统计
app.get("/api/admin/usage", auth, adminOnly, (req, res) => {
  const all = getUsage();
  const stats = { totalChat: all.filter(s => s.type === "chat").length, totalImage: all.filter(s => s.type === "image").length, totalVideo: all.filter(s => s.type === "video").length, totalCost: all.reduce((s, u) => s + (u.cost || 0), 0) };
  res.json(stats);
});

// 聊天（非流式）
app.post("/api/chat/:model", auth, async (req, res) => {
  try {
    const { messages, temperature = 0.7 } = req.body;
    if (!messages?.length) return res.status(400).json({ error: "消息不能为空" });
    const model = req.params.model;
    
    let result;
    if (model === "deepseek") result = await callDeepSeek(messages, temperature);
    else if (model === "qwen" || model === "tongyi") result = await callQwen(messages, temperature);
    else if (model === "openai" || model === "gpt") result = await callOpenAI(messages, temperature);
    else return res.status(400).json({ error: "不支持的模型" });
    
    await trackUsage(req.user.id, model, "chat", 0.001);
    res.json({ content: result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 聊天（流式 SSE）
app.post("/api/chat/:model/stream", auth, async (req, res) => {
  try {
    const { messages, temperature = 0.7 } = req.body;
    if (!messages?.length) return res.status(400).json({ error: "消息不能为空" });
    const model = req.params.model;
    const key = getModelKeys();
    
    let apiUrl, apiKey, body;
    if (model === "deepseek") {
      apiUrl = "https://api.deepseek.com/v1/chat/completions";
      apiKey = key.deepseek;
      body = { model: "deepseek-chat", messages, temperature, stream: true, max_tokens: 4096 };
    } else if (model === "qwen" || model === "tongyi") {
      apiUrl = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
      apiKey = key.aliyun;
      body = { model: "qwen-plus", messages, temperature, stream: true, max_tokens: 4096 };
    } else if (model === "openai" || model === "gpt") {
      apiUrl = "https://api.openai.com/v1/chat/completions";
      apiKey = key.openai;
      body = { model: "gpt-4o", messages, temperature, stream: true, max_tokens: 4096 };
    } else return res.status(400).json({ error: "不支持的模型" });
    
    if (!apiKey) return res.status(400).json({ error: `${model} API Key 未配置` });
    
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
    
    const apiResp = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    
    if (!apiResp.ok) {
      res.write(`data: ${JSON.stringify({ error: `API 错误: ${await apiResp.text()}` })}\n\n`);
      return res.end();
    }
    
    const reader = apiResp.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = "";
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      const lines = chunk.split("\\n").filter(l => l.startsWith("data: ") && l !== "data: [DONE]");
      for (const line of lines) {
        try {
          const json = JSON.parse(line.replace(/^data: /, ""));
          const content = json.choices?.[0]?.delta?.content || "";
          if (content) { fullContent += content; res.write(`data: ${JSON.stringify({ content })}\n\n`); }
        } catch { /* 跳过解析错误 */ }
      }
    }
    
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    await trackUsage(req.user.id, model, "chat", 0.001);
    res.end();
  } catch (e) {
    res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
    res.end();
  }
});

// 图片生成
app.post("/api/image/generate", auth, async (req, res) => {
  try {
    const { prompt, model } = req.body;
    if (!prompt) return res.status(400).json({ error: "描述词不能为空" });
    
    let images;
    if (model === "dalle" || model === "openai") { images = await callDalle(prompt); await trackUsage(req.user.id, "dalle", "image", 0.04); }
    else if (model === "tongyi" || model === "aliyun") { images = await callTongyiImage(prompt); await trackUsage(req.user.id, "tongyi", "image", 0.02); }
    else return res.status(400).json({ error: "不支持的图片模型" });
    
    res.json({ images });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 视频生成
app.post("/api/video/generate", auth, async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: "描述词不能为空" });
    
    const { kling, klingSecret } = getModelKeys();
    if (!kling || !klingSecret) return res.status(400).json({ error: "可灵 API Key 未配置" });
    
    const timestamp = Math.floor(Date.now() / 1000);
    const signStr = `${kling}${timestamp}${klingSecret}`;
    const signature = crypto.createHash("md5").update(signStr).digest("hex");
    
    const resp = await fetch("https://api.klingai.com/v1/videos/text2video", {
      method: "POST",
      headers: { "Content-Type": "application/json", ak: kling, timestamp: String(timestamp), signature },
      body: JSON.stringify({ model_name: "kling-v1", prompt, duration: 5, cfg_scale: 0.5 }),
    });
    if (!resp.ok) throw new Error(`可灵错误: ${await resp.text()}`);
    const data = await resp.json();
    
    const task = { id: data.data.task_id, prompt, userId: req.user.id, status: "pending", result: null, createdAt: new Date().toISOString() };
    const tasks = getVideoTasks();
    tasks.push(task);
    saveVideoTasks(tasks);
    await trackUsage(req.user.id, "kling", "video", 1);
    
    res.json({ taskId: task.id, status: "pending" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 视频状态查询
app.get("/api/video/status/:taskId", auth, async (req, res) => {
  try {
    const { taskId } = req.params;
    const tasks = getVideoTasks();
    const task = tasks.find(t => t.id === taskId);
    if (!task) return res.status(404).json({ error: "任务不存在" });
    
    const { kling, klingSecret } = getModelKeys();
    const timestamp = Math.floor(Date.now() / 1000);
    const signStr = `${kling}${timestamp}${klingSecret}`;
    const signature = crypto.createHash("md5").update(signStr).digest("hex");
    
    const resp = await fetch(`https://api.klingai.com/v1/videos/text2video/${taskId}`, {
      headers: { ak: kling, timestamp: String(timestamp), signature },
    });
    const data = await resp.json();
    const status = data.data.task_status;
    const result = status === "succeed" ? { videoUrl: data.data.videos?.[0]?.url, duration: data.data.videos?.[0]?.duration } : null;
    task.status = status;
    task.result = result;
    saveVideoTasks(tasks);
    
    res.json({ status, result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 视频列表
app.get("/api/video/list", auth, (req, res) => {
  const tasks = getVideoTasks().filter(t => t.userId === req.user.id || req.user.isAdmin).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 50);
  res.json(tasks);
});

// 页面路由
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/app", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`AI 平台启动成功: http://localhost:${PORT}`);
  console.log(`管理员账号: admin / ${process.env.ADMIN_PASSWORD || "admin123"}`);
});
