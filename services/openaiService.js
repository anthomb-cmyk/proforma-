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

  return history.slice(-maxMessages).map((entry) => {
    if (entry?.role && entry?.content) {
      return {
        role: String(entry.role).trim(),
        content: String(entry.content).trim()
      };
    }

    const sections = Array.isArray(entry?.sections)
      ? entry.sections.slice(0, 4).map((section) => ({
          title: String(section?.title || "").trim(),
          text: String(section?.text || "").trim()
        }))
      : [];

    const content = [
      String(entry?.text || "").trim(),
      ...sections.map((section) => `${section.title ? `${section.title} : ` : ""}${section.text}`.trim())
    ]
      .filter(Boolean)
      .join("\n");

    return {
      role: String(entry?.sender || "").trim().toLowerCase() === "assistant" ? "assistant" : "user",
      content
    };
  }).filter((entry) => entry.role && entry.content);
}

function buildTranslatorKnownFieldsSummary(threadState) {
  const knownFields = Object.entries(threadState?.qualification || {})
    .filter(([, value]) => value?.known)
    .map(([key, value]) => `${key}: ${String(value?.value ?? "").trim()}`)
    .filter(Boolean);

  return knownFields.length ? knownFields.join("\n") : "Aucune information connue pour le moment.";
}

function buildTranslatorListingSummary(listing) {
  if (!listing) {
    return "Aucun logement sélectionné";
  }

  return JSON.stringify({
    ref: String(listing.ref || "").trim(),
    adresse: String(listing.adresse || listing.address || "").trim(),
    ville: String(listing.ville || listing.city || "").trim(),
    loyer: listing.loyer ?? listing.rent ?? null,
    disponibilite: String(listing.disponibilite || listing.availability || "").trim(),
    inclusions: String(listing.inclusions || "").trim(),
    animaux_acceptes: String(listing.animaux_acceptes || "").trim(),
    stationnement: String(listing.stationnement || "").trim(),
    electricite: String(listing.electricite || "").trim(),
    notes: String(listing.notes || "").trim(),
    description: String(listing.description || "").trim()
  }, null, 2);
}

function detectFieldsInMessage(message) {
  const msg = String(message || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const detected = new Set();

  if (/\b(1er|\d{1,2})\s*(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\b/.test(msg)) {
    detected.add("move_in_date");
  }

  if (/\b(on va etre|on sera|on est|nous sommes|je suis seul|seule|\d+\s*personne)/.test(msg)) {
    detected.add("occupants_total");
  }

  if (/\b(chien|chat|animal|animaux|chiot|pitou|minou|perroquet|lapin|cochon d.inde)\b/.test(msg)) {
    detected.add("has_animals");
    detected.add("animal_type");
  }
  if (/\bpas d.animaux\b|\bsans animaux\b|\baucun animal\b/.test(msg)) {
    detected.add("has_animals");
  }

  if (/\b(je travaille|travail|emploi|employe|temps plein|temps partiel|autonome|retraite|etudiant|sans emploi)\b/.test(msg)) {
    detected.add("employment_status");
  }

  if (/\b(\d+\s*k|\d+\s*000|revenu|salaire|\d+\s*\/\s*mois|par mois)\b/.test(msg)) {
    detected.add("income");
  }

  return detected;
}

function buildTranslatorSystemPrompt({ threadState, listing, currentMessage = "" }) {
  const knownFields = buildTranslatorKnownFieldsSummary(threadState);
  const listingSummary = buildTranslatorListingSummary(listing);

  const fieldsInCurrentMessage = detectFieldsInMessage(currentMessage);

  const stepOrder = [
    "move_in_date", "occupants_total", "has_animals", "animal_type",
    "employment_status", "employer", "employment_duration",
    "income", "credit", "tal", "full_name", "phone", "email"
  ];

  const knownSet = new Set(
    Object.entries(threadState?.qualification || {})
      .filter(([, v]) => v?.known)
      .map(([k]) => k)
  );
  for (const f of fieldsInCurrentMessage) knownSet.add(f);

  let nextStep = null;
  for (const step of stepOrder) {
    if (step === "animal_type") {
      const hasAnimals = knownSet.has("has_animals") &&
        (threadState?.qualification?.has_animals?.value === true ||
         fieldsInCurrentMessage.has("has_animals"));
      if (!hasAnimals) continue;
    }
    if (!knownSet.has(step)) {
      nextStep = step;
      break;
    }
  }

  const nextStepLabels = {
    move_in_date: "Quand souhaitez-vous emménager ?",
    occupants_total: "Vous seriez combien à habiter le logement ?",
    has_animals: "Avez-vous des animaux ?",
    animal_type: "Quel type d'animal avez-vous ?",
    employment_status: "Quelle est votre situation d'emploi ?",
    employer: "Chez quel employeur travaillez-vous ?",
    employment_duration: "Depuis combien de temps occupez-vous cet emploi ?",
    income: "Quel est votre revenu mensuel approximatif ?",
    credit: "Comment est votre situation de crédit ?",
    tal: "Avez-vous eu des problèmes au TAL ou avec un propriétaire précédent ?",
    full_name: "Quel est votre nom complet ?",
    phone: "Quel est votre numéro de téléphone ?",
    email: "Quelle est votre adresse courriel ?"
  };

  const prochainQuestion = nextStep ? (nextStepLabels[nextStep] || null) : null;

  return [
    "Tu es un assistant interne qui aide un employé locatif à répondre à des messages de locataires potentiels.",
    "",
    "TON RÔLE :",
    "1. Comprendre le message du locataire même s'il est mal écrit (fautes, québécois, Marketplace, abréviations)",
    "2. Le reformuler en français international clair dans \"translation\"",
    "3. Proposer une réponse courte et naturelle dans \"reply\"",
    "4. Extraire toute information utile dans \"extracted_fields\"",
    "5. Indiquer si une visite a été demandée dans \"visit_requested\"",
    "6. Identifier le type de question logement dans \"listing_question\" si applicable",
    "",
    "RÈGLES DE RÉPONSE :",
    "- Maximum 2-3 phrases — court et direct",
    "- Ton naturel, humain — jamais formel ni robotique",
    "- INTERDIT : \"Avez-vous d'autres questions ?\", \"N'hésitez pas\", \"Merci pour l'information\", \"Je peux vérifier\"",
    "- Répondre D'ABORD à la question du locataire si applicable, ENSUITE poser UNE SEULE question de qualification",
    "- Ne jamais poser plus d'une question à la fois",
    "- Ne jamais redemander une information déjà présente dans le message actuel ou le dossier",
    "- Les infos données par le locataire dans son message sont extraites silencieusement — ne pas les confirmer verbalement",
    prochainQuestion
      ? `- PROCHAINE QUESTION OBLIGATOIRE à poser à la fin de la réponse : "${prochainQuestion}"`
      : "- Dossier complet — pas de question à poser",
    "",
    "EXEMPLES DE BONNES RÉPONSES :",
    "Message: \"1 mai je peu tu amener mon chien\" → Bonne réponse: \"Oui les animaux sont acceptés. Quelle est votre situation d'emploi ?\"",
    "  (move_in_date et has_animals extraits silencieusement, on passe directement à employment_status)",
    "Message: \"il atu de lelectriciter\" → Bonne réponse: \"Oui l'électricité est incluse. Vous seriez combien à habiter le logement ?\"",
    "Message: \"cest tu inclus lelectriciter? on va etre 4 personnes\" → Bonne réponse: \"L'électricité n'est pas incluse dans le loyer. Quelle est votre situation d'emploi ?\"",
    "  (occupants_total: 4 extrait silencieusement, on passe à employment_status)",
    "",
    "EXEMPLES DE MESSAGES RÉELS À RECONNAÎTRE :",
    "\"stu dispo\" → question de disponibilité",
    "\"cé tu encore a louer\" → question de disponibilité",
    "\"le 1 mai je peux tu amener mon chat\" → move_in_date: \"1er mai\" ET has_animals: true",
    "\"ouais ces correct\" après un refus → confirmation, le locataire continue",
    "\"4\" après \"combien d'occupants\" → occupants_total: 4",
    "\"demain il a tu de l'électricité\" → question sur l'électricité (\"demain\" = référence à la question, PAS une date d'emménagement)",
    "\"je travaille au tim\" → employer: \"Tim Hortons\", employment_status: \"temps plein\" probable",
    "\"jai un petit chien propre\" → has_animals: true, animal_type: \"chien\"",
    "\"asap\" ou \"le plus vite possible\" → NE PAS extraire comme move_in_date précise",
    "",
    "RÈGLES D'EXTRACTION CRITIQUES :",
    "- Une date précise (1er mai, 15 juin, début juillet) = move_in_date même si le message contient autre chose",
    "- \"demain\", \"ce soir\", \"cette semaine\" seul sans date = NE PAS extraire comme move_in_date",
    "- Si le message contient une question logement (électricité, animaux, stationnement, inclusions), ignorer les mots temporels vagues pour move_in_date",
    "- Extraire TOUS les champs présents dans un même message, pas juste un",
    "- null = information absente du message (pas false, pas 0)",
    "",
    "RÈGLES SUR LES INFOS LOGEMENT :",
    "- Si l'info est dans la fiche ci-dessous : répondre directement et clairement",
    "- Si l'info n'est pas dans la fiche : ne pas inventer, dire qu'on va vérifier",
    "- Ne jamais inventer une information sur le logement",
    "",
    "FORMAT DE SORTIE JSON OBLIGATOIRE :",
    JSON.stringify({
      translation: "reformulation en français international",
      reply: "réponse suggérée naturelle",
      extracted_fields: {
        move_in_date: null, occupants_total: null, has_animals: null,
        animal_type: null, employment_status: null, employer: null,
        employment_duration: null, income: null, credit: null,
        tal: null, full_name: null, phone: null, email: null
      },
      next_step: null,
      visit_requested: false,
      listing_question: null
    }),
    "",
    "ÉTAT DU DOSSIER ACTUEL (ne jamais redemander ces infos) :",
    knownFields,
    "",
    nextStep
      ? `PROCHAIN CHAMP À OBTENIR : ${nextStep}`
      : "DOSSIER COMPLET — toutes les informations sont connues",
    "",
    "LOGEMENT SÉLECTIONNÉ :",
    listingSummary
  ].join("\n");
}

function normalizeTranslatorResponsePayload(payload = {}) {
  const extracted = payload?.extracted_fields && typeof payload.extracted_fields === "object" && !Array.isArray(payload.extracted_fields)
    ? payload.extracted_fields
    : {};

  return {
    translation: String(payload?.translation || "").trim(),
    reply: String(payload?.reply || "").trim(),
    extracted_fields: {
      move_in_date: extracted.move_in_date ?? null,
      occupants_total: extracted.occupants_total ?? null,
      has_animals: extracted.has_animals ?? null,
      animal_type: extracted.animal_type ?? null,
      employment_status: extracted.employment_status ?? null,
      employer: extracted.employer ?? null,
      employment_duration: extracted.employment_duration ?? null,
      income: extracted.income ?? null,
      credit: extracted.credit ?? null,
      tal: extracted.tal ?? null,
      full_name: extracted.full_name ?? null,
      phone: extracted.phone ?? null,
      email: extracted.email ?? null
    },
    next_step: payload?.next_step ?? null,
    visit_requested: Boolean(payload?.visit_requested),
    listing_question: payload?.listing_question ?? null
  };
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
            "Tu es un extracteur structuré pour un assistant conversationnel locatif interne.\nTu analyses le message d'un locataire potentiel et tu retournes uniquement un objet JSON valide.\n\nChamps autorisés : translation, message_type, listing_question_type, provided_fields, answers_previous_step, confidence.\n\nRègles :\n- translation : reformule le message en français international, court, clair, fidèle au sens réel\n- message_type : listing_question | qualification_answer | mixed | general\n- listing_question_type : availability | price | electricity | heating | inclusions | appliances | pets | parking | location | deposit | visit | none\n- provided_fields : extrait uniquement les champs clairement présents dans le message. Clés autorisées : move_in_date, occupants_total, has_animals, animal_type, employment_status, employer, employment_duration, income, credit, tal, full_name, phone, email\n- answers_previous_step : true si le message répond à la dernière question posée\n- confidence : nombre entre 0 et 1\n\nComportement critique :\n- Si le message est court (ex: \"4\", \"oui\", \"non\", \"le 1er\"), l'interpréter selon la dernière question posée fournie en contexte\n- Si le message contient à la fois une réponse et une nouvelle question, extraire les deux\n- Être robuste aux fautes, québécismes, abréviations, messages Marketplace\n- Ne jamais inventer d'information sur le logement\n\nRÈGLE CRITIQUE sur move_in_date :\n- Si le message contient une question sur le logement (électricité, chauffage, animaux, stationnement, électros, visite, prix), NE PAS extraire \"demain\", \"ce soir\", \"cette semaine\" comme move_in_date\n- Ces mots temporels dans ce contexte font référence à la question posée, pas à une date d'emménagement\n- N'extraire move_in_date que si le locataire exprime clairement QUAND il veut emménager, sans autre contexte de question logement dans le même message"
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
            `\nType de question logement détecté par le déterministe : ${options?.deterministicExtraction?.listing_question_type || "none"}`,
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

  async function generateTranslatorResponse({
    message,
    conversationHistory,
    threadState,
    listing
  } = {}) {
    if (!openaiClient) {
      return null;
    }

    const messages = [
      {
        role: "system",
        content: buildTranslatorSystemPrompt({ threadState, listing, currentMessage: message })
      },
      ...truncateConversationHistory(conversationHistory, 40).map((entry) => ({
        role: entry.role === "assistant" ? "assistant" : "user",
        content: entry.content
      })),
      {
        role: "user",
        content: String(message || "").trim()
      }
    ];

    const response = await openaiClient.chat.completions.create({
      model: translatorModel,
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages
    });

    const content = response.choices?.[0]?.message?.content?.trim();

    if (!content) {
      return null;
    }

    try {
      return normalizeTranslatorResponsePayload(JSON.parse(content));
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
    generateTranslatorResponse,
    generateTranslatorReply,
    streamListingReply
  };
}
