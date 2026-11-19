import { esc } from "../utils/format.js";
import { EventEmitter } from "../core/EventEmitter.js";

/** Thrown when the user closes a dialog that another step was waiting for. */
export class CancelledError extends Error {
  constructor() {
    super("Cancelled");
    this.name = "CancelledError";
  }
}

let openCount = 0;
/** Emits "change" when a dialog opens or closes, so auto-refresh can pause meanwhile. */
export const modalEvents = new EventEmitter();
export const isModalOpen = () => openCount > 0;

/**
 * Opens a modal dialog and resolves when it closes.
 *
 * onSubmit(form) runs when the user presses the main button. Its return value
 * closes the dialog and becomes the result. If it throws, the message is shown
 * inside the dialog and the dialog stays open, so the user can fix the input
 * (wrong password, MySQL error ...). Cancel or Esc resolves with null.
 */
export function openModal({ title, body, submitLabel = "Save", danger = false, wide = false, onMount, onSubmit }) {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = `modal${wide ? " wide" : ""}`;
    dialog.innerHTML = `
      <form novalidate>
        <header>
          <h2>${esc(title)}</h2>
          <button type="button" class="icon" data-cancel aria-label="Close">×</button>
        </header>
        <div class="modal-body">${body}</div>
        <p class="modal-error" role="alert" hidden></p>
        <footer>
          <button type="button" data-cancel>Cancel</button>
          <button type="submit" class="${danger ? "danger" : "primary"}">${esc(submitLabel)}</button>
        </footer>
      </form>`;
    document.body.append(dialog);

    const form = dialog.querySelector("form");
    const errorBox = dialog.querySelector(".modal-error");
    const submit = dialog.querySelector('button[type="submit"]');
    let busy = false;

    const showError = (message) => {
      errorBox.textContent = message;
      errorBox.hidden = !message;
    };
    const finish = (result) => {
      dialog.close();
      dialog.remove();
      openCount -= 1;
      modalEvents.emit("change", isModalOpen());
      resolve(result);
    };

    dialog.addEventListener("cancel", (e) => {
      e.preventDefault(); // Esc: close ourselves so the promise resolves
      if (!busy) finish(null);
    });
    for (const button of dialog.querySelectorAll("[data-cancel]")) {
      button.addEventListener("click", () => !busy && finish(null));
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (busy) return;
      busy = true;
      submit.disabled = true;
      showError("");
      try {
        const result = await onSubmit(form);
        finish(result === undefined ? true : result);
      } catch (err) {
        // A cancelled password prompt just returns to this dialog.
        if (!(err instanceof CancelledError)) showError(err.message);
      } finally {
        busy = false;
        submit.disabled = false;
      }
    });

    onMount?.(form, { showError });
    openCount += 1;
    modalEvents.emit("change", true);
    dialog.showModal();
    (form.querySelector("[autofocus]") ?? form.querySelector("input:not([disabled]), select, textarea"))?.focus();
  });
}

/** Yes/no confirmation. With `typeToConfirm`, the user must type that text first. */
export function confirmDialog({ title, message, confirmLabel, typeToConfirm, onConfirm }) {
  const check = typeToConfirm
    ? `<label class="confirm-type">Type <code>${esc(typeToConfirm)}</code> to confirm
         <input name="confirm" autocomplete="off" spellcheck="false" autofocus></label>`
    : "";
  return openModal({
    title,
    body: `<div class="confirm-message">${message}</div>${check}`,
    submitLabel: confirmLabel,
    danger: true,
    onSubmit: async (form) => {
      if (typeToConfirm && form.elements.confirm.value !== typeToConfirm) {
        throw new Error(`Type "${typeToConfirm}" exactly to confirm.`);
      }
      return onConfirm ? onConfirm(form) : true;
    },
  });
}
