(function bootstrapChatUiFeature(global) {
  function createChatUiFeature(deps) {
    const { state, elements, setStatus, escapeHtml, maxImageAttachmentBytes } = deps;

    function isNearBottom(element, threshold = 72) {
      if (!element) {
        return true;
      }
      const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
      if (!Number.isFinite(remaining)) {
        return true;
      }
      return remaining <= threshold;
    }

    function setScrollButtonVisible(visible) {
      if (!elements.scrollToBottomBtn) {
        return;
      }
      elements.scrollToBottomBtn.hidden = !visible;
    }

    function scrollChatToBottom({ smooth = false } = {}) {
      if (!elements.chatLog) {
        return;
      }
      if (smooth && typeof elements.chatLog.scrollTo === "function") {
        elements.chatLog.scrollTo({ top: elements.chatLog.scrollHeight, behavior: "smooth" });
      } else {
        elements.chatLog.scrollTop = elements.chatLog.scrollHeight;
      }
      state.shouldStickToBottom = true;
      setScrollButtonVisible(false);
    }

    function syncChatScrollState() {
      if (!elements.chatLog) {
        return;
      }
      state.shouldStickToBottom = isNearBottom(elements.chatLog);
      setScrollButtonVisible(!state.shouldStickToBottom);
    }

    function updateAttachmentCount() {
      if (!elements.chatAttachmentCount) {
        return;
      }
      const count = state.pendingImages.length;
      if (!count) {
        elements.chatAttachmentCount.textContent = "";
        return;
      }
      elements.chatAttachmentCount.textContent = count === 1 ? "1 image attached" : `${count} images attached`;
    }

    function formatBytes(bytes) {
      const size = Number(bytes);
      if (!Number.isFinite(size) || size <= 0) {
        return "0 B";
      }
      if (size < 1024) {
        return `${size} B`;
      }
      if (size < 1024 * 1024) {
        return `${(size / 1024).toFixed(1)} KB`;
      }
      return `${(size / (1024 * 1024)).toFixed(2)} MB`;
    }

    function revokeAttachmentPreviewUrls() {
      if (typeof URL === "undefined" || typeof URL.revokeObjectURL !== "function") {
        state.attachmentPreviewUrls = [];
        return;
      }
      for (const url of state.attachmentPreviewUrls) {
        URL.revokeObjectURL(url);
      }
      state.attachmentPreviewUrls = [];
    }

    function syncPendingImagesToInput() {
      if (!elements.chatImages || typeof DataTransfer !== "function") {
        return;
      }

      try {
        const transfer = new DataTransfer();
        for (const file of state.pendingImages) {
          transfer.items.add(file);
        }
        elements.chatImages.files = transfer.files;
      } catch {
        // Ignore environments where programmatic FileList assignment is blocked.
      }
    }

    function renderAttachmentPreview() {
      if (!elements.chatAttachmentPreview) {
        return;
      }

      revokeAttachmentPreviewUrls();

      if (!state.pendingImages.length) {
        elements.chatAttachmentPreview.innerHTML = "";
        return;
      }

      const cards = state.pendingImages
        .map((file, index) => {
          const safeName = escapeHtml(file.name || `image-${index + 1}`);
          const sizeText = escapeHtml(formatBytes(file.size));
          let thumbMarkup = '<span class="attachment-thumb-fallback" aria-hidden="true">IMG</span>';

          if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
            const objectUrl = URL.createObjectURL(file);
            state.attachmentPreviewUrls.push(objectUrl);
            thumbMarkup = `<img src="${escapeHtml(objectUrl)}" alt="" loading="lazy" />`;
          }

          return `<div class="attachment-card">
        <div class="attachment-thumb">${thumbMarkup}</div>
        <div class="attachment-meta">
          <div class="attachment-name" title="${safeName}">${safeName}</div>
          <div class="attachment-size">${sizeText}</div>
        </div>
        <button class="attachment-remove-btn" type="button" data-index="${index}" aria-label="Remove ${safeName}">Remove</button>
      </div>`;
        })
        .join("");

      elements.chatAttachmentPreview.innerHTML = cards;
    }

    function mergePendingImages(files) {
      const unique = new Map(
        state.pendingImages.map((file) => [`${file.name}:${file.size}:${file.lastModified}:${file.type}`, file])
      );
      let oversized = 0;

      for (const file of files) {
        if (!file || typeof file !== "object") {
          continue;
        }
        const type = String(file.type || "").toLowerCase();
        if (!type.startsWith("image/")) {
          continue;
        }
        if (Number(file.size) > maxImageAttachmentBytes) {
          oversized += 1;
          continue;
        }
        const key = `${file.name}:${file.size}:${file.lastModified}:${file.type}`;
        unique.set(key, file);
      }

      state.pendingImages = [...unique.values()];
      syncPendingImagesToInput();
      updateAttachmentCount();
      renderAttachmentPreview();

      if (oversized > 0) {
        const limitText = formatBytes(maxImageAttachmentBytes);
        setStatus(
          oversized === 1
            ? `Skipped 1 image larger than ${limitText}.`
            : `Skipped ${oversized} images larger than ${limitText}.`,
          true
        );
      }
    }

    function removePendingImage(index) {
      if (!Number.isInteger(index) || index < 0 || index >= state.pendingImages.length) {
        return;
      }
      state.pendingImages.splice(index, 1);
      syncPendingImagesToInput();
      updateAttachmentCount();
      renderAttachmentPreview();
    }

    function clearPendingImages() {
      state.pendingImages = [];
      if (elements.chatImages) {
        elements.chatImages.value = "";
      }
      syncPendingImagesToInput();
      updateAttachmentCount();
      renderAttachmentPreview();
    }

    function autoResizeChatMessage() {
      if (!elements.chatMessage || !elements.chatMessage.style) {
        return;
      }
      elements.chatMessage.style.height = "auto";
      const next = Math.min(180, Math.max(44, elements.chatMessage.scrollHeight || 44));
      elements.chatMessage.style.height = `${next}px`;
    }

    return {
      isNearBottom,
      setScrollButtonVisible,
      scrollChatToBottom,
      syncChatScrollState,
      updateAttachmentCount,
      formatBytes,
      revokeAttachmentPreviewUrls,
      syncPendingImagesToInput,
      renderAttachmentPreview,
      mergePendingImages,
      removePendingImage,
      clearPendingImages,
      autoResizeChatMessage
    };
  }

  const root = global.AppClient || (global.AppClient = {});
  const features = root.features || (root.features = {});
  features.createChatUiFeature = createChatUiFeature;
})(typeof globalThis !== "undefined" ? globalThis : window);
