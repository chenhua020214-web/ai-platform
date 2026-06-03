// ====== API 客户端 ======
const API = {
  token: localStorage.getItem("token"),
  base: "",

  async request(method, url, body) {
    const headers = { "Content-Type": "application/json" };
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
    const resp = await fetch(this.base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (resp.status === 401) { localStorage.removeItem("token"); location.reload(); }
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "请求失败");
    return data;
  },

  auth: {
    register: (u, p) => API.request("POST", "/api/auth/register", { username: u, password: p }),
    login: (u, p) => API.request("POST", "/api/auth/login", { username: u, password: p }),
    me: () => API.request("GET", "/api/user/me"),
  },

  chat: {
    send: (model, messages) => API.request("POST", `/api/chat/${model}`, { messages }),
    stream: (model, messages, onChunk, onDone, onError) => {
      const headers = { "Content-Type": "application/json" };
      if (API.token) headers["Authorization"] = `Bearer ${API.token}`;
      fetch(API.base + `/api/chat/${model}/stream`, { method: "POST", headers, body: JSON.stringify({ messages }) })
        .then(async resp => {
          const reader = resp.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            for (const line of lines) {
              if (line.startsWith("data: ")) {
                try {
                  const json = JSON.parse(line.slice(6));
                  if (json.error) { onError?.(json.error); return; }
                  if (json.done) { onDone?.(json.fullContent); return; }
                  if (json.content) onChunk?.(json.content);
                } catch {}
              }
            }
          }
        })
        .catch(e => onError?.(e.message));
    },
  },

  image: {
    generate: (prompt, model) => API.request("POST", "/api/image/generate", { prompt, model }),
  },

  video: {
    generate: (prompt) => API.request("POST", "/api/video/generate", { prompt }),
    status: (taskId) => API.request("GET", `/api/video/status/${taskId}`),
    list: () => API.request("GET", "/api/video/list"),
  },

  admin: {
    users: () => API.request("GET", "/api/admin/users"),
    setQuota: (userId, q) => API.request("POST", "/api/admin/user/quota", { userId, ...q }),
    usage: () => API.request("GET", "/api/admin/usage"),
  },
};
