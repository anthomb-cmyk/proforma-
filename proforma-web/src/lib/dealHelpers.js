// Pure helpers for constructing and labeling deal/lead records.
// Kept free of React so they can be unit-tested.

import { STAGES, CHECKLISTS } from "./stages.js";
import { normalizeTextKey, normalizePhoneKey, mergePhoneLists } from "./phoneUtils.js";

export function buildCL(stageId) {
  return (CHECKLISTS[stageId] || []).map((label, i) => ({
    id: `${stageId}_${i}`,
    label,
    done: false,
  }));
}

export function createDeal(title, address = "", coords = null, units = "", askingPrice = "") {
  const now = Date.now();
  return {
    id: `acq_${now}_${Math.random().toString(36).slice(2, 7)}`,
    title: title || "Nouveau deal",
    address: address || "",
    coords: coords || null,
    units: units || "",
    askingPrice: askingPrice || "",
    stage: "prospection",
    priority: "medium",
    createdAt: now,
    updatedAt: now,
    followUpDate: "",
    followUpNote: "",
    nextAction: "",
    contact: { name: "", phone: "", email: "", company: "", role: "" },
    notesDeal: "",
    notesVendeur: "",
    aiDeal: "",
    aiVendeur: "",
    files: [],
    activities: [],
    events: [],
    checklists: { prospection: buildCL("prospection") },
  };
}

export function dealLabel(d) {
  let label = d?.title || "Sans titre";
  if (d?.units) label += ` • ${d.units} unités`;
  if (d?.askingPrice) {
    const n = Number(d.askingPrice);
    const formatted = isNaN(n) ? d.askingPrice : n.toLocaleString("en-CA");
    label += ` • ${formatted} $`;
  }
  return label;
}

// Accepts a persisted deal and returns a version with coords normalized
// (strings → numbers, invalid values → null). Called on every load() so
// legacy/imported rows get a consistent shape.
export function normalizeDeal(d) {
  const lat = Number(d?.coords?.lat);
  const lng = Number(d?.coords?.lng);
  return {
    ...d,
    address: d?.address || "",
    coords: Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null,
  };
}

export function stageColor(stageId) {
  return STAGES.find((s) => s.id === stageId)?.color || "#6B7280";
}

// Deterministic identity key for a lead row, used to de-dupe leads that
// arrive from different import sources (PhoneFinder export vs manual Excel).
// Falls back to a phone hash when there's no company/address/contact.
export function buildLeadIdentityKey(item = {}) {
  const company = normalizeTextKey(item.companyName || item.inputName || item.matchedName || "");
  const address = normalizeTextKey(item.buildingAddress || item.inputAddress || item.matchedAddress || item.address || "");
  const contact = normalizeTextKey(item.contactName || item.leadContact || "");
  if (!company && !address && !contact) {
    const phone = normalizePhoneKey((item.phones || [])[0] || item.phone || "");
    return phone ? `p:${phone}` : "";
  }
  return `c:${company}|a:${address}|ct:${contact}`;
}

export function getLeadPhones(lead) {
  return mergePhoneLists(lead?.phones || [], lead?.phone, lead?.originalPhone);
}
