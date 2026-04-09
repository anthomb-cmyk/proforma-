import { Router } from "express";

function writeStreamEvent(res, payload) {
  res.write(`${JSON.stringify(payload)}\n`);
}

function sendStreamHeaders(res) {
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
}

function buildProgressiveChunks(text) {
  return String(text || "")
    .split(/(\s+)/)
    .filter(Boolean);
}

export function createChatRouter({
  chatLimiter,
  listingsService,
  openaiService,
  normalizeRef,
  extractListingReference,
  upsertChatSession,
  recordUserDailyTime,
  appendChatMessage,
  createId,
  generateTranslatorPayload
}) {
  const router = Router();

  router.post("/", chatLimiter, async (req, res) => {
    const mode = String(req.body?.mode || "").trim();
    const message = String(req.body?.message || "").trim();
    const userId = String(req.body?.user_id || "employee-manuel");
    const listingRef = normalizeRef(req.body?.listing_ref || "");
    const resolvedListingRef = listingRef ? `L-${listingRef}` : "";
    const translatorThreadKey = String(req.body?.translator_thread_key || "").trim();
    const conversationHistory = openaiService.truncateConversationHistory(
      Array.isArray(req.body?.conversation_history) ? req.body.conversation_history : [],
      10
    );

    if (!mode || !message) {
      return res.status(400).json({
        ok: false,
        error: "Le mode et le message sont obligatoires."
      });
    }

    sendStreamHeaders(res);

    const requestAbortController = new AbortController();
    req.on("close", () => requestAbortController.abort());

    try {
      await upsertChatSession(userId);
      await recordUserDailyTime(userId);

      const userMessageId = createId("msg");
      await appendChatMessage({
        id: userMessageId,
        user_id: userId,
        mode,
        listing_ref: resolvedListingRef || null,
        translator_thread_key: translatorThreadKey || null,
        sender: "user",
        text: message,
        created_at: new Date().toISOString()
      });

      if (mode === "translator") {
        const listings = listingRef ? await listingsService.loadListingsMap() : null;
        const translatorPayload = await generateTranslatorPayload(message, {
          userId,
          translatorThreadKey,
          listing: listingRef && listings ? listings[listingRef] || null : null,
          conversationHistory
        });

        const assistantText = [
          `Français international : ${translatorPayload.translation}`,
          `Réponse suggérée : ${translatorPayload.reply}`
        ].join("\n\n");

        for (const chunk of buildProgressiveChunks(assistantText)) {
          writeStreamEvent(res, { type: "chunk", delta: chunk });
        }

        const assistantMessageId = createId("msg");
        await appendChatMessage({
          id: assistantMessageId,
          user_id: userId,
          mode,
          listing_ref: resolvedListingRef || null,
          translator_thread_key: translatorThreadKey || null,
          sender: "assistant",
          text: assistantText,
          translation: translatorPayload.translation,
          reply: translatorPayload.reply,
          context: translatorPayload.context,
          created_at: new Date().toISOString()
        });

        writeStreamEvent(res, {
          type: "done",
          payload: {
            ok: true,
            label: "Traducteur",
            variant: "success",
            user_message_id: userMessageId,
            assistant_message_id: assistantMessageId,
            translator_thread_key: translatorThreadKey || "",
            listing_ref: resolvedListingRef || "",
            translation: translatorPayload.translation,
            reply: translatorPayload.reply,
            context: translatorPayload.context
          }
        });
        return res.end();
      }

      if (mode === "listing") {
        const listings = await listingsService.loadListingsMap();
        const reference = extractListingReference(message);
        const listing = listings[reference];

        if (!reference || !listing) {
          writeStreamEvent(res, {
            type: "error",
            error: "Référence d'appartement introuvable dans le message."
          });
          return res.end();
        }

        const reply = await openaiService.streamListingReply(message, listing, {
          signal: requestAbortController.signal,
          onToken: (delta) => writeStreamEvent(res, { type: "chunk", delta })
        });

        await appendChatMessage({
          id: createId("msg"),
          user_id: userId,
          mode,
          sender: "assistant",
          text: reply,
          created_at: new Date().toISOString()
        });

        writeStreamEvent(res, {
          type: "done",
          payload: {
            ok: true,
            label: "Assistant des immeubles",
            variant: "success",
            reference,
            reply
          }
        });
        return res.end();
      }

      writeStreamEvent(res, {
        type: "error",
        error: "Mode non pris en charge."
      });
      return res.end();
    } catch (error) {
      const errorMessage = error?.name === "AbortError"
        ? "Requête annulée."
        : "Impossible de traiter la demande.";

      writeStreamEvent(res, {
        type: "error",
        error: errorMessage
      });
      return res.end();
    }
  });

  return router;
}
