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
import {
  extractContactCandidatesFromRow,
  mergePhoneCandidates,
  mergeEmailCandidates,
  mergeWebsiteCandidates,
  flattenPhoneCandidates,
  flattenEmailCandidates,
  flattenWebsiteCandidates,
  pickBestPhone,
  pickBestEmail,
  pickBestWebsite,
  candidatesFromOnlinePhones,
  candidatesFromOnlineWebsites,
  makePhoneCandidate,
  makeEmailCandidate,
  makeWebsiteCandidate,
} from "../lib/contactCandidates.js";
import { buildLeadIdentityKey, getLeadPhones } from "../lib/dealHelpers.js";
import { firstBusinessLookupName } from "../lib/businessName.js";
import useDebouncedValue from "../lib/useDebouncedValue.js";
import useToast from "../lib/useToast.js";
import useEscapeKey from "../lib/useEscapeKey.js";
import useFocusHotkey from "../lib/useFocusHotkey.js";
import {
  parseCSV,
  parseSpreadsheet,
  isSpreadsheetFile,
  normalizeHeader,
} from "../lib/tableImport.js";
import LeadFiche from "../components/LeadFiche.jsx";
import LeadListRow, { LEAD_ROW_HEIGHT } from "../components/LeadListRow.jsx";
import { FolderIcon, HourglassIcon, DownloadIcon, TrashIcon, TargetIcon, CloseIcon } from "../components/Icons.jsx";

const LEAD_BATCH_SIZE = 10;

const MENU_ITEM_STYLE = {
  display: "flex",
  alignItems: "center",
  width: "100%",
  textAlign: "left",
  padding: "13px 16px",
  border: "none",
  background: "none",
  fontSize: 14,
  cursor: "pointer",
  color: "var(--text)",
  borderBottom: "1px solid var(--border)",
};

function LeadsManager({ leads, setLeads, onCreateDealFromLead }) {
  const [importFile, setImportFile] = useState(null);
  const [colMap, setColMap] = useState({});
  const [showColMap, setShowColMap] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importProgress, setImportProgress] = useState(null);
  const [importError, setImportError] = useState("");
  const { toast, showToast } = useToast();
  const [filter, setFilter] = useState({ status:"all", phone:"all", source:"all", linked:"all", call:"all", city:"all", units:"all" });
  const [searchInput, setSearchInput] = useState("");
  const debouncedSearch = useDebouncedValue(searchInput, 180);
  const searchRef = useRef(null);
  useFocusHotkey(searchRef);
  const [selectedLeadId, setSelectedLeadId] = useState(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const isMobile = window.innerWidth <= 768;
  const [mobileView, setMobileView] = useState("list");
  const listPanelRef = useRef(null);
  const [listHeight, setListHeight] = useState(600);
  const [listWidth, setListWidth] = useState(isMobile ? window.innerWidth : 320);

  // ⋯ overflow menu
  const [showOverflowMenu, setShowOverflowMenu] = useState(false);
  const menuBtnRef = useRef(null);
  const [menuTop, setMenuTop] = useState(48);

  function openOverflowMenu() {
    if (menuBtnRef.current) {
      const rect = menuBtnRef.current.getBoundingClientRect();
      setMenuTop(rect.bottom + 4);
    }
    setShowOverflowMenu(v => !v);
  }

  useEscapeKey(() => setShowColMap(false), showColMap);
  useEscapeKey(() => setShowImportModal(false), showImportModal && !showColMap);
  useEscapeKey(() => setShowOverflowMenu(false), showOverflowMenu);

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
      // Pull every contact candidate out of the raw row with full source-
      // column attribution. The classifier covers explicit phone/email/website
      // columns plus notes / contact columns; address columns are skipped to
      // avoid civic-number false positives. Source = "file" because we're at
      // import time and these came directly from the user's spreadsheet.
      const fileCandidates = extractContactCandidatesFromRow(row, {
        ownerName: contactName || companyName,
      });
      // The auto-detected primary phone column (`phone`) and email column
      // (`email`) sometimes have headers the classifier wouldn't pick up
      // (e.g. localized variants). Force-add them as candidates when they
      // produced values, so the user-mapped column always shows up as a
      // file source.
      if (phone && colMap.phone) {
        for (const p of mergePhoneLists(phone)) {
          fileCandidates.candidatePhones.push(makePhoneCandidate({
            phone: p,
            source: "file",
            source_column: colMap.phone,
            phone_owner_name: contactName || companyName,
            relationship_to_lead_owner: "owner",
            evidence: `mapped phone column "${colMap.phone}"`,
          }));
        }
      }
      if (email && colMap.email) {
        fileCandidates.candidateEmails.push(makeEmailCandidate({
          email,
          source: "file",
          source_column: colMap.email,
          email_owner_name: contactName || companyName,
          relationship_to_lead_owner: "owner",
          evidence: `mapped email column "${colMap.email}"`,
        }));
      }
      const candidatePhones = mergePhoneCandidates(fileCandidates.candidatePhones.filter(Boolean));
      const candidateEmails = mergeEmailCandidates(fileCandidates.candidateEmails.filter(Boolean));
      const candidateWebsites = mergeWebsiteCandidates(fileCandidates.candidateWebsites.filter(Boolean));
      return {
        companyName, contactName, address, city, province, postalCode, country, email, phone,
        inputPhones, notes, units, utilisation, assessment, yearBuilt, lotArea,
        buildingAddress, lookupName, rawRow: row,
        candidatePhones, candidateEmails, candidateWebsites,
      };
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

        // Build online candidates from the lookup result. Phones get tagged
        // by the source the enrichment pipeline reported (google_places /
        // pages_jaunes / 411ca / file → directory). Websites tag as
        // google_places. We DO NOT overwrite the file candidates — file +
        // online live side-by-side in the candidate arrays.
        const lookedSourceParts = String(looked.source || "").split(/[ ,]+/).filter(Boolean);
        const placesSource = lookedSourceParts.includes("google_places") ? "google_places"
          : lookedSourceParts.includes("pages_jaunes") || lookedSourceParts.includes("411ca") ? "directory"
          : "google_places";
        const placesEvidence = looked.matchedName
          ? `Google Places match: ${looked.matchedName}${looked.confidence ? ` (${Math.round(looked.confidence)}%)` : ""}`
          : "online lookup";
        const onlinePhoneCandidates = candidatesFromOnlinePhones(
          [looked.phone, ...(Array.isArray(looked.onlinePhones) ? looked.onlinePhones : [])],
          {
            source: placesSource,
            phone_owner_name: looked.matchedName || item.companyName,
            evidence: placesEvidence,
            confidence: Number.isFinite(Number(looked.confidence))
              ? Math.max(0, Math.min(100, Number(looked.confidence)))
              : undefined,
          },
        );
        const onlinePjCandidates = candidatesFromOnlinePhones(
          Array.isArray(looked.pjDirectoryPhones) ? looked.pjDirectoryPhones : [],
          { source: "directory", evidence: "Pages Jaunes directory" },
        );
        const online411Candidates = candidatesFromOnlinePhones(
          Array.isArray(looked.c411DirectoryPhones) ? looked.c411DirectoryPhones : [],
          { source: "directory", evidence: "411.ca directory" },
        );
        const onlineWebsiteCandidates = candidatesFromOnlineWebsites(
          [looked.website].filter(Boolean),
          { source: placesSource, evidence: placesEvidence },
        );

        // Merge file candidates FIRST so they take priority on (value,
        // source, source_column) collisions and so flatten/pickBest favors
        // the user's original data over enrichment guesses.
        const candidatePhones = mergePhoneCandidates(
          item.candidatePhones || [],
          onlinePhoneCandidates,
          onlinePjCandidates,
          online411Candidates,
        );
        const candidateEmails = mergeEmailCandidates(item.candidateEmails || []);
        const candidateWebsites = mergeWebsiteCandidates(
          item.candidateWebsites || [],
          onlineWebsiteCandidates,
        );

        const allPhones = flattenPhoneCandidates(candidatePhones);
        const allEmails = flattenEmailCandidates(candidateEmails);
        const allWebsites = flattenWebsiteCandidates(candidateWebsites);
        const linkedStatus = looked.status || (mergedPhones.length || allPhones.length ? "found" : "not_found");
        return {
          id: `lead_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          createdAt: nowIso,
          updatedAt: Date.now(),
          stage: (mergedPhones.length || allPhones.length) ? "to_call" : "new",
          companyName: item.companyName || looked.inputName || looked.matchedName || "",
          contactName: item.contactName || "",
          buildingAddress: item.buildingAddress || looked.inputAddress || looked.matchedAddress || "",
          city: item.city || "",
          province: item.province || "",
          postalCode: item.postalCode || "",
          country: item.country || "Canada",
          // Primary string fields: best file candidate first, then online.
          phone: pickBestPhone(candidatePhones) || mergedPhones[0] || "",
          email: pickBestEmail(candidateEmails) || item.email || "",
          website: pickBestWebsite(candidateWebsites) || looked.website || "",
          phones: allPhones.length ? allPhones : mergedPhones,
          emails: allEmails,
          websites: allWebsites,
          candidatePhones,
          candidateEmails,
          candidateWebsites,
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
      // Candidate arrays: existing comes FIRST so its file candidates with
      // user-edited metadata are preserved on (value, source, source_column)
      // collisions. New incoming online candidates append at the end.
      const beforePhoneCandLen = (existing.candidatePhones || []).length;
      const beforeEmailCandLen = (existing.candidateEmails || []).length;
      const beforeWebsiteCandLen = (existing.candidateWebsites || []).length;
      existing.candidatePhones = mergePhoneCandidates(
        existing.candidatePhones || [],
        incoming.candidatePhones || [],
      );
      existing.candidateEmails = mergeEmailCandidates(
        existing.candidateEmails || [],
        incoming.candidateEmails || [],
      );
      existing.candidateWebsites = mergeWebsiteCandidates(
        existing.candidateWebsites || [],
        incoming.candidateWebsites || [],
      );
      if (existing.candidatePhones.length !== beforePhoneCandLen ||
          existing.candidateEmails.length !== beforeEmailCandLen ||
          existing.candidateWebsites.length !== beforeWebsiteCandLen) {
        changed = true;
      }
      // Re-flatten the value arrays from the merged candidate lists. If the
      // merge produced no candidates (e.g. a phones-only-from-merge case),
      // fall back to mergedPhones / existing values so we don't silently drop
      // anything.
      const flatPhones = flattenPhoneCandidates(existing.candidatePhones);
      if (flatPhones.length) {
        existing.phones = mergePhoneLists(flatPhones, mergedPhones);
        existing.phone = pickBestPhone(existing.candidatePhones) || existing.phones[0] || "";
      }
      const flatEmails = flattenEmailCandidates(existing.candidateEmails);
      if (flatEmails.length) {
        existing.emails = flatEmails;
        // Only overwrite the primary email when there's no existing one — the
        // user may have manually edited it.
        if (!existing.email) existing.email = pickBestEmail(existing.candidateEmails);
      }
      const flatWebsites = flattenWebsiteCandidates(existing.candidateWebsites);
      if (flatWebsites.length) {
        existing.websites = flatWebsites;
        if (!existing.website) existing.website = pickBestWebsite(existing.candidateWebsites);
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
    showToast(`Import Leads terminé${summary.length ? ` · ${summary.join(" · ")}` : ""}.`, 5000);
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
    showToast("Appel noté dans le lead.", 2800);
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
      showToast("Aucun lead à nettoyer.", 2500);
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
      showToast("Aucun numéro invalide trouvé dans les leads.", 3200);
      return;
    }

    setLeads(cleaned);
    showToast(`Nettoyage terminé: ${changed} leads corrigés · ${removedValues} valeurs retirées`, 4500);
  }

  function exportLeads() {
    // Export ALL leads regardless of active filters. Filters are for the
    // display list only — exporting filtered leads caused data loss when users
    // had an accidental filter active.
    const source = leads;
    if (!source.length) {
      showToast("Aucun lead à exporter.", 3000);
      return;
    }
    const headers = ["Entreprise", "Contact", "Adresse Immeuble", "Ville", "Unités", "Téléphone", "Email", "Statut", "Source", "Nom trouvé", "Adresse trouvée", "Confiance", "Site", "Date import"];
    const rows = source.map(lead => [
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
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`${source.length} leads exportés.`, 3000);
  }

  const cityOptions = useMemo(() => {
    const seen = new Set();
    const cities = [];
    for (const lead of leads) {
      const c = String(lead.city || "").trim();
      if (c && !seen.has(c)) { seen.add(c); cities.push(c); }
    }
    return cities.sort((a, b) => a.localeCompare(b, "fr"));
  }, [leads]);

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
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      list = list.filter(lead => (
        `${lead.companyName || ""} ${lead.contactName || ""} ${lead.buildingAddress || ""} ${lead.city || ""} ${getLeadPhones(lead).join(" ")} ${lead.email || ""} ${lead.notes || ""} ${lead.callNotes || ""}`
      ).toLowerCase().includes(q));
    }
    return list;
  }, [leads, filter, debouncedSearch]);

  useEffect(() => {
    if (!filteredLeads.length) {
      if (selectedLeadId) setSelectedLeadId(null);
      return;
    }
    if (!selectedLeadId || !filteredLeads.some(lead => lead.id === selectedLeadId)) {
      setSelectedLeadId(filteredLeads[0].id);
    }
  }, [filteredLeads, selectedLeadId]);

  useEffect(() => {
    const el = listPanelRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { height, width } = entry.contentRect;
      if (height > 0) setListHeight(height);
      if (width > 0) setListWidth(width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const leadListItemData = useMemo(
    () => ({
      leads: filteredLeads,
      selectedLeadId,
      onSelect: (id) => {
        setSelectedLeadId(id);
        if (isMobile) setMobileView("fiche");
      },
    }),
    [filteredLeads, selectedLeadId],
  );

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

  const activeSecondaryCount =
    (filter.phone !== "all" ? 1 : 0) +
    (filter.units !== "all" ? 1 : 0) +
    (filter.city  !== "all" ? 1 : 0) +
    (filter.call  !== "all" ? 1 : 0);
  const anyFilterActive = activeSecondaryCount > 0 || filter.status !== "all" || searchInput;

  return (
    <>
      {/* Column mapping modal */}
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

      {/* Import modal */}
      {showImportModal && (
        <div className="mo" onClick={() => setShowImportModal(false)}>
          <div className="mo-box" style={{maxWidth:560}} onClick={e => e.stopPropagation()}>
            <div className="mo-title">Importer des leads (CSV / XLSX)</div>
            <div className="pf-drop"
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleImportFile(f); }}
              onClick={pickImportFile}
              style={{marginTop:8}}
            >
              <FolderIcon size={32} style={{marginBottom:8,color:"var(--text3)"}} />
              {importFile
                ? <div style={{fontSize:13,fontWeight:700,color:"var(--text)"}}>{importFile.fileName} · {importFile.rows.length} lignes · {importFile.headers.length} colonnes</div>
                : <div style={{fontSize:13,fontWeight:700,color:"var(--text2)"}}>Glissez un fichier ou cliquez pour importer</div>}
              <div style={{fontSize:11,color:"var(--text3)",marginTop:4}}>Formats: CSV, XLSX · Colonnes recommandées: adresse immeuble, nom complet, entreprise</div>
            </div>
            {importFile && (
              <div style={{marginTop:12,fontSize:12,color:"var(--text2)"}}>
                <strong>{importFile.rows.length}</strong> lignes prêtes ·{" "}
                <button style={{border:"none",background:"none",color:"var(--blue)",fontSize:12,cursor:"pointer",padding:0}} onClick={e => { e.stopPropagation(); setShowColMap(true); }}>
                  mappage avancé (optionnel)
                </button>
              </div>
            )}
            {importError && <div className="status-note error" style={{marginTop:10}}>{importError}</div>}
            <div className="mo-foot">
              <button className="btn" onClick={() => setShowImportModal(false)}>Fermer</button>
              <button
                className="btn btn-gold"
                disabled={!importFile || importBusy}
                onClick={() => { importLeads(); setShowImportModal(false); }}
              >
                {importBusy ? "Import en cours…" : "Importer dans Leads"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Progress bar — stays visible after modal closes */}
      {importBusy && importProgress && (
        <div className="card" style={{padding:16,marginBottom:14}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <div style={{fontSize:13,fontWeight:700,color:"var(--text)"}}><HourglassIcon size={13} style={{marginRight:4}} />{importProgress.done} / {importProgress.total} lignes importées</div>
          </div>
          <div style={{height:8,background:"#F0E8D8",borderRadius:999,overflow:"hidden"}}>
            <div style={{height:"100%",background:"var(--gold)",borderRadius:999,width:`${Math.round((importProgress.done/importProgress.total)*100)}%`,transition:"width .3s"}} />
          </div>
        </div>
      )}

      {/* ⋯ overflow menu */}
      {showOverflowMenu && (
        <>
          <div style={{position:"fixed",inset:0,zIndex:200}} onClick={() => setShowOverflowMenu(false)} />
          <div style={{position:"fixed",right:12,top:menuTop,zIndex:201,background:"#fff",border:"1px solid var(--border)",borderRadius:12,boxShadow:"0 8px 28px rgba(0,0,0,.14)",minWidth:230,overflow:"hidden"}}>
            <button style={MENU_ITEM_STYLE} onClick={() => { setShowImportModal(true); setShowOverflowMenu(false); }}>
              <FolderIcon size={14} style={{marginRight:10,flexShrink:0}} />Importer CSV / XLSX
            </button>
            <button style={MENU_ITEM_STYLE} onClick={() => { exportLeads(); setShowOverflowMenu(false); }}>
              <DownloadIcon size={14} style={{marginRight:10,flexShrink:0}} />Exporter CSV
            </button>
            <button style={MENU_ITEM_STYLE} onClick={() => { cleanLegacyLeadPhones(); setShowOverflowMenu(false); }}>
              Nettoyer téléphones
            </button>
            <button style={{...MENU_ITEM_STYLE,color:"#C0392B",borderBottom:"none"}} onClick={() => { clearLeads(); setShowOverflowMenu(false); }}>
              <TrashIcon size={14} style={{marginRight:10,flexShrink:0}} />Vider tout
            </button>
          </div>
        </>
      )}

      <div className="card leads-card" style={{padding:0,overflow:"hidden"}}>
        {/* ── Top bar ── */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 12px",height:44,borderBottom:"1px solid var(--border)",flexShrink:0}}>
          <div style={{fontWeight:700,fontSize:17,color:"var(--text)"}}>
            Leads <span style={{color:"var(--text3)",fontWeight:500,fontSize:14}}>· {leads.length}</span>
          </div>
          <button
            ref={menuBtnRef}
            onClick={openOverflowMenu}
            style={{background:"none",border:"1px solid var(--border)",borderRadius:8,width:36,height:36,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,color:"var(--text2)",letterSpacing:3,lineHeight:1}}
            aria-label="Plus d'actions"
          >
            ⋯
          </button>
        </div>

        {/* ── Search + filter bar ── */}
        <div className="leads-filter-primary">
          <input
            ref={searchRef}
            className="leads-search tb-search"
            placeholder="Rechercher…"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            style={{fontSize:16}}
          />
          <select
            className="leads-stage-select"
            style={{padding:"6px 9px",fontSize:14}}
            value={filter.status}
            onChange={e => setFilter(prev => ({ ...prev, status:e.target.value }))}
          >
            <option value="all">Tous</option>
            {Object.entries(STAGE_CFG).map(([id, cfg]) => <option key={id} value={id}>{cfg.label}</option>)}
          </select>
          <button
            className="btn btn-sm leads-filter-toggle"
            style={{fontSize:13,background:showAdvancedFilters||activeSecondaryCount?"var(--gold-light)":undefined,borderColor:showAdvancedFilters||activeSecondaryCount?"#E9D9AA":undefined}}
            onClick={() => setShowAdvancedFilters(v => !v)}
          >
            {showAdvancedFilters ? "▾" : "▸"} Filtres{activeSecondaryCount > 0 ? ` (${activeSecondaryCount})` : ""}
          </button>
          {anyFilterActive && (
            <button className="btn btn-sm" style={{fontSize:11}} onClick={() => { setFilter({ status:"all", phone:"all", source:"all", linked:"all", call:"all", city:"all", units:"all" }); setSearchInput(""); }}>
              ✕
            </button>
          )}
          <span className="leads-count">
            {filteredLeads.length}{leads.length !== filteredLeads.length ? `/${leads.length}` : ""}
          </span>
        </div>

        {/* ── Secondary filters (collapsible) ── */}
        {showAdvancedFilters && (
          <div className="leads-filter-secondary allow-horizontal-scroll">
            <select style={{padding:"6px 9px",fontSize:12,flexShrink:0}} value={filter.phone} onChange={e => setFilter(prev => ({ ...prev, phone:e.target.value }))}>
              <option value="all">Téléphone: tous</option>
              <option value="with">Avec tél.</option>
              <option value="without">Sans tél.</option>
            </select>
            <select style={{padding:"6px 9px",fontSize:12,flexShrink:0}} value={filter.units} onChange={e => setFilter(prev => ({ ...prev, units:e.target.value }))}>
              <option value="all">Toutes tailles</option>
              <option value="1">1–2 unités</option>
              <option value="3">3–5 unités</option>
              <option value="6">6–11 unités</option>
              <option value="12">12–24 unités</option>
              <option value="25">25–49 unités</option>
              <option value="50">50+ unités</option>
            </select>
            {cityOptions.length > 0 && (
              <select style={{padding:"6px 9px",fontSize:12,flexShrink:0}} value={filter.city} onChange={e => setFilter(prev => ({ ...prev, city:e.target.value }))}>
                <option value="all">Toutes villes</option>
                {cityOptions.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
            <select style={{padding:"6px 9px",fontSize:12,flexShrink:0}} value={filter.call} onChange={e => setFilter(prev => ({ ...prev, call:e.target.value }))}>
              <option value="all">Appel: tous</option>
              <option value="due">Rappel dû</option>
              {Object.entries(CALL_STATUS_CFG).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </div>
        )}

        {/* ── Two-panel body ── */}
        <div className="leads-body">
          {/* LIST panel */}
          {(!isMobile || mobileView === "list") && (
            <div
              ref={listPanelRef}
              className="leads-list-panel"
              style={{touchAction:"pan-y",overscrollBehavior:"none"}}
            >
              {filteredLeads.length === 0 ? (
                <div style={{padding:32,textAlign:"center",color:"var(--text3)"}}>
                  <TargetIcon size={28} style={{marginBottom:8,color:"var(--text3)"}} />
                  <div style={{fontWeight:700,marginBottom:4}}>{leads.length === 0 ? "Aucun lead" : "Aucun résultat"}</div>
                  <div style={{fontSize:12,marginBottom:12}}>{leads.length === 0 ? "Importez un fichier pour commencer." : "Modifiez les filtres."}</div>
                  {leads.length === 0 && (
                    <button className="btn btn-gold btn-sm" onClick={() => setShowImportModal(true)}>
                      <FolderIcon size={12} style={{marginRight:4}} />Importer un fichier
                    </button>
                  )}
                </div>
              ) : (
                <VirtualList
                  height={listHeight}
                  width={listWidth}
                  itemCount={filteredLeads.length}
                  itemSize={LEAD_ROW_HEIGHT}
                  itemData={leadListItemData}
                >
                  {LeadListRow}
                </VirtualList>
              )}
            </div>
          )}

          {/* FICHE panel — full-screen overlay on mobile */}
          {(!isMobile || mobileView === "fiche") && (
            <div
              className={isMobile ? "" : "leads-fiche-panel"}
              style={isMobile ? {
                position:"fixed",
                inset:0,
                background:"#fff",
                zIndex:100,
                display:"flex",
                flexDirection:"column",
                paddingBottom:"env(safe-area-inset-bottom)",
              } : {}}
            >
              {isMobile && (
                <div style={{display:"flex",alignItems:"center",height:44,borderBottom:"1px solid var(--border)",padding:"0 12px",flexShrink:0,background:"#fff"}}>
                  <button className="back-btn" style={{margin:0,marginRight:"auto"}} onClick={() => setMobileView("list")}>
                    ← Retour
                  </button>
                  {selectedLead && (
                    <div style={{fontWeight:600,fontSize:15,textAlign:"center",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1,padding:"0 8px"}}>
                      {selectedLead.companyName || selectedLead.contactName || "Lead"}
                    </div>
                  )}
                  <div style={{width:70}} />
                </div>
              )}
              <div style={isMobile ? {padding:"14px 16px",overflowY:"auto",flex:1} : {}}>
                {!selectedLead ? (
                  <div style={{padding:40,textAlign:"center",color:"var(--text3)"}}>
                    <div style={{fontSize:24,marginBottom:8,color:"var(--text3)"}}>←</div>
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
          )}
        </div>
      </div>

      {/* FAB — add / import leads */}
      {(!isMobile || mobileView === "list") && (
        <button
          onClick={() => setShowImportModal(true)}
          aria-label="Importer des leads"
          style={{
            position:"fixed",
            bottom:"calc(16px + env(safe-area-inset-bottom))",
            right:16,
            zIndex:90,
            width:56,
            height:56,
            borderRadius:"50%",
            background:"var(--gold,#C9A84C)",
            color:"#fff",
            border:"none",
            fontSize:28,
            cursor:"pointer",
            boxShadow:"0 4px 16px rgba(0,0,0,.22)",
            display:"flex",
            alignItems:"center",
            justifyContent:"center",
            lineHeight:1,
          }}
        >
          +
        </button>
      )}

      {toast && (
        <div style={{position:"fixed",bottom:88,right:24,background:"#1A7A3F",color:"#fff",padding:"12px 18px",borderRadius:10,fontWeight:700,fontSize:13,zIndex:999,boxShadow:"0 4px 16px rgba(0,0,0,.2)"}}>
          {toast}
        </div>
      )}
    </>
  );
}

export default LeadsManager;
