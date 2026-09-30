const queues = new Map<number, Promise<unknown>>();
export async function serial<T>(
  tabId: number,
  run: () => Promise<T>,
): Promise<T> {
  const previous = queues.get(tabId) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(run);
  queues.set(tabId, current);
  try {
    return await current;
  } finally {
    if (queues.get(tabId) === current) queues.delete(tabId);
  }
}
export async function content(
  tabId: number,
  message: Record<string, unknown>,
): Promise<any> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "ping" });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content/content-script.js"],
      world: "ISOLATED",
    });
  }
  const response = await chrome.tabs.sendMessage(tabId, message);
  if (!response?.ok)
    throw new Error(response?.error ?? "Content script command failed");
  return response;
}
export async function observe(tabId: number): Promise<unknown> {
  const deadline = Date.now() + 8000;
  while ((await chrome.tabs.get(tabId)).status === "loading") {
    if (Date.now() > deadline)
      throw new Error("Navigation observation timed out");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await content(tabId, { type: "settle" });
  return (await content(tabId, { type: "snapshot" })).snapshot;
}
