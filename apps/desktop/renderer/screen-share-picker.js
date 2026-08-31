const sourcesElement = document.getElementById("sources");
const messageElement = document.getElementById("message");
const shareButton = document.getElementById("share");
const cancelButton = document.getElementById("cancel");

let selectedIndex;
let submitting = false;

function select(button, index) {
  sourcesElement.querySelectorAll(".source").forEach((source) => {
    const selected = source === button;
    source.classList.toggle("selected", selected);
    source.setAttribute("aria-pressed", String(selected));
  });
  selectedIndex = index;
  shareButton.disabled = false;
}

async function share() {
  if (submitting || selectedIndex === undefined) return;
  submitting = true;
  shareButton.disabled = true;
  cancelButton.disabled = true;
  try {
    await window.screenShare.choose(selectedIndex);
  } catch (error) {
    submitting = false;
    cancelButton.disabled = false;
    shareButton.disabled = false;
    messageElement.hidden = false;
    messageElement.textContent = error instanceof Error ? error.message : "That source could not be shared.";
  }
}

function renderSources(sources) {
  sourcesElement.setAttribute("aria-busy", "false");
  if (!sources.length) {
    messageElement.textContent = "No screens or windows are available to share.";
    return;
  }

  messageElement.hidden = true;
  for (const source of sources) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "source";
    button.setAttribute("aria-pressed", "false");

    const thumbnailWrap = document.createElement("span");
    thumbnailWrap.className = "thumbnail-wrap";
    const thumbnail = document.createElement("img");
    thumbnail.className = "thumbnail";
    thumbnail.src = source.thumbnail;
    thumbnail.alt = "";
    thumbnailWrap.append(thumbnail);

    const copy = document.createElement("span");
    copy.className = "source-copy";
    const name = document.createElement("span");
    name.className = "source-name";
    name.textContent = source.name;
    name.title = source.name;
    const type = document.createElement("span");
    type.className = "source-type";
    type.textContent = source.type;
    copy.append(name, type);
    button.append(thumbnailWrap, copy);

    button.addEventListener("click", () => select(button, source.index));
    button.addEventListener("dblclick", () => {
      select(button, source.index);
      void share();
    });
    sourcesElement.append(button);
  }
}

shareButton.addEventListener("click", () => void share());
cancelButton.addEventListener("click", () => void window.screenShare.cancel());
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !submitting) void window.screenShare.cancel();
  if (event.key === "Enter" && selectedIndex !== undefined) void share();
});

window.screenShare.getSources().then(renderSources).catch((error) => {
  sourcesElement.setAttribute("aria-busy", "false");
  messageElement.textContent = error instanceof Error ? error.message : "Screens and windows could not be loaded.";
});
