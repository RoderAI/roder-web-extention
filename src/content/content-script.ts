import { captureSnapshot, getPageText } from "./snapshot";
import { focused, highlight, probe, selectOption } from "./actions";
import { documentToken } from "./refs";
import { maskSecrets, settle } from "./observation";
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const supported = [
    "ping",
    "snapshot",
    "getText",
    "highlight",
    "probe",
    "focused",
    "viewport",
    "mask",
    "settle",
    "select",
  ];
  if (!supported.includes(message?.type)) return false;
  void (async () => {
    switch (message.type) {
      case "ping":
        return { documentToken };
      case "snapshot":
        return { snapshot: captureSnapshot(message.include) };
      case "getText":
        return { text: getPageText() };
      case "highlight":
        return highlight(message);
      case "probe":
        return probe(message);
      case "select":
        return selectOption(message);
      case "focused":
        return focused(message.ref);
      case "viewport":
        return {
          width: innerWidth,
          height: innerHeight,
          scrollX,
          scrollY,
          ratio: devicePixelRatio,
        };
      case "mask":
        maskSecrets(message.on);
        return {};
      case "settle":
        await settle();
        return {};
    }
  })()
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) =>
      sendResponse({ ok: false, error: String(error.message ?? error) }),
    );
  return true;
});
