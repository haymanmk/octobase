import { getSettings, setSettings } from "./config.ts";

const led = document.getElementById("led")!;
const statusText = document.getElementById("status-text")!;
const captureBtn = document.getElementById("capture") as HTMLButtonElement;
const queueEl = document.getElementById("queue")!;
const portInput = document.getElementById("port") as HTMLInputElement;
const tokenInput = document.getElementById("token") as HTMLInputElement;
const saveBtn = document.getElementById("save") as HTMLButtonElement;

async function refresh() {
  const settings = await getSettings();
  portInput.value = String(settings.port);
  tokenInput.value = settings.token;

  const health = (await chrome.runtime.sendMessage({ type: "health" })) as { ok: boolean };
  if (health?.ok) {
    led.className = "led on";
    statusText.textContent = "Connected to octobase";
    captureBtn.disabled = false;
  } else {
    led.className = "led off";
    statusText.textContent = settings.token ? "App not reachable" : "Not paired yet";
    captureBtn.disabled = false; // still allow — it will queue
  }

  const q = (await chrome.runtime.sendMessage({ type: "queueSize" })) as { size: number };
  queueEl.textContent = q?.size ? `${q.size} item${q.size > 1 ? "s" : ""} queued for delivery` : "";
}

async function ensureContentScript(tabId: number): Promise<boolean> {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    return true;
  } catch {
    // Restricted page (chrome://, web store, PDF viewer, etc.).
    return false;
  }
}

captureBtn.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  const injected = await ensureContentScript(tab.id);
  if (!injected) {
    statusText.textContent = "Can't capture this page";
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "capture" });
    window.close();
  } catch {
    statusText.textContent = "Couldn't reach the page — try reloading it";
  }
});

saveBtn.addEventListener("click", async () => {
  await setSettings({
    port: Number(portInput.value) || 7373,
    token: tokenInput.value.trim(),
  });
  await refresh();
});

void refresh();
