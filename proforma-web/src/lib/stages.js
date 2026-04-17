// Acquisition-pipeline stage metadata and per-stage checklist templates.
// Used by: App.js (Kanban/Dashboard/Pipeline), dealHelpers.js (stageColor,
// createDeal default stage), LeadsManager stage badges.
//
// Keep stage ids stable — they're persisted inside every saved deal/lead in
// localStorage, so renaming an id means migrating stored state.

export const STAGES = [
  { id: "prospection",   label: "Prospection",    color: "#6366f1", emoji: "🔍" },
  { id: "analyse",       label: "Analyse",         color: "#f59e0b", emoji: "📊" },
  { id: "offre",         label: "Offre déposée",   color: "#3b82f6", emoji: "📝" },
  { id: "due_diligence", label: "Due diligence",   color: "#8b5cf6", emoji: "🔬" },
  { id: "financement",   label: "Financement",     color: "#06b6d4", emoji: "🏦" },
  { id: "closing",       label: "Closing",         color: "#22c55e", emoji: "🤝" },
  { id: "perdu",         label: "Perdu",           color: "#ef4444", emoji: "✗"  },
];

export const CHECKLISTS = {
  prospection:   ["Identifier la propriété","Valider le zonage","Vérifier historique MLS","Premier contact vendeur/courtier","Évaluer le quartier"],
  analyse:       ["Remplir le proforma","Valider loyers actuels","Analyser dépenses réelles","Calculer NOI et cap rate","Comparer ventes récentes"],
  offre:         ["Rédiger la promesse d'achat","Définir les conditions","Déposer l'offre","Négocier la contre-offre","Confirmer l'acceptation"],
  due_diligence: ["Commander l'inspection","Rapport environnemental","Vérifier les titres","Valider les baux","Inspecter la mécanique"],
  financement:   ["Demande de prêt soumise","Évaluation bancaire reçue","Approbation conditionnelle","Approbation finale","SCHL si requis"],
  closing:       ["Acte de vente signé","Virement de fonds","Remise des clés","Mise à jour assurances","Comptes de gestion ouverts"],
  perdu:         ["Documenter les raisons","Archiver les documents"],
};

export const PRIORITY = {
  high:   { label: "Haute",   color: "#C0392B", tag: "CHAUD", cls: "pr-hot", score: 3 },
  medium: { label: "Moyenne", color: "#B7791F", tag: "TIÈDE", cls: "pr-warm", score: 2 },
  low:    { label: "Basse",   color: "#2563EB", tag: "FROID", cls: "pr-cold", score: 1 },
};

// Mirror of the STAGE_CFG declared inside LeadsManager. Module-scope so the
// virtualized row renderer (which lives outside the component) can read it.
// Keep in sync with LeadsManager's local STAGE_CFG when lead stages change.
export const LEAD_STAGE_CFG = {
  new: { label: "Nouveau", cls: "multiple_matches" },
  to_call: { label: "À appeler", cls: "needs_review" },
  contacted: { label: "Contacté", cls: "found" },
  qualified: { label: "Qualifié", cls: "found" },
  converted: { label: "Converti", cls: "found" },
  lost: { label: "Fermé", cls: "not_found" },
};
