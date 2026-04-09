const DEFAULT_LISTING_CACHE_TTL_MS = 10 * 60 * 1000;
const STEP_LABELS = {
  move_in_date: "la date d'emménagement souhaitée",
  occupants_total: "le nombre de personnes qui habiteraient le logement",
  has_animals: "s'il y a des animaux",
  animal_type: "le type d'animal",
  employment_status: "la situation d'emploi ou source de revenu",
  employer: "le nom de l'employeur ou type d'emploi",
  employment_duration: "l'ancienneté en emploi",
  income: "le revenu approximatif",
  credit: "la situation de crédit",
  tal: "s'il y a eu des problèmes au TAL ou avec un propriétaire précédent",
  full_name: "le nom complet",
  phone: "le numéro de téléphone",
  email: "l'adresse courriel"
};

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

function summarizeTranslatorConversationEntries(entries = []) {
  if (!Array.isArray(entries) || !entries.length) {
    return "aucun";
  }

  return entries.slice(-4).map((entry, index) => {
    const sender = String(entry?.sender || entry?.label || "").trim().toLowerCase();
    const roleLabel = sender === "assistant" ? "Équipe" : sender === "user" ? "Locataire" : "Échange";
    const text = String(entry?.text || "").trim().replace(/\s+/g, " ");
    const compactText = text.length > 180 ? `${text.slice(0, 177)}...` : text;
    return `${index + 1}. ${roleLabel} : ${compactText || "(vide)"}`;
  }).join("\n");
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
            "Tu es un extracteur structuré pour un assistant conversationnel locatif interne.\nTu analyses le message d'un locataire potentiel et tu retournes uniquement un objet JSON valide.\n\nChamps autorisés : translation, message_type, listing_question_type, provided_fields, answers_previous_step, confidence.\n\nRègles :\n- translation : reformule le message en français international, court, clair, fidèle au sens réel\n- message_type : listing_question | qualification_answer | mixed | general\n- listing_question_type : availability | price | electricity | heating | inclusions | appliances | pets | parking | location | deposit | visit | none\n- provided_fields : extrait uniquement les champs clairement présents dans le message. Clés autorisées : move_in_date, occupants_total, has_animals, animal_type, employment_status, employer, employment_duration, income, credit, tal, full_name, phone, email\n- answers_previous_step : true si le message répond à la dernière question posée\n- confidence : nombre entre 0 et 1\n\nComportement critique :\n- Si le message est court (ex: \"4\", \"oui\", \"non\", \"le 1er\"), l'interpréter selon la dernière question posée fournie en contexte\n- Si le message contient à la fois une réponse et une nouvelle question, extraire les deux\n- Être robuste aux fautes, québécismes, abréviations, messages Marketplace\n- Ne jamais inventer d'information sur le logement"
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
              ? `\nLa dernière question posée au locataire portait sur : ${STEP_LABELS[options.threadState.last_asked_step] ?? options.threadState.last_asked_step}`
              : "\nLa dernière question posée au locataire portait sur : aucune.",
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

  async function generateTranslatorReply({
    answerLine,
    nextQuestion,
    extraction,
    threadState,
    listing,
    conversationEntries
  } = {}) {
    if (!openaiClient) {
      return null;
    }

    const response = await openaiClient.chat.completions.create({
      model: translatorModel,
      temperature: 0.5,
      messages: [
        {
          role: "system",
          content:
            "Tu es un assistant interne qui aide un employé locatif à répondre à des messages de locataires potentiels écrits en style Marketplace ou québécois oral.\n\nTu reçois :\n- La réponse à la question logement (si applicable)\n- La prochaine question à poser pour qualifier le candidat\n- L'historique récent de la conversation\n- L'état du dossier (ce qui est déjà connu)\n\nTu dois rédiger UNE réponse courte, naturelle et humaine qui :\n1. Répond d'abord à la question du locataire si une réponse est fournie\n2. Pose ensuite UNE SEULE question pour faire avancer le dossier\n\nRègles absolues :\n- Maximum 3 à 4 phrases au total\n- Ton direct, simple, humain — jamais formel ni robotique\n- Jamais de \"Je peux vérifier\", \"Si cela vous intéresse\", \"Voulez-vous plus de détails\", \"N'hésitez pas\"\n- Si la réponse logement est fournie : l'utiliser directement et clairement\n- Si la réponse logement est vide ou inconnue : ne rien inventer, rester prudent et naturel\n- Une seule question à la fin, jamais une liste\n- Ne pas répéter l'information que le locataire vient de donner\n- Sonner comme un vrai employé qui répond vite entre deux dossiers"
        },
        {
          role: "user",
          content: [
            `Réponse à la question logement : ${String(answerLine || "").trim() || "aucune"}`,
            `Prochaine question à poser : ${String(nextQuestion || "").trim() || "aucune"}`,
            `Traduction du message du locataire : ${String(extraction?.translation || "").trim() || "aucune"}`,
            `Dernière question posée : ${STEP_LABELS[threadState?.last_asked_step] || "aucune"}`,
            `Historique récent : ${summarizeTranslatorConversationEntries(conversationEntries)}`,
            `État du dossier connu : ${JSON.stringify({
              listing_ref: String(listing?.ref || threadState?.listing_ref || "").trim(),
              current_step: String(threadState?.current_step || "").trim() || null,
              known_fields: Object.fromEntries(
                Object.entries(threadState?.qualification || {})
                  .filter(([, value]) => value?.known)
                  .map(([key, value]) => [key, value?.value ?? null])
              )
            })}`
          ].join("\n")
        }
      ]
    });

    return response.choices?.[0]?.message?.content?.trim() || null;
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
    generateTranslatorReply,
    streamListingReply
  };
}
