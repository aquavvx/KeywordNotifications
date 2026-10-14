var plugin = (() => {
  const B = bunny;
  const React = B.React;
  const RN = B.ReactNative;
  const h = React.createElement;

  const defaults = {
    keywords: [],
    cooldownSeconds: 30,
    ignoreOwnMessages: true,
    webhookChannelId: "",
    webhookName: "Keyword Notifications",
    webhookUrl: "",
    webhookEnabled: false
  };
  const store = B.plugin?.createStorage ? B.plugin.createStorage({ ...defaults }) : { ...defaults };
  if (!Array.isArray(store.keywords)) store.keywords = [];
  if (typeof store.cooldownSeconds !== "number") store.cooldownSeconds = defaults.cooldownSeconds;
  if (typeof store.ignoreOwnMessages !== "boolean") store.ignoreOwnMessages = defaults.ignoreOwnMessages;
  for (const key of ["webhookChannelId", "webhookName", "webhookUrl"]) {
    if (typeof store[key] !== "string") store[key] = defaults[key];
  }
  if (typeof store.webhookEnabled !== "boolean") store.webhookEnabled = defaults.webhookEnabled;

  let unpatches = [];
  let startNote = "";
  let scannedMessages = 0;
  let matchedMessages = 0;
  let lastMatch = "No keyword matched yet.";
  let lastToastAt = 0;
  const listeners = new Set();
  const notify = () => listeners.forEach((fn) => fn());

  function save() {
    try {
      B.plugin?.flushStorage?.();
    } catch (error) {
      console.error("[KeywordNotifications] storage", error?.message);
    }
  }

  function toast(text) {
    try {
      const show = B.ui?.toasts?.showToast || B.ui?.showToast;
      if (typeof show === "function") {
        show(`✨  ${text}`, { type: "info", duration: 5000 });
        return;
      }
      console.warn("[KeywordNotifications] Toast API is unavailable.");
    } catch (error) {
      console.error("[KeywordNotifications] toast", error?.message);
    }
  }

  function httpRequest(method, url, body) {
    const http = findHttp();
    if (!http || typeof http[method] !== "function") {
      throw new Error("Discord's request client is unavailable.");
    }
    const request = { url, body };
    return http[method](request);
  }

  async function createWebhook() {
    const channelId = store.webhookChannelId.trim();
    const name = store.webhookName.trim() || defaults.webhookName;
    if (!/^\d{17,20}$/.test(channelId)) {
      throw new Error("Enter a valid Discord channel ID.");
    }
    const response = await httpRequest("post", `/channels/${channelId}/webhooks`, { name });
    const webhook = response?.body || response;
    if (!webhook?.id || !webhook?.token) {
      throw new Error("Discord did not return a usable webhook.");
    }
    store.webhookUrl = `https://discord.com/api/webhooks/${webhook.id}/${webhook.token}`;
    store.webhookEnabled = true;
    save();
    notify();
  }

  async function sendWebhook(message, keyword) {
    if (!store.webhookEnabled || !store.webhookUrl) return;
    const author = message.author?.username || "Discord";
    const channelId = message.channel_id || message.channelId;
    const jumpUrl = channelId && message.id
      ? `https://discord.com/channels/@me/${channelId}/${message.id}`
      : undefined;
    const response = await fetch(store.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "Keyword Notifications",
        avatar_url: "https://cdn.discordapp.com/embed/avatars/0.png",
        embeds: [{
          title: `Keyword matched: ${keyword}`,
          description: messageText(message).slice(0, 4000),
          color: 0x5865f2,
          author: { name: author },
          ...(jumpUrl ? { url: jumpUrl } : {}),
          footer: { text: "Keyword Notifications" },
          timestamp: new Date().toISOString()
        }]
      })
    });
    if (!response.ok) throw new Error(`Webhook request failed (${response.status}).`);
  }

  function normalizedKeywords() {
    return store.keywords
      .filter((keyword) => typeof keyword === "string")
      .map((keyword) => keyword.trim().toLowerCase())
      .filter(Boolean);
  }

  function isMessageUrl(url) {
    return typeof url === "string" && /\/(guilds|channels)\/\d+\/messages/.test(url);
  }

  function messageText(message) {
    return typeof message?.content === "string" ? message.content : "";
  }

  function inspectMessage(message) {
    if (!message || typeof message !== "object" || typeof message.id !== "string") return;
    const content = messageText(message);
    if (!content) return;
    scannedMessages++;
    const lower = content.toLowerCase();
    const keyword = normalizedKeywords().find((item) => lower.includes(item));
    if (!keyword || (store.ignoreOwnMessages && message.author?.id === B.currentUser?.id)) return;

    const now = Date.now();
    if (now - lastToastAt < Math.max(0, store.cooldownSeconds) * 1000) return;
    lastToastAt = now;
    matchedMessages++;
    lastMatch = `${keyword}: ${content.slice(0, 120)}`;
    toast(`Keyword "${keyword}" found${message.author?.username ? ` from ${message.author.username}` : ""}.`);
    sendWebhook(message, keyword).catch((error) => {
      console.error("[KeywordNotifications] webhook", error?.message);
      startNote = `Webhook error: ${error?.message || "request failed"}`;
      notify();
    });
    notify();
  }

  function inspectPayload(payload, depth = 0) {
    if (payload == null || depth > 5) return;
    if (Array.isArray(payload)) {
      for (const item of payload.slice(0, 100)) inspectPayload(item, depth + 1);
      return;
    }
    if (typeof payload !== "object") return;
    if (typeof payload.id === "string" && typeof payload.content === "string") inspectMessage(payload);
    for (const key of ["messages", "message", "data", "body", "results"]) {
      if (payload[key] && payload[key] !== payload) inspectPayload(payload[key], depth + 1);
    }
  }

  function inspectResponse(response) {
    if (!response) return;
    if (typeof response.then === "function") {
      response.then(inspectResponse).catch(() => {});
      return;
    }
    if (typeof response === "string") {
      try {
        inspectPayload(JSON.parse(response));
      } catch {}
      return;
    }
    inspectPayload(response);
  }

  function findHttp() {
    try {
      const found =
        B.metro.findByProps("HTTP", "get", "post", "put", "patch", "del") ||
        B.metro.findByProps("get", "post", "put", "del");
      return found?.HTTP || found;
    } catch {
      return null;
    }
  }

  function start() {
    const patcher = B.patcher || B.api?.patcher;
    if (typeof patcher?.after !== "function") {
      startNote = "Patcher not available. Plugin is inactive.";
      return;
    }
    const http = findHttp();
    if (http) {
      for (const method of ["get", "post"]) {
        if (typeof http[method] !== "function") continue;
        try {
          unpatches.push(patcher.after(method, http, (args, result) => {
            try {
              const url = args?.[0]?.url || args?.[0];
              if (isMessageUrl(url)) inspectResponse(result);
            } catch (error) {
              console.error("[KeywordNotifications] response", error?.message);
            }
            return result;
          }));
        } catch (error) {
          console.error("[KeywordNotifications] patch", error?.message);
        }
      }
    } else {
      startNote = "Could not find Discord's request code.";
    }
    startNote += ` Started with ${unpatches.length} patches.`;
    notify();
  }

  function stop() {
    while (unpatches.length) {
      try {
        unpatches.pop()();
      } catch (error) {
        console.error("[KeywordNotifications] unpatch", error?.message);
      }
    }
    listeners.clear();
  }

  function Settings() {
    const [, bump] = React.useState(0);
    const [input, setInput] = React.useState(store.keywords.join(", "));
    React.useEffect(() => {
      const fn = () => bump((value) => value + 1);
      listeners.add(fn);
      return () => listeners.delete(fn);
    }, []);
    const updateKeywords = (value) => {
      setInput(value);
      store.keywords = value.split(",").map((item) => item.trim()).filter(Boolean);
      save();
    };
    const updateSetting = (key, value) => {
      store[key] = value;
      save();
      bump((current) => current + 1);
    };
    const create = async () => {
      try {
        await createWebhook();
        startNote = "Webhook created and enabled.";
        notify();
      } catch (error) {
        startNote = `Webhook setup failed: ${error?.message || "unknown error"}`;
        console.error("[KeywordNotifications] webhook setup", error?.message);
        notify();
      }
    };
    return h(
      RN.ScrollView,
      { contentContainerStyle: { padding: 16, gap: 10 } },
      h(RN.Text, { style: { color: "#ffffff", fontSize: 20, fontWeight: "700" } }, "Keyword Notifications"),
      h(RN.Text, { style: { color: "#b9bbbe" } }, "Comma-separated keywords to watch in loaded messages."),
      h(RN.TextInput, {
        value: input,
        onChangeText: updateKeywords,
        placeholder: "urgent, commission, meeting",
        placeholderTextColor: "#72767d",
        style: { color: "#ffffff", backgroundColor: "#2b2d31", borderRadius: 8, padding: 12 }
      }),
      h(RN.View, {
        style: {
          borderLeftWidth: 4,
          borderLeftColor: "#5865f2",
          backgroundColor: "#202225",
          borderRadius: 8,
          padding: 12,
          shadowColor: "#5865f2",
          shadowOpacity: 0.8,
          shadowRadius: 12,
          elevation: 8
        }
      },
        h(RN.Text, { style: { color: "#ffffff", fontSize: 16, fontWeight: "700" } }, "✨ Keyword alert preview"),
        h(RN.Text, { style: { color: "#dcddde", marginTop: 4 } }, "A highlighted Discord-style alert appears when a keyword is found.")
      ),
      h(RN.Text, { style: { color: "#ffffff", fontSize: 16, fontWeight: "700", marginTop: 8 } }, "Discord webhook"),
      h(RN.Text, { style: { color: "#b9bbbe" } }, "Enter a channel ID you manage. The plugin will create and use a webhook in that channel."),
      h(RN.TextInput, {
        value: store.webhookChannelId,
        onChangeText: (value) => updateSetting("webhookChannelId", value.trim()),
        placeholder: "Channel ID",
        placeholderTextColor: "#72767d",
        keyboardType: "numeric",
        style: { color: "#ffffff", backgroundColor: "#2b2d31", borderRadius: 8, padding: 12 }
      }),
      h(RN.TextInput, {
        value: store.webhookName,
        onChangeText: (value) => updateSetting("webhookName", value),
        placeholder: "Webhook name",
        placeholderTextColor: "#72767d",
        style: { color: "#ffffff", backgroundColor: "#2b2d31", borderRadius: 8, padding: 12 }
      }),
      h(RN.Button, { title: store.webhookEnabled ? "Recreate webhook" : "Create webhook", onPress: create }),
      h(RN.Text, { style: { color: "#b9bbbe" } }, `Webhook: ${store.webhookEnabled ? "enabled" : "disabled"}`),
      h(RN.Text, { style: { color: "#b9bbbe" } }, `Cooldown: ${store.cooldownSeconds}s`),
      h(RN.Text, { style: { color: "#b9bbbe" } }, `Messages scanned: ${scannedMessages}`),
      h(RN.Text, { style: { color: "#b9bbbe" } }, `Matches: ${matchedMessages}`),
      h(RN.Text, { style: { color: "#b9bbbe" } }, `Last match: ${lastMatch}`),
      h(RN.Text, { style: { color: "#b9bbbe" } }, `Status: ${startNote}`)
    );
  }

  return {
    __esModule: true,
    default: definePlugin({
      async start() { start(); },
      async stop() { stop(); },
      SettingsComponent() { return h(Settings); }
    })
  };
})();
