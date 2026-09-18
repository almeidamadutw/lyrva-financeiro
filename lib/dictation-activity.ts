const DICTATION_ATTRIBUTE = "data-lyvra-dictation";
const DICTATION_EVENT = "lyvra:dictation-state";

export function isDictationActive() {
  return typeof document !== "undefined"
    && document.documentElement.getAttribute(DICTATION_ATTRIBUTE) === "active";
}

export function setDictationActive(active: boolean) {
  if (typeof document === "undefined") return;
  if (active) document.documentElement.setAttribute(DICTATION_ATTRIBUTE, "active");
  else document.documentElement.removeAttribute(DICTATION_ATTRIBUTE);
  window.dispatchEvent(new CustomEvent(DICTATION_EVENT, { detail: { active } }));
}

export function onDictationStateChange(listener: (active: boolean) => void) {
  if (typeof window === "undefined") return () => undefined;
  const handler = (event: Event) => {
    listener(Boolean((event as CustomEvent<{ active?: boolean }>).detail?.active));
  };
  window.addEventListener(DICTATION_EVENT, handler);
  return () => window.removeEventListener(DICTATION_EVENT, handler);
}
