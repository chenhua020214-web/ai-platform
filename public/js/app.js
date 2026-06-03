// ====== 应用主逻辑 ======
const App = {
  user: null,

  // 初始化
  async init() {
    const token = localStorage.getItem("token");
    if (token) {
      API.token = token;
      try {
        this.user = await API.auth.me();
        this.showApp();
        return;
      } catch { localStorage.removeItem("token"); }
    }
    this.showAuth();
  },

  // 显示登录页
  showAuth() {
    document.querySelector(".auth-page").style.display = "flex";
    document.querySelector(".app-layout").classList.remove("active");
  },

  // 显示主界面
  showApp() {
    document.querySelector(".auth-page").style.display = "none";
    document.querySelector(".app-layout").classList.add("active");
    document.getElementById("username-display").textContent = this.user.username;
    const badge = document.getElementById("user-badge");
    badge.textContent = this.user.isAdmin ? "管理员" : `对话:${this.user.usage?.chat||0}/${this.user.quota?.chatDaily||200} 图片:${this.user.usage?.image||0}/${this.user.quota?.imageDaily||50} 视频:${this.user.usage?.video||0}/${this.user.quota?.videoDaily||10}`;

    // 管理员显示管理面板入口
    if (this.user.isAdmin) {
      document.getElementById("nav-admin").style.display = "flex";
      this.loadAdminStats();
    } else {
      document.getElementById("nav-admin").style.display = "none";
    }

    // 导航到默认页
    this.navigate("chat");
  },

  // 导航
  navigate(page) {
    document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
    document.querySelectorAll(".page-content").forEach(p => p.classList.remove("active"));
    const navItem = document.querySelector(`[data-page="${page}"]`);
    if (navItem) navItem.classList.add("active");
    const content = document.getElementById(`page-${page}`);
    if (content) content.classList.add("active");

    // 更新顶栏标题
    const titles = { chat: "AI 对话", image: "AI 图片生成", video: "AI 视频生成", admin: "管理面板" };
    document.getElementById("page-title").textContent = titles[page] || page;

    if (page === "admin" && this.user?.isAdmin) this.loadAdminStats();
    if (page === "video") this.loadVideoList();
  },

  // ========== AI 对话 ==========
  chatModel: "deepseek",
  chatMessages: [],

  setChatModel(model) {
    this.chatModel = model;
    document.querySelectorAll(".model-btn").forEach(b => b.classList.remove("active"));
    document.querySelector(`[data-model="${model}"]`)?.classList.add("active");
  },

  async sendChat() {
    const textarea = document.getElementById("chat-input");
    const text = textarea.value.trim();
    if (!text) return;
    textarea.value = "";
    textarea.style.height = "auto";

    this.chatMessages.push({ role: "user", content: text });
    this.renderChat();
    document.getElementById("chat-send").disabled = true;

    // 添加占位
    this.chatMessages.push({ role: "assistant", content: "", loading: true });
    this.renderChat();
    const msgIdx = this.chatMessages.length - 1;

    API.chat.stream(this.chatModel, this.chatMessages.filter(m => !m.loading).map(m => ({ role: m.role, content: m.content })),
      (chunk) => {
        this.chatMessages[msgIdx].content += chunk;
        this.chatMessages[msgIdx].loading = false;
        this.renderChat(true);
      },
      (full) => {
        this.chatMessages[msgIdx].content = full;
        this.chatMessages[msgIdx].loading = false;
        this.renderChat();
        document.getElementById("chat-send").disabled = false;
        this.scrollChat();
        this.updateBadge();
      },
      (err) => {
        this.chatMessages[msgIdx].content = `❌ ${err}`;
        this.chatMessages[msgIdx].loading = false;
        this.renderChat();
        document.getElementById("chat-send").disabled = false;
      }
    );
  },

  renderChat(scrolling) {
    const container = document.getElementById("chat-messages");
    if (!scrolling) {
      container.innerHTML = this.chatMessages.map(m => {
        if (m.loading) return `<div class="message bot"><div class="avatar">AI</div><div class="bubble"><div class="loading"><div class="spinner"></div></div></div></div>`;
        return `<div class="message ${m.role}"><div class="avatar">${m.role === "user" ? "我" : "AI"}</div><div class="bubble">${this.escapeHtml(m.content)}</div></div>`;
      }).join("");
    } else {
      const last = container.lastElementChild;
      if (last) last.querySelector(".bubble").innerHTML = this.escapeHtml(this.chatMessages[this.chatMessages.length - 1].content) || '<div class="loading"><div class="spinner"></div></div>';
    }
    if (!scrolling) this.scrollChat();
  },

  scrollChat() {
    const container = document.getElementById("chat-messages");
    container.scrollTop = container.scrollHeight;
  },

  clearChat() {
    this.chatMessages = [];
    this.renderChat();
  },

  // ========== 图片生成 ==========

  async generateImage() {
    const prompt = document.getElementById("image-prompt").value.trim();
    const model = document.getElementById("image-model").value;
    if (!prompt) return;

    document.getElementById("image-gen-btn").disabled = true;
    document.getElementById("image-gen-btn").textContent = "生成中...";
    const grid = document.getElementById("image-grid");

    try {
      const data = await API.image.generate(prompt, model);
      const card = document.createElement("div");
      card.className = "image-card";
      card.innerHTML = `
        <img src="${data.images[0].url}" alt="${this.escapeHtml(prompt)}" loading="lazy">
        <div class="info">
          <div class="prompt">${this.escapeHtml(prompt)}</div>
          <div class="actions">
            <a href="${data.images[0].url}" target="_blank" rel="noopener">打开原图 ↗</a>
            <span style="font-size:11px;color:var(--text2);margin-left:auto;">${model === "dalle" ? "DALL·E 3" : "通义万相"}</span>
          </div>
        </div>`;
      grid.prepend(card);
      this.updateBadge();
    } catch (e) {
      this.toast(e.message);
    }
    document.getElementById("image-gen-btn").disabled = false;
    document.getElementById("image-gen-btn").textContent = "生成图片";
  },

  // ========== 视频生成 ==========

  async generateVideo() {
    const prompt = document.getElementById("video-prompt").value.trim();
    if (!prompt) return;

    document.getElementById("video-gen-btn").disabled = true;
    document.getElementById("video-gen-btn").textContent = "提交中...";

    try {
      const data = await API.video.generate(prompt);
      this.toast("视频任务已提交，正在生成（约1-3分钟）");
      document.getElementById("video-prompt").value = "";
      this.loadVideoList();

      // 轮询状态
      const poll = setInterval(async () => {
        try {
          const status = await API.video.status(data.taskId);
          this.loadVideoList();
          if (status.status === "succeed" || status.status === "failed") clearInterval(poll);
        } catch {}
      }, 5000);

      this.updateBadge();
    } catch (e) {
      this.toast(e.message);
    }
    document.getElementById("video-gen-btn").disabled = false;
    document.getElementById("video-gen-btn").textContent = "生成视频";
  },

  async loadVideoList() {
    try {
      const tasks = await API.video.list();
      const list = document.getElementById("video-list");
      if (tasks.length === 0) {
        list.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text2);font-size:14px;">还没有视频，输入描述词开始生成</div>';
        return;
      }
      list.innerHTML = tasks.map(t => {
        const statusMap = { pending: "等待中", processing: "生成中...", succeed: "已完成", failed: "失败" };
        return `<div class="video-card">
          ${t.result?.videoUrl ? `<video src="${t.result.videoUrl}" controls preload="metadata" poster="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='180'%3E%3Crect fill='%231b1f2e' width='320' height='180'/%3E%3Ctext x='160' y='90' text-anchor='middle' fill='%238b949e' font-size='14' font-family='sans-serif'%3E视频预览%3C/text%3E%3C/svg%3E"></video>` : `<div style="height:180px;display:flex;align-items:center;justify-content:center;background:var(--bg3);font-size:13px;color:var(--text2);">${statusMap[t.status] || t.status}</div>`}
          <div class="info">
            <div class="prompt">${this.escapeHtml(t.prompt)}</div>
            <span class="status status-${t.status}">${statusMap[t.status] || t.status}</span>
            <span style="font-size:11px;color:var(--text2);margin-left:8px;">${new Date(t.createdAt).toLocaleString()}</span>
          </div>
        </div>`;
      }).join("");
    } catch {}
  },

  // ========== 管理面板 ==========

  async loadAdminStats() {
    if (!this.user?.isAdmin) return;
    try {
      const usage = await API.admin.usage();
      document.getElementById("stat-total").textContent = usage.totalCalls;
      document.getElementById("stat-cost").textContent = `¥${usage.totalCost}`;
      document.getElementById("stat-breakdown").textContent = Object.entries(usage.byModel).map(([k, v]) => `${k}: ${v}`).join(" | ");

      const users = await API.admin.users();
      const tbody = document.getElementById("admin-users");
      tbody.innerHTML = users.map(u => {
        const up = `/api/user/me`; // not used
        return `<tr>
          <td>${this.escapeHtml(u.username)}</td>
          <td style="font-size:11px;color:var(--text2);">${new Date(u.createdAt).toLocaleDateString()}</td>
          <td>
            <div>对话: ${u.totalUsage.chat}</div>
            <div>图片: ${u.totalUsage.image}</div>
            <div>视频: ${u.totalUsage.video}</div>
            <div style="font-size:11px;color:var(--text2);">费用: ¥${u.totalUsage.totalCost}</div>
          </td>
          <td>
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
              <span style="font-size:11px;min-width:28px;">对话</span>
              <input type="number" value="${u.quota.chatDaily}" data-user="${u.id}" data-field="chatDaily" min="0" style="width:50px;">
            </div>
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
              <span style="font-size:11px;min-width:28px;">图片</span>
              <input type="number" value="${u.quota.imageDaily}" data-user="${u.id}" data-field="imageDaily" min="0" style="width:50px;">
            </div>
            <div style="display:flex;align-items:center;gap:6px;">
              <span style="font-size:11px;min-width:28px;">视频</span>
              <input type="number" value="${u.quota.videoDaily}" data-user="${u.id}" data-field="videoDaily" min="0" style="width:50px;">
            </div>
          </td>
          <td>
            <div class="usage-bar"><div class="fill" style="width:${Math.min(100, (u.totalUsage.chat / (u.quota.chatDaily||1)) * 100)}%"></div></div>
          </td>
        </tr>`;
      }).join("");

      // 保存按钮
      document.querySelectorAll("#admin-users input").forEach(input => {
        input.onchange = async () => {
          const userId = input.dataset.user;
          const field = input.dataset.field;
          const val = parseInt(input.value) || 0;
          try {
            // 收集该用户所有字段
            const inputs = document.querySelectorAll(`input[data-user="${userId}"]`);
            const quota = {};
            inputs.forEach(inp => { quota[inp.dataset.field] = parseInt(inp.value) || 0; });
            await API.admin.setQuota(userId, quota);
            App.toast("额度已更新");
          } catch (e) { App.toast(e.message); }
        };
      });
    } catch {}
  },

  // ========== 工具 ==========

  escapeHtml(text) {
    if (!text) return "";
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/\n/g, "<br>").replace(/```(\w*)\n([\s\S]*?)```/g, "<pre><code>$2</code></pre>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");
  },

  toast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove("show"), 3000);
  },

  async updateBadge() {
    if (this.user?.isAdmin) return;
    try {
      const me = await API.auth.me();
      this.user.usage = me.usage;
      document.getElementById("user-badge").textContent = `对话:${me.usage.chat}/${me.quota.chatDaily} 图片:${me.usage.image}/${me.quota.imageDaily} 视频:${me.usage.video}/${me.quota.videoDaily}`;
    } catch {}
  },

  logout() {
    localStorage.removeItem("token");
    location.reload();
  }
};

// ====== 事件绑定 ======
document.addEventListener("DOMContentLoaded", () => {
  // 登录/注册切换
  document.querySelectorAll(".auth-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".auth-tab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("auth-login-form").style.display = btn.dataset.tab === "login" ? "block" : "none";
      document.getElementById("auth-register-form").style.display = btn.dataset.tab === "register" ? "block" : "none";
    });
  });

  // 登录
  document.getElementById("login-btn").addEventListener("click", async () => {
    const u = document.getElementById("login-username").value.trim();
    const p = document.getElementById("login-password").value;
    try {
      const data = await API.auth.login(u, p);
      localStorage.setItem("token", data.token);
      API.token = data.token;
      App.user = data.user;
      App.showApp();
    } catch (e) { document.getElementById("login-error").textContent = e.message; document.getElementById("login-error").style.display = "block"; }
  });

  // 注册
  document.getElementById("register-btn").addEventListener("click", async () => {
    const u = document.getElementById("reg-username").value.trim();
    const p = document.getElementById("reg-password").value;
    const p2 = document.getElementById("reg-password2").value;
    if (p !== p2) { document.getElementById("reg-error").textContent = "两次密码不一致"; document.getElementById("reg-error").style.display = "block"; return; }
    try {
      const data = await API.auth.register(u, p);
      localStorage.setItem("token", data.token);
      API.token = data.token;
      App.user = data.user;
      App.showApp();
    } catch (e) { document.getElementById("reg-error").textContent = e.message; document.getElementById("reg-error").style.display = "block"; }
  });

  // 回车发送聊天
  document.getElementById("chat-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); App.sendChat(); }
  });

  // 自动调整输入框高度
  document.getElementById("chat-input").addEventListener("input", function() {
    this.style.height = "auto";
    this.style.height = Math.min(this.scrollHeight, 160) + "px";
  });

  // 全局绑定
  window.App = App;
  App.init();
});
