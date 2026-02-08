(function bootstrapStreamSseFeature(global) {
  async function* streamSse(body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const boundaryMatch = buffer.match(/\r?\n\r?\n/);
        if (!boundaryMatch || boundaryMatch.index === undefined) {
          break;
        }
        const boundary = boundaryMatch.index;
        const boundaryLength = boundaryMatch[0].length;
        const block = buffer.slice(0, boundary).trim();
        buffer = buffer.slice(boundary + boundaryLength);
        if (!block) {
          continue;
        }

        const lines = block.split(/\r?\n/);
        let event = "message";
        const dataLines = [];
        for (const line of lines) {
          if (line.startsWith("event:")) {
            event = line.slice(6).trim() || "message";
            continue;
          }
          if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trimStart());
          }
        }

        if (!dataLines.length) {
          continue;
        }
        const raw = dataLines.join("\n");
        let data = raw;
        try {
          data = JSON.parse(raw);
        } catch {
          data = raw;
        }

        yield { event, data };
      }
    }
  }

  const root = global.AppClient || (global.AppClient = {});
  const features = root.features || (root.features = {});
  features.streamSse = streamSse;
})(typeof globalThis !== "undefined" ? globalThis : window);
