import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { fileURLToPath } from "url";
import "dotenv/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const DATA_DIR = path.join(__dirname, "data");

// ==== 数据层（JSON 文件存储）====
function readJSON(file) {
  const p = path.join(DATA_DIR, file);
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return []; }
}
function writeJSON(file, data) {
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2), "utf-8");
}

// 用户管理
function getUsers() { return readJSON("users.json"); }
function saveUsers(u) { writeJSON("users.json", u); }

// API Key 管理
function getApiKeys() { return readJSON("api-keys.json"); }
function saveApiKeys(k) { writeJSON("api-keys.json", k); }

// 用量记录
function getUsage() { return readJSON("usage.json"); }
function saveUsage(u) { writeJSON("usage.json", u); }

// 视频任务
function getVideoTasks() { return readJSON("videos.json"); }
function saveVideoTasks(v) { writeJSON("videos.json", v); }

// 初始化数据文件
for (const f of ["users.json", "api-keys.json", "usage.json", "videos.json"]) {
  const p = path.join(DATA_DIR, f);
  if (!fs.existsSync(p)) fs.writeFileSync(p, "[]", "utf-8");
}

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ==================== JWT 中间件 ====================
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

// ==================== API Key 管理 ====================
function getModelKeys() {
  return {
    deepseek: process.env.DEEPSEEK_API_KEY || "",
    openai: process.env.OPENAI_API_KEY || "",
    aliyun: process.env.ALIYUN_API_KEY || "",
    kling: process.env.KLING_API_KEY || "",
    klingSecret: process.env.KLING_SECRET_KEY || "",
  };
}

// ==================== 用量追踪 ====================
async function trackUsage(userId, model, type, cost = 0) {
  const usage = getUsage();
  usage.push({
    id: uuidv4(),
    userId,
    model,
    type,
    cost,
    timestamp: new Date().toISOString(),
  });
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

// ==================== AI 调用函数 ====================

// DeepSeek 聊天
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

// 通义千问聊天
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

// OpenAI 聊天
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

// OpenAI DALL·E 3 图片生成
async function callDalle(prompt, n = 1, size = "1024x1024") {
  const key = getModelKeys().openai;
  if (!key) throw new Error("OpenAI API Key 未配置");
  const resp = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: "dall-e-3", prompt, n, size }),
  });
  if (!resp.ok) throw new Error(`DALL·E 错误: ${await resp.text()}`);
  const data = await resp.json();
  return data.data.map(d => ({ url: d.url, revisedPrompt: d.revised_prompt }));
}

// 通义万相图片生成
async function callTongyiImage(prompt) {
  const key = getModelKeys().aliyun;
  if (!key) throw new Error("阿里云 API Key 未配置");
  const resp = await fetch("https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "wanx2.1-t2i-turbo",
      input: { prompt },
      parameters: { size: "1024*1024", n: 1 },
    }),
  });
  if (!resp.ok) throw new Error(`通义万相错误: ${await resp.text()}`);
  const data = await resp.json();
  return [{ url: data.output.task_status === "SUCCEEDED" ? data.output.results[0].url : null, taskId: data.output.task_id }];
}

// ==================== 用户 API ====================

// 注册
app.post("/api/auth/register", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "用户名和密码必填" });
    const users = getUsers();
    if (users.find(u => u.username === username)) return res.status(400).json({ error: "用户名已存在" });
    const hashed = await bcrypt.hash(password, 10);
    const user = { id: uuidv4(), username, password: hashed, isAdmin: false, quota: { chatDaily: 200, imageDaily: 50, videoDaily: 10 }, createdAt: new Date().toISOString() };
    users.push(user);
    saveUsers(users);
    const token = jwt.sign({ id: user.id, username: user.username, isAdmin: false }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, user: { id: user.id, username: user.username, isAdmin: false } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 登录
app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    // 管理员特殊登录
    if (username === "admin" && password === (process.env.ADMIN_PASSWORD || "admin123")) {
      const token = jwt.sign({ id: "admin", username: "admin", isAdmin: true }, JWT_SECRET, { expiresIn: "7d" });
      return res.json({ token, user: { id: "admin", username: "admin", isAdmin: true } });
    }
    const users = getUsers();
    const user = users.find(u => u.username === username);
    if (!user || !(await bcrypt.compare(password, user.password))) return res.status(400).json({ error: "用户名或密码错误" });
    const token = jwt.sign({ id: user.id, username: user.username, isAdmin: user.isAdmin || false }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, user: { id: user.id, username: user.username, isAdmin: user.isAdmin || false } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 获取用户信息
app.get("/api/user/me", auth, (req, res) => {
  if (req.user.isAdmin) return res.json({ id: "admin", username: "admin", isAdmin: true });
  const user = getUsers().find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: "用户不存在" });
  const stats = getUsageStats(req.user.id);
  const chatUsed = stats.filter(s => s.type === "chat").length;
  const imageUsed = stats.filter(s => s.type === "image").length;
  const videoUsed = stats.filter(s => s.type === "video").length;
  res.json({
    id: user.id, username: user.username, isAdmin: false,
    quota: user.quota,
    usage: { chat: chatUsed, image: imageUsed, video: videoUsed },
  });
});

// 管理员：获取所有用户
app.get("/api/admin/users", auth, adminOnly, (req, res) => {
  const users = getUsers();
  const allUsage = getUsage();
  res.json(users.map(u => {
    const userUsage = allUsage.filter(us => us.userId === u.id);
    return {
      id: u.id, username: u.username, isAdmin: u.isAdmin,
      quota: u.quota, createdAt: u.createdAt,
      totalUsage: { chat: userUsage.filter(s => s.type === "chat").length, image: userUsage.filter(s => s.type === "image").length, video: userUsage.filter(s => s.type === "video").length, totalCost: userUsage.reduce((a, b) => a + (b.cost || 0), 0).toFixed(4) },
    };
  }));
});

// 管理员：更新用户额度
app.post("/api/admin/user/quota", auth, adminOnly, (req, res) => {
  const { userId, chatDaily, imageDaily, videoDaily } = req.body;
  const users = getUsers();
  const user = users.find(u => u.id === userId);
  if (!user) return res.status(404).json({ error: "用户不存在" });
  user.quota = { chatDaily: chatDaily ?? user.quota.chatDaily, imageDaily: imageDaily ?? user.quota.imageDaily, videoDaily: videoDaily ?? user.quota.videoDaily };
  saveUsers(users);
  res.json({ success: true });
});

// 管理员：获取用量统计
app.get("/api/admin/usage", auth, adminOnly, (req, res) => {
  const all = getUsage();
  const totalCost = all.reduce((a, b) => a + (b.cost || 0), 0).toFixed(4);
  const byModel = {};
  for (const u of all) { byModel[u.model] = (byModel[u.model] || 0) + 1; }
  res.json({ totalCalls: all.length, totalCost, byModel, records: all.slice(-200).reverse() });
});

// ==================== AI 聊天 API ====================

app.post("/api/chat/:model", auth, async (req, res) => {
  try {
    const { model } = req.params;
    const { messages } = req.body;
    if (!messages?.length) return res.status(400).json({ error: "消息不能为空" });

    // 检查额度
    if (!req.user.isAdmin) {
      const user = getUsers().find(u => u.id === req.user.id);
      if (!user) return res.status(404).json({ error: "用户不存在" });
      const today = getUsageStats(req.user.id, "day").filter(s => s.type === "chat").length;
      if (today >= (user.quota?.chatDaily || 200)) return res.status(429).json({ error: "今日对话额度已用完" });
    }

    let result;
    switch (model) {
      case "deepseek": result = await callDeepSeek(messages); break;
      case "qwen": result = await callQwen(messages); break;
      case "openai": result = await callOpenAI(messages); break;
      default: return res.status(400).json({ error: "不支持的模型" });
    }

    await trackUsage(req.user.id, model, "chat", 0.001);
    res.json({ content: result, model });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 流式聊天（SSE）
app.post("/api/chat/:model/stream", auth, async (req, res) => {
  const { model } = req.params;
  const { messages } = req.body;
  if (!messages?.length) return res.status(400).json({ error: "消息不能为空" });

  if (!req.user.isAdmin) {
    const user = getUsers().find(u => u.id === req.user.id);
    if (!user) return res.status(404).json({ error: "用户不存在" });
    const today = getUsageStats(req.user.id, "day").filter(s => s.type === "chat").length;
    if (today >= (user.quota?.chatDaily || 200)) return res.status(429).json({ error: "今日对话额度已用完" });
  }

  const keyMap = { deepseek: getModelKeys().deepseek, qwen: getModelKeys().aliyun, openai: getModelKeys().openai };
  const urlMap = {
    deepseek: "https://api.deepseek.com/v1/chat/completions",
    qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    openai: "https://api.openai.com/v1/chat/completions",
  };
  const modelMap = { deepseek: "deepseek-chat", qwen: "qwen-plus", openai: "gpt-4o" };

  const key = keyMap[model];
  if (!key) return res.status(400).json({ error: `${model} API Key 未配置` });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    const apiResp = await fetch(urlMap[model], {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: modelMap[model], messages, temperature: 0.7, max_tokens: 4096, stream: true }),
    });

    if (!apiResp.ok) {
      const err = await apiResp.text();
      res.write(`data: ${JSON.stringify({ error: `${model} 错误: ${err}` })}\n\n`);
      return res.end();
    }

    const reader = apiResp.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      const lines = chunk.split("\n").filter(l => l.startsWith("data: ") && !l.includes("[DONE]"));
      for (const line of lines) {
        try {
          const json = JSON.parse(line.slice(6));
          const content = json.choices?.[0]?.delta?.content || "";
          if (content) { fullContent += content; res.write(`data: ${JSON.stringify({ content })}\n\n`); }
        } catch { /* skip parse errors */ }
      }
    }
    res.write(`data: ${JSON.stringify({ done: true, fullContent })}\n\n`);
    await trackUsage(req.user.id, model, "chat", 0.001);
    res.end();
  } catch (e) {
    res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
    res.end();
  }
});

// ==================== 图片生成 API ====================

app.post("/api/image/generate", auth, async (req, res) => {
  try {
    const { prompt, model } = req.body;
    if (!prompt) return res.status(400).json({ error: "描述词不能为空" });

    if (!req.user.isAdmin) {
      const user = getUsers().find(u => u.id === req.user.id);
      if (!user) return res.status(404).json({ error: "用户不存在" });
      const today = getUsageStats(req.user.id, "day").filter(s => s.type === "image").length;
      if (today >= (user.quota?.imageDaily || 50)) return res.status(429).json({ error: "今日图片额度已用完" });
    }

    let images;
    if (model === "dalle" || model === "openai") { images = await callDalle(prompt); await trackUsage(req.user.id, "dalle", "image", 0.04); }
    else if (model === "tongyi" || model === "aliyun") { images = await callTongyiImage(prompt); await trackUsage(req.user.id, "tongyi", "image", 0.02); }
    else return res.status(400).json({ error: "不支持的图片模型" });

    res.json({ images });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== 视频生成 API（可灵）===================

app.post("/api/video/generate", auth, async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: "描述词不能为空" });

    if (!req.user.isAdmin) {
      const user = getUsers().find(u => u.id === req.user.id);
      if (!user) return res.status(404).json({ error: "用户不存在" });
      const today = getUsageStats(req.user.id, "day").filter(s => s.type === "video").length;
      if (today >= (user.quota?.videoDaily || 10)) return res.status(429).json({ error: "今日视频额度已用完" });
    }

    const { kling, klingSecret } = getModelKeys();
    if (!kling || !klingSecret) return res.status(400).json({ error: "可灵 API Key 未配置" });

    // 生成签名
    const timestamp = Math.floor(Date.now() / 1000);
    const signStr = `${kling}${timestamp}${klingSecret}`;
    const signature = crypto.createHash("md5").update(signStr).digest("hex");

    const resp = await fetch("https://api.klingai.com/v1/videos/text2video", {
      method: "POST",
      headers: { "Content-Type": "application/json", "ak": kling, "timestamp": String(timestamp), "signature": signature },
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

// 查询视频任务状态
app.get("/api/video/status/:taskId", auth, async (req, res) => {
  try {
    const { taskId } = req.params;
    const tasks = getVideoTasks();
    const task = tasks.find(t => t.id === taskId);
    if (!task) return res.status(404).json({ error: "任务不存在" });

    // 调用可灵查询
    const { kling, klingSecret } = getModelKeys();
    const timestamp = Math.floor(Date.now() / 1000);
    const signStr = `${kling}${timestamp}${klingSecret}`;
    const signature = crypto.createHash("md5").update(signStr).digest("hex");

    const resp = await fetch(`https://api.klingai.com/v1/videos/text2video/${taskId}`, {
      headers: { "ak": kling, "timestamp": String(timestamp), "signature": signature },
    });
    const data = await resp.json();

    const status = data.data.task_status;
    const result = status === "succeed" ? { videoUrl: data.data.videos?.[0]?.url, duration: data.data.videos?.[0]?.duration } : null;

    // 更新本地记录
    task.status = status;
    task.result = result;
    saveVideoTasks(tasks);

    res.json({ status, result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 获取用户视频列表
app.get("/api/video/list", auth, (req, res) => {
  const tasks = getVideoTasks().filter(t => t.userId === req.user.id || req.user.isAdmin).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 50);
  res.json(tasks);
});

// ==================== 页面路由 ====================
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/app", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, "0.0.0.0", () => console.log(`AI 平台: http://localhost:${PORT}`));
