const params = new URLSearchParams(window.location.search);
const detail = params.get("detail");
if (detail) document.getElementById("detail").textContent = detail;

document.getElementById("retry").addEventListener("click", () => {
  void window.desktop.retry();
});

document.getElementById("change").addEventListener("click", () => {
  void window.desktop.disconnect();
});
