const DEFAULT_LISTING_CACHE_TTL_MS = 10 * 60 * 1000;

function normalizeQuestionKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function buildListingFallback(listing) {
  return [
    `Voici les informations disponibles pour L-${listing.ref}.`,
    "",
    listing.adresse ? `Adresse : ${listing.adresse}` : "",
    listing.ville ? `Ville : ${listing.ville}` : "",
    listing.type_logement ? `Type : ${listing.type_logement}` : "",
    listing.chambres ? `Chambres : ${listing.chambres}` : "",
    listing.superficie ? `Superficie : ${listing.superficie}` : "",
    listing.loyer ? `Loyer : ${listing.loyer}` : "",
    listing.disponibilite ? `Disponibilité : ${listing.disponibilite}` : "",
    listing.statut ? `Statut : ${listing.statut}` : "",
    listing.notes ? `Notes : ${listing.notes}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

export function truncateConversationHistory(history = [], maxMessages = 10) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history.slice(-maxMessages).map((entry) => ({
    sender: String(entry?.sender || "").trim(),
    label: String(entry?.label || "").trim(),
    text: String(entry?.text || "").trim(),
    sections: Array.isArray(entry?.sections)
      ? entry.sections.slice(0, 4).map((section) => ({
          title: String(section?.title || "").trim(),
          text: String(section?.text || "").trim()
        }))
      : []
  }));
}

export function createOpenAIService({
  openaiClient,
  assistantModel = process.env.OPENAI_MODEL || "gpt-4.1-mini",
  translatorModel = process.env.OPENAI_TRANSLATOR_MODEL || "gpt-4o-mini",
  listingCacheTtlMs = DEFAULT_LISTING_CACHE_TTL_MS
} = {}) {
  const listingReplyCache = new Map();

  function cleanupExpiredCacheEntries() {
    const now = Date.now();
    for (const [key, value] of listingReplyCache.entries()) {
      if (!value || value.expiresAt <= now) {
        listingReplyCache.delete(key);
      }
    }
  }

  function getListingCacheKey(message, listing) {
    return [
      String(listing?.ref || "").trim(),
      normalizeQuestionKey(message)
    ].join("::");
  }

  function getCachedListingReply(message, listing) {
    cleanupExpiredCacheEntries();
    const entry = listingReplyCache.get(getListingCacheKey(message, listing));
    if (!entry || entry.expiresAt <= Date.now()) {
      return null;
    }
    return entry.reply;
  }

  function setCachedListingReply(message, listing, reply) {
    listingReplyCache.set(getListingCacheKey(message, listing), {
      reply,
      expiresAt: Date.now() + listingCacheTtlMs
    });
  }

  async function generateTranslatorExtraction(message, options = {}) {
    if (!openaiClient) {
      return null;
    }

    const response = await openaiClient.chat.completions.create({
      model: translatorModel,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Tu es un extracteur structuré pour un traducteur interne d’équipe locative. Tu dois répondre uniquement avec un objet JSON valide contenant au maximum ces champs: translation, message_type, listing_question_type, provided_fields, answers_previous_step, confidence.\n\nRègles:\n- translation: reformule le message du locataire en français international clair, court et fidèle au sens\n- message_type doit être l’un de: listing_question, qualification_answer, mixed, general\n- listing_question_type doit être l’un de: availability, price, electricity, heating, inclusions, appliances, pets, parking, location, deposit, visit, none\n- provided_fields doit être un objet dont les clés autorisées sont: move_in_date, occupants_total, has_animals, animal_type, employment_status, employer, employment_duration, income, credit, tal, full_name, phone, email\n- answers_previous_step doit être true seulement si le message répond clairement à la dernière question posée\n- confidence est un nombre entre 0 et 1\n- n’invente pas d’information sur la fiche logement\n- sois robuste aux fautes, au français québécois oral, aux abréviations, au style Marketplace et aux réponses courtes dépendantes du contexte"
        },
        {
          role: "user",
          content: [
            `Message actuel du locataire :\n${message}`,
            options?.listing ? `\nAppartement sélectionné :\n${options.buildTranslatorListingContext(options.listing)}` : "\nAppartement sélectionné : aucun.",
            options?.conversationEntries?.length
              ? `\nHistorique récent utile :\n${options.conversationEntries.map((entry, index) => `${index + 1}. ${options.renderTranslatorHistoryEntry(entry)}`).join("\n\n")}`
              : "\nHistorique récent utile : aucun.",
            options?.threadState?.last_asked_step
              ? `\nDernière information demandée : ${options.threadState.last_asked_step}`
              : "\nDernière information demandée : aucune.",
            `\nExtraction déterministe déjà repérée : ${JSON.stringify({
              listing_question_type: options?.deterministicExtraction?.listing_question_type || "none",
              provided_fields: Object.fromEntries(
                Object.entries(options?.deterministicExtraction?.provided_fields || {}).map(([key, value]) => [key, value.value])
              ),
              answers_previous_step: Boolean(options?.deterministicExtraction?.answers_previous_step)
            })}`
          ].join("\n")
        }
      ]
    });

    const content = response.choices?.[0]?.message?.content?.trim();

    if (!content) {
      return null;
    }

    try {
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  async function streamListingReply(message, listing, { signal, onToken } = {}) {
    const cachedReply = getCachedListingReply(message, listing);
    if (cachedReply) {
      if (typeof onToken === "function" && cachedReply) {
        onToken(cachedReply);
      }
      return cachedReply;
    }

    if (!openaiClient) {
      const fallback = buildListingFallback(listing);
      setCachedListingReply(message, listing, fallback);
      if (typeof onToken === "function" && fallback) {
        onToken(fallback);
      }
      return fallback;
    }

    const stream = await openaiClient.chat.completions.create({
      model: assistantModel,
      temperature: 0.3,
      stream: true,
      messages: [
        {
          role: "system",
          content:
            "Tu es un assistant interne pour une equipe de location. Reponds seulement avec les informations fournies sur l'appartement. Si l'information manque, dis-le clairement sans inventer."
        },
        {
          role: "user",
          content: `Appartement : ${JSON.stringify(listing, null, 2)}\n\nQuestion : ${message}`
        }
      ],
      signal
    });

    let reply = "";

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content || "";
      if (!delta) continue;
      reply += delta;
      if (typeof onToken === "function") {
        onToken(delta);
      }
    }

    const finalReply = reply.trim() || "Aucune réponse disponible.";
    setCachedListingReply(message, listing, finalReply);
    return finalReply;
  }

  return {
    assistantModel,
    translatorModel,
    truncateConversationHistory,
    generateTranslatorExtraction,
    streamListingReply
  };
}
