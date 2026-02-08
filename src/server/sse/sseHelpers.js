/**
 * SSE response helpers.
 */
function openSse(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
}

function sendEvent(res, { type, data }) {
  res.write(`event: ${type}\n`);
  if (data !== undefined) {
    const serialized = typeof data === "string" ? data : JSON.stringify(data);
    res.write(`data: ${serialized}\n`);
  }
  res.write("\n");
}

function closeSse(res) {
  res.end();
}

module.exports = {
  openSse,
  sendEvent,
  closeSse
};
