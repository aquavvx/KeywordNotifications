var plugin = (() => {
  const B = bunny;
  const React = B.React;
  const RN = B.ReactNative;
  const h = React.createElement;

  const defaults = {
    keywords: [],
    cooldownSeconds: 30,
    ignoreOwnMessages: true
  };
  const store = B.plugin?.createStorage ? B.plugin.createStorage({ ...defaults }) : { ...defaults };
  if (!Array.isArray(store.keywords)) store.keywords = [];
  if (typeof store.cooldownSeconds !== "number") store.cooldownSeconds = defaults.cooldownSeconds;
  if (typeof store.ignoreOwnMessages !== "boolean") store.ignoreOwnMessages = defaults.ignoreOwnMessages;

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
      if (typeof show === "function") show(text);
    } catch (error) {
      console.error("[KeywordNotifications] toast", error?.message);
    }
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
