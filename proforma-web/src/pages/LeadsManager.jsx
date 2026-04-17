// Extracted from App.js as part of the page-level split.
// Keeps all its internal helpers (parseCSV, parseSpreadsheet, updateLead,
// markCallNow, etc.) private to this module — they were always scoped to
// the component body.
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { FixedSizeList as VirtualList } from "react-window";
import {
  mergePhoneLists,
  extractPhonesFromRow,
} from "../lib/phoneUtils.js";
import { buildLeadIdentityKey, getLeadPhones } from "../lib/dealHelpers.js";
import { firstBusinessLookupName } from "../lib/businessName.js";
import LeadFiche from "../components/LeadFiche.jsx";
import LeadListRow, { LEAD_ROW_HEIGHT } from "../components/LeadListRow.jsx";

// Batch size for the POST /api/phone-lookup call when enriching imported
// leads — keeps requests under the proxy/timeout ceiling.
const LEAD_BATCH_SIZE = 10;

function LeadsManager({ leads, setLeads, onCreateDealFromLead }) {
  const [importFile, setImportFile] = useState(null);
  const [colMap, setColMap] = useState({});
  const [showColMap, setShowColMap] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importProgress, setImportProgress] = useState(null);
  const [importError, setImportError] = useState("");
  const [toast, setToast] = useState("");
  const [filter, setFilter] = useState({ status:"all", search:"", phone:"all", source:"all", linked:"all", call:"all", city:"all", units:"all" });
  const [selectedLeadId, setSelectedLeadId] = useState(null);
  // Tab toggle: "list" shows filters + virtualized lead list, "import" shows
  // the CSV/XLSX dropzone. Matches the PhoneFinder tab pattern so the two
  // pages feel consistent.
  const [leadTab, setLeadTab] = useState("list");

  const STAGE_CFG = {
    new: { label:"Nouveau", cls:"multiple_matches" },
    to_call: { label:"À appeler", cls:"needs_review" },
    contacted: { label:"Contacté", cls:"found" },
    qualified: { label:"Qualifié", cls:"found" },
    converted: { label:"Converti", cls:"found" },
    lost: { label:"Fermé", cls:"not_found" },
  };

  const CALL_STATUS_CFG = {
    none: "Non appelé",
    tried: "Tentative",
    voicemail: "Boîte vocale",
    reached: "Contact établi",
    callback: "Rappeler",
    invalid: "Numéro invalide",
  };

  // Page-reset effect was needed when we did client-side pagination with a
  // "+ de plus" button. The virtualized list renders the full filter result,
  // so there's no page cursor to reset.

  function normalizeHeader(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function parseCSV(text) {
    const lines = String(text || "").trim().split(/\r?\n/);
    if (!lines.length) return { headers:[], rows:[] };
    const first = lines[0];
    const counts = { ",": (first.match(/,/g)||[]).length, ";": (first.match(/;/g)||[]).length, "\t": (first.match(/\t/g)||[]).length };
    const delim = counts[";"] >= counts[","] && counts[";"] >= counts["\t"] ? ";"
                : counts["\t"] >= counts[","] ? "\t"
                : ",";
    const parseLine = line => {
      const res = []; let cur = ""; let inQ = false;
      for (const c of line) {
        if (c === "\"") { inQ = !inQ; continue; }
        if (c === delim && !inQ) { res.push(cur.trim()); cur = ""; continue; }
        cur += c;
      }
      res.push(cur.trim());
      return res;
    };
    const headers = parseLine(lines[0]);
    const rows = lines.slice(1)
      .filter(l => l.trim())
      .map(l => {
        const vals = parseLine(l);
        return Object.fromEntries(headers.map((h, i) => [h, vals[i] || ""]));
      });
    return { headers, rows, delim };
  }

  function parseSpreadsheet(file) {
    return new Promise((resolve, reject) => {
      const XLSX = window.XLSX;
      if (!XLSX) { reject(new Error("Module Excel non chargé.")); return; }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Impossible de lire le fichier."));
      reader.onload = e => {
        try {
          const wb = XLSX.read(e.target.result, { type: "array" });
          const firstSheet = wb.SheetNames[0];
          if (!firstSheet) throw new Error("Aucune feuille trouvée.");
          const matrix = XLSX.utils.sheet_to_json(wb.Sheets[firstSheet], { header: 1, defval: "" });
          if (!Array.isArray(matrix) || !matrix.length) throw new Error("Le fichier est vide.");
          const rawHeaders = Array.isArray(matrix[0]) ? matrix[0] : [];
          const dedupe = {};
          const headers = rawHeaders.map((h, i) => {
            let base = String(h || `Colonne ${i + 1}`).trim();
            if (!base) base = `Colonne ${i + 1}`;
            const seen = dedupe[base] || 0;
            dedupe[base] = seen + 1;
            return seen ? `${base} (${seen + 1})` : base;
          });
          const rows = matrix
            .slice(1)
            .map(vals => Object.fromEntries(headers.map((h, i) => [h, String(vals?.[i] ?? "").trim()])))
            .filter(row => Object.values(row).some(v => String(v).trim()));
          resolve({ headers, rows, delim: `XLSX · ${firstSheet}` });
        } catch (err) {
          reject(err);
        }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  function isSpreadsheetFile(file) {
    const name = String(file?.name || "").toLowerCase();
    const type = String(file?.type || "").toLowerCase();
    return /\.xlsx?$/.test(name) || type.includes("spreadsheetml") || type.includes("excel");
  }

  function pickValue(row, col) {
    if (!col) return "";
    return String(row?.[col] || "").trim();
  }

  function autoDetectCols(headers) {
    const map = {};
    const normalized = headers.map(h => ({ raw: h, norm: normalizeHeader(h) }));
    const used = new Set();
    const findHeader = (patterns) => {
      const match = normalized.find(({ raw, norm }) => !used.has(raw) && patterns.some(rx => rx.test(norm)));
      if (!match) return "";
      used.add(match.raw);
      return match.raw;
    };
    const patterns = {
      buildingAddress: [/\badresse immeuble\b/, /\badresse\b/, /\baddress\b/, /\bstreet\b/, /\brue\b/],
      city: [/\bville immeuble\b/, /\bville\b/, /\bcity\b/],
      province: [/\bprovince\b/, /\betat\b/, /\bstate\b/],
      postalCode: [/\bcode postal immeuble\b/, /\bcode postal\b/, /\bpostal\b/, /\bzip\b/],
      country: [/\bpays\b/, /\bcountry\b/],
      companyName: [/\bcompany\b/, /\bentreprise\b/, /\bcompagnie\b/, /\borganisation\b/, /\braison sociale\b/],
      contactName: [/\bnom complet\b/, /\bproprietaire\b/, /\bcontact\b/, /\bnom\b/, /\bowner\b/],
      email: [/\bemail\b/, /\bcourriel\b/, /\bmail\b/],
      phone: [/\btelephone\b/, /\bphone\b/, /\bcell\b/, /\bmobile\b/],
      notes: [/\bnotes?\b/, /\bcomment\b/, /\bremarque\b/],
      units:       [/\bnombre.*logement/, /\bnb.*logement/, /\bnb.*unit/, /\bnombre.*unit/, /\bnb log/, /\blogement/, /\bunite/, /\bunit[eé]s?\b/],
      utilisation: [/\butilisation/, /\busage pr[eé]dominant/, /\bproperty.?type\b/, /\btype.*immeuble\b/, /\bzoning\b/],
      assessment:  [/\bvaleur.*fonciere\b/, /\bvaleur.*immeuble\b/, /\b[eé]valuation\b/, /\bvaleur.*totale\b/, /\bassess/, /\bvaleur\b/],
      yearBuilt:   [/\ann[eé]e.*construction\b/, /\bconstruction.*an\b/, /\byear.*built\b/, /\bbuilt\b/, /\bconstruit\b/],
      lotArea:     [/\bsuperficie.*terrain\b/, /\bsuperficie.*lot\b/, /\blot.*area\b/, /\bterrain.*m2\b/, /\bsuperficie\b/],
    };
    for (const key of ["buildingAddress", "city", "province", "postalCode", "country", "companyName", "contactName", "email", "phone", "notes", "units", "utilisation", "assessment", "yearBuilt", "lotArea"]) {
      const found = findHeader(patterns[key]);
      if (found) map[key] = found;
    }
    return map;
  }

  async function handleImportFile(file) {
    if (!file) return;
    setImportError("");
    try {
      let parsed;
      if (isSpreadsheetFile(file)) {
        parsed = await parseSpreadsheet(file);
      } else {
        const text = await file.text();
        parsed = parseCSV(text);
      }
      if (!parsed?.rows?.length) {
        setImportError("Le fichier ne contient pas de lignes importables.");
        return;
      }
      setImportFile({ ...parsed, fileName: file.name });
      setColMap(autoDetectCols(parsed.headers || []));
      setShowColMap(false);
    } catch (err) {
      setImportError(`Import impossible: ${String(err?.message || err)}`);
    }
  }

  function pickImportFile() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel";
    input.onchange = e => { if (e.target.files[0]) handleImportFile(e.target.files[0]); };
    input.click();
  }

  async function importLeads() {
    if (!importFile?.rows?.length) return;
    const prepared = importFile.rows.map(row => {
      const companyName = pickValue(row, colMap.companyName);
      const contactName = pickValue(row, colMap.contactName);
      const address = pickValue(row, colMap.buildingAddress);
      const city = pickValue(row, colMap.city);
      const province = pickValue(row, colMap.province);
      const postalCode = pickValue(row, colMap.postalCode);
      const country = pickValue(row, colMap.country) || "Canada";
      const email = pickValue(row, colMap.email);
      const phone = pickValue(row, colMap.phone);
      const notes = pickValue(row, colMap.notes);
      const unitsRaw    = pickValue(row, colMap.units);
      const units       = unitsRaw ? (parseInt(unitsRaw, 10) || 0) : 0;
      const utilisation = pickValue(row, colMap.utilisation);
      const assessment  = pickValue(row, colMap.assessment);
      const yearBuilt   = pickValue(row, colMap.yearBuilt);
      const lotArea     = pickValue(row, colMap.lotArea);
      const buildingAddress = [address, city, province, postalCode].filter(Boolean).join(", ");
      const lookupName = firstBusinessLookupName(companyName);
      const inputPhones = mergePhoneLists(phone, extractPhonesFromRow(row));
      return { companyName, contactName, address, city, province, postalCode, country, email, phone, inputPhones, notes, units, utilisation, assessment, yearBuilt, lotArea, buildingAddress, lookupName, rawRow: row };
    }).filter(item => Object.values(item.rawRow || {}).some(v => String(v ?? "").trim()));

    if (!prepared.length) {
      setImportError("Aucune ligne exploitable après mappage.");
      return;
    }

    setImportBusy(true);
    setImportError("");
    setImportProgress({ done: 0, total: prepared.length });

    let imported = [];
    let done = 0;
    let lookupErrorShown = false;

    for (let i = 0; i < prepared.length; i += LEAD_BATCH_SIZE) {
      const batch = prepared.slice(i, i + LEAD_BATCH_SIZE);
      let lookupResults = [];
      try {
        const lookupRows = batch.map(item => ({
          name: item.lookupName,
          address: item.address,
          city: item.city,
          province: item.province,
          postalCode: item.postalCode,
          country: item.country || "Canada",
          companyName: item.companyName,
          contactName: item.contactName,
          buildingAddress: item.buildingAddress,
          rawRow: item.rawRow,
        }));
        const resp = await fetch("/api/phone-lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: lookupRows }),
        });
        const data = await resp.json();
        if (data?.ok && Array.isArray(data.results)) {
          lookupResults = data.results;
        } else if (!lookupErrorShown) {
          lookupErrorShown = true;
          setImportError(data?.error ? `Enrichissement partiel: ${data.error}` : "Enrichissement partiel: service indisponible.");
        }
      } catch {
        if (!lookupErrorShown) {
          lookupErrorShown = true;
          setImportError("Enrichissement partiel: impossible de joindre le service de lookup.");
        }
      }

      const nowIso = new Date().toISOString();
      const mapped = batch.map((item, idx) => {
        const looked = lookupResults[idx] || {};
        const mergedPhones = mergePhoneLists(item.inputPhones, looked.inputPhones, looked.phone);
        const resolvedPhone = mergedPhones[0] || "";
        const linkedStatus = looked.status || (mergedPhones.length ? "found" : "not_found");
        return {
          id: `lead_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          createdAt: nowIso,
          updatedAt: Date.now(),
          stage: mergedPhones.length ? "to_call" : "new",
          companyName: item.companyName || looked.inputName || looked.matchedName || "",
          contactName: item.contactName || "",
          buildingAddress: item.buildingAddress || looked.inputAddress || looked.matchedAddress || "",
          city: item.city || "",
          province: item.province || "",
          postalCode: item.postalCode || "",
          country: item.country || "Canada",
          email: item.email || "",
          phone: resolvedPhone,
          phones: mergedPhones,
          originalPhone: item.inputPhones[0] || "",
          notes: item.notes || "",
          units:       item.units || 0,
          utilisation: item.utilisation || "",
          assessment:  item.assessment || "",
          yearBuilt:   item.yearBuilt || "",
          lotArea:     item.lotArea || "",
          sourceFile: importFile.fileName || "",
          matchedName: looked.matchedName || "",
          matchedAddress: looked.matchedAddress || "",
          confidence: Number(looked.confidence || 0),
          lookupStatus: linkedStatus,
          website: looked.website || "",
          linkedDealId: "",
        };
      });

      imported = [...imported, ...mapped];
      done += batch.length;
      setImportProgress({ done, total: prepared.length });
    }

    setImportBusy(false);
    setImportProgress(null);

    if (!imported.length) {
      setImportError("Aucun lead n'a été importé.");
      return;
    }

    let addedCount = 0;
    let updatedCount = 0;
    let unchangedCount = 0;
    const now = Date.now();
    const current = (Array.isArray(leads) ? leads : []).map(lead => {
      const phones = getLeadPhones(lead);
      return { ...lead, phones, phone: phones[0] || "", updatedAt: lead.updatedAt || now };
    });
    const byKey = new Map();
    current.forEach(lead => {
      const key = buildLeadIdentityKey(lead);
      if (key && !byKey.has(key)) byKey.set(key, lead);
    });
    const additions = [];

    for (const incomingRaw of imported) {
      const incoming = { ...incomingRaw, phones: getLeadPhones(incomingRaw) };
      const key = buildLeadIdentityKey(incoming);
      const existing = key ? byKey.get(key) : null;
      if (!existing) {
        additions.push({ ...incoming, phone: incoming.phones[0] || incoming.phone || "" });
        if (key) byKey.set(key, additions[additions.length - 1]);
        addedCount++;
        continue;
      }

      const mergedPhones = mergePhoneLists(existing.phones, incoming.phones);
      let changed = false;
      if (mergedPhones.length !== existing.phones.length) {
        existing.phones = mergedPhones;
        existing.phone = mergedPhones[0] || "";
        changed = true;
      }
      if (!existing.companyName && incoming.companyName) { existing.companyName = incoming.companyName; changed = true; }
      if (!existing.contactName && incoming.contactName) { existing.contactName = incoming.contactName; changed = true; }
      if (!existing.buildingAddress && incoming.buildingAddress) { existing.buildingAddress = incoming.buildingAddress; changed = true; }
      if (!existing.email && incoming.email) { existing.email = incoming.email; changed = true; }
      if (!existing.website && incoming.website) { existing.website = incoming.website; changed = true; }
      if (!existing.matchedName && incoming.matchedName) { existing.matchedName = incoming.matchedName; changed = true; }
      if (!existing.matchedAddress && incoming.matchedAddress) { existing.matchedAddress = incoming.matchedAddress; changed = true; }
      if ((Number(incoming.confidence || 0) > Number(existing.confidence || 0))) {
        existing.confidence = Number(incoming.confidence || 0);
        changed = true;
      }
      if (changed) {
        existing.updatedAt = now;
        updatedCount++;
      } else {
        unchangedCount++;
      }
    }

    setLeads([...additions, ...current].slice(0, 6000));
    const summary = [];
    if (addedCount > 0) summary.push(`${addedCount} nouveau${addedCount > 1 ? "x" : ""}`);
    if (updatedCount > 0) summary.push(`${updatedCount} enrichi${updatedCount > 1 ? "s" : ""}`);
    if (unchangedCount > 0) summary.push(`${unchangedCount} inchangé${unchangedCount > 1 ? "s" : ""}`);
    setToast(`✅ Import Leads terminé${summary.length ? ` · ${summary.join(" · ")}` : ""}.`);
    setTimeout(() => setToast(""), 5000);
    setImportFile(null);
    setColMap({});
    setShowColMap(false);
  }

  function updateLead(id, patch) {
    setLeads(prev => prev.map(lead => lead.id === id ? { ...lead, ...patch, updatedAt: Date.now() } : lead));
  }

  function leadSourceType(lead) {
    const src = String(lead?.sourceFile || "").toLowerCase();
    if (!src) return "manual";
    if (src.includes("recherche t") || src.includes("phonefinder")) return "phonefinder";
    return "import_file";
  }

  function toDateTimeLocal(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    return `${y}-${m}-${d}T${hh}:${mm}`;
  }

  function markCallNow(lead) {
    if (!lead?.id) return;
    const now = new Date();
    const stamp = now.toISOString();
    const line = `[${now.toLocaleString("fr-CA", { dateStyle:"short", timeStyle:"short" })}] Appel effectué.`;
    const existing = String(lead.callNotes || "").trim();
    updateLead(lead.id, {
      lastCallAt: stamp,
      callStatus: lead.callStatus && lead.callStatus !== "none" ? lead.callStatus : "tried",
      stage: (lead.stage === "new" || lead.stage === "to_call") ? "contacted" : lead.stage,
      callNotes: existing ? `${existing}\n${line}` : line,
    });
    setToast("✅ Appel noté dans le lead.");
    setTimeout(() => setToast(""), 2800);
  }

  function removeLead(id) {
    setLeads(prev => prev.filter(lead => lead.id !== id));
    setSelectedLeadId(prev => (prev === id ? null : prev));
  }

  function clearLeads() {
    if (!window.confirm("Effacer tous les leads importés ?")) return;
    setLeads([]);
    setSelectedLeadId(null);
  }

  function extractRawLeadPhoneCandidates(lead) {
    const parts = [];
    const push = (value) => {
      if (value === null || value === undefined) return;
      if (Array.isArray(value)) { value.forEach(push); return; }
      const txt = String(value || "").trim();
      if (!txt) return;
      txt
        .split(/[\n|;,/]+/)
        .map(item => item.trim())
        .filter(Boolean)
        .forEach(item => parts.push(item));
    };
    push(lead?.phones);
    push(lead?.phone);
    push(lead?.originalPhone);
    const unique = [];
    const seen = new Set();
    for (const item of parts) {
      const key = item.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(item);
    }
    return unique;
  }

  function cleanLegacyLeadPhones() {
    if (!Array.isArray(leads) || leads.length === 0) {
      setToast("Aucun lead à nettoyer.");
      setTimeout(() => setToast(""), 2500);
      return;
    }
    if (!window.confirm("Nettoyer les téléphones invalides dans tous les leads existants ?")) return;

    let changed = 0;
    let removedValues = 0;
    const now = Date.now();
    const cleaned = leads.map(lead => {
      const rawCandidates = extractRawLeadPhoneCandidates(lead);
      const normalizedPhones = getLeadPhones(lead);
      removedValues += Math.max(0, rawCandidates.length - normalizedPhones.length);

      const prevPhones = Array.isArray(lead.phones) ? lead.phones.map(v => String(v || "").trim()).filter(Boolean) : [];
      const prevPrimary = String(lead.phone || "").trim();
      const nextPrimary = normalizedPhones[0] || "";
      const cleanOriginal = mergePhoneLists(lead.originalPhone)[0] || "";
      const nextOriginal = cleanOriginal || nextPrimary || "";
      const samePhones = prevPhones.length === normalizedPhones.length && prevPhones.every((v, i) => v === normalizedPhones[i]);
      if (samePhones && prevPrimary === nextPrimary && String(lead.originalPhone || "") === String(nextOriginal || "")) {
        return lead;
      }

      changed++;
      return {
        ...lead,
        phone: nextPrimary,
        phones: normalizedPhones,
        originalPhone: nextOriginal,
        updatedAt: now,
      };
    });

    if (changed === 0) {
      setToast("Aucun numéro invalide trouvé dans les leads.");
      setTimeout(() => setToast(""), 3200);
      return;
    }

    setLeads(cleaned);
    setToast(`✅ Nettoyage terminé: ${changed} leads corrigés · ${removedValues} valeurs retirées`);
    setTimeout(() => setToast(""), 4500);
  }

  function exportLeads() {
    const headers = ["Entreprise", "Contact", "Adresse Immeuble", "Ville", "Unités", "Téléphone", "Email", "Statut", "Source", "Nom trouvé", "Adresse trouvée", "Confiance", "Site", "Date import"];
    const rows = filteredLeads.map(lead => [
      lead.companyName || "",
      lead.contactName || "",
      lead.buildingAddress || "",
      lead.city || "",
      lead.units || "",
      getLeadPhones(lead).join(" | "),
      lead.email || "",
      STAGE_CFG[lead.stage]?.label || lead.stage || "Nouveau",
      lead.sourceFile || "",
      lead.matchedName || "",
      lead.matchedAddress || "",
      lead.confidence || 0,
      lead.website || "",
      lead.createdAt || "",
    ]);
    const csv = [headers, ...rows].map(row => row.map(c => `"${String(c ?? "").replace(/"/g, "\"\"")}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Dynamic city list from all leads (for city filter dropdown).
  const cityOptions = useMemo(() => {
    const seen = new Set();
    const cities = [];
    for (const lead of leads) {
      const c = String(lead.city || "").trim();
      if (c && !seen.has(c)) { seen.add(c); cities.push(c); }
    }
    return cities.sort((a, b) => a.localeCompare(b, "fr"));
  }, [leads]);

  // Returns which units bucket a lead belongs to.
  function unitsInBucket(lead, bucket) {
    const n = Number(lead.units) || 0;
    if (bucket === "1")  return n >= 1 && n <= 2;
    if (bucket === "3")  return n >= 3 && n <= 5;
    if (bucket === "6")  return n >= 6 && n <= 11;
    if (bucket === "12") return n >= 12 && n <= 24;
    if (bucket === "25") return n >= 25 && n <= 49;
    if (bucket === "50") return n >= 50;
    return true;
  }

  const filteredLeads = useMemo(() => {
    let list = leads;
    if (filter.status !== "all") list = list.filter(lead => (lead.stage || "new") === filter.status);
    if (filter.phone === "with") list = list.filter(lead => getLeadPhones(lead).length > 0);
    if (filter.phone === "without") list = list.filter(lead => getLeadPhones(lead).length === 0);
    if (filter.source !== "all") list = list.filter(lead => leadSourceType(lead) === filter.source);
    if (filter.linked === "linked") list = list.filter(lead => Boolean(lead.linkedDealId));
    if (filter.linked === "unlinked") list = list.filter(lead => !lead.linkedDealId);
    if (filter.city !== "all") list = list.filter(lead => (lead.city || "") === filter.city);
    if (filter.units !== "all") list = list.filter(lead => unitsInBucket(lead, filter.units));
    if (filter.call === "due") {
      const now = Date.now();
      list = list.filter(lead => {
        if (!lead.nextCallAt) return false;
        const t = new Date(lead.nextCallAt).getTime();
        return Number.isFinite(t) && t <= now;
      });
    } else if (filter.call !== "all") {
      list = list.filter(lead => (lead.callStatus || "none") === filter.call);
    }
    if (filter.search) {
      const q = filter.search.toLowerCase();
      list = list.filter(lead => (
        `${lead.companyName || ""} ${lead.contactName || ""} ${lead.buildingAddress || ""} ${lead.city || ""} ${getLeadPhones(lead).join(" ")} ${lead.email || ""} ${lead.notes || ""} ${lead.callNotes || ""}`
      ).toLowerCase().includes(q));
    }
    return list;
  }, [leads, filter]);

  useEffect(() => {
    if (!filteredLeads.length) {
      if (selectedLeadId) setSelectedLeadId(null);
      return;
    }
    if (!selectedLeadId || !filteredLeads.some(lead => lead.id === selectedLeadId)) {
      setSelectedLeadId(filteredLeads[0].id);
    }
  }, [filteredLeads, selectedLeadId]);

  const selectedLead = useMemo(() => (
    leads.find(lead => lead.id === selectedLeadId) || null
  ), [leads, selectedLeadId]);

  const FIELD_LABELS = {
    buildingAddress: "Adresse immeuble",
    city: "Ville",
    province: "Province",
    postalCode: "Code postal",
    country: "Pays",
    companyName: "Entreprise",
    contactName: "Contact / Propriétaire",
    email: "Courriel",
    phone: "Téléphone",
    notes: "Notes",
    units:       "Nombre d'unités / logements",
    utilisation: "Type / utilisation de l'immeuble",
    assessment:  "Valeur foncière / évaluation",
    yearBuilt:   "Année de construction",
    lotArea:     "Superficie du terrain",
  };

  const FIELD_HINTS = {
    buildingAddress: "recommandé",
    city: "optionnel",
    province: "optionnel",
    postalCode: "optionnel",
    country: "optionnel",
    companyName: "utilisé pour la recherche",
    contactName: "utile pour qui appeler",
    email: "optionnel",
    phone: "si déjà disponible",
    notes: "optionnel",
    units:       "pour filtrer par taille d'immeuble",
    utilisation: "affiché dans la fiche immeuble",
    assessment:  "affiché dans la fiche immeuble",
    yearBuilt:   "affiché dans la fiche immeuble",
    lotArea:     "affiché dans la fiche immeuble",
  };

  return (
    <>
      {showColMap && importFile && (
        <div className="mo">
          <div className="mo-box" style={{maxWidth:560,maxHeight:"85vh",overflow:"auto"}}>
            <div className="mo-title">Mapper les colonnes leads</div>
            <div style={{fontSize:12,color:"var(--text2)",marginBottom:14}}>
              <strong>{importFile.rows.length}</strong> lignes · <strong>{importFile.headers.length}</strong> colonnes détectées ({importFile.delim || "fichier"})<br/>
              Assignez les champs clés pour garder le lien entre immeuble, entreprise et contact.
            </div>
            {Object.entries(FIELD_LABELS).map(([field, label]) => (
              <div className="f-row" key={field}>
                <div className="f-lbl">{label} <span style={{color:"var(--text3)",fontWeight:400}}>— {FIELD_HINTS[field]}</span></div>
                <select value={colMap[field] || ""} onChange={e => setColMap(prev => ({ ...prev, [field]: e.target.value }))}>
                  <option value="">— Ignorer —</option>
                  {importFile.headers.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            ))}
            <div className="mo-foot">
              <button className="btn" onClick={() => setShowColMap(false)}>Fermer</button>
              <button className="btn btn-gold" onClick={() => setShowColMap(false)}>Confirmer</button>
            </div>
          </div>
        </div>
      )}

      {/* Liste / Importer tabs — mirrors PhoneFinder so both pages share the
          same navigation pattern. The import dropzone used to sit above the
          list and eat half the viewport; moving it into its own tab keeps
          the list as the default, always-visible workspace. */}
      <div className="tabs" style={{marginBottom:14}}>
        <button className={`tab${leadTab==="list"?" active":""}`} onClick={() => setLeadTab("list")}>
          📋 Liste ({leads.length})
        </button>
        <button className={`tab${leadTab==="import"?" active":""}`} onClick={() => setLeadTab("import")}>
          📂 Importer CSV / XLSX
        </button>
      </div>

      {leadTab === "import" && (
        <div className="card f-card">
          <div className="f-title">Importer des leads (CSV / XLSX)</div>
          <div className="pf-drop"
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleImportFile(f); }}
            onClick={pickImportFile}
          >
            <div style={{fontSize:32,marginBottom:8}}>📂</div>
            {importFile
              ? <div style={{fontSize:13,fontWeight:700,color:"var(--text)"}}>{importFile.fileName} · {importFile.rows.length} lignes · {importFile.headers.length} colonnes</div>
              : <div style={{fontSize:13,fontWeight:700,color:"var(--text2)"}}>Glissez un fichier ou cliquez pour importer</div>}
            <div style={{fontSize:11,color:"var(--text3)",marginTop:4}}>Formats: CSV, XLSX · Colonnes recommandées: adresse immeuble, nom complet, entreprise</div>
          </div>
          {importFile && (
            <div style={{marginTop:12,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
              <div style={{fontSize:12,color:"var(--text2)"}}>
                <strong>{importFile.rows.length}</strong> lignes prêtes ·{" "}
                <button style={{border:"none",background:"none",color:"var(--blue)",fontSize:12,cursor:"pointer",padding:0}} onClick={e => { e.stopPropagation(); setShowColMap(true); }}>
                  mappage avancé (optionnel)
                </button>
              </div>
              <button className="btn btn-gold" onClick={() => { importLeads(); setLeadTab("list"); }} disabled={importBusy}>
                {importBusy ? "Import en cours…" : "Importer dans Leads"}
              </button>
            </div>
          )}
          {importError && <div className="status-note error" style={{marginTop:10}}>{importError}</div>}
        </div>
      )}

      {/* Progress bar stays visible while an import is running even if the
          user switches back to the list tab — otherwise the progress would
          disappear as soon as the list-tab auto-switch fires. */}
      {importBusy && importProgress && (
        <div className="card" style={{padding:16}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <div style={{fontSize:13,fontWeight:700,color:"var(--text)"}}>⏳ {importProgress.done} / {importProgress.total} lignes importées</div>
          </div>
          <div style={{height:8,background:"#F0E8D8",borderRadius:999,overflow:"hidden"}}>
            <div style={{height:"100%",background:"var(--gold)",borderRadius:999,width:`${Math.round((importProgress.done/importProgress.total)*100)}%`,transition:"width .3s"}} />
          </div>
        </div>
      )}

      {leadTab === "list" && (
      <div className="card" style={{padding:0,overflow:"hidden"}}>
        {/* ── Filter bar ──
            The global `input,select,textarea{width:100%}` rule in App CSS
            stretches each select to a full row by default. Inline
            `width:"auto"` keeps them their natural size so the whole bar
            lives on a single line instead of piling 5 filters vertically. */}
        <div style={{padding:"10px 14px 8px",borderBottom:"1px solid var(--border)",display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <input className="tb-search" style={{width:200,minWidth:140}} placeholder="🔍 Rechercher…" value={filter.search} onChange={e => setFilter(prev => ({ ...prev, search:e.target.value }))} />
          <select style={{padding:"7px 9px",fontSize:12,width:"auto"}} value={filter.status} onChange={e => setFilter(prev => ({ ...prev, status:e.target.value }))}>
            <option value="all">Tous les statuts</option>
            {Object.entries(STAGE_CFG).map(([id, cfg]) => <option key={id} value={id}>{cfg.label}</option>)}
          </select>
          <select style={{padding:"7px 9px",fontSize:12,width:"auto"}} value={filter.phone} onChange={e => setFilter(prev => ({ ...prev, phone:e.target.value }))}>
            <option value="all">📞 Tous</option>
            <option value="with">📞 Avec tél.</option>
            <option value="without">📞 Sans tél.</option>
          </select>
          <select style={{padding:"7px 9px",fontSize:12,width:"auto"}} value={filter.units} onChange={e => setFilter(prev => ({ ...prev, units:e.target.value }))}>
            <option value="all">🏢 Toutes tailles</option>
            <option value="1">1–2 unités</option>
            <option value="3">3–5 unités</option>
            <option value="6">6–11 unités</option>
            <option value="12">12–24 unités</option>
            <option value="25">25–49 unités</option>
            <option value="50">50+ unités</option>
          </select>
          {cityOptions.length > 0 && (
            <select style={{padding:"7px 9px",fontSize:12,width:"auto"}} value={filter.city} onChange={e => setFilter(prev => ({ ...prev, city:e.target.value }))}>
              <option value="all">📍 Toutes villes</option>
              {cityOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <select style={{padding:"7px 9px",fontSize:12,width:"auto"}} value={filter.call} onChange={e => setFilter(prev => ({ ...prev, call:e.target.value }))}>
            <option value="all">Appel: tous</option>
            <option value="due">Rappel dû</option>
            {Object.entries(CALL_STATUS_CFG).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
          {(filter.status !== "all" || filter.phone !== "all" || filter.units !== "all" || filter.city !== "all" || filter.call !== "all" || filter.search) && (
            <button className="btn btn-sm" style={{fontSize:11}} onClick={() => setFilter({ status:"all", search:"", phone:"all", source:"all", linked:"all", call:"all", city:"all", units:"all" })}>✕ Réinitialiser</button>
          )}
          <span style={{marginLeft:"auto",fontSize:11,color:"var(--text3)",whiteSpace:"nowrap"}}>
            {filteredLeads.length} lead{filteredLeads.length !== 1 ? "s" : ""}
            {leads.length !== filteredLeads.length ? " / " + leads.length : ""}
          </span>
          <div style={{display:"flex",gap:5}}>
            <button className="btn btn-sm" onClick={exportLeads} title="Exporter">⬇</button>
            <button className="btn btn-sm btn-danger" onClick={clearLeads} title="Vider tout">🗑</button>
          </div>
        </div>

        {/* ── Two-column body: list LEFT · fiche RIGHT ── */}
        <div style={{display:"flex",height:600,minHeight:400}}>

          {/* LEFT: lead list (virtualized so thousands of imported leads render in O(viewport)) */}
          <div style={{width:320,minWidth:240,flexShrink:0,borderRight:"1px solid var(--border)",background:"var(--bg,#FAF6EF)"}}>
            {filteredLeads.length === 0 ? (
              <div style={{padding:32,textAlign:"center",color:"var(--text3)"}}>
                <div style={{fontSize:28,marginBottom:8}}>🎯</div>
                <div style={{fontWeight:700,marginBottom:4}}>{leads.length === 0 ? "Aucun lead" : "Aucun résultat"}</div>
                <div style={{fontSize:12,marginBottom:12}}>{leads.length === 0 ? "Importez un fichier pour commencer." : "Modifiez les filtres."}</div>
                {leads.length === 0 && (
                  <button className="btn btn-gold btn-sm" onClick={() => setLeadTab("import")}>
                    📂 Importer un fichier
                  </button>
                )}
              </div>
            ) : (
              <VirtualList
                height={600}
                width={320}
                itemCount={filteredLeads.length}
                itemSize={LEAD_ROW_HEIGHT}
                itemData={{ leads: filteredLeads, selectedLeadId, onSelect: setSelectedLeadId }}
              >
                {LeadListRow}
              </VirtualList>
            )}
          </div>

          {/* RIGHT: fiche */}
          <div style={{flex:1,overflowY:"auto",padding:"16px 18px",minWidth:0}}>
            {!selectedLead ? (
              <div style={{padding:40,textAlign:"center",color:"var(--text3)"}}>
                <div style={{fontSize:32,marginBottom:8}}>👈</div>
                <div style={{fontWeight:700}}>Sélectionnez un lead</div>
                <div style={{fontSize:12,marginTop:4}}>Cliquez sur un lead dans la liste pour voir sa fiche.</div>
              </div>
            ) : (
              <LeadFiche
                lead={selectedLead}
                stageCfg={STAGE_CFG}
                callStatusCfg={CALL_STATUS_CFG}
                onUpdate={updateLead}
                onRemove={removeLead}
                onCreateDeal={onCreateDealFromLead}
                onMarkCall={markCallNow}
                toDateTimeLocal={toDateTimeLocal}
                getPhones={getLeadPhones}
              />
            )}
          </div>
        </div>
      </div>
      )}

      {toast && (
        <div style={{position:"fixed",bottom:24,right:24,background:"#1A7A3F",color:"#fff",padding:"12px 18px",borderRadius:10,fontWeight:700,fontSize:13,zIndex:999,boxShadow:"0 4px 16px rgba(0,0,0,.2)"}}>
          {toast}
        </div>
      )}
    </>
  );
}

export default LeadsManager;
