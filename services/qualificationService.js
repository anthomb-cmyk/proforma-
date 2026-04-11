function getThreadFieldValue(threadState, fieldKey) {
  return threadState?.qualification?.[fieldKey]?.value ?? null;
}

function isThreadFieldKnown(threadState, fieldKey) {
  return Boolean(threadState?.qualification?.[fieldKey]?.known);
}

function buildCandidateFromThreadState(threadState) {
  return {
    apartment_ref: String(threadState?.listing_ref || "").replace(/^L-/i, ""),
    monthly_income: getThreadFieldValue(threadState, "income"),
    credit_level: getThreadFieldValue(threadState, "credit"),
    tal_record: getThreadFieldValue(threadState, "tal"),
    occupants_total: getThreadFieldValue(threadState, "occupants_total"),
    pets: getThreadFieldValue(threadState, "has_animals"),
    employment_status: getThreadFieldValue(threadState, "employment_status"),
    employer_name: getThreadFieldValue(threadState, "employer"),
    employment_length: getThreadFieldValue(threadState, "employment_duration"),
    candidate_name: getThreadFieldValue(threadState, "full_name"),
    phone: getThreadFieldValue(threadState, "phone"),
    email: getThreadFieldValue(threadState, "email"),
    move_in_date: getThreadFieldValue(threadState, "move_in_date"),
    animal_type: getThreadFieldValue(threadState, "animal_type")
  };
}

function normalizeReason(value) {
  return String(value || "").trim().toLowerCase();
}

function pickBlockingReasons(reasons = []) {
  return reasons.filter((reason) => {
    const normalized = normalizeReason(reason);
    return (
      normalized.includes("insuffisant") ||
      normalized.includes("faible") ||
      normalized.includes("défavorable") ||
      normalized.includes("defavorable") ||
      normalized.includes("non accepté") ||
      normalized.includes("non accepte") ||
      normalized.includes("trop d’occupants") ||
      normalized.includes("trop doccupants") ||
      normalized.includes("non compatible")
    );
  });
}

function buildRentDistance(listing, incomeValue) {
  const rent = Number(String(listing?.loyer ?? listing?.rent ?? "").replace(/[^\d.-]/g, ""));
  const income = Number(String(incomeValue ?? "").replace(/[^\d.-]/g, ""));

  if (!Number.isFinite(rent) || !rent || !Number.isFinite(income) || !income) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.abs((income / 3) - rent);
}

export function createQualificationService({
  loadListingsMap,
  loadClientsMap,
  evaluateMatch,
  isListingRelevantForMatching,
  normalizeRef
}) {
  async function evaluateTenantEligibility(threadState, listing) {
    if (!threadState || !listing) {
      return {
        eligible: false,
        confidence: "low",
        blocking_reasons: [],
        missing_fields: ["move_in_date", "occupants_total", "has_animals", "employment_status", "income", "credit", "tal"],
        status: "incomplete"
      };
    }

    const clients = await loadClientsMap();
    const client = listing.client_id ? clients[String(listing.client_id)] || null : null;
    const criteria = client?.criteres || null;
    const candidate = buildCandidateFromThreadState(threadState);
    const result = evaluateMatch(listing, candidate, criteria);
    const missingFields = [
      "move_in_date",
      "occupants_total",
      "has_animals",
      "employment_status",
      "income",
      "credit",
      "tal",
      "full_name",
      "phone",
      "email"
    ].filter((fieldKey) => !isThreadFieldKnown(threadState, fieldKey));
    const blockingReasons = pickBlockingReasons(result?.reasons || []);
    const criticalFieldsKnown = ["employment_status", "income", "credit", "tal", "has_animals", "occupants_total"]
      .some((fieldKey) => isThreadFieldKnown(threadState, fieldKey));

    if (blockingReasons.length && !criticalFieldsKnown) {
      return {
        eligible: false,
        confidence: "low",
        blocking_reasons: [],
        missing_fields: missingFields,
        status: "incomplete"
      };
    }

    if (blockingReasons.length) {
      return {
        eligible: false,
        confidence: missingFields.length ? "medium" : "high",
        blocking_reasons: blockingReasons,
        missing_fields: missingFields,
        status: "refused"
      };
    }

    if (missingFields.length) {
      return {
        eligible: false,
        confidence: missingFields.length >= 3 ? "low" : "medium",
        blocking_reasons: [],
        missing_fields: missingFields,
        status: "incomplete"
      };
    }

    return {
      eligible: true,
      confidence: "high",
      blocking_reasons: [],
      missing_fields: [],
      status: "eligible"
    };
  }

  async function findMatchingListings(threadState, options = {}) {
    const listings = await loadListingsMap();
    const clients = await loadClientsMap();
    const currentRef = normalizeRef(options?.excludeRef || threadState?.listing_ref || "");
    const candidate = buildCandidateFromThreadState(threadState);

    return Object.values(listings)
      .filter((listing) => normalizeRef(listing.ref) !== currentRef)
      .filter((listing) => isListingRelevantForMatching(listing))
      .map((listing) => {
        const client = listing.client_id ? clients[String(listing.client_id)] || null : null;
        const criteria = client?.criteres || null;
        const result = evaluateMatch(listing, candidate, criteria);

        return {
          ref: `L-${normalizeRef(listing.ref)}`,
          address: listing.adresse || listing.address || "",
          city: listing.ville || listing.city || "",
          rent: listing.loyer ?? listing.rent ?? null,
          match_score: result.score,
          match_status: result.status,
          reasons: result.reasons
        };
      })
      .filter((listing) => listing.match_status !== "refusé")
      .sort((left, right) => {
        if (right.match_score !== left.match_score) {
          return right.match_score - left.match_score;
        }

        return buildRentDistance(left, candidate.monthly_income) - buildRentDistance(right, candidate.monthly_income);
      })
      .slice(0, Math.max(1, Number(options?.limit) || 3));
  }

  function getVisitRequirements(threadState, evaluation = null) {
    const requiredFields = ["move_in_date", "occupants_total", "has_animals", "full_name", "phone"];
    const missingFields = requiredFields.filter((fieldKey) => !isThreadFieldKnown(threadState, fieldKey));
    const ready = Boolean(evaluation?.eligible) && missingFields.length === 0;

    return {
      required_fields: requiredFields,
      missing_fields: missingFields,
      ready
    };
  }

  return {
    evaluateTenantEligibility,
    findMatchingListings,
    getVisitRequirements
  };
}
