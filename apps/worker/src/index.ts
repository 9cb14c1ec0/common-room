const intervalMs = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 5000);

console.log(JSON.stringify({ level: "info", service: "office-worker", message: "Worker started", intervalMs }));

const timer = setInterval(() => {
  // The queue adapter will claim recording-completed jobs in the next integration slice.
}, intervalMs);

function shutdown() {
  clearInterval(timer);
  console.log(JSON.stringify({ level: "info", service: "office-worker", message: "Worker stopped" }));
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
