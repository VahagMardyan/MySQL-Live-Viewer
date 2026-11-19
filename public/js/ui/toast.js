import { esc } from "../utils/format.js";

let container = null;

/** Shows a short message in the corner for a few seconds. kind: "ok" | "error". */
export function showToast(message, kind = "ok") {
  if (!container) {
    container = document.createElement("div");
    container.className = "toasts";
    container.setAttribute("aria-live", "polite");
    document.body.append(container);
  }
  const toast = document.createElement("div");
  toast.className = `toast toast-${kind}`;
  toast.innerHTML = esc(message);
  container.append(toast);
  setTimeout(() => toast.classList.add("hide"), kind === "error" ? 6000 : 3500);
  setTimeout(() => toast.remove(), kind === "error" ? 6500 : 4000);
}
