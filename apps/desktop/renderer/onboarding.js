const form = document.getElementById("form");
const input = document.getElementById("url");
const error = document.getElementById("error");
const connect = document.getElementById("connect");
const anyway = document.getElementById("anyway");
const recents = document.getElementById("recents");

let connecting = false;

function showError(message, allowAnyway) {
  error.hidden = false;
  error.textContent = message;
  anyway.hidden = !allowAnyway;
}

function clearError() {
  error.hidden = true;
  error.textContent = "";
  anyway.hidden = true;
}

function setChoicesDisabled(disabled) {
  connect.disabled = disabled;
  anyway.disabled = disabled;
  recents.querySelectorAll("button").forEach((button) => { button.disabled = disabled; });
  document.querySelectorAll("[data-url]").forEach((button) => { button.disabled = disabled; });
}

function renderRecents(urls) {
  recents.querySelectorAll("button").forEach((button) => button.remove());
  if (!urls.length) {
    recents.hidden = true;
    return;
  }
  recents.hidden = false;
  for (const url of urls) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "choice";
    button.disabled = connecting;
    button.innerHTML = `<span><strong>Recent workspace</strong><small></small></span>`;
    button.querySelector("small").textContent = url;
    button.addEventListener("click", () => {
      input.value = url;
      void submit(false);
    });
    recents.append(button);
  }
}

async function submit(force) {
  if (connecting) return;
  connecting = true;
  clearError();
  setChoicesDisabled(true);
  connect.textContent = force ? "Connecting…" : "Checking workspace…";
  anyway.hidden = true;
  try {
    const result = await window.desktop.connect(input.value, { force });
    if (result?.ok) return;
    const retryable = result?.code === "network" || result?.code === "http";
    showError(result?.error ?? "Unable to connect to that workspace.", retryable);
  } catch (cause) {
    showError(cause instanceof Error ? cause.message : "Unable to connect to that workspace.", true);
  } finally {
    connecting = false;
    setChoicesDisabled(false);
    connect.textContent = "Connect";
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void submit(false);
});

anyway.addEventListener("click", () => void submit(true));

document.querySelectorAll("[data-url]").forEach((button) => {
  button.addEventListener("click", () => {
    input.value = button.getAttribute("data-url") ?? "";
    void submit(false);
  });
});

window.desktop.getState().then((state) => {
  if (state.url && !input.value) input.value = state.url;
  renderRecents(state.recents.filter((url) => url !== "http://localhost:5173"));
}).catch(() => undefined);
