# AI 聚合平台 🤖

## 已集成的 AI 模型

### 💬 对话
| 模型 | API | 效果 |
|---|---|---|
| DeepSeek Chat | `api.deepseek.com` | ⭐⭐⭐⭐⭐ 国内最强开源 |
| 通义千问 Qwen | 阿里云百炼 | ⭐⭐⭐⭐⭐ 国内稳定 |
| OpenAI GPT-4o | `api.openai.com` | ⭐⭐⭐⭐⭐ 国际标杆 |

### 🎨 图片生成
| 模型 | API | 成本 |
|---|---|---|
| DALL·E 3 (OpenAI) | `api.openai.com` | ~¥0.3/张 |
| 通义万相 (阿里云) | 阿里云百炼 | ~¥0.08/张 |

### 🎬 视频生成
| 模型 | API | 成本 | 说明 |
|---|---|---|---|
| 可灵 Kling | `api.klingai.com` | ~¥1/条 | 国内最好，效果好 |
| Runway Gen-3 | `runwayml.com` | ~¥2/秒 | 国际标杆 |
| Pika | `pika.art` | ~$0.05/条 | 创意风格强 |

## 快速启动

```bash
# 1. 安装依赖
npm install

# 2. 复制环境变量
cp .env.example .env

# 3. 填入你的 API Key（在 .env 中）
# DEEPSEEK_API_KEY=sk-xxx
# OPENAI_API_KEY=sk-xxx
# ALIYUN_API_KEY=sk-xxx
# KLING_API_KEY=xxx
# KLING_SECRET_KEY=xxx

# 4. 启动
npm start
# 浏览器打开 http://localhost:3000
```

## 部署到 Render

1. 创建 GitHub 仓库并推送代码
2. 在 Render 创建 Web Service，连接该仓库
3. Render 会自动识别 `render.yaml`
4. 在 Render 环境变量中填入所有 API Key
5. 部署完成，获得 `https://xxx.onrender.com` 永久网址

## 管理员功能

- 默认管理员：用户名 `admin`，密码 `admin123`（可在 `.env` 中修改 `ADMIN_PASSWORD`）
- 管理面板可查看所有用户用量、修改额度
- 注册用户默认每日额度：对话 200 次、图片 50 张、视频 10 条

## 费用估算

| 用户类型 | 月均成本/人 | 建议收费 |
|---|---|---|
| 纯文本聊天 | ~¥3 | ¥19~39/月 |
| 文本+图片 | ~¥15 | ¥39~79/月 |
| 全功能（含视频） | ~¥30~50 | ¥79~199/月 |
