import { useState, useMemo, useCallback, useEffect, useRef, Suspense } from "react";
import lazyWithPreload from "./lib/lazyWithPreload.js";
import {
  mergePhoneLists,
  extractPhonesFromRow,
} from "./lib/phoneUtils.js";
import { STAGES, PRIORITY } from "./lib/stages.js";
import {
  fmtSz, fileIco, initials, calDays, dayKey,
  fmtCallDateTime, fmtDurationSeconds, MONTHS, DAYS,
} from "./lib/format.js";
import { load, isQuotaError, persist } from "./lib/storage.js";
import { fetchServerState, pushServerState } from "./lib/syncState.js";
import { pushSupported, pushPermission, subscribeToPush, unsubscribeFromPush } from "./lib/pushSubscribe.js";
import {
  buildCL, createDeal, dealLabel, normalizeDeal,
  buildLeadIdentityKey, getLeadPhones,
} from "./lib/dealHelpers.js";
import { migrateLeadsToOwners } from "./lib/ownerGrouping.js";

// ─── Runtime constants ───────────────────────────────────────────────────────
// Hardcoded per-user PIN access. Client-side only (not a security boundary —
// anyone with devtools can bypass). Good enough for a small internal team
// where the real enforcement is "we trust each other" + role-gated UI.
const USERS = [
  { id: "anthony", name: "Anthony Makeen", role: "admin",    pin: "9472", initials: "AM", roleLabel: { fr: "Président",     en: "President" } },
  { id: "gaylord", name: "Gaylord",        role: "employee", pin: "3815", initials: "G",  roleLabel: { fr: "Acquisitions",  en: "Acquisitions" } },
];

// Tiny i18n dictionary. Deliberately narrow: covers the NEW strings this
// commit adds (auth, flag workflow, chatbox, top-level nav, topbar titles)
// plus a handful of high-traffic buttons. Deep-internal French strings
// (stage labels, workspace tabs, lead import wording) are left intact — a
// full-app translation pass is out of scope for this change.
//
// tr(lang, key, ...args) resolves the value; functions in the dict take
// runtime arguments (e.g. chat greeting with the user's name).
const I18N = {
  fr: {
    login_title: "Connexion SOCLE",
    login_tag: "Sélectionnez votre profil",
    login_pin_placeholder: "PIN à 4 chiffres",
    login_submit: "Entrer",
    login_error: "PIN incorrect.",
    logout: "Déconnexion",
    nav_dashboard: "Dashboard",
    nav_pipeline: "Pipeline",
    nav_map: "Carte",
    nav_followups: "Follow-ups",
    nav_calendar: "Calendrier",
    nav_owners: "Investisseurs",
    nav_leads: "Leads",
    nav_phonefinder: "Recherche Tél.",
    nav_new_deal: "＋ Nouveau deal",
    topbar_dashboard: "Dashboard",
    topbar_dashboard_sub: "Vue d'ensemble · deals, follow-ups, activité",
    topbar_pipeline: "Pipeline",
    topbar_pipeline_sub: "Glissez les deals d'une étape à l'autre",
    topbar_map: "Carte",
    topbar_map_sub: "Vue géographique des deals au Québec",
    topbar_followups: "Follow-ups",
    topbar_followups_sub: "Appels et relances à faire",
    topbar_calendar: "Calendrier",
    topbar_calendar_sub: "Événements et échéances des deals",
    topbar_owners: "Investisseurs",
    topbar_owners_sub: "Un investisseur = une adresse postale. Toutes ses compagnies, numéros et propriétés regroupés.",
    topbar_leads: "Leads",
    topbar_leads_sub: "Propriétaires — importez, enrichissez, suivez vos pistes",
    topbar_phonefinder: "Recherche Tél.",
    topbar_phonefinder_sub: "Enrichit des numéros manquants via Google Places",
    topbar_workspace: "Workspace",
    topbar_workspace_empty: "Sélectionnez un deal",
    flag_banner: "Soumettre ce lead à Anthony",
    flag_note_placeholder: "Note pour Anthony (optionnel)…",
    flag_submit: "Soumettre",
    flag_submitted: "Lead soumis à Anthony.",
    flag_resubmit: "Déjà soumis · mettre à jour",
    admin_flags_title: "Leads soumis par Gaylord",
    admin_flags_empty: "Aucun lead soumis pour le moment.",
    admin_flags_note_label: "Note:",
    flag_view: "Voir",
    flag_dismiss: "✓ Vu",
    delete: "Supprimer",
    chat_title: "Assistant SOCLE",
    chat_send: "Envoyer",
    chat_placeholder: "Posez votre question…",
    chat_thinking: "Réflexion…",
    chat_greet: (name) => `Bonjour ${name} ! Je suis l'assistant SOCLE. Posez-moi vos questions sur le CRM (stages, leads, follow-ups, calendrier, etc.) pour éviter de déranger Anthony.`,
    lang_switch: "EN",

    // Leads page (merged owner-grouped view) -----------------------------
    leads_label_proprio: "Propriétaire",
    leads_search_placeholder: "Rechercher propriétaire, compagnie, téléphone… (⌘K)",
    leads_filter_all_stages: "Tous les statuts",
    leads_filter_all_sources: "Tous les numéros",
    leads_filter_missing_phone: "Numéro manquant",
    leads_sort_buildings: "Tri: plus de propriétés",
    leads_sort_phones: "Tri: plus de numéros",
    leads_sort_name: "Tri: nom A–Z",
    leads_btn_import: "Importer un rôle",
    leads_btn_import_busy: "Lecture…",
    leads_btn_enrich: "Enrichir numéros manquants",
    leads_btn_enrich_busy: "Recherche…",
    leads_btn_test100: "▶︎ Tester 100 d'abord",
    leads_header_title: "Propriétaires",
    leads_header_counts: (bldCount, bldS, phCount, phS) =>
      `${bldCount} propriété${bldS} · ${phCount} numéro${phS} tracé${phS}`,
    leads_header_missing: (n) => ` · ${n} sans numéro`,
    leads_hint: "Un propriétaire = une adresse postale. Les compagnies à numéro sont regroupées comme aliases.",
    leads_empty_title: "Aucun propriétaire pour le moment",
    leads_empty_body: "Importez un rôle d'évaluation avec le bouton « Importer un rôle » ci-dessus.",
    leads_empty_search: (q) => `Aucun propriétaire ne correspond à « ${q} »`,
    leads_select_hint: "Sélectionnez un propriétaire à gauche pour voir sa fiche.",
    leads_loading: "Chargement des propriétaires…",
    leads_err_label: "la page Leads",
    leads_no_buildings: "Aucune propriété enregistrée.",
    leads_no_companies: "Aucune compagnie recensée.",
    leads_no_phones: "Aucun numéro tracé pour l'instant.",
    leads_no_emails: "Aucun courriel.",
    leads_buildings_tt: "Toutes les propriétés détenues par ce propriétaire",
    leads_phones_tt: "Les badges indiquent la provenance de chaque numéro",
    leads_companies_tt: "Toutes les entités à numéro et fiducies de ce propriétaire",
    leads_contacts_tt: "Les personnes identifiées à cette adresse postale (conjoints, etc.)",
    leads_count_buildings: (n, s) => `${n} propriété${s}`,
    leads_count_phones: (n) => `${n} tél`,
    leads_count_also: (names) => `Aussi: ${names}`,
    leads_places_matched: "Places a associé ce propriétaire à :",
    leads_call_notes: "Notes d'appel",
    leads_call_notes_placeholder: "Notes d'appel, impressions, prochaine étape…",
    leads_ia_btn: "✦ IA",
    leads_ia_btn_busy: "Organisation…",
    leads_ia_label: "✦ Résumé IA",
    leads_ia_placeholder: "Résumé IA — cliquez pour organiser les notes",
    leads_ia_clear: "Effacer",
    leads_ia_err_empty: "Ajoutez des notes avant d'utiliser l'IA.",
    leads_ia_err_server: "Erreur de connexion au serveur.",

    // Finances section --------------------------------------------------
    fin_section: "Finances",
    fin_revenue: "Revenu brut annuel ($)",
    fin_revenue_en_short: "Gross annual income",
    fin_expenses: "Dépenses annuelles ($)",
    fin_expenses_en_short: "Annual expenses",
    fin_noi: "NOI",
    fin_total_units: "Total unités",
    fin_unit_mix: "Unit mix",
    fin_unit_1_5: "1½",
    fin_unit_2_5: "2½",
    fin_unit_3_5: "3½",
    fin_unit_4_5: "4½",
    fin_unit_5_5: "5½+",

    // Stage labels (owner/lead) ----------------------------------------
    stage_new: "Nouveau",
    stage_to_call: "À appeler",
    stage_contacted: "Contacté",
    stage_qualified: "Qualifié",
    stage_converted: "Converti",
    stage_closed: "Fermé",
    stage_lost: "Perdu",

    // Deal-pipeline stages (the ones surfaced on cards) ----------------
    pipeline_prospection: "Prospection",
    pipeline_negotiation: "Négociation",
    pipeline_due_diligence: "Due diligence",
    pipeline_closing: "Closing",
    pipeline_lost: "Perdu",

    // Phone-source badges -----------------------------------------------
    src_excel: "Excel",
    src_places: "Places",
    src_manual: "Manuel",
    src_migrated: "Importé",

    // Import modal -------------------------------------------------------
    import_title: "Importer un rôle d'évaluation",
    import_cancel: "Annuler",
    import_only: "Importer seulement",
    import_enrich_100: "Importer + tester 100",
    import_enrich_all: "Importer + enrichir tout",
    import_filters_title: "Filtres de ciblage (optionnels)",
    import_preview_title: "Aperçu — 5 premiers propriétaires",
    import_done: (newN, updN, leadsN) =>
      `Import terminé · ${newN} nouveau${newN > 1 ? "x" : ""} · ${updN} mis à jour · ${leadsN} propriété${leadsN > 1 ? "s" : ""} ajoutée${leadsN > 1 ? "s" : ""}.`,

    // Enrichment notices -------------------------------------------------
    enrich_none_targeted: "Aucun propriétaire à enrichir avec ces critères.",
    enrich_none_usable: "Aucun propriétaire ciblé n'a une adresse postale exploitable.",
    enrich_cap_hit: (cost) => `Plafond quotidien atteint (${cost}). Réessayez demain.`,
    enrich_budget_hit: "Budget quotidien Google Places atteint. Réessayez demain.",
    enrich_ok: (found, foundS, total) => `${found} propriétaire${foundS} enrichi${foundS} sur ${total}.`,
    enrich_nothing_found: (n, s) => `Aucun nouveau numéro trouvé sur ${n} recherche${s}.`,

    // Toasts & misc ------------------------------------------------------
    toast_saved: "Enregistré.",
    toast_storage_full: "Stockage local plein. Exportez puis retirez des leads pour libérer de l'espace.",
    loading_generic: "Chargement…",

    // --- Sidebar ---
    sidebar_tag: "Investissement Immobilier",
    sidebar_recent_deals: "Deals récents",
    sidebar_no_deals: "Aucun deal encore.",
    sidebar_no_contact: "Sans contact",

    // --- Dashboard ---
    dashboard_kpi_total: "Deals Total",
    dashboard_kpi_total_sub: (n) => `+${n} cette semaine`,
    dashboard_kpi_closing: "En Closing",
    dashboard_kpi_closing_sub: "Progression solide",
    dashboard_kpi_overdue: "Follow-ups Retard",
    dashboard_kpi_overdue_action: "Action requise",
    dashboard_kpi_overdue_ok: "Sous contrôle",
    dashboard_today_title: "À faire aujourd'hui",
    dashboard_today_empty: "Rien de prévu — bonne journée.",
    dashboard_today_overdue: (n) => `${n} en retard`,
    dashboard_today_due: (n) => `${n} aujourd'hui`,
    dashboard_today_events: (n) => `${n} événement${n > 1 ? "s" : ""}`,
    dashboard_today_followup_label: "Follow-up",
    dashboard_today_event_label: "Événement",
    dashboard_today_overdue_by: (n) => `en retard de ${n} jour${n > 1 ? "s" : ""}`,
    dashboard_today_due_today: "à faire aujourd'hui",
    dashboard_kpi_prospection: "En Prospection",
    dashboard_kpi_prospection_sub: "Flux actif",
    dashboard_section_pipeline: "Pipeline des Acquisitions",
    dashboard_section_pipeline_full: "Vue complète",
    dashboard_section_activity: "Activité Récente",
    dashboard_activity_empty: "Aucune activité encore.",
    dashboard_section_tasks: "Tâches à Compléter",
    dashboard_section_tasks_all: "Voir tout",
    dashboard_section_top_opps: "Top Opportunités",
    dashboard_no_followups: "Aucun follow-up planifié.",
    dashboard_no_opps: "Ajoutez des deals pour voir les opportunités.",
    dashboard_task_default: "Suivi à compléter",
    dashboard_followup_label: "Suivi requis",
    dashboard_followup_today: "Aujourd'hui",
    dashboard_followup_overdue: (n) => `${n}j retard`,
    dashboard_followup_in: (n) => `Dans ${n}j`,
    dashboard_map_full: "Voir la carte complète",
    dashboard_map_loading: "Chargement de la carte…",

    // --- Pipeline ---
    pipeline_empty_col: "Aucun deal",
    pipeline_no_contact: "Contact à définir",
    pipeline_price_tbd: "Prix: À valider",
    pipeline_followup_label: "Suivi",
    pipeline_documents_label: "Documents",
    pipeline_checklist_label: (pct) => `Checklist ${pct}%`,

    // --- Map ---
    map_stages_header: "Étapes",
    map_filter_label: "Filtrer",
    map_filter_all: "Toutes les étapes",
    map_status_shown: (n) => `${n} deal(s) affiché(s) sur la carte.`,
    map_status_empty: "Aucun deal géocodé pour ce filtre. Ajoutez une adresse dans CRM & Suivi pour afficher un pin.",
    map_err_label: "la carte",
    map_popup_open: "Ouvrir le deal",
    map_close: "Fermer la carte",
    map_back: "← Tableau de bord",

    // --- Follow-ups view ---
    followups_empty_title: "Aucun Follow-up",
    followups_empty_sub: "Ajoutez une date de suivi dans l'onglet CRM d'un deal.",

    // --- Calendar ---
    cal_btn_connecting: "Connexion...",
    cal_btn_refresh: "Actualiser Google Calendar",
    cal_btn_connect: "Connecter Google Calendar",
    cal_connected: "Google Calendar connecté",
    cal_new_event: "＋ Événement",
    cal_loading_events: "Chargement des événements Google Calendar…",
    cal_err_client_missing: "REACT_APP_GCAL_CLIENT_ID manquant.",
    cal_err_oauth_missing: "Google OAuth non chargé. Rafraîchissez la page.",
    cal_err_auth: "Authentification Google refusée ou invalide.",
    cal_err_load: "Impossible de charger les événements Google Calendar.",
    cal_event_untitled: "(Sans titre)",
    cal_next_events: "Prochains Événements",
    cal_no_upcoming: "Aucun événement à venir.",
    cal_source_google: "Google Calendar",
    cal_month_0: "Janvier",
    cal_month_1: "Février",
    cal_month_2: "Mars",
    cal_month_3: "Avril",
    cal_month_4: "Mai",
    cal_month_5: "Juin",
    cal_month_6: "Juillet",
    cal_month_7: "Août",
    cal_month_8: "Septembre",
    cal_month_9: "Octobre",
    cal_month_10: "Novembre",
    cal_month_11: "Décembre",
    cal_day_0: "Dim",
    cal_day_1: "Lun",
    cal_day_2: "Mar",
    cal_day_3: "Mer",
    cal_day_4: "Jeu",
    cal_day_5: "Ven",
    cal_day_6: "Sam",

    // --- Workspace (deal detail) ---
    ws_empty_title: "Aucun Deal",
    ws_empty_sub: "Sélectionnez un deal dans la barre de gauche pour commencer.",
    ws_empty_cta: "＋ Nouveau deal",
    ws_address_todo: "Adresse à compléter",
    ws_address_placeholder: "Adresse / secteur à renseigner",
    ws_units_suffix: (n) => `• ${n} unités`,
    ws_updated_on: (d) => `Mis à jour le ${d}`,
    ws_phonefinder_err_label: "Recherche Tél",
    ws_phonefinder_loading: "Chargement de Recherche Tél…",

    // Workspace tabs
    ws_tab_crm: "CRM & Suivi",
    ws_tab_notes: "Notes",
    ws_tab_documents: "Documents",
    ws_tab_checklist: "Checklist",
    ws_tab_activity: "Activité",
    ws_tab_agent: "Agent",

    // Contact card
    ws_contact_title: "Contact (vendeur / courtier)",
    ws_contact_main: "Contact principal",
    ws_contact_role_todo: "Rôle à définir",
    ws_contact_name: "Nom",
    ws_contact_phone: "Téléphone",
    ws_contact_email: "Email",
    ws_contact_company: "Compagnie",
    ws_contact_role: "Rôle",
    ws_call_start: "Appeler ce contact",
    ws_call_busy: "Appel en cours...",
    ws_call_refresh: "Actualiser appels",
    ws_call_loading: "Chargement...",
    ws_call_history_title: "Historique des appels",
    ws_call_history_empty: "Aucun appel enregistré pour ce deal.",
    ws_call_err_no_phone: "Ajoutez un téléphone dans la fiche contact avant d'appeler.",
    ws_call_err_generic: "Impossible de lancer l'appel.",
    ws_call_err_history: "Impossible de charger l'historique des appels.",
    ws_call_err_transcript: "Impossible de relancer la transcription.",
    ws_call_ok_launched: "Appel lancé. Le statut et l'enregistrement vont se mettre à jour automatiquement.",
    ws_call_ok_transcript: "Transcription relancée. Rafraîchissez dans quelques secondes.",
    ws_call_act_launched: (name) => `Appel lancé vers ${name}`,
    ws_call_unknown: "inconnu",
    ws_call_contact_fallback: "Contact",
    ws_call_transcript_prefix: "Transcript:",
    ws_call_listen: "Écouter",
    ws_call_retry_transcript: "Relancer transcript",
    ws_call_show_transcript: "Voir la transcription",
    err_status: (s) => `Erreur ${s}`,

    // Suivi & priorité card
    ws_section_priority: "Suivi & Priorité",
    ws_priority_label: "Priorité",
    ws_priority_high: "Haute",
    ws_priority_medium: "Moyenne",
    ws_priority_low: "Basse",
    ws_priority_tag_high: "CHAUD",
    ws_priority_tag_medium: "TIÈDE",
    ws_priority_tag_low: "FROID",
    ws_field_units: "Nombre d'unités",
    ws_field_units_ph: "Ex: 6",
    ws_field_price: "Prix demandé ($)",
    ws_field_price_ph: "Ex: 900000",
    ws_field_followup_date: "Date de follow-up",
    ws_field_followup_note: "Note de suivi",
    ws_field_followup_note_ph: "Ex: Rappeler pour contre-offre…",
    ws_field_next_action: "Prochaine action",
    ws_field_next_action_ph: "Ex: Déposer l'offre d'achat",
    ws_field_address: "Adresse",
    ws_field_address_ph: "Ex: 320 rue Bouchard, Saint-Jean-sur-Richelieu",

    ws_section_activity: "Enregistrer une activité",

    // Notes tab
    ws_notes_deal: "Notes deal",
    ws_notes_vendor: "Notes vendeur",
    ws_notes_deal_ph: "Prix demandé, état général, potentiel, quartier, historique, stratégie…",
    ws_notes_vendor_ph: "Motivation du vendeur, délai, flexibilité prix, points sensibles, style de négociation…",
    ws_ai_btn: "✦ Formater",
    ws_ai_btn_busy: "Formatage...",
    ws_ai_box_label: "✦ Notes CRM formatées",
    ws_ai_clear: "Effacer",
    ws_ai_err_empty: "Ajoutez des notes avant de formater.",
    ws_ai_err_api: "Erreur API.",
    ws_ai_err_server: "Erreur de connexion au serveur.",
    ws_ai_err_network: "Erreur réseau.",

    // Documents tab
    ws_doc_download: "Télécharger",
    ws_doc_close: "Fermer",
    ws_doc_viewer_err: "le tableur",
    ws_doc_viewer_loading: "Chargement du tableur…",
    ws_doc_preview_unavailable: "Prévisualisation non disponible.",
    ws_doc_drop_title: "Glissez vos fichiers ici ou cliquez pour sélectionner",
    ws_doc_drop_sub: "PDF, images, Word, Excel — tous formats acceptés",
    ws_doc_empty: "Aucun document pour ce deal.",
    ws_doc_added: (n, names) => `${n} document${n > 1 ? "s" : ""} ajouté${n > 1 ? "s" : ""}: ${names}`,

    // Checklist tab
    ws_checklist_title: "Checklist par étape",
    ws_checklist_add_ph: "Ajouter un item…",
    ws_checklist_add_btn: "Ajouter",

    // Activity tab
    ws_activity_history: "Historique",
    ws_activity_stage_move: (lbl) => `Étape → ${lbl}`,

    // --- Stage catalog (deal pipeline) ---
    stage_prospection: "Prospection",
    stage_analyse: "Analyse",
    stage_offre: "Offre déposée",
    stage_due_diligence: "Due diligence",
    stage_financement: "Financement",
    stage_closing: "Closing",
    stage_perdu: "Perdu",

    // --- Modals ---
    modal_new_deal_title: "Nouveau deal",
    modal_new_field_address: "Adresse de la propriété",
    modal_new_address_ph: "Ex: 11 rue Molleur, Saint-Jean-sur-Richelieu",
    modal_cancel: "Annuler",
    modal_new_submit: "Créer le deal",
    modal_event_title: "Nouvel événement",
    modal_event_field_title: "Titre",
    modal_event_title_ph: "Ex: Inspection 320 rue Bouchard",
    modal_event_field_date: "Date",
    modal_event_field_time: "Heure (optionnel)",
    modal_event_field_deal: "Associer à un deal",
    modal_event_select_placeholder: "— Sélectionner —",
    modal_event_submit: "Créer",
    modal_event_err_no_deal: "Associez l'événement à un deal.",
    modal_event_act_created: (title, date) => `Événement: ${title} le ${date}`,

    // Deal defaults
    deal_default_title: "Nouveau deal",
    deal_lead_imported: "Lead importé",
    deal_lead_other_phones: (list) => `Autres numéros: ${list}`,
    deal_lead_converted: "Lead converti en deal",
    deal_confirm_delete: "Supprimer ce deal ?",

    // --- PhoneFinder (page) ---
    pf_source_title: (t) => `Recherche Tél. · ${t}`,
    pf_source_default: "Recherche Tél.",
    pf_imported_from_with: (t) => `Importé depuis Recherche Tél. (${t})`,
    pf_imported_from: "Importé depuis Recherche Tél.",
    pf_header_title: "Recherche de Numéros",
    pf_header_sub: "Google Places · imports sauvegardés localement",
    pf_spend_today: (rows, cost) => `Aujourd'hui · ${rows} lignes · ~${cost}`,
    pf_spend_tooltip: (rows) => `${rows} lignes enrichies aujourd'hui (estimation Google Places Essentials 2025)`,
    pf_export_busy: "Export…",
    pf_export_found_btn: (n) => `⇢ Leads trouvés (${n})`,
    pf_view_results: "Voir résultats",
    pf_export_csv: "Exporter CSV",
    pf_clear_all: "Vider",
    pf_tab_search: "Recherche",
    pf_tab_results: (n) => `Résultats (${n})`,
    pf_tab_manual: "Recherche manuelle",
    pf_tab_csv: "Import CSV / XLSX",
    pf_manual_section: "Informations de recherche",
    pf_field_name: "Nom de l'entreprise",
    pf_field_name_ph: "Ex: Dépanneur Bélanger",
    pf_field_address: "Adresse",
    pf_field_address_ph: "Ex: 320 rue Bouchard",
    pf_field_city: "Ville",
    pf_field_city_ph: "Ex: Saint-Jean-sur-Richelieu",
    pf_field_province: "Province",
    pf_field_province_ph: "Ex: Québec",
    pf_field_postal: "Code postal",
    pf_field_postal_ph: "Ex: J3B 6N5",
    pf_field_country: "Pays",
    pf_field_country_ph: "Canada",
    pf_btn_search: "Rechercher",
    pf_btn_searching: "Recherche…",
    pf_csv_section: "Import CSV / XLSX",
    pf_csv_stats: (rows, cols, sep) => `${rows} lignes · ${cols} colonnes · séparateur : ${sep}`,
    pf_csv_drop: "Glissez un CSV/XLSX ou cliquez pour choisir",
    pf_csv_hint: "Colonnes utiles : adresse immeuble, entreprise, nom complet, ville, province, code postal",
    pf_csv_detected: (rows, mapped) => `${rows} lignes • ${mapped} colonnes détectées automatiquement`,
    pf_csv_advanced_mapping: "mappage avancé (optionnel)",
    pf_csv_search_n: (n) => `Rechercher ${n} lignes`,
    pf_csv_running: "Recherche en cours…",
    pf_empty_saved_title: "Aucun import sauvegardé",
    pf_empty_saved_sub: "Lancez une recherche manuelle ou un import CSV. Chaque import sera enregistré dans l'onglet Résultats avec une date.",
    pf_empty_results_sub: "Retournez dans l'onglet Recherche pour lancer une recherche. Les résultats seront sauvegardés automatiquement avec la date.",
    pf_empty_results_cta: "Aller à la recherche",
    pf_last_import: (title, n) => `Dernier import : ${title} · ${n} lignes`,
    pf_open_results: "Ouvrir les résultats",
    pf_saved_imports: "Imports sauvegardés",
    pf_rows_found_sub: (rows, found) => `${rows} lignes · ${found} trouvés`,
    pf_rename_title: "Renommer",
    pf_confirm_delete_run: "Supprimer cet import sauvegardé ?",
    pf_delete_all_confirm: "Effacer tous les imports sauvegardés ?",
    pf_rename_prompt: "Nouveau titre pour cet import :",
    pf_rename_err_empty: "Le titre ne peut pas être vide.",
    pf_export_no_phones: "Aucun numéro trouvé à exporter.",
    pf_export_unavailable: "Export vers Leads indisponible.",
    pf_export_leads_updated: (parts) => `Leads mis à jour: ${parts} · aucune donnée supprimée`,
    pf_export_part_new: (n) => `${n} nouveau${n > 1 ? "x" : ""}`,
    pf_export_part_updated: (n) => `${n} enrichi${n > 1 ? "s" : ""}`,
    pf_export_part_skipped: (n) => `${n} inchangé${n > 1 ? "s" : ""}`,
    pf_export_nothing_new: "Tous les numéros trouvés sont déjà dans Leads.",
    pf_export_impossible: (e) => `Export impossible: ${e}`,
    pf_active_run_summary: (date, rows, found) => `${date} · ${rows} lignes · ${found} numéros trouvés`,
    pf_export_status_label_prefix: "Export vers Leads:",
    pf_export_status_current: "Trouvé uniquement (filtre affiché)",
    pf_export_found_leads: (n) => `⇢ Exporter ${n} leads trouvés`,
    pf_rename_btn: "Renommer",
    pf_export_this_import: "Exporter cet import",
    pf_filter_ph: "Filtrer les résultats… (⌘K)",
    pf_filter_status_all: "Tous les statuts",
    pf_filter_status_found: "Trouvé",
    pf_filter_status_review: "À vérifier",
    pf_filter_status_multi: "Choix multiple",
    pf_filter_status_not_found: "Non trouvé",
    pf_rerun_not_found: "Relancer non trouvés",
    pf_rerun_not_found_tt: "Relancer la recherche Google Places pour toutes les lignes non trouvées dans cette session",
    pf_shown_of: (shown, total) => `${shown} affichés sur ${total}`,
    pf_results_count: (n) => `${n} résultat${n !== 1 ? "s" : ""}`,
    pf_total_suffix: (n) => ` (total: ${n})`,
    pf_th_num: "#",
    pf_th_search: "Recherche",
    pf_th_match: "Correspondance trouvée",
    pf_th_phone: "Téléphone",
    pf_th_website: "Site web",
    pf_th_conf: "Conf.",
    pf_th_status: "Statut",
    pf_th_actions: "Actions",
    pf_show_more: (count, remaining) => `Afficher ${count} de plus (${remaining} restants)`,
    pf_no_results_title: "Aucun résultat dans cet import",
    pf_no_results_sub: "Cet import existe mais ne contient pas de lignes affichables avec le filtre actuel.",
    pf_stop: "⏹ Arrêter",
    pf_processing: (done, total) => `${done} / ${total} lignes traitées`,
    pf_remaining: (pct, seconds) => `${pct}% · ~${seconds}s restantes`,
    pf_connecting: "Connexion à Google Places…",
    pf_progress_label: (pct) => `${pct}%`,
    pf_review_title: "Choisir le bon résultat",
    pf_review_query: "Recherche :",
    pf_review_anon: "(sans nom)",
    pf_review_mark_notfound: "Marquer introuvable",
    pf_review_cancel: "Annuler",
    pf_colmap_title: "Mapper les colonnes d'import",
    pf_colmap_stats: (rows, cols, sep) => `${rows} lignes · ${cols} colonnes détectées (séparateur : ${sep})`,
    pf_colmap_hint: "Assignez vos colonnes (adresse, entreprise, contact). L'adresse immeuble est recommandée pour une recherche fiable.",
    pf_colmap_ignore: "— Ignorer —",
    pf_colmap_close: "Fermer",
    pf_colmap_confirm: "Confirmer le mappage",
    pf_confirm_title: "Confirmer la recherche téléphones",
    pf_confirm_body: (n) => `Vous êtes sur le point d'enrichir ${n} ${n === 1 ? "ligne" : "lignes"} via Google Places.`,
    pf_confirm_est_label: "Coût estimé",
    pf_confirm_range: (lo, hi) => `Fourchette : ${lo} – ${hi}`,
    pf_confirm_calls: (lo1, hi1, lo2, hi2) => `Appels estimés : ${lo1}–${hi1} Text Search + ${lo2}–${hi2} Details`,
    pf_confirm_note: "Les lignes résidentielles (Logement · Physique) ne font aucun appel. Les doublons d'adresse dans le même lot sont mis en cache.",
    pf_confirm_cancel: "Annuler",
    pf_confirm_launch: "Lancer la recherche",
    pf_status_found: "Trouvé",
    pf_status_review: "À vérifier",
    pf_status_multi: "Choix multiple",
    pf_status_not_found: "Non trouvé",
    pf_err_need_name_or_addr: "Entrez un nom d'entreprise ou une adresse.",
    pf_err_no_rows: "Aucune ligne exploitable dans ce fichier.",
    pf_err_budget: "Budget quotidien Google Places atteint. Réessayez demain.",
    pf_err_server: "Erreur serveur",
    pf_err_server_code: (code) => `Erreur serveur (${code}).`,
    pf_err_import: (e) => `Import impossible: ${e}`,
    pf_err_no_rows_parsed: "Le fichier ne contient pas de lignes importables.",
    pf_err_network_batch: (n, m) => `Erreur réseau (lot ${n}): ${m}`,
    pf_err_network: (e) => `Erreur réseau: ${e}`,
    pf_err_generic: (e) => `Erreur: ${e}`,
    pf_rerun_toast_found: "Relancé · numéro trouvé !",
    pf_rerun_toast_not_found: "Relancé · toujours introuvable",
    pf_rerun_none: "Aucun résultat non trouvé relançable (fichier non rechargé depuis la session courante).",
    pf_rerun_summary: (done, found) => `${done} relancés · ${found} nouveau${found !== 1 ? "x" : ""} numéro${found !== 1 ? "s" : ""} trouvé${found !== 1 ? "s" : ""}`,
    pf_batch_ok: (done, found) => `${done} lignes traitées · ${found} numéros trouvés`,
    pf_sep_tab: "TAB",
    pf_run_default_manual: (stamp) => `Recherche manuelle · ${stamp}`,
    pf_run_default_csv: (stamp) => `Import CSV · ${stamp}`,
    pf_run_legacy: (stamp) => `Historique importé · ${stamp}`,
    pf_run_import_of: (stamp) => `Import du ${stamp}`,

    // PhoneFinder column-mapping field labels
    pf_fl_name: "Nom de recherche",
    pf_fl_company: "Entreprise / Organisation",
    pf_fl_leadContact: "Contact / Propriétaire",
    pf_fl_phone: "Téléphone (déjà connu)",
    pf_fl_address: "Adresse immeuble",
    pf_fl_city: "Ville",
    pf_fl_province: "Province",
    pf_fl_postalCode: "Code postal",
    pf_fl_country: "Pays",
    pf_fh_name: "optionnel, utilisé pour la recherche Places",
    pf_fh_company: "optionnel, prioritaire pour la recherche si présent",
    pf_fh_leadContact: "optionnel, conservé pour savoir qui appeler",
    pf_fh_phone: "optionnel, ajouté au lead à l'export",
    pf_fh_address: "très recommandé",
    pf_fh_city: "optionnel",
    pf_fh_province: "optionnel",
    pf_fh_postalCode: "optionnel",
    pf_fh_country: "optionnel",

    pf_csv_example: (v) => `→ ex: "${v}"`,
    // PhoneFinder exportCSV headers + file name stem
    pf_csv_hdr_company: "Entreprise",
    pf_csv_hdr_contact: "Contact",
    pf_csv_hdr_building: "Bâtiment",
    pf_csv_hdr_input_name: "Nom saisi",
    pf_csv_hdr_input_address: "Adresse saisie",
    pf_csv_hdr_matched_name: "Nom trouvé",
    pf_csv_hdr_matched_address: "Adresse trouvée",
    pf_csv_hdr_phone: "Téléphone trouvé",
    pf_csv_hdr_file_phones: "Téléphones fichier",
    pf_csv_hdr_website: "Site web",
    pf_csv_hdr_source: "Source",
    pf_csv_hdr_confidence: "Confiance %",
    pf_csv_hdr_status: "Statut",
    pf_csv_hdr_date: "Date",
    pf_csv_download_stem: "recherche-tel",
    fmt_date_unknown: "Date inconnue",

    // OwnersManager extras (some FR-only literals)
    owner_unknown: "(Propriétaire inconnu)",
    om_fiche_props_count: (n) => `${n} × propriét${n === 1 ? "é" : "és"}`,
    om_progress: (done, total, found) => `${done} / ${total} · ${found}`,
    om_import_stats_properties: "propriétés",
    om_import_stats_unique: "propriétaires uniques",
    om_import_stats_with_phone: "avec numéro dans le rôle",
    om_import_stats_to_lookup: "à rechercher via Places",
    om_import_est_cost: "Coût estimé de l'enrichissement:",
    om_missing_mailing: "(adresse postale manquante)",
    om_import_no_address: "(adresse postale manquante)",
    om_filter_min_value: "Valeur de l'immeuble ≥",
    om_filter_max_year: "Année de construction ≤",
    om_filter_inscription: "Inscrit au rôle avant",
    om_filter_units_between: "Unités entre",
    om_err_server_generic: (code) => `Erreur serveur (${code}).`,
    om_err_network: (e) => `Erreur réseau: ${e}`,

    // ChatWidget aria
    chat_close_label: "Fermer",

    // ─── Push notifications ───
    push_enable: "Activer les notifications",
    push_enabled: "Notifications activées",
    push_disable: "Désactiver",
    push_unsupported: "Notifications non supportées sur ce navigateur.",
    push_denied: "Notifications bloquées. Activez-les dans les réglages du navigateur.",
    push_subscribing: "Activation…",
    push_test: "Envoyer un test",
    push_test_title: "SOCLE — Test",
    push_test_body: "Les notifications push fonctionnent !",
    push_flag_title: "Nouveau lead à revoir",
    push_flag_body: (user, label) => `${user} a signalé « ${label || "un lead"} » pour revue.`,
    push_not_configured: "Serveur push non configuré.",
  },
  en: {
    login_title: "SOCLE Sign-in",
    login_tag: "Choose your profile",
    login_pin_placeholder: "4-digit PIN",
    login_submit: "Enter",
    login_error: "Incorrect PIN.",
    logout: "Sign out",
    nav_dashboard: "Dashboard",
    nav_pipeline: "Pipeline",
    nav_map: "Map",
    nav_followups: "Follow-ups",
    nav_calendar: "Calendar",
    nav_owners: "Investors",
    nav_leads: "Leads",
    nav_phonefinder: "Phone Finder",
    nav_new_deal: "＋ New deal",
    topbar_dashboard: "Dashboard",
    topbar_dashboard_sub: "Overview · deals, follow-ups, activity",
    topbar_pipeline: "Pipeline",
    topbar_pipeline_sub: "Drag deals from one stage to the next",
    topbar_map: "Map",
    topbar_map_sub: "Geographic view of deals across Québec",
    topbar_followups: "Follow-ups",
    topbar_followups_sub: "Calls and follow-ups to make",
    topbar_calendar: "Calendar",
    topbar_calendar_sub: "Deal events and deadlines",
    topbar_owners: "Investors",
    topbar_owners_sub: "One investor = one mailing address. Companies, phone numbers and properties all grouped.",
    topbar_leads: "Leads",
    topbar_leads_sub: "Property owners — import, enrich, track your leads",
    topbar_phonefinder: "Phone Finder",
    topbar_phonefinder_sub: "Fills missing numbers via Google Places",
    topbar_workspace: "Workspace",
    topbar_workspace_empty: "Select a deal",
    flag_banner: "Submit this lead to Anthony",
    flag_note_placeholder: "Note for Anthony (optional)…",
    flag_submit: "Submit",
    flag_submitted: "Lead submitted to Anthony.",
    flag_resubmit: "Already submitted · update",
    admin_flags_title: "Leads submitted by Gaylord",
    admin_flags_empty: "No submitted leads.",
    admin_flags_note_label: "Note:",
    flag_view: "Open",
    flag_dismiss: "✓ Seen",
    delete: "Delete",
    chat_title: "SOCLE Assistant",
    chat_send: "Send",
    chat_placeholder: "Ask a question…",
    chat_thinking: "Thinking…",
    chat_greet: (name) => `Hi ${name}! I'm the SOCLE assistant. Ask me anything about the CRM (stages, leads, follow-ups, calendar, etc.) so you don't have to call Anthony.`,
    lang_switch: "FR",

    leads_label_proprio: "Owner",
    leads_search_placeholder: "Search owner, company, phone… (⌘K)",
    leads_filter_all_stages: "All statuses",
    leads_filter_all_sources: "All phone sources",
    leads_filter_missing_phone: "Missing phone",
    leads_sort_buildings: "Sort: most properties",
    leads_sort_phones: "Sort: most phones",
    leads_sort_name: "Sort: name A–Z",
    leads_btn_import: "Import a rôle",
    leads_btn_import_busy: "Reading…",
    leads_btn_enrich: "Enrich missing numbers",
    leads_btn_enrich_busy: "Searching…",
    leads_btn_test100: "▶︎ Test 100 first",
    leads_header_title: "Property owners",
    leads_header_counts: (bldCount, bldS, phCount, phS) =>
      `${bldCount} propert${bldCount === 1 ? "y" : "ies"} · ${phCount} tracked phone${phS}`,
    leads_header_missing: (n) => ` · ${n} missing phone`,
    leads_hint: "One owner = one mailing address. Numbered companies roll up as aliases.",
    leads_empty_title: "No owners yet",
    leads_empty_body: "Import a rôle to get started — use the « Import a rôle » button above.",
    leads_empty_search: (q) => `No owner matches « ${q} »`,
    leads_select_hint: "Select an owner on the left to view their fiche.",
    leads_loading: "Loading owners…",
    leads_err_label: "the Leads page",
    leads_no_buildings: "No properties on file.",
    leads_no_companies: "No companies on file.",
    leads_no_phones: "No phone tracked yet.",
    leads_no_emails: "No email.",
    leads_buildings_tt: "All properties held by this owner",
    leads_phones_tt: "Badges show the source of each phone number",
    leads_companies_tt: "All numbered entities and trusts belonging to this owner",
    leads_contacts_tt: "People identified at this mailing address (spouses, etc.)",
    leads_count_buildings: (n) => `${n} propert${n === 1 ? "y" : "ies"}`,
    leads_count_phones: (n) => `${n} ph`,
    leads_count_also: (names) => `Also: ${names}`,
    leads_places_matched: "Places matched this owner to:",
    leads_call_notes: "Call notes",
    leads_call_notes_placeholder: "Call notes, impressions, next step…",
    leads_ia_btn: "✦ AI",
    leads_ia_btn_busy: "Organizing…",
    leads_ia_label: "✦ AI summary",
    leads_ia_placeholder: "AI summary — click to organize notes",
    leads_ia_clear: "Clear",
    leads_ia_err_empty: "Add notes before using AI.",
    leads_ia_err_server: "Server connection error.",

    fin_section: "Finances",
    fin_revenue: "Gross annual income ($)",
    fin_revenue_en_short: "Gross annual income",
    fin_expenses: "Annual expenses ($)",
    fin_expenses_en_short: "Annual expenses",
    fin_noi: "NOI",
    fin_total_units: "Total units",
    fin_unit_mix: "Unit mix",
    fin_unit_1_5: "1½",
    fin_unit_2_5: "2½",
    fin_unit_3_5: "3½",
    fin_unit_4_5: "4½",
    fin_unit_5_5: "5½+",

    stage_new: "New",
    stage_to_call: "To call",
    stage_contacted: "Contacted",
    stage_qualified: "Qualified",
    stage_converted: "Converted",
    stage_closed: "Closed",
    stage_lost: "Lost",

    pipeline_prospection: "Prospecting",
    pipeline_negotiation: "Negotiation",
    pipeline_due_diligence: "Due diligence",
    pipeline_closing: "Closing",
    pipeline_lost: "Lost",

    src_excel: "Excel",
    src_places: "Places",
    src_manual: "Manual",
    src_migrated: "Legacy",

    import_title: "Import an évaluation rôle",
    import_cancel: "Cancel",
    import_only: "Import only",
    import_enrich_100: "Import + test 100",
    import_enrich_all: "Import + enrich all",
    import_filters_title: "Targeting filters (optional)",
    import_preview_title: "Preview — first 5 owners",
    import_done: (newN, updN, leadsN) =>
      `Import done · ${newN} new · ${updN} updated · ${leadsN} propert${leadsN === 1 ? "y" : "ies"} added.`,

    enrich_none_targeted: "No owner matches the enrichment criteria.",
    enrich_none_usable: "No targeted owner has a usable mailing address.",
    enrich_cap_hit: (cost) => `Daily cap hit (${cost}). Try again tomorrow.`,
    enrich_budget_hit: "Daily Google Places budget hit. Try again tomorrow.",
    enrich_ok: (found, _foundS, total) => `${found} owner${found === 1 ? "" : "s"} enriched out of ${total}.`,
    enrich_nothing_found: (n) => `No new number found over ${n} search${n === 1 ? "" : "es"}.`,

    toast_saved: "Saved.",
    toast_storage_full: "Local storage full. Export and remove leads to free up space.",
    loading_generic: "Loading…",

    // --- Sidebar ---
    sidebar_tag: "Real Estate Investment",
    sidebar_recent_deals: "Recent deals",
    sidebar_no_deals: "No deals yet.",
    sidebar_no_contact: "No contact",

    // --- Dashboard ---
    dashboard_kpi_total: "Total Deals",
    dashboard_kpi_total_sub: (n) => `+${n} this week`,
    dashboard_kpi_closing: "Closing",
    dashboard_kpi_closing_sub: "Steady progress",
    dashboard_kpi_overdue: "Overdue Follow-ups",
    dashboard_kpi_overdue_action: "Action needed",
    dashboard_kpi_overdue_ok: "On track",
    dashboard_today_title: "To do today",
    dashboard_today_empty: "Nothing scheduled — enjoy your day.",
    dashboard_today_overdue: (n) => `${n} overdue`,
    dashboard_today_due: (n) => `${n} today`,
    dashboard_today_events: (n) => `${n} event${n > 1 ? "s" : ""}`,
    dashboard_today_followup_label: "Follow-up",
    dashboard_today_event_label: "Event",
    dashboard_today_overdue_by: (n) => `${n} day${n > 1 ? "s" : ""} overdue`,
    dashboard_today_due_today: "due today",
    dashboard_kpi_prospection: "Prospecting",
    dashboard_kpi_prospection_sub: "Active flow",
    dashboard_section_pipeline: "Acquisitions Pipeline",
    dashboard_section_pipeline_full: "Full view",
    dashboard_section_activity: "Recent Activity",
    dashboard_activity_empty: "No activity yet.",
    dashboard_section_tasks: "Tasks to Complete",
    dashboard_section_tasks_all: "View all",
    dashboard_section_top_opps: "Top Opportunities",
    dashboard_no_followups: "No follow-ups scheduled.",
    dashboard_no_opps: "Add deals to see opportunities.",
    dashboard_task_default: "Follow-up to complete",
    dashboard_followup_label: "Follow-up needed",
    dashboard_followup_today: "Today",
    dashboard_followup_overdue: (n) => `${n}d overdue`,
    dashboard_followup_in: (n) => `In ${n}d`,
    dashboard_map_full: "Open full map",
    dashboard_map_loading: "Loading map…",

    // --- Pipeline ---
    pipeline_empty_col: "No deals",
    pipeline_no_contact: "Contact to be set",
    pipeline_price_tbd: "Price: TBD",
    pipeline_followup_label: "Follow-up",
    pipeline_documents_label: "Documents",
    pipeline_checklist_label: (pct) => `Checklist ${pct}%`,

    // --- Map ---
    map_stages_header: "Stages",
    map_filter_label: "Filter",
    map_filter_all: "All stages",
    map_status_shown: (n) => `${n} deal${n === 1 ? "" : "s"} shown on the map.`,
    map_status_empty: "No geocoded deals for this filter. Add an address in CRM & Follow-up to drop a pin.",
    map_err_label: "the map",
    map_popup_open: "Open deal",
    map_close: "Close map",
    map_back: "← Dashboard",

    // --- Follow-ups view ---
    followups_empty_title: "No Follow-ups",
    followups_empty_sub: "Add a follow-up date in the CRM tab of a deal.",

    // --- Calendar ---
    cal_btn_connecting: "Connecting...",
    cal_btn_refresh: "Refresh Google Calendar",
    cal_btn_connect: "Connect Google Calendar",
    cal_connected: "Google Calendar connected",
    cal_new_event: "＋ Event",
    cal_loading_events: "Loading Google Calendar events…",
    cal_err_client_missing: "REACT_APP_GCAL_CLIENT_ID is missing.",
    cal_err_oauth_missing: "Google OAuth not loaded. Please refresh the page.",
    cal_err_auth: "Google authentication refused or invalid.",
    cal_err_load: "Unable to load Google Calendar events.",
    cal_event_untitled: "(Untitled)",
    cal_next_events: "Upcoming Events",
    cal_no_upcoming: "No upcoming events.",
    cal_source_google: "Google Calendar",
    cal_month_0: "January",
    cal_month_1: "February",
    cal_month_2: "March",
    cal_month_3: "April",
    cal_month_4: "May",
    cal_month_5: "June",
    cal_month_6: "July",
    cal_month_7: "August",
    cal_month_8: "September",
    cal_month_9: "October",
    cal_month_10: "November",
    cal_month_11: "December",
    cal_day_0: "Sun",
    cal_day_1: "Mon",
    cal_day_2: "Tue",
    cal_day_3: "Wed",
    cal_day_4: "Thu",
    cal_day_5: "Fri",
    cal_day_6: "Sat",

    // --- Workspace (deal detail) ---
    ws_empty_title: "No Deal",
    ws_empty_sub: "Select a deal from the left sidebar to get started.",
    ws_empty_cta: "＋ New deal",
    ws_address_todo: "Address to be set",
    ws_address_placeholder: "Address / area to fill in",
    ws_units_suffix: (n) => `• ${n} units`,
    ws_updated_on: (d) => `Updated on ${d}`,
    ws_phonefinder_err_label: "Phone Finder",
    ws_phonefinder_loading: "Loading Phone Finder…",

    // Workspace tabs
    ws_tab_crm: "CRM & Follow-up",
    ws_tab_notes: "Notes",
    ws_tab_documents: "Documents",
    ws_tab_checklist: "Checklist",
    ws_tab_activity: "Activity",
    ws_tab_agent: "Agent",

    // Contact card
    ws_contact_title: "Contact (seller / broker)",
    ws_contact_main: "Main contact",
    ws_contact_role_todo: "Role to be set",
    ws_contact_name: "Name",
    ws_contact_phone: "Phone",
    ws_contact_email: "Email",
    ws_contact_company: "Company",
    ws_contact_role: "Role",
    ws_call_start: "Call this contact",
    ws_call_busy: "Calling...",
    ws_call_refresh: "Refresh calls",
    ws_call_loading: "Loading...",
    ws_call_history_title: "Call history",
    ws_call_history_empty: "No calls logged for this deal.",
    ws_call_err_no_phone: "Add a phone number to the contact before calling.",
    ws_call_err_generic: "Unable to start the call.",
    ws_call_err_history: "Unable to load call history.",
    ws_call_err_transcript: "Unable to restart the transcription.",
    ws_call_ok_launched: "Call started. Status and recording will update automatically.",
    ws_call_ok_transcript: "Transcription restarted. Refresh in a few seconds.",
    ws_call_act_launched: (name) => `Call started to ${name}`,
    ws_call_unknown: "unknown",
    ws_call_contact_fallback: "Contact",
    ws_call_transcript_prefix: "Transcript:",
    ws_call_listen: "Listen",
    ws_call_retry_transcript: "Retry transcript",
    ws_call_show_transcript: "Show transcription",
    err_status: (s) => `Error ${s}`,

    // Suivi & priorité card
    ws_section_priority: "Follow-up & Priority",
    ws_priority_label: "Priority",
    ws_priority_high: "High",
    ws_priority_medium: "Medium",
    ws_priority_low: "Low",
    ws_priority_tag_high: "HOT",
    ws_priority_tag_medium: "WARM",
    ws_priority_tag_low: "COLD",
    ws_field_units: "Number of units",
    ws_field_units_ph: "Ex: 6",
    ws_field_price: "Asking price ($)",
    ws_field_price_ph: "Ex: 900000",
    ws_field_followup_date: "Follow-up date",
    ws_field_followup_note: "Follow-up note",
    ws_field_followup_note_ph: "Ex: Call back for counter-offer…",
    ws_field_next_action: "Next action",
    ws_field_next_action_ph: "Ex: Submit the offer",
    ws_field_address: "Address",
    ws_field_address_ph: "Ex: 320 rue Bouchard, Saint-Jean-sur-Richelieu",

    ws_section_activity: "Log an activity",

    // Notes tab
    ws_notes_deal: "Deal notes",
    ws_notes_vendor: "Seller notes",
    ws_notes_deal_ph: "Asking price, condition, potential, neighborhood, history, strategy…",
    ws_notes_vendor_ph: "Seller motivation, timing, price flexibility, pressure points, negotiation style…",
    ws_ai_btn: "✦ Format",
    ws_ai_btn_busy: "Formatting...",
    ws_ai_box_label: "✦ Formatted CRM notes",
    ws_ai_clear: "Clear",
    ws_ai_err_empty: "Add notes before formatting.",
    ws_ai_err_api: "API error.",
    ws_ai_err_server: "Server connection error.",
    ws_ai_err_network: "Network error.",

    // Documents tab
    ws_doc_download: "Download",
    ws_doc_close: "Close",
    ws_doc_viewer_err: "the spreadsheet viewer",
    ws_doc_viewer_loading: "Loading spreadsheet…",
    ws_doc_preview_unavailable: "Preview not available.",
    ws_doc_drop_title: "Drag files here or click to pick",
    ws_doc_drop_sub: "PDF, images, Word, Excel — any format",
    ws_doc_empty: "No documents for this deal.",
    ws_doc_added: (n, names) => `${n} document${n > 1 ? "s" : ""} added: ${names}`,

    // Checklist tab
    ws_checklist_title: "Checklist per stage",
    ws_checklist_add_ph: "Add an item…",
    ws_checklist_add_btn: "Add",

    // Activity tab
    ws_activity_history: "History",
    ws_activity_stage_move: (lbl) => `Stage → ${lbl}`,

    // --- Stage catalog (deal pipeline) ---
    stage_prospection: "Prospecting",
    stage_analyse: "Analysis",
    stage_offre: "Offer submitted",
    stage_due_diligence: "Due diligence",
    stage_financement: "Financing",
    stage_closing: "Closing",
    stage_perdu: "Lost",

    // --- Modals ---
    modal_new_deal_title: "New deal",
    modal_new_field_address: "Property address",
    modal_new_address_ph: "Ex: 11 rue Molleur, Saint-Jean-sur-Richelieu",
    modal_cancel: "Cancel",
    modal_new_submit: "Create deal",
    modal_event_title: "New event",
    modal_event_field_title: "Title",
    modal_event_title_ph: "Ex: Inspection 320 rue Bouchard",
    modal_event_field_date: "Date",
    modal_event_field_time: "Time (optional)",
    modal_event_field_deal: "Link to a deal",
    modal_event_select_placeholder: "— Select —",
    modal_event_submit: "Create",
    modal_event_err_no_deal: "Link the event to a deal.",
    modal_event_act_created: (title, date) => `Event: ${title} on ${date}`,

    // Deal defaults
    deal_default_title: "New deal",
    deal_lead_imported: "Imported lead",
    deal_lead_other_phones: (list) => `Other numbers: ${list}`,
    deal_lead_converted: "Lead converted to deal",
    deal_confirm_delete: "Delete this deal?",

    // --- PhoneFinder (page) ---
    pf_source_title: (t) => `Phone Finder · ${t}`,
    pf_source_default: "Phone Finder",
    pf_imported_from_with: (t) => `Imported from Phone Finder (${t})`,
    pf_imported_from: "Imported from Phone Finder",
    pf_header_title: "Phone Number Finder",
    pf_header_sub: "Google Places · imports saved locally",
    pf_spend_today: (rows, cost) => `Today · ${rows} rows · ~${cost}`,
    pf_spend_tooltip: (rows) => `${rows} rows enriched today (Google Places Essentials 2025 estimate)`,
    pf_export_busy: "Exporting…",
    pf_export_found_btn: (n) => `⇢ Found leads (${n})`,
    pf_view_results: "View results",
    pf_export_csv: "Export CSV",
    pf_clear_all: "Clear",
    pf_tab_search: "Search",
    pf_tab_results: (n) => `Results (${n})`,
    pf_tab_manual: "Manual search",
    pf_tab_csv: "CSV / XLSX import",
    pf_manual_section: "Search details",
    pf_field_name: "Business name",
    pf_field_name_ph: "Ex: Dépanneur Bélanger",
    pf_field_address: "Address",
    pf_field_address_ph: "Ex: 320 rue Bouchard",
    pf_field_city: "City",
    pf_field_city_ph: "Ex: Saint-Jean-sur-Richelieu",
    pf_field_province: "Province",
    pf_field_province_ph: "Ex: Québec",
    pf_field_postal: "Postal code",
    pf_field_postal_ph: "Ex: J3B 6N5",
    pf_field_country: "Country",
    pf_field_country_ph: "Canada",
    pf_btn_search: "Search",
    pf_btn_searching: "Searching…",
    pf_csv_section: "CSV / XLSX import",
    pf_csv_stats: (rows, cols, sep) => `${rows} rows · ${cols} columns · separator: ${sep}`,
    pf_csv_drop: "Drop a CSV/XLSX here or click to pick",
    pf_csv_hint: "Useful columns: building address, company, full name, city, province, postal code",
    pf_csv_detected: (rows, mapped) => `${rows} rows • ${mapped} columns auto-detected`,
    pf_csv_advanced_mapping: "advanced mapping (optional)",
    pf_csv_search_n: (n) => `Search ${n} rows`,
    pf_csv_running: "Search in progress…",
    pf_empty_saved_title: "No saved imports",
    pf_empty_saved_sub: "Run a manual search or a CSV import. Each import will be saved in the Results tab with a date.",
    pf_empty_results_sub: "Switch to the Search tab to start a search. Results will be saved automatically with the date.",
    pf_empty_results_cta: "Go to search",
    pf_last_import: (title, n) => `Last import: ${title} · ${n} rows`,
    pf_open_results: "Open results",
    pf_saved_imports: "Saved imports",
    pf_rows_found_sub: (rows, found) => `${rows} rows · ${found} found`,
    pf_rename_title: "Rename",
    pf_confirm_delete_run: "Delete this saved import?",
    pf_delete_all_confirm: "Delete all saved imports?",
    pf_rename_prompt: "New title for this import:",
    pf_rename_err_empty: "Title cannot be empty.",
    pf_export_no_phones: "No phone numbers to export.",
    pf_export_unavailable: "Export to Leads is unavailable.",
    pf_export_leads_updated: (parts) => `Leads updated: ${parts} · no data deleted`,
    pf_export_part_new: (n) => `${n} new`,
    pf_export_part_updated: (n) => `${n} enriched`,
    pf_export_part_skipped: (n) => `${n} unchanged`,
    pf_export_nothing_new: "All found numbers are already in Leads.",
    pf_export_impossible: (e) => `Export failed: ${e}`,
    pf_active_run_summary: (date, rows, found) => `${date} · ${rows} rows · ${found} numbers found`,
    pf_export_status_label_prefix: "Export to Leads:",
    pf_export_status_current: "Found only (current filter)",
    pf_export_found_leads: (n) => `⇢ Export ${n} found leads`,
    pf_rename_btn: "Rename",
    pf_export_this_import: "Export this import",
    pf_filter_ph: "Filter results… (⌘K)",
    pf_filter_status_all: "All statuses",
    pf_filter_status_found: "Found",
    pf_filter_status_review: "Needs review",
    pf_filter_status_multi: "Multiple matches",
    pf_filter_status_not_found: "Not found",
    pf_rerun_not_found: "Retry not-found",
    pf_rerun_not_found_tt: "Rerun the Google Places search for every not-found row in this session",
    pf_shown_of: (shown, total) => `${shown} shown of ${total}`,
    pf_results_count: (n) => `${n} result${n !== 1 ? "s" : ""}`,
    pf_total_suffix: (n) => ` (total: ${n})`,
    pf_th_num: "#",
    pf_th_search: "Query",
    pf_th_match: "Matched entity",
    pf_th_phone: "Phone",
    pf_th_website: "Website",
    pf_th_conf: "Conf.",
    pf_th_status: "Status",
    pf_th_actions: "Actions",
    pf_show_more: (count, remaining) => `Show ${count} more (${remaining} remaining)`,
    pf_no_results_title: "No results in this import",
    pf_no_results_sub: "This import exists but has no rows matching the current filter.",
    pf_stop: "⏹ Stop",
    pf_processing: (done, total) => `${done} / ${total} rows processed`,
    pf_remaining: (pct, seconds) => `${pct}% · ~${seconds}s remaining`,
    pf_connecting: "Connecting to Google Places…",
    pf_progress_label: (pct) => `${pct}%`,
    pf_review_title: "Pick the right match",
    pf_review_query: "Query:",
    pf_review_anon: "(no name)",
    pf_review_mark_notfound: "Mark as not found",
    pf_review_cancel: "Cancel",
    pf_colmap_title: "Map your import columns",
    pf_colmap_stats: (rows, cols, sep) => `${rows} rows · ${cols} columns detected (separator: ${sep})`,
    pf_colmap_hint: "Assign your columns (address, company, contact). A building address is recommended for reliable lookups.",
    pf_colmap_ignore: "— Ignore —",
    pf_colmap_close: "Close",
    pf_colmap_confirm: "Confirm mapping",
    pf_confirm_title: "Confirm phone-number search",
    pf_confirm_body: (n) => `You are about to enrich ${n} ${n === 1 ? "row" : "rows"} via Google Places.`,
    pf_confirm_est_label: "Estimated cost",
    pf_confirm_range: (lo, hi) => `Range: ${lo} – ${hi}`,
    pf_confirm_calls: (lo1, hi1, lo2, hi2) => `Estimated API calls: ${lo1}–${hi1} Text Search + ${lo2}–${hi2} Details`,
    pf_confirm_note: "Residential entries (Logement · Physique) make no API calls. Duplicate addresses in the same batch are cached.",
    pf_confirm_cancel: "Cancel",
    pf_confirm_launch: "Launch search",
    pf_status_found: "Found",
    pf_status_review: "Needs review",
    pf_status_multi: "Multiple matches",
    pf_status_not_found: "Not found",
    pf_err_need_name_or_addr: "Enter a business name or an address.",
    pf_err_no_rows: "No usable rows in this file.",
    pf_err_budget: "Daily Google Places budget hit. Try again tomorrow.",
    pf_err_server: "Server error",
    pf_err_server_code: (code) => `Server error (${code}).`,
    pf_err_import: (e) => `Import failed: ${e}`,
    pf_err_no_rows_parsed: "The file has no importable rows.",
    pf_err_network_batch: (n, m) => `Network error (batch ${n}): ${m}`,
    pf_err_network: (e) => `Network error: ${e}`,
    pf_err_generic: (e) => `Error: ${e}`,
    pf_rerun_toast_found: "Re-ran · number found!",
    pf_rerun_toast_not_found: "Re-ran · still not found",
    pf_rerun_none: "No retryable not-found results (file not reloaded since this session started).",
    pf_rerun_summary: (done, found) => `${done} retried · ${found} new number${found !== 1 ? "s" : ""} found`,
    pf_batch_ok: (done, found) => `${done} rows processed · ${found} numbers found`,
    pf_sep_tab: "TAB",
    pf_run_default_manual: (stamp) => `Manual search · ${stamp}`,
    pf_run_default_csv: (stamp) => `CSV import · ${stamp}`,
    pf_run_legacy: (stamp) => `Imported history · ${stamp}`,
    pf_run_import_of: (stamp) => `Import from ${stamp}`,

    // PhoneFinder column-mapping field labels
    pf_fl_name: "Search name",
    pf_fl_company: "Company / Organization",
    pf_fl_leadContact: "Contact / Owner",
    pf_fl_phone: "Phone (already known)",
    pf_fl_address: "Building address",
    pf_fl_city: "City",
    pf_fl_province: "Province",
    pf_fl_postalCode: "Postal code",
    pf_fl_country: "Country",
    pf_fh_name: "optional, used for the Places query",
    pf_fh_company: "optional, prioritized for search when present",
    pf_fh_leadContact: "optional, kept so you know who to call",
    pf_fh_phone: "optional, added to the lead on export",
    pf_fh_address: "strongly recommended",
    pf_fh_city: "optional",
    pf_fh_province: "optional",
    pf_fh_postalCode: "optional",
    pf_fh_country: "optional",

    pf_csv_example: (v) => `→ ex: "${v}"`,
    // PhoneFinder exportCSV headers + file name stem
    pf_csv_hdr_company: "Company",
    pf_csv_hdr_contact: "Contact",
    pf_csv_hdr_building: "Building",
    pf_csv_hdr_input_name: "Input name",
    pf_csv_hdr_input_address: "Input address",
    pf_csv_hdr_matched_name: "Matched name",
    pf_csv_hdr_matched_address: "Matched address",
    pf_csv_hdr_phone: "Matched phone",
    pf_csv_hdr_file_phones: "File phones",
    pf_csv_hdr_website: "Website",
    pf_csv_hdr_source: "Source",
    pf_csv_hdr_confidence: "Confidence %",
    pf_csv_hdr_status: "Status",
    pf_csv_hdr_date: "Date",
    pf_csv_download_stem: "phone-search",
    fmt_date_unknown: "Unknown date",

    // OwnersManager extras
    owner_unknown: "(Unknown owner)",
    om_fiche_props_count: (n) => `${n} × propert${n === 1 ? "y" : "ies"}`,
    om_progress: (done, total, found) => `${done} / ${total} · ${found}`,
    om_import_stats_properties: "properties",
    om_import_stats_unique: "unique owners",
    om_import_stats_with_phone: "already with a phone",
    om_import_stats_to_lookup: "to look up via Places",
    om_import_est_cost: "Estimated enrichment cost:",
    om_missing_mailing: "(missing mailing address)",
    om_import_no_address: "(missing mailing address)",
    om_filter_min_value: "Property value ≥",
    om_filter_max_year: "Year built ≤",
    om_filter_inscription: "Registered before",
    om_filter_units_between: "Units between",
    om_err_server_generic: (code) => `Server error (${code}).`,
    om_err_network: (e) => `Network error: ${e}`,

    // ChatWidget aria
    chat_close_label: "Close",

    // ─── Push notifications ───
    push_enable: "Enable notifications",
    push_enabled: "Notifications on",
    push_disable: "Turn off",
    push_unsupported: "Push isn't supported in this browser.",
    push_denied: "Notifications blocked — enable them in your browser settings.",
    push_subscribing: "Enabling…",
    push_test: "Send test",
    push_test_title: "SOCLE — Test",
    push_test_body: "Push notifications are working!",
    push_flag_title: "New lead to review",
    push_flag_body: (user, label) => `${user} flagged "${label || "a lead"}" for review.`,
    push_not_configured: "Push server not configured.",
  },
};

function tr(lang, key, ...args) {
  const val = (I18N[lang] && I18N[lang][key] !== undefined) ? I18N[lang][key] : I18N.fr[key];
  if (val === undefined) return key;
  return typeof val === "function" ? val(...args) : val;
}

// ─── PushToggle ──────────────────────────────────────────────────────────────
// Small button that reflects the browser's current Notification permission.
// Click to subscribe → prompts for permission, registers with the push
// service, persists the subscription on the backend. Long-press (or alt-click)
// fires a test notification so we can verify the pipeline end-to-end without
// waiting for a real trigger.
function PushToggle({ t, currentUser }) {
  const [state, setState] = useState(() => (pushSupported() ? pushPermission() : "unsupported"));
  const [busy, setBusy] = useState(false);

  // On mount, if permission is "granted" but no PushManager subscription exists,
  // treat the component as "default" so the next click subscribes rather than
  // attempting to unsubscribe a nonexistent registration.
  useEffect(() => {
    if (!pushSupported()) return;
    if (Notification.permission !== "granted") return;
    navigator.serviceWorker.ready.then((reg) =>
      reg.pushManager.getSubscription().then((sub) => {
        if (!sub) setState("default");
      })
    ).catch(() => {});
  }, []);

  const refresh = () => {
    setState(pushSupported() ? pushPermission() : "unsupported");
  };

  const handleClick = async () => {
    if (busy) return;
    if (state === "unsupported") { alert(t("push_unsupported")); return; }
    if (state === "denied")      { alert(t("push_denied"));      return; }
    if (state === "granted") {
      setBusy(true);
      await unsubscribeFromPush();
      setBusy(false);
      refresh();
      return;
    }
    setBusy(true);
    const res = await subscribeToPush(currentUser);
    setBusy(false);
    if (!res.ok) {
      if (res.error === "no-vapid-key" || res.error === "push-not-configured") {
        alert(t("push_not_configured"));
      } else if (res.error === "denied") {
        alert(t("push_denied"));
      }
    }
    refresh();
  };

  // Alt-click or right-click sends a test notification.
  const handleTest = async (e) => {
    e.preventDefault();
    if (state !== "granted") return;
    try {
      await fetch("/api/push/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: currentUser?.id,
          title: t("push_test_title"),
          body: t("push_test_body"),
        }),
      });
    } catch {}
  };

  if (state === "unsupported") return null;

  const label = busy
    ? t("push_subscribing")
    : state === "granted" ? t("push_enabled")
    : state === "denied"  ? t("push_denied")
    : t("push_enable");

  return (
    <button
      type="button"
      onClick={handleClick}
      onContextMenu={handleTest}
      title={state === "granted" ? t("push_test") : label}
      aria-label={label}
      style={{
        border: "1px solid var(--border)",
        background: state === "granted" ? "#0F766E" : "#fff",
        color: state === "granted" ? "#fff" : "var(--text2)",
        borderRadius: 8,
        width: 30, height: 30,
        display: "grid", placeItems: "center",
        fontSize: 14, cursor: busy ? "wait" : "pointer",
        flexShrink: 0,
        opacity: busy ? 0.6 : 1,
      }}
    >
      {state === "granted" ? <BellIcon size={14} /> : <BellOffIcon size={14} />}
    </button>
  );
}

import { BellIcon, BellOffIcon, CalendarIcon, WarningIcon, PaperclipIcon, FileIcon, FolderIcon, HomeIcon, ChatIcon, FlagIcon } from "./components/Icons.jsx";
import NavIcon from "./components/NavIcon.jsx";
import Topbar from "./components/Topbar.jsx";
import AddressAutocomplete from "./components/AddressAutocomplete.jsx";
import ActivityLogger from "./components/ActivityLogger.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import AgentPanel from "./components/AgentPanel.jsx";
import VoiceDictation from "./components/VoiceDictation.jsx";
// Heavy pages/viewers — code-split with React.lazy so their deps
// (Leaflet via window.L, SheetJS via window.XLSX, react-window, and each
// page's local helpers) only load when the corresponding view/modal is
// actually opened. Suspense fallbacks below keep the initial paint snappy.
//
// lazyWithPreload exposes a .preload() method on each component so the
// nav bar can start fetching the chunk on hover/focus; by the time the
// user clicks, the chunk is usually already resolved and the Suspense
// fallback flashes for ~0ms instead of the 150–400ms a cold fetch takes.
const DealMap = lazyWithPreload(() => import("./components/DealMap.jsx"));
const XlsxViewer = lazyWithPreload(() => import("./components/XlsxViewer.jsx"));
// LeadsManager (flat per-property view) is retired from the UI but kept in
// the repo to avoid blast radius during this merge. Not imported here.
const PhoneFinder = lazyWithPreload(() => import("./pages/PhoneFinder.jsx"));
const OwnersManager = lazyWithPreload(() => import("./pages/OwnersManager.jsx"));

// Map nav-item id → preload function. The nav button's onMouseEnter /
// onFocus calls this to kick off the chunk fetch. Entries without a
// lazy chunk (dashboard / pipeline / followups / calendar) are absent
// → prefetch becomes a no-op.
const NAV_PRELOAD = {
  map: DealMap.preload,
  // "Leads" now renders the owner-grouped page (OwnersManager); the legacy
  // flat-leads module (LeadsManager) is no longer routed to but kept on
  // disk for now so its import flow can be revived if needed.
  leads: OwnersManager.preload,
  phonefinder: PhoneFinder.preload,
};

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#F5F3EE;
  --sidebar:#FFFFFF;
  --card:#FFFFFF;
  --gold:#C9A84C;
  --gold-light:#F5EDD6;
  --text:#1A1A1A;
  --text2:#6B6B6B;
  --text3:#A0A0A0;
  --border:#E8E3D8;
  --green:#2D8C4E;
  --red:#C0392B;
  --blue:#2563EB;
  --radius:12px;
  --radius-sm:8px;
  --shadow:0 1px 4px rgba(0,0,0,0.06);
}
html,body,#root{height:100%}
body{font-family:'Plus Jakarta Sans',sans-serif;background:var(--bg);color:var(--text);overflow:hidden}
button,input,select,textarea{font-family:inherit}
a{color:inherit}

.app-shell{display:grid;grid-template-columns:260px 1fr;height:100vh;height:100dvh;overflow:hidden}

/* Sidebar */
.sidebar{background:var(--sidebar);border-right:1px solid var(--border);display:flex;flex-direction:column;min-height:0}
.sb-head{padding:20px 16px 14px;border-bottom:1px solid var(--border)}
.sb-logo{font-size:22px;font-weight:700;letter-spacing:.6px;color:var(--gold);line-height:1}
.sb-logo-sub{font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--text2);margin-top:4px}
.sb-tag{font-size:11px;color:var(--text3);margin-top:4px}

.sb-nav{padding:10px 8px;border-bottom:1px solid var(--border)}
.nav-item{width:100%;border:none;background:transparent;display:flex;align-items:center;gap:9px;padding:10px 11px;border-radius:10px;color:var(--text2);font-size:13px;font-weight:600;cursor:pointer;position:relative;transition:all .15s}
.nav-item:hover{background:#FAF8F4;color:var(--text)}
.nav-item.active{background:var(--gold-light);color:var(--gold)}
.nav-item.active::before{content:'';position:absolute;left:0;top:7px;bottom:7px;width:3px;border-radius:6px;background:var(--gold)}

.sb-sec{padding:10px 16px 8px;font-size:10px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:var(--text3)}
.deal-scroll{flex:1;min-height:0;overflow-y:auto;padding:0 8px 8px}
.deal-row{border:1px solid transparent;border-radius:10px;padding:9px;display:flex;gap:9px;cursor:pointer;transition:all .15s;margin-bottom:8px;background:transparent}
.deal-row:hover{background:#FAF8F4;border-color:var(--border)}
.deal-row.active{background:var(--gold-light);border-color:#E9D9AA}
.deal-avatar{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:700;flex-shrink:0}
.deal-main{min-width:0;flex:1}
.deal-title{font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text)}
.deal-meta{display:flex;align-items:center;gap:6px;margin-top:4px}
.stage-pill-mini{font-size:11px;padding:2px 7px;border-radius:999px;font-weight:700;letter-spacing:.2px}

.new-btn{margin:10px 12px 12px;border:none;background:var(--gold);color:#fff;border-radius:10px;padding:11px 12px;font-size:13px;font-weight:700;cursor:pointer;box-shadow:var(--shadow)}
.new-btn:hover{filter:brightness(1.04)}

.sb-profile{border-top:1px solid var(--border);padding:12px;display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.p-avatar{width:36px;height:36px;border-radius:50%;background:var(--gold-light);color:var(--gold);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0}
.p-name{font-size:13px;font-weight:700;color:var(--text)}
.p-role{font-size:11px;color:var(--text3)}

/* Main */
.main{display:flex;flex-direction:column;min-width:0;overflow:hidden}
.topbar{background:var(--card);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 22px;flex-shrink:0}
.tb-title{font-size:24px;font-weight:700;letter-spacing:.2px;color:var(--text)}
.tb-sub{margin-top:3px;font-size:12px;color:var(--text3)}
.tb-right{display:flex;align-items:center;gap:10px}
.tb-search{width:220px;border:1px solid var(--border);background:#fff;color:var(--text);border-radius:8px;padding:8px 10px;font-size:12px;outline:none}
.tb-search:focus{border-color:#D9C07A;box-shadow:0 0 0 3px #F5EDD6}
.bell{position:relative;width:34px;height:34px;border-radius:10px;border:1px solid var(--border);background:#fff;display:flex;align-items:center;justify-content:center;color:var(--text2)}
.bell-badge{position:absolute;top:-5px;right:-5px;min-width:16px;height:16px;border-radius:999px;background:var(--red);color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 4px}
.tb-user{font-size:12px;font-weight:600;color:var(--text2)}

.content{flex:1;padding:22px;overflow-y:auto;min-height:0;display:flex;flex-direction:column;gap:14px}
.card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow)}

.btn{border:1px solid var(--border);background:#fff;color:var(--text2);padding:8px 12px;border-radius:10px;font-size:12px;font-weight:600;cursor:pointer}
.btn:hover{background:#FAF8F4}
.btn-gold{border-color:transparent;background:var(--gold);color:#fff}
.btn-gold:hover{filter:brightness(1.05)}
.btn-danger{border:1px solid #F2C7BF;background:#FDF0ED;color:#A93425}
.btn-danger:hover{background:#FBE4E0}
.btn-sm{padding:6px 10px;font-size:11px}

/* Dashboard */
.kpi-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.kpi{padding:14px;display:flex;gap:10px;align-items:center}
.kpi-ico{width:38px;height:38px;border-radius:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.kpi-body{min-width:0;flex:1}
.kpi-val{font-size:32px;line-height:1;font-weight:700;color:var(--text)}
.kpi-lbl{font-size:12px;font-weight:600;color:var(--text2);margin-top:2px}
.kpi-sub{font-size:11px;color:var(--green);margin-top:3px}

.grid-60-40{display:grid;grid-template-columns:3fr 2fr;gap:12px}
.grid-50{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.map-split{display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start}
.sec{padding:14px}
.sec-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.sec-title{font-size:14px;font-weight:700;color:var(--text)}

.pipe-row{display:flex;align-items:center;gap:9px;padding:8px 0;border-bottom:1px solid var(--border)}
.pipe-row:last-child{border-bottom:none}
.pipe-name{width:130px;display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--text2)}
.pipe-bar-wrap{flex:1;height:8px;background:#F7F4ED;border-radius:999px;overflow:hidden}
.pipe-bar{height:100%;background:linear-gradient(90deg,var(--gold),#DDBF6E)}
.pipe-m{font-size:11px;color:var(--text2);font-weight:600;min-width:90px;text-align:right}

.activity-list{display:flex;flex-direction:column;gap:8px}
.act-row{display:flex;gap:9px;align-items:flex-start;padding:8px;border:1px solid var(--border);border-radius:10px;background:#fff}
.act-av{width:26px;height:26px;border-radius:50%;background:var(--gold-light);color:var(--gold);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0}
.act-main{min-width:0;flex:1}
.act-text{font-size:12px;color:var(--text2);line-height:1.45}
.act-time{font-size:10px;color:var(--text3);margin-top:3px}

.task-list{display:flex;flex-direction:column;gap:8px}
.task{display:flex;align-items:center;gap:10px;padding:10px;border:1px solid var(--border);border-radius:10px;background:#fff;cursor:pointer}
.task:hover{border-color:#DECFA7}
.task-main{min-width:0;flex:1}
.task-title{font-size:12px;font-weight:700;color:var(--text)}
.task-sub{font-size:11px;color:var(--text2);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.date-badge{font-size:12px;padding:3px 8px;border-radius:999px;font-weight:700}

.opp-list{display:flex;flex-direction:column;gap:8px}
.opp{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px;border:1px solid var(--border);border-radius:10px;background:#fff;cursor:pointer}
.opp:hover{border-color:#DECFA7}
.opp-l{min-width:0;flex:1}
.opp-title{font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.opp-sub{font-size:11px;color:var(--text2);margin-top:2px}
.badge-hot,.badge-warm,.badge-cold{font-size:10px;font-weight:700;padding:3px 8px;border-radius:999px}
.badge-hot{background:#FCE9E6;color:var(--red)}
.badge-warm{background:#FFF3D8;color:#B7791F}
.badge-cold{background:#EAF1FF;color:var(--blue)}

/* Pipeline */
.kanban-wrap{overflow-x:auto;padding-bottom:3px;touch-action:pan-x}
.kanban{display:flex;gap:10px;min-width:max-content;align-items:flex-start}
.k-col{width:220px;background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:10px;max-height:calc(100vh - 170px);max-height:calc(100dvh - 170px);overflow-y:auto;touch-action:pan-y}
.k-col{border-left:3px solid transparent}
.k-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.k-name{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700}
.k-count{font-size:10px;font-weight:700;padding:3px 8px;border-radius:999px;background:var(--gold-light);color:var(--gold)}
.k-card{background:#fff;border:1px solid var(--border);border-radius:10px;padding:10px;box-shadow:var(--shadow);margin-bottom:8px;cursor:pointer;transition:all .15s}
.k-card:hover{transform:translateY(-1px);box-shadow:0 8px 16px rgba(0,0,0,.09)}
.k-title{font-size:13px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.k-contact{margin-top:6px;display:flex;align-items:center;gap:7px}
.k-c-av{width:22px;height:22px;border-radius:50%;background:#F4EFE2;color:var(--gold);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;flex-shrink:0}
.k-c-name{font-size:11px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.k-price{font-size:12px;font-weight:700;color:var(--gold);margin-top:7px}
.k-row{display:flex;justify-content:space-between;margin-top:4px}
.k-mk{font-size:10px;color:var(--text3)}
.k-mv{font-size:10px;color:var(--text2);font-weight:600}
.k-foot{display:flex;gap:5px;flex-wrap:wrap;margin-top:8px}
.pr-hot,.pr-warm,.pr-cold{font-size:9px;font-weight:700;padding:2px 7px;border-radius:999px}
.pr-hot{background:#FCE9E6;color:var(--red)}
.pr-warm{background:#FFF3D8;color:#B7791F}
.pr-cold{background:#EAF1FF;color:var(--blue)}
.k-progress{margin-top:7px;height:4px;background:#F2ECE0;border-radius:999px;overflow:hidden}
.k-bar{height:100%;background:var(--gold)}
.k-empty{font-size:11px;color:var(--text3);text-align:center;padding:12px 0;font-style:italic}

/* Workspace */
.ws-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
.ws-title{border:none;background:transparent;font-size:24px;font-weight:700;color:var(--text);width:100%;outline:none;padding:0}
.ws-title:focus{border-bottom:1px solid #DABF7F}
.ws-addr{font-size:12px;color:var(--text3);margin-top:4px}
.stage-crumb{font-size:11px;color:var(--text3)}

.stage-wrap{background:#fff;border:1px solid var(--border);border-radius:12px;padding:10px 12px;box-shadow:var(--shadow)}
.stage-track{display:flex;gap:8px;overflow-x:auto;touch-action:pan-x pan-y}
.stage-btn{border:1px solid var(--border);background:#fff;border-radius:999px;padding:7px 11px;font-size:11px;color:var(--text2);font-weight:700;cursor:pointer;white-space:nowrap}
.stage-btn.active{background:var(--gold-light);color:var(--gold);border-color:#E1CC94}

.tabs{display:flex;gap:18px;border-bottom:1px solid var(--border);padding:0 4px;background:transparent}
.tab{border:none;background:transparent;color:var(--text2);font-size:13px;font-weight:700;padding:11px 2px;cursor:pointer;border-bottom:2px solid transparent}
.tab.active{color:var(--gold);border-bottom-color:var(--gold)}

.ws-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.f-card{padding:15px}
.f-title{font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--text3);font-weight:700;margin-bottom:11px}
.f-row{display:flex;flex-direction:column;gap:4px;margin-bottom:9px}
.f-row:last-child{margin-bottom:0}
.f-lbl{font-size:11px;color:var(--text2);font-weight:600}
input,select,textarea{border:1px solid var(--border);background:#fff;color:var(--text);border-radius:8px;padding:8px 10px;font-size:13px;width:100%;outline:none}
input:focus,select:focus,textarea:focus{border-color:#DABF7F;box-shadow:0 0 0 3px #F5EDD6}
textarea{resize:vertical;line-height:1.55;min-height:150px}

.contact-top{display:flex;align-items:center;gap:10px;margin-bottom:12px}
.contact-avatar{width:42px;height:42px;border-radius:50%;background:var(--gold-light);color:var(--gold);display:flex;align-items:center;justify-content:center;font-weight:700}

.pri-row{display:flex;gap:6px}
.pri-btn{flex:1;border:1px solid var(--border);background:#fff;color:var(--text2);border-radius:8px;padding:7px;font-size:11px;font-weight:700;cursor:pointer}

.ai-btn{display:inline-flex;align-items:center;gap:5px;border:none;background:var(--gold-light);color:var(--gold);border-radius:999px;padding:5px 10px;font-size:10px;font-weight:700;cursor:pointer}
.ai-btn.loading{opacity:.6;pointer-events:none}
.ai-box{margin-top:10px;background:var(--gold-light);border:1px solid #E8D7AD;border-radius:10px;padding:12px;font-size:12px;color:#7D641E;line-height:1.6}
.ai-box-lbl{font-size:10px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;margin-bottom:6px}

.doc-drop{border:1.5px dashed #D9C07A;border-radius:12px;background:#FCF8EE;padding:30px;text-align:center;cursor:pointer;transition:all .15s}
.doc-drop:hover,.doc-drop.drag{background:#F8F0DD}
.doc-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:12px}
.doc{background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px;box-shadow:var(--shadow);position:relative;cursor:pointer}
.doc-icon{font-size:10px;font-weight:700;letter-spacing:.04em;text-align:center;margin-bottom:8px;background:var(--border);color:var(--text2);border-radius:4px;padding:2px 4px;display:inline-block}
.doc-name{font-size:11px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.doc-meta{font-size:10px;color:var(--text3);margin-top:3px}
.doc-del{position:absolute;top:6px;right:6px;border:1px solid #F2C7BF;background:#FDF0ED;color:#A93425;border-radius:5px;padding:2px 6px;font-size:9px;cursor:pointer;opacity:0;transition:opacity .12s}
.doc:hover .doc-del{opacity:1}
.doc-modal{position:fixed;inset:0;z-index:300;display:flex;flex-direction:column;background:var(--bg)}
.doc-modal-top{display:flex;align-items:center;justify-content:space-between;padding:12px 18px;border-bottom:1px solid var(--border);background:#fff;flex-shrink:0}
.doc-modal-name{font-size:13px;font-weight:700;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-right:12px}
.doc-modal-body{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column}
.doc-modal-frame{width:100%;height:100%;border:none;background:#fff;flex:1}
.pf-wrap{overflow:auto;flex:1;background:#f7f4ef;padding:16px;display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap}
.pf-panel{border:2px solid #5a4a32;border-radius:4px;overflow:hidden;flex-shrink:0;background:#fff;font-family:Arial,sans-serif;font-size:12px}
.pf-panel table{border-collapse:collapse;width:100%}
.pf-panel td{padding:4px 10px;vertical-align:middle;white-space:nowrap;color:#1a1000;border-bottom:1px solid #ece6d8;height:22px}
.pf-panel tr:hover td{background:#fef9ee!important}
.pf-panel td.ph{font-weight:700;background:#5a4a32!important;color:#fff!important;text-transform:uppercase;letter-spacing:.05em;font-size:11px;border-bottom:2px solid #3a2e1e}
.pf-panel td.psh{font-weight:700;background:#e8e0d0!important;color:#3a2e1e;font-size:11.5px;border-top:1px solid #aaa;border-bottom:1px solid #aaa}
.pf-panel td.pnum{text-align:right;font-variant-numeric:tabular-nums}
.pf-panel td.pbold{font-weight:700}
.pf-panel td.plbl{color:#5a4a32}
.pf-panel tr.pspacer td{height:8px;border-bottom:none;background:#f7f4ef!important}
.xlsx-tabs{display:flex;gap:4px;padding:8px 12px;border-bottom:1px solid var(--border);background:#fff;flex-shrink:0;flex-wrap:wrap}

.cl-pills{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
.cl-pill{border:1px solid var(--border);background:#fff;color:var(--text2);border-radius:999px;padding:5px 10px;font-size:11px;font-weight:700;cursor:pointer}
.cl-pill.active{background:var(--gold-light);border-color:#E1CC94;color:var(--gold)}
.cl-progress{height:5px;background:#F0E8D8;border-radius:999px;overflow:hidden;margin-bottom:10px}
.cl-bar{height:100%;background:var(--gold);transition:width .2s}
.cl-item{display:flex;align-items:center;gap:9px;padding:9px 0;border-bottom:1px solid var(--border);cursor:pointer}
.cl-item:last-child{border-bottom:none}
.cl-box{width:16px;height:16px;border-radius:4px;border:1.5px solid #CAB98A;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.cl-box.done{background:var(--gold);color:#fff;border-color:var(--gold)}
.cl-lbl{font-size:13px;color:var(--text)}
.cl-lbl.done{text-decoration:line-through;color:var(--text3)}

.timeline{display:flex;flex-direction:column}
.t-item{display:flex;gap:9px;padding:10px 0;border-bottom:1px solid var(--border)}
.t-item:last-child{border-bottom:none}
.t-dot{width:8px;height:8px;border-radius:50%;background:var(--gold);margin-top:5px;flex-shrink:0}
.t-text{font-size:12px;color:var(--text2);flex:1}
.t-time{font-size:10px;color:var(--text3);white-space:nowrap}
.qa-wrap{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}
.qa-btn{border:1px solid var(--border);background:#fff;border-radius:999px;padding:5px 9px;font-size:10px;font-weight:700;color:var(--text2);cursor:pointer}

/* Calendar */
.cal-layout{display:grid;grid-template-columns:1fr 320px;gap:12px}
.cal-main{padding:14px}
.cal-side{padding:14px}
.cal-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.cal-month{font-size:22px;font-weight:700;color:var(--text)}
.cal-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:5px}
.cal-dlbl{font-size:10px;color:var(--text3);text-align:center;padding:4px 0;font-weight:700;letter-spacing:.4px;text-transform:uppercase}
.cal-day{min-height:76px;background:#fff;border:1px solid var(--border);border-radius:10px;padding:7px;cursor:pointer;transition:border-color .15s}
.cal-day:hover{border-color:#DABF7F}
.cal-day.today{border-color:#D4B767;background:#FFFBF1}
.cal-day.other{opacity:.45}
.cal-num{font-size:11px;color:var(--text2);font-weight:700;margin-bottom:4px}
.cal-event{font-size:9px;font-weight:700;padding:1px 5px;border-radius:4px;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cal-event.type-deal{background:#F5EDD6;color:#8B6C24}
.cal-event.type-followup{background:#FCE9E6;color:var(--red)}
.cal-event.type-google{background:#EAF1FF;color:var(--blue)}

/* Map */
.dot{width:8px;height:8px;border-radius:50%;display:inline-block;flex-shrink:0}
.map-layout{position:relative}
.map-wrap{position:relative;border:1px solid var(--border);border-radius:12px;overflow:hidden;background:#fff}
.map-viewport{width:100%;height:calc(100vh - 140px);height:calc(100dvh - 140px)}
.map-viewport.mini{height:280px}
.map-overlay{position:absolute;z-index:500;background:#fff;border:1px solid var(--border);border-radius:10px;box-shadow:var(--shadow)}
.map-overlay.legend{left:12px;top:12px;padding:10px}
.map-overlay.filters{right:12px;top:12px;padding:8px}
.map-close-btn{position:absolute;top:12px;left:50%;transform:translateX(-50%);z-index:1000;
  background:var(--text);color:#fff;border:none;border-radius:999px;
  padding:11px 22px;font-size:14px;font-weight:700;cursor:pointer;letter-spacing:.2px;
  min-height:44px;box-shadow:0 6px 20px rgba(0,0,0,0.28);transition:background .15s;
  -webkit-tap-highlight-color:transparent}
.map-close-btn:hover{background:#000}
.map-close-btn:active{transform:translateX(-50%) scale(.97);background:#000}
.map-overlay h4{font-size:10px;letter-spacing:.8px;color:var(--text3);text-transform:uppercase;margin-bottom:6px}
.legend-row{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text2);margin-bottom:4px;white-space:nowrap}
.legend-row:last-child{margin-bottom:0}
.map-filter{min-width:170px}
.map-mini-foot{padding-top:10px;display:flex;justify-content:flex-end}
.map-pill{font-size:10px;padding:2px 8px;border-radius:999px;font-weight:700}
.map-pin,.map-cluster-pin{
  width:14px;height:14px;border-radius:50%;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.28);
}
.map-cluster-pin{
  width:24px;height:24px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:700;
}
.map-popup{min-width:200px;color:var(--text)}
.map-popup-title{font-size:13px;font-weight:700;margin-bottom:4px}
.map-popup-sub{font-size:11px;color:var(--text2);margin-bottom:6px}
.map-popup-row{font-size:11px;color:var(--text2);margin-bottom:4px}
.map-open-btn{
  margin-top:7px;border:none;background:var(--gold);color:#fff;border-radius:7px;padding:6px 10px;font-size:11px;font-weight:700;cursor:pointer;
}
.map-open-btn:hover{filter:brightness(1.04)}
.leaflet-popup-content-wrapper{border-radius:10px;border:1px solid var(--border);box-shadow:0 8px 16px rgba(0,0,0,0.12)}
.leaflet-popup-content{margin:10px}

/* Common */
.pill{display:inline-flex;align-items:center;padding:3px 8px;border-radius:999px;font-size:10px;font-weight:700}
.empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:40px 20px;min-height:300px;text-align:center}
.empty-ico{font-size:44px;filter:drop-shadow(0 4px 10px #E5D4A5);animation:floaty 2.5s ease-in-out infinite}
.empty-title{font-size:20px;font-weight:700;color:var(--text)}
.empty-sub{font-size:12px;color:var(--text2);line-height:1.6;max-width:330px}

.mo{position:fixed;inset:0;background:rgba(245,243,238,.78);display:flex;align-items:center;justify-content:center;z-index:60}
.mo-box{width:460px;max-width:92vw;background:#fff;border:1px solid var(--border);border-radius:14px;box-shadow:0 18px 36px rgba(0,0,0,.12);padding:22px}
.mo-title{font-size:22px;font-weight:700;color:var(--text);margin-bottom:14px}
.mo-foot{display:flex;justify-content:flex-end;gap:8px;margin-top:15px}

.status-note{font-size:12px;color:var(--text2);padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:#fff}
.status-note.error{color:#A93425;background:#FDF0ED;border-color:#F2C7BF}
.call-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.call-log-wrap{margin-top:12px}
.call-log-list{display:flex;flex-direction:column;gap:8px;margin-top:8px}
.call-log-item{border:1px solid var(--border);border-radius:10px;background:#fff;padding:10px}
.call-log-top{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}
.call-log-title{font-size:12px;font-weight:700;color:var(--text)}
.call-log-sub{font-size:11px;color:var(--text2);margin-top:2px}
.call-log-meta{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px}
.call-pill{display:inline-flex;align-items:center;padding:3px 8px;border-radius:999px;font-size:10px;font-weight:700}
.call-pill.success{background:#E9F7EF;color:var(--green)}
.call-pill.pending{background:#EAF1FF;color:var(--blue)}
.call-pill.failed{background:#FDF0ED;color:var(--red)}
.call-pill.neutral{background:#F4F1E8;color:#6B6B6B}
.call-transcript{margin-top:8px}
.call-transcript summary{cursor:pointer;font-size:11px;font-weight:700;color:var(--text2)}
.call-transcript-text{margin-top:6px;font-size:12px;line-height:1.55;color:var(--text2);background:#FAF8F4;border:1px solid var(--border);border-radius:8px;padding:9px;white-space:pre-wrap}

/* Phone Finder */
.pf-tbl{width:100%;border-collapse:collapse;font-size:12px}
.pf-tbl th{padding:9px 12px;text-align:left;font-weight:700;color:var(--text2);font-size:11px;letter-spacing:.3px;white-space:nowrap;border-bottom:1px solid var(--border);background:#F7F4EE}
.pf-tbl td{padding:9px 12px;border-bottom:1px solid var(--border);vertical-align:middle}
.pf-tbl tbody tr:hover td{background:#FAF8F4}
.pf-tbl td.pf-input-col{max-width:180px}
.pf-tbl td.pf-match-col{max-width:200px}
.pf-tbl td.pf-web-col{max-width:160px}
.pf-cell-name{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pf-cell-addr{color:var(--text3);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
.pf-phone{font-weight:700;cursor:pointer;white-space:nowrap}
.pf-phone:hover{text-decoration:underline}
.pf-conf{display:inline-block;min-width:42px;text-align:center;font-size:11px;font-weight:700;padding:2px 7px;border-radius:999px;font-variant-numeric:tabular-nums}
.pf-status{display:inline-block;font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;white-space:nowrap}
.pf-status.found{background:#E9F7EF;color:#1A7A3F}
.pf-status.needs_review{background:#FFF3D8;color:#B7791F}
.pf-status.multiple_matches{background:#FFF0E0;color:#C05A00}
.pf-status.not_found{background:#FDF0ED;color:#A93425}
.pf-conf.hi{background:#E9F7EF;color:#1A7A3F}
.pf-conf.mid{background:#FFF3D8;color:#B7791F}
.pf-conf.lo{background:#FFF0E0;color:#C05A00}
.pf-conf.zero{background:#FDF0ED;color:#A93425}
.pf-drop{border:1.5px dashed #D9C07A;border-radius:12px;background:#FCF8EE;padding:28px;text-align:center;cursor:pointer;transition:all .15s}
.pf-drop:hover{background:#F8F0DD}
.pf-cand{border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:8px;cursor:pointer;background:#fff;transition:border-color .15s}
.pf-cand:hover{border-color:#D9C07A;background:#FFFBF1}
.pf-cand.best{background:#FFFBF1;border-color:#E1CC94}
@keyframes floaty{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}

@media (max-width:1280px){
  .kpi-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
  .grid-60-40,.grid-50,.ws-grid,.cal-layout,.map-split{grid-template-columns:1fr}
  .doc-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
}
@media (max-width:960px){
  .app-shell{grid-template-columns:1fr}
  .doc-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
  /* Mobile sidebar: hidden by default, slides in as an overlay when .open. */
  .sidebar{
    position:fixed;top:0;left:0;bottom:0;width:280px;max-width:85vw;
    z-index:60;
    transform:translateX(-100%);
    transition:transform .24s ease;
    box-shadow:0 20px 60px rgba(0,0,0,.24);
    display:flex;
  }
  .sidebar.open{transform:translateX(0)}
  .sidebar-scrim{
    position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:55;
    opacity:0;pointer-events:none;transition:opacity .24s ease;
  }
  .sidebar-scrim.open{opacity:1;pointer-events:auto}
  .mobile-hamburger{
    display:inline-flex;align-items:center;justify-content:center;
    width:44px;height:44px;border:1px solid var(--border);
    background:#fff;border-radius:10px;cursor:pointer;
    font-size:20px;line-height:1;flex-shrink:0;
  }
}
@media (min-width:961px){
  .mobile-hamburger{display:none}
  .sidebar-scrim{display:none}
}

/* ─── Mobile layout (≤768px) ───────────────────────────────────────────────
   The 960px breakpoint handles the sidebar drawer. This one handles actual
   phone-sized content: stacked rows, single-column grids, larger tap
   targets, form input font-size ≥ 16px (prevents iOS Safari auto-zoom on
   focus), and full-screen modals. */
/* iOS zoom prevention: inputs <16px trigger Safari auto-zoom on focus.
   Apply at 1024px so tablets and landscape phones are covered too. */
@media (max-width:1024px){
  input,textarea,select{font-size:16px !important}
}
@media (max-width:768px){
  body,html,#root{overflow-x:hidden}
  /* Topbar: stack title + actions, reduce padding */
  .topbar{padding:12px 14px;gap:10px;flex-wrap:wrap}
  .tb-title{font-size:17px}
  .tb-sub{font-size:12px;display:none}
  /* Content padding tighter on phones */
  .content{padding:14px;gap:12px}
  /* KPI / dashboard cards stack */
  .kpi-grid{grid-template-columns:1fr;gap:10px}
  .doc-grid{grid-template-columns:1fr}
  /* Pipeline kanban: horizontal scroll stays, narrower columns */
  .kanban{gap:8px}
  .kanban-col{min-width:220px;max-width:240px}
  /* Modals go full-screen */
  .mo-box{width:100%;max-width:100%;box-sizing:border-box;min-height:100vh;min-height:100dvh;border-radius:0;
    padding:16px;box-shadow:none;border:none}
  .mo-foot{padding-bottom:env(safe-area-inset-bottom,20px)}
  /* Forms: bump input font to prevent iOS zoom */
  input,select,textarea,button{font-size:16px}
  /* Tap targets — iOS HIG minimum 44×44px */
  button,.btn,.nav-item{min-height:44px}
  select{min-height:44px}
  /* Table horizontal scroll instead of overflow cut-off */
  table{min-width:0}
  /* Owner/Leads toolbar: wrap filters, full-width search */
  .om-toolbar,.om-actions{flex-wrap:wrap}
  .om-search{min-width:100%;flex:1 1 100%}
  .om-toolbar select,.om-actions button{flex:1 1 auto;min-width:0}
  /* Owner fiche sections stack */
  .om-fiche-grid,.om-split{grid-template-columns:1fr !important}
  /* Chatbox: full-screen on mobile */
  .chat-root{bottom:0 !important;right:0 !important;left:0 !important;top:auto !important;width:100% !important;max-width:100% !important;border-radius:0 !important}
  /* 60dvh: shrinks with keyboard so the send button stays on screen */
  .chat-window{width:100% !important;height:60dvh !important;max-height:60dvh !important;border-radius:0 !important;padding-bottom:env(safe-area-inset-bottom,0px) !important}
  /* Sidebar profile area: stack logout + push toggle below user info */
  .sb-profile{padding:10px;gap:4px}
  .p-name{font-size:14px}
  .p-role{font-size:11px}
  /* Login screen: remove big card padding */
  .login-card{padding:20px !important;width:100% !important;max-width:100% !important;border-radius:0 !important}
  /* Dashboard flag banner stays tight */
  .card.sec{padding:12px}
  /* Kanban deal cards */
  .kb-card{padding:10px;font-size:13px}
  /* Filter bar selects single-column when wrapped */
  .om-toolbar select{flex:1 1 48%}
  /* Map: close button sits at top, overlays stack below */
  .map-close-btn{top:10px;padding:10px 18px;font-size:13px;min-height:44px}
  .map-overlay.legend{left:8px;top:64px;padding:8px;max-width:45vw}
  .map-overlay.filters{right:8px;top:64px;padding:6px}
  .map-overlay.legend h4{font-size:9px;margin-bottom:4px}
  .legend-row{font-size:10px;margin-bottom:2px}
  .map-filter{min-width:130px}
  .map-filter select{max-width:140px}
  .map-viewport{height:calc(100vh - 200px);height:calc(100dvh - 200px)}
  /* iOS: bump common tap targets from 40px to 44px (Apple HIG minimum) */
  button,.btn,.nav-item{min-height:44px}
  /* Remove the gray flash on tap — we manage our own :active states */
  button,.btn,.nav-item,a{-webkit-tap-highlight-color:transparent}
}

/* Kill iOS 300ms click delay + gray flash globally on interactive surfaces */
button,.btn,.nav-item,a,select,input[type="checkbox"],input[type="radio"]{
  touch-action:manipulation;
  -webkit-tap-highlight-color:transparent;
}

/* ── Leads two-panel layout (LeadsManager) ───────────────────────────── */
.leads-card{display:flex;flex-direction:column}
.leads-body{display:flex;flex:1;min-height:0}
.leads-list-panel{width:320px;min-width:240px;flex-shrink:0;border-right:1px solid var(--border);background:var(--bg,#FAF6EF);overflow:hidden;min-height:0}
.leads-fiche-panel{flex:1;overflow-y:auto;padding:16px 18px;min-width:0}
.leads-filter-primary{padding:8px 12px;border-bottom:1px solid var(--border);display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.leads-search{width:200px;min-width:140px}
.leads-count{margin-left:auto;font-size:11px;color:var(--text3);white-space:nowrap}
.leads-actions{display:flex;gap:5px}
.leads-filter-secondary{padding:8px 12px;border-bottom:1px solid var(--border);background:#FAF8F4;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.back-btn{min-height:44px;padding:0 4px;font-size:15px;background:none;border:none;color:var(--gold,#C9A84C);cursor:pointer;font-weight:600;display:inline-flex;align-items:center;gap:6px;margin-bottom:12px}
.back-btn:active{opacity:.7}
@media (max-width:768px){
  .leads-card{flex:1;min-height:0}
  .leads-body{height:auto;flex:1;min-height:0;flex-direction:column}
  .leads-list-panel{width:100%;min-width:0;flex:1;border-right:none;border-bottom:1px solid var(--border)}
  .leads-fiche-panel{padding:12px 16px}
  .leads-filter-primary{flex-wrap:wrap}
  .leads-search{width:100%;flex:1 1 100%;height:44px;font-size:16px;order:0}
  .leads-stage-select{flex:1;height:44px;font-size:16px;order:1}
  .leads-filter-toggle{height:44px;padding:0 14px;flex-shrink:0;order:1}
  .leads-count{order:3;flex:1 1 100%;font-size:12px;margin-left:0;text-align:center}
  .leads-actions{order:4}
  .leads-filter-secondary{flex-wrap:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch}
  .leads-filter-secondary select{flex-shrink:0;height:40px;font-size:15px}
}

/* Prevent browser-level horizontal swipe (back/forward navigation gesture).
   overscroll-behavior-x:none is the operative property — it tells the browser
   not to translate horizontal edge-overscroll into a history navigation.
   touch-action:pan-y on the root ensures only vertical panning is handled
   at the app level; intentional overflow-x:auto containers (.kanban-wrap,
   .stage-track) keep their own scrollability because touch-action is
   inherited per-element and those containers reset it as needed. */
html,body{overscroll-behavior:none}
#root{overscroll-behavior:none;touch-action:pan-y}

/* iPhone notch safe area */
@supports (padding:env(safe-area-inset-top)){
  /* Topbar: top notch + landscape left/right insets */
  .topbar{
    padding-top:calc(14px + env(safe-area-inset-top));
    padding-left:max(22px, calc(16px + env(safe-area-inset-left)));
    padding-right:max(22px, calc(16px + env(safe-area-inset-right)));
  }
  .sidebar{padding-top:env(safe-area-inset-top)}
  /* Content + list bottom: clear home indicator (M7 + M10) */
  .content{padding-bottom:calc(32px + env(safe-area-inset-bottom))}
  .om-list,.om-fiche{padding-bottom:env(safe-area-inset-bottom,16px)}
  .chat-window{padding-bottom:env(safe-area-inset-bottom)}
  /* Mobile hamburger: keep clear of left notch */
  .mobile-hamburger{margin-left:env(safe-area-inset-left,0px)}
}
`;

export default function App() {
  const stored = load();
  const [deals, setDeals]         = useState((stored?.deals || []).map(normalizeDeal));
  const [leads, setLeads]         = useState(Array.isArray(stored?.leads) ? stored.leads : []);
  const [owners, setOwners]       = useState(Array.isArray(stored?.owners) ? stored.owners : []);
  // Leads flagged by Gaylord for Anthony's review. Lives in the main persist
  // payload so it survives reloads.
  const [flaggedLeads, setFlaggedLeads] = useState(Array.isArray(stored?.flaggedLeads) ? stored.flaggedLeads : []);

  // Auth session — stored in its own localStorage key (not the main payload)
  // so signing out doesn't wipe CRM data. The session holds only id/name/role/
  // initials — the PIN stays out of anything persisted.
  const [currentUser, setCurrentUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem("socle_user") || "null"); } catch { return null; }
  });

  // Language preference ("fr" | "en"), also stored in its own key.
  const [lang, setLang] = useState(() => {
    const v = localStorage.getItem("socle_lang");
    return v === "fr" || v === "en" ? v : "fr";
  });
  useEffect(() => { try { localStorage.setItem("socle_lang", lang); } catch {} }, [lang]);
  const t = useCallback((key, ...args) => tr(lang, key, ...args), [lang]);

  // Chat state (in-memory — conversation doesn't persist across reloads).
  const [chatOpen, setChatOpen]         = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput]       = useState("");
  const [chatBusy, setChatBusy]         = useState(false);

  const isAdmin = currentUser?.role === "admin";

  const login = useCallback((userId, pin) => {
    const u = USERS.find(x => x.id === userId && x.pin === String(pin || ""));
    if (!u) return false;
    const session = { id: u.id, name: u.name, role: u.role, initials: u.initials, roleLabel: u.roleLabel };
    try { localStorage.setItem("socle_user", JSON.stringify(session)); } catch {}
    setCurrentUser(session);
    return true;
  }, []);

  const logout = useCallback(() => {
    try { localStorage.removeItem("socle_user"); } catch {}
    setCurrentUser(null);
    setChatOpen(false);
    setChatMessages([]);
  }, []);

  const [currentId, setCurrentId] = useState(stored?.currentId || null);
  const [gcalOk, setGcalOk]       = useState(stored?.gcalOk || false);
  const [gcalEvents, setGcalEvents] = useState([]);
  const [gcalLoading, setGcalLoading] = useState(false);
  const [gcalError, setGcalError] = useState("");
  // Persisted access token — stored in localStorage with expiry so it survives
  // page reloads. GIS tokens last ~1 hour; on expiry the user just hits
  // "Refresh" to re-authorize (no full consent screen needed after first time).
  const [gcalToken, setGcalToken] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("socle_gcal_token") || "null");
      if (saved?.token && saved.expiry > Date.now()) return saved.token;
    } catch {}
    return null;
  });
  const [view, setView]           = useState("dashboard");
  const [tab, setTab]             = useState("crm");
  const [modal, setModal]         = useState(null);
  const [newTitle, setNewTitle]   = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [clStage, setClStage]     = useState("prospection");
  const [clNew, setClNew]         = useState("");
  const [viewing, setViewing]     = useState(null);
  const [dragging, setDragging]   = useState(false);
  const [calDate, setCalDate]     = useState(new Date());
  const [mapStageFilter, setMapStageFilter] = useState("all");
  const [newEv, setNewEv]         = useState({ title:"", date:"", time:"", dealId:"" });
  const [aiLoadD, setAiLoadD]     = useState(false);
  const [aiLoadV, setAiLoadV]     = useState(false);
  const [callsByDeal, setCallsByDeal] = useState({});
  const [callsLoading, setCallsLoading] = useState(false);
  const [calling, setCalling] = useState(false);
  const [callNotice, setCallNotice] = useState({ type: "", text: "" });
  const fileRef = useRef();
  const geocodeTimersRef = useRef({});
  const geocodeSkipRef = useRef({});
  const [newAddrCoords, setNewAddrCoords] = useState(null);
  const [newUnits, setNewUnits] = useState("");
  const [newAskingPrice, setNewAskingPrice] = useState("");
  // App-level toast for persist/quota errors (rare but user-visible when it happens).
  const [appToast, setAppToast] = useState("");
  // Mobile nav drawer — only meaningful on ≤960px screens; the CSS hides the
  // toggle button on wider viewports so desktop stays unchanged.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);

  // ─── Mobile detection ────────────────────────────────────────────────────
  // Tracks ≤760px viewports (phone-size). Used to hide the map entirely on
  // phones — Leaflet has been unreliable on Gaylord's device and the value
  // on a small screen is low. Desktop/tablet keep the full map experience.
  // Re-evaluates on resize + orientation change so rotating the phone works.
  const [isPhone, setIsPhone] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(max-width: 760px)").matches;
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 760px)");
    const onChange = (e) => setIsPhone(e.matches);
    // Safari pre-14 uses addListener instead of addEventListener.
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", onChange);
      else mq.removeListener(onChange);
    };
  }, []);

  // If we're on phone and somehow landed on the map view (e.g. stale tab,
  // deep link, cached state), bounce to dashboard. Belt-and-suspenders —
  // the nav item is also hidden on phones below.
  useEffect(() => {
    if (isPhone && view === "map") setView("dashboard");
  }, [isPhone, view]);

  // Global ESC handler: closes the mobile drawer if open, then falls back
  // to popping us out of any full-viewport "stuck" view (map, calendar)
  // back to Dashboard. Gives keyboard users and iPad-with-keyboard users a
  // reliable escape hatch.
  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      if (mobileNavOpen) {
        setMobileNavOpen(false);
      } else if (view === "map" || view === "calendar") {
        setView("dashboard");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line
  }, [mobileNavOpen, view]);

  // ─── Daily reminder scan (follow-ups + calendar events) ────────────────────
  // Pings /api/push/scan-reminders on each mount and then hourly while the tab
  // is open. The backend is idempotent (ledger entry per tag+day in
  // socle_crm_state.__reminderLog), so running it "too often" is a no-op —
  // the user only gets each reminder once per day. This replaces the need
  // for a dedicated cron job as long as someone opens the app daily.
  useEffect(() => {
    if (!currentUser) return;
    let cancelled = false;
    const kick = () => {
      if (cancelled) return;
      // Fire-and-forget: a failure here just means no push today; the next
      // tab load will retry and the ledger keeps everything idempotent.
      fetch("/api/push/scan-reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }).catch(() => {});
    };
    // Delay the first kick by 8 s so server hydration + push subscription
    // have time to land before we try to notify. Then poll every 15 minutes
    // — the backend ledger (state.__reminderLog[tag]=todayISO) makes the
    // endpoint idempotent, so running it "often" is safe. This gets a newly
    // added same-day follow-up on the user's phone within 15 minutes
    // instead of up to an hour.
    const first = setTimeout(kick, 8000);
    const interval = setInterval(kick, 15 * 60 * 1000); // every 15 min
    // Also kick when the tab regains focus after being backgrounded — catches
    // the case where the phone was asleep and the user comes back to the app.
    const onVisibility = () => { if (!document.hidden) kick(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [currentUser]);
  const persistTimerRef = useRef(null);
  // Guard so the debounced persist effect doesn't fire a server write during
  // the initial mount/hydration — otherwise we'd immediately overwrite the
  // freshly-fetched server state with whatever was in localStorage.
  const hydratedRef = useRef(false);
  // True once fetchServerState() returns ok:true — Supabase is reachable, so
  // localStorage writes for acq_crm_v4 become redundant (Supabase is canonical).
  // Stays false on network failure so offline cold-start still works.
  const supabaseActiveRef = useRef(false);

  // ─── Shared backend state sync ─────────────────────────────────────────────
  // Hydrate from the Supabase-backed server state on mount so teammates see
  // the same CRM. Local state (localStorage via storage.js) stays as an
  // offline cache and an instant-first-paint source. Conflict policy:
  // last-write-wins.
  //
  // Flow on mount:
  //   1. Fetch server state.
  //   2. If server returned non-empty state → hydrate local React state from it.
  //   3. If server is empty but local has data → seed the server with local.
  //   4. Flip hydratedRef so the debounced persist effect can start pushing.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetchServerState();
      if (cancelled) return;
      const srv = res?.ok ? res.state : null;
      const serverHasData =
        srv && typeof srv === "object" && (
          (Array.isArray(srv.owners)       && srv.owners.length       > 0) ||
          (Array.isArray(srv.deals)        && srv.deals.length        > 0) ||
          (Array.isArray(srv.leads)        && srv.leads.length        > 0) ||
          (Array.isArray(srv.flaggedLeads) && srv.flaggedLeads.length > 0)
        );

      if (serverHasData) {
        if (Array.isArray(srv.deals))        setDeals(srv.deals.map(normalizeDeal));
        if (Array.isArray(srv.leads))        setLeads(srv.leads);
        if (Array.isArray(srv.owners))       setOwners(srv.owners);
        if (Array.isArray(srv.flaggedLeads)) setFlaggedLeads(srv.flaggedLeads);
        if (typeof srv.currentId !== "undefined") setCurrentId(srv.currentId || null);
        if (typeof srv.gcalOk === "boolean")      setGcalOk(srv.gcalOk);
      } else if (res?.ok) {
        // Server responded ok but is genuinely empty (first boot / new workspace).
        // Do NOT seed if the fetch failed (res.ok false) — that's a server error,
        // not an empty state, and seeding would overwrite real data on recovery.
        const localHasData =
          (Array.isArray(owners) && owners.length > 0) ||
          (Array.isArray(deals)  && deals.length  > 0) ||
          (Array.isArray(leads)  && leads.length  > 0);
        if (localHasData) {
          await pushServerState({ deals, leads, owners, flaggedLeads, currentId, gcalOk });
        }
      }
      if (!cancelled) {
        hydratedRef.current = true;
        if (res?.ok) supabaseActiveRef.current = true;
      }
    })();
    return () => { cancelled = true; };
    // Runs once on mount. Subsequent syncs happen via the debounced persist
    // effect below. The stale-closure capture of deals/leads/owners for the
    // "seed empty server" branch is intentional — we want the snapshot as of
    // mount, not whatever the latest state is.
    // eslint-disable-next-line
  }, []);

  // Debounce writes to localStorage: state changes during typing/drag were
  // triggering a full JSON.stringify of the whole CRM on every keystroke.
  // 500ms is a comfortable tradeoff — short enough that refreshes rarely
  // lose the latest edit, long enough to coalesce bursts of updates.
  //
  // Same debounce also pushes to the shared Supabase-backed server so
  // teammates pick up changes on their next hydrate. Server writes fail
  // soft — localStorage still gets the authoritative local copy.
  useEffect(() => {
    clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      const payload = { deals, leads, owners, flaggedLeads, currentId, gcalOk };
      if (!supabaseActiveRef.current) {
        persist(payload, (err) => {
          if (isQuotaError(err)) {
            setAppToast(tr(lang, "toast_storage_full"));
            setTimeout(() => setAppToast(""), 8000);
          }
        });
      }
      // Don't push to server until after the initial hydrate has landed —
      // and never push an empty payload — a device with no localStorage data
      // on a failed hydration must not overwrite real server state.
      if (hydratedRef.current) {
        const nonEmpty = owners.length > 0 || deals.length > 0 || leads.length > 0;
        if (nonEmpty) pushServerState(payload);
        else console.warn("[sync] refusing pushServerState — local state is empty");
      }
    }, 500);
    return () => clearTimeout(persistTimerRef.current);
    // lang is only read from the quota-error toast branch; adding it as a
    // dep would rerun this debounced persist every language switch which is
    // noisy and wasteful. Acceptable stale-closure on purpose.
    // eslint-disable-next-line
  }, [deals, leads, owners, flaggedLeads, currentId, gcalOk]);

  // Make sure a pending write is flushed before the tab closes.
  useEffect(() => {
    const flush = () => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
        const payload = { deals, leads, owners, flaggedLeads, currentId, gcalOk };
        if (!supabaseActiveRef.current) persist(payload);
        // Best-effort: fire the PUT but don't await. beforeunload handlers
        // can't block — the browser may or may not finish the request.
        if (hydratedRef.current) {
          try { pushServerState(payload); } catch {}
        }
      }
    };
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, [deals, leads, owners, flaggedLeads, currentId, gcalOk]);

  // One-time migration: absorb flat legacy Leads into the owner-grouped
  // model. Runs once per browser (guarded by `migratedLeads_v1` in
  // localStorage) so re-opening the app doesn't re-import legacy leads
  // every time. After the merge, the user works only with owners; the
  // leads array stays on disk but isn't surfaced in the UI.
  const migratedRef = useRef(false);
  useEffect(() => {
    if (migratedRef.current) return;
    let alreadyDone = false;
    try { alreadyDone = localStorage.getItem("migratedLeads_v1") === "1"; } catch {}
    if (alreadyDone) { migratedRef.current = true; return; }
    if (!Array.isArray(leads) || leads.length === 0) {
      // Still mark the flag so a user who has neither leads nor owners
      // doesn't re-enter this branch on every boot.
      try { localStorage.setItem("migratedLeads_v1", "1"); } catch {}
      migratedRef.current = true;
      return;
    }
    const migrated = migrateLeadsToOwners(leads);
    if (migrated.length > 0) {
      // If the user already has owners, merge — don't clobber. Otherwise
      // set directly.
      setOwners(prev => {
        if (!Array.isArray(prev) || prev.length === 0) return migrated;
        // Cheap merge: dedupe by ownerKey, prefer existing record.
        const byKey = new Map(prev.map(o => [o.ownerKey, o]));
        for (const m of migrated) {
          if (!byKey.has(m.ownerKey)) byKey.set(m.ownerKey, m);
        }
        return Array.from(byKey.values());
      });
    }
    try { localStorage.setItem("migratedLeads_v1", "1"); } catch {}
    migratedRef.current = true;
  }, [leads]);

  const current = useMemo(() => deals.find(d => d.id === currentId) || null, [deals, currentId]);
  const currentCalls = useMemo(() => {
    if (!current?.id) return [];
    return callsByDeal[current.id] || [];
  }, [callsByDeal, current?.id]);

  const upd = useCallback((id, fn) => {
    setDeals(p => p.map(d => d.id === id ? { ...fn(d), updatedAt: Date.now() } : d));
  }, []);

  const addAct = useCallback((id, text) => {
    upd(id, d => ({ ...d, activities: [{ id: Date.now(), text, time: Date.now() }, ...(d.activities || [])] }));
  }, [upd]);

  const loadCallsForDeal = useCallback(async (dealId, options = {}) => {
    if (!dealId) return;
    if (!options.silent) {
      setCallsLoading(true);
    }
    try {
      const response = await fetch(`/api/deals/${encodeURIComponent(dealId)}/calls`);
      const data = await response.json();
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || t("err_status", response.status));
      }
      setCallsByDeal((prev) => ({ ...prev, [dealId]: data.calls || [] }));
    } catch (error) {
      if (!options.silent) {
        setCallNotice({ type: "error", text: error.message || t("ws_call_err_history") });
      }
    } finally {
      if (!options.silent) {
        setCallsLoading(false);
      }
    }
  }, [t]);

  const startDealCall = useCallback(async () => {
    if (!current?.id) return;

    const contactPhone = String(current.contact?.phone || "").trim();
    if (!contactPhone) {
      setCallNotice({ type: "error", text: t("ws_call_err_no_phone") });
      return;
    }

    setCalling(true);
    setCallNotice({ type: "", text: "" });
    try {
      const response = await fetch("/api/twilio/calls/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          dealId: current.id,
          dealTitle: current.title || "",
          contactName: String(current.contact?.name || "").trim(),
          contactPhone
        })
      });
      const data = await response.json();
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || t("err_status", response.status));
      }

      addAct(current.id, t("ws_call_act_launched", current.contact?.name || contactPhone));
      setCallNotice({ type: "success", text: t("ws_call_ok_launched") });
      await loadCallsForDeal(current.id, { silent: true });
    } catch (error) {
      setCallNotice({ type: "error", text: error.message || t("ws_call_err_generic") });
    } finally {
      setCalling(false);
    }
  }, [addAct, current, loadCallsForDeal, t]);

  const retryCallTranscription = useCallback(async (callId) => {
    if (!callId || !current?.id) return;
    try {
      const response = await fetch(`/api/calls/${encodeURIComponent(callId)}/transcribe/retry`, {
        method: "POST"
      });
      const data = await response.json();
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || t("err_status", response.status));
      }
      setCallNotice({ type: "success", text: t("ws_call_ok_transcript") });
      await loadCallsForDeal(current.id, { silent: true });
    } catch (error) {
      setCallNotice({ type: "error", text: error.message || t("ws_call_err_transcript") });
    }
  }, [current?.id, loadCallsForDeal, t]);

  useEffect(() => {
    if (!current?.id) return;
    setCallNotice({ type: "", text: "" });
    loadCallsForDeal(current.id);
  }, [current?.id, loadCallsForDeal]);

  const openDeal = useCallback((id) => {
    setCurrentId(id);
    setView("workspace");
    setTab("crm");
    setViewing(null);
  }, []);

  // ─── Flag-for-review workflow ──────────────────────────────────────────────
  // Employees (Gaylord) can tag a deal for Anthony's attention with an optional
  // note. Re-flagging the same deal replaces the prior entry (one pending flag
  // per deal — simpler than a full thread, good enough for the "take a look at
  // this" use case). Admin dismisses by removing the flag.
  const flagDeal = useCallback((dealId, note) => {
    if (!dealId || !currentUser) return;
    setFlaggedLeads(prev => {
      const without = prev.filter(f => f.dealId !== dealId);
      return [
        ...without,
        {
          id: `flag_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          dealId,
          note: String(note || "").trim(),
          byId: currentUser.id,
          byName: currentUser.name,
          at: Date.now(),
        },
      ];
    });
    // Fire a push to admins — only when flagged by a non-admin. Best-effort;
    // failures don't block the flag itself.
    if (currentUser.role !== "admin") {
      const deal = deals.find(d => d.id === dealId);
      const label = deal ? (deal.title || dealLabel(deal) || "") : "";
      try {
        fetch("/api/push/notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: "anthony",
            title: t("push_flag_title"),
            body: t("push_flag_body", currentUser.name, label),
            url: "/",
            tag: `flag-${dealId}`,
            requireInteraction: true,
          }),
        }).catch(() => {});
      } catch {}
    }
  }, [currentUser, deals, t]);

  const dismissFlag = useCallback((flagId) => {
    setFlaggedLeads(prev => prev.filter(f => f.id !== flagId));
  }, []);

  // ─── Chatbox → backend /api/chat proxy ────────────────────────────────────
  // The OpenAI key lives on the server (Railway env var), so we just POST
  // {messages, lang, user} to /api/chat and get back {ok, reply}. System
  // prompt + model selection live in server.js — keeps the key out of the
  // bundle and lets us tweak the prompt without redeploying the frontend.
  const sendChat = useCallback(async (text) => {
    const content = String(text || "").trim();
    if (!content || chatBusy) return;
    const userMsg = { role: "user", content };
    const history = [...chatMessages.filter(m => m.role !== "system"), userMsg];
    setChatMessages(prev => [...prev, userMsg]);
    setChatInput("");
    setChatBusy(true);
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history,
          lang,
          user: currentUser ? { name: currentUser.name, role: currentUser.role } : null,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) {
        setChatMessages(prev => [...prev, { role: "assistant", content: `Erreur: ${data.error || `HTTP ${r.status}`}` }]);
        return;
      }
      setChatMessages(prev => [...prev, { role: "assistant", content: data.reply || "—" }]);
    } catch (err) {
      setChatMessages(prev => [...prev, { role: "assistant", content: `Erreur: ${err?.message || t("ws_ai_err_network")}` }]);
    } finally {
      setChatBusy(false);
    }
  }, [chatMessages, chatBusy, lang, currentUser, t]);

  // Seed the chat with a greeting the first time it opens for a given user/lang.
  useEffect(() => {
    if (!chatOpen) return;
    if (chatMessages.length > 0) return;
    if (!currentUser) return;
    const firstName = String(currentUser.name || "").split(" ")[0];
    setChatMessages([{ role: "assistant", content: t("chat_greet", firstName) }]);
  }, [chatOpen, chatMessages.length, currentUser, t]);

  const createDealFn = () => {
    const d = createDeal(newTitle.trim() || t("deal_default_title"), newAddress.trim(), newAddrCoords, newUnits.trim(), newAskingPrice.trim());
    setDeals(p => [d, ...p]);
    setCurrentId(d.id);
    setModal(null);
    setNewTitle("");
    setNewAddress("");
    setNewAddrCoords(null);
    setNewUnits("");
    setNewAskingPrice("");
    setView("workspace");
    setTab("crm");
  };

  const createDealFromLead = useCallback((lead) => {
    if (!lead) return null;
    const title = (lead.companyName || lead.contactName || lead.buildingAddress || t("deal_lead_imported")).trim();
    const address = (lead.buildingAddress || lead.address || "").trim();
    const phones = getLeadPhones(lead);
    const nextDeal = {
      ...createDeal(title, address, null, "", ""),
      contact: {
        name: lead.contactName || "",
        phone: phones[0] || "",
        email: lead.email || "",
        company: lead.companyName || "",
        role: "Lead",
      },
      notesDeal: `${lead.notes || ""}${phones.length > 1 ? `\n${t("deal_lead_other_phones", phones.slice(1).join(" · "))}` : ""}`.trim(),
      activities: [{ id: Date.now(), text: t("deal_lead_converted"), time: Date.now() }],
    };
    setDeals(prev => [nextDeal, ...prev]);
    setCurrentId(nextDeal.id);
    setView("workspace");
    setTab("crm");
    setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, stage: "converted", linkedDealId: nextDeal.id, updatedAt: Date.now() } : l));
    return nextDeal.id;
  }, [t]);

  const importPhoneFinderResultsToLeads = useCallback((rows, meta = {}) => {
    let added = 0;
    let updated = 0;
    let skipped = 0;
    const sourceTitle = String(meta?.title || "").trim();
    const sourceFile = sourceTitle ? t("pf_source_title", sourceTitle) : t("pf_source_default");
    const now = Date.now();
    const nowIso = new Date().toISOString();
    const current = (Array.isArray(leads) ? leads : []).map(lead => {
      const phones = getLeadPhones(lead);
      return { ...lead, phones, phone: phones[0] || "", updatedAt: lead.updatedAt || now };
    });

    // ── Owner-grouped mode ────────────────────────────────────────────────
    // Triggered by PhoneFinder's auto-export when the GPT planner was used.
    // Instead of one Lead per building, we roll all buildings that share an
    // ownerKey into a single Lead, naming it after the owner and stuffing
    // the buildings list into the notes (+ a structured `buildings` array).
    // On re-import, we dedupe by ownerKey and merge buildings + phones.
    if (meta?.ownerGrouped) {
      const grouped = new Map(); // ownerKey → aggregate
      for (const row of Array.isArray(rows) ? rows : []) {
        // Fall back to a synthetic key when the planner didn't attach one
        // (e.g. non-GPT rows that slipped in). These degenerate to per-row
        // leads — same as legacy behavior — which is fine.
        const rawOwnerKey = String(row?.ownerKey || "").trim();
        const synthKey = rawOwnerKey || `row_${row?.id || Math.random().toString(36).slice(2)}`;
        let g = grouped.get(synthKey);
        if (!g) {
          const planOwner = row?.planOwner || {};
          const ownerDisplayName = String(planOwner.displayName || row?.companyName || row?.leadContact || row?.inputName || "").trim();
          const postalAddress = String(planOwner.postalRaw || "").trim();
          g = {
            ownerKey: rawOwnerKey,
            syntheticKey: synthKey,
            ownerName: ownerDisplayName,
            postalAddress,
            postalCity: String(planOwner.postalCity || ""),
            postalCode: String(planOwner.postalCode || ""),
            buildings: [],
            buildingsSeen: new Set(),
            phones: [],
            phoneSources: {}, // key → array of source labels
            sources: new Set(),
            matchedNames: new Set(),
            website: "",
            confidence: 0,
            statuses: new Set(),
          };
          grouped.set(synthKey, g);
        }
        // Collect the building this row represents.
        const addr = String(row?.buildingAddress || row?.inputAddress || "").trim();
        const addrKey = addr.toLowerCase().replace(/\s+/g, " ");
        if (addr && !g.buildingsSeen.has(addrKey)) {
          g.buildingsSeen.add(addrKey);
          g.buildings.push({
            address: addr,
            utilisation: row?.utilisation || "",
            matchedName: row?.matchedName || "",
            phone: row?.phone || (row?.inputPhones || [])[0] || "",
            status: row?.status || "",
          });
        }
        // Union phones, tagging each with the source label.
        const rowPhones = mergePhoneLists(row?.phone, row?.inputPhones, extractPhonesFromRow(row?.rawRow));
        const rowSource = String(row?.source || "file");
        for (const ph of rowPhones) {
          if (!g.phones.includes(ph)) g.phones.push(ph);
          g.phoneSources[ph] = Array.from(new Set([...(g.phoneSources[ph] || []), rowSource]));
        }
        if (rowSource) g.sources.add(rowSource);
        if (row?.matchedName) g.matchedNames.add(row.matchedName);
        if (row?.website && !g.website) g.website = String(row.website);
        if (Number(row?.confidence || 0) > g.confidence) g.confidence = Number(row.confidence);
        if (row?.status) g.statuses.add(row.status);
      }

      // Index existing leads by ownerKey for merge detection. Leads created
      // by rôle-import already carry ownerIds (linked via ownerKey →
      // ownerId); we also store the direct ownerKey we use here so dedup
      // across re-runs is O(1).
      const byOwnerKey = new Map();
      for (const lead of current) {
        if (lead?.ownerKey) byOwnerKey.set(String(lead.ownerKey), lead);
      }

      const additions = [];
      for (const [, g] of grouped) {
        if (!g.phones.length && !g.buildings.length) { skipped++; continue; }
        const buildingsSummary = g.buildings
          .map(b => `• ${b.address}${b.utilisation ? ` — ${b.utilisation}` : ""}${b.phone ? ` — Tél. ${b.phone}` : ""}`)
          .join("\n");
        const phoneSourceLines = g.phones
          .map(p => `${p} (${(g.phoneSources[p] || ["?"]).join(", ")})`)
          .join(" · ");
        const sharedNotes = [
          sourceTitle ? t("pf_imported_from_with", sourceTitle) : t("pf_imported_from"),
          g.postalAddress ? `\nAdresse postale: ${g.postalAddress}` : "",
          g.buildings.length ? `\nImmeubles (${g.buildings.length}):\n${buildingsSummary}` : "",
          phoneSourceLines ? `\nTéléphones: ${phoneSourceLines}` : "",
        ].filter(Boolean).join("");

        const existing = g.ownerKey ? byOwnerKey.get(g.ownerKey) : null;
        if (existing) {
          const mergedPhones = mergePhoneLists(existing.phones, g.phones);
          const existingBuildings = Array.isArray(existing.buildings) ? existing.buildings : [];
          const seenAddrs = new Set(existingBuildings.map(b => String(b?.address || "").toLowerCase().replace(/\s+/g, " ")));
          const newBuildings = g.buildings.filter(b => !seenAddrs.has(String(b.address || "").toLowerCase().replace(/\s+/g, " ")));
          const phonesChanged = mergedPhones.length !== (existing.phones || []).length;
          const buildingsChanged = newBuildings.length > 0;
          if (!phonesChanged && !buildingsChanged) { skipped++; continue; }
          existing.phones = mergedPhones;
          existing.phone = mergedPhones[0] || existing.phone || "";
          existing.buildings = [...existingBuildings, ...newBuildings];
          existing.updatedAt = now;
          if (!existing.companyName && g.ownerName) existing.companyName = g.ownerName;
          if (!existing.contactName && g.ownerName && !existing.companyName) existing.contactName = g.ownerName;
          if (!existing.postalAddress && g.postalAddress) existing.postalAddress = g.postalAddress;
          existing.notes = [existing.notes || "", "\n— Re-import —\n" + sharedNotes].filter(Boolean).join("");
          if (!existing.sourceFile) existing.sourceFile = sourceFile;
          updated++;
          continue;
        }

        const primaryBuildingAddress = g.buildings[0]?.address || "";
        const nextLead = {
          id: `lead_pf_owner_${now}_${Math.random().toString(36).slice(2, 7)}`,
          createdAt: nowIso,
          updatedAt: now,
          stage: g.phones.length ? "to_call" : "new",
          // The *lead name* is the owner name (as requested).
          companyName: g.ownerName,
          contactName: "",
          // Personal (postal) address of the owner.
          postalAddress: g.postalAddress,
          postalCity: g.postalCity,
          postalCode: g.postalCode,
          // Keep the legacy buildingAddress populated with the first
          // building so any UI that still reads it has a value.
          buildingAddress: primaryBuildingAddress,
          buildings: g.buildings,
          city: g.postalCity || "",
          province: "QC",
          country: "Canada",
          email: "",
          phone: g.phones[0] || "",
          phones: g.phones,
          phoneSources: g.phoneSources,
          originalPhone: "",
          units: 0,
          utilisation: g.buildings[0]?.utilisation || "",
          notes: sharedNotes,
          sourceFile,
          matchedName: Array.from(g.matchedNames).join(" · "),
          matchedAddress: "",
          confidence: g.confidence,
          lookupStatus: g.statuses.has("found") ? "found" : (g.statuses.has("needs_manual_review") ? "needs_manual_review" : "not_found"),
          website: g.website,
          ownerKey: g.ownerKey || "",
          linkedDealId: "",
        };
        additions.push(nextLead);
        if (g.ownerKey) byOwnerKey.set(g.ownerKey, nextLead);
        added++;
      }

      if (additions.length || updated > 0) {
        setLeads([...additions, ...current].slice(0, 6000));
      }
      return { added, updated, skipped };
    }
    // ── end owner-grouped mode ────────────────────────────────────────────

    const byKey = new Map();
    current.forEach(lead => {
      const key = buildLeadIdentityKey(lead);
      if (key && !byKey.has(key)) byKey.set(key, lead);
    });
    const additions = [];

    for (const row of Array.isArray(rows) ? rows : []) {
      const phones = mergePhoneLists(row?.phone, row?.inputPhones, extractPhonesFromRow(row?.rawRow));
      if (!phones.length) { skipped++; continue; }
      const companyName = String(row?.companyName || row?.inputName || row?.matchedName || "").trim();
      const contactName = String(row?.leadContact || "").trim();
      const buildingAddress = String(row?.buildingAddress || row?.inputAddress || row?.matchedAddress || "").trim();
      const key = buildLeadIdentityKey({ companyName, contactName, buildingAddress, inputName: row?.inputName, matchedName: row?.matchedName, inputAddress: row?.inputAddress, matchedAddress: row?.matchedAddress, phones });
      const createdAt = String(row?.searchedAt || new Date().toISOString());

      const existing = key ? byKey.get(key) : null;
      if (existing) {
        const merged = mergePhoneLists(existing.phones, phones);
        if (merged.length === existing.phones.length) { skipped++; continue; }
        existing.phones = merged;
        existing.phone = merged[0] || "";
        existing.updatedAt = now;
        if (!existing.companyName) existing.companyName = companyName;
        if (!existing.contactName) existing.contactName = contactName;
        if (!existing.buildingAddress) existing.buildingAddress = buildingAddress;
        if (!existing.website && row?.website) existing.website = String(row.website);
        if (!existing.matchedName && row?.matchedName) existing.matchedName = String(row.matchedName);
        if (!existing.matchedAddress && row?.matchedAddress) existing.matchedAddress = String(row.matchedAddress);
        if (!existing.sourceFile) existing.sourceFile = sourceFile;
        updated++;
        continue;
      }

      const rawRowForUnits = row?.rawRow || {};
      const rre = (patterns) => Object.entries(rawRowForUnits).find(([k]) => patterns.some(rx => rx.test(k)))?.[1] || "";
      const units       = parseInt(rre([/logement|unite|unit[eé]s?/i]), 10) || 0;
      const cityFromRow = rre([/\bville\d*\b/i]);
      const utilisation = row?.utilisation || rre([/utilisation|usage.*predominant|type.*immeuble/i]);
      const assessment  = rre([/valeur.*fonciere|valeur.*immeuble|[eé]valuation|valeur.*totale|assess/i]);
      const yearBuilt   = rre([/ann[eé]e.*construction|year.*built|construit/i]);
      const lotArea     = rre([/superficie.*terrain|superficie.*lot|lot.*area/i]);
      const nextLead = {
        id: `lead_pf_${now}_${Math.random().toString(36).slice(2, 7)}`,
        createdAt,
        updatedAt: now,
        stage: "to_call",
        companyName,
        contactName,
        buildingAddress,
        city: cityFromRow,
        province: "",
        postalCode: "",
        country: "Canada",
        email: "",
        phone: phones[0] || "",
        phones,
        originalPhone: "",
        units,
        utilisation,
        assessment,
        yearBuilt,
        lotArea,
        notes: sourceTitle ? t("pf_imported_from_with", sourceTitle) : t("pf_imported_from"),
        sourceFile,
        matchedName: String(row?.matchedName || ""),
        matchedAddress: String(row?.matchedAddress || ""),
        confidence: Number(row?.confidence || 0),
        lookupStatus: String(row?.status || "found"),
        website: String(row?.website || ""),
        linkedDealId: "",
      };
      additions.push(nextLead);
      if (key) byKey.set(key, nextLead);
      added++;
    }

    if (additions.length || updated > 0) {
      setLeads([...additions, ...current].slice(0, 6000));
    }

    return { added, updated, skipped };
  }, [leads, t]);

  // Called by OwnersManager after a rôle d'évaluation import. The rôle flow
  // builds one Lead per property (linked to ownerIds); we prepend them to the
  // existing leads list, dedup by lead id to tolerate re-imports, and cap at
  // 6000 to match importPhoneFinderResultsToLeads. No attempt to merge with
  // existing leads — the rôle Leads have stable ids (lead_role_<matricule>)
  // and the rare collision just overwrites with the fresh import.
  const importLeadsFromRole = useCallback((roleLeads) => {
    if (!Array.isArray(roleLeads) || !roleLeads.length) return;
    setLeads(prev => {
      const byId = new Map();
      for (const l of roleLeads) if (l && l.id) byId.set(l.id, l);
      const kept = (Array.isArray(prev) ? prev : []).filter(l => !byId.has(l?.id));
      return [...roleLeads, ...kept].slice(0, 6000);
    });
  }, []);

  const deleteDeal = (id) => {
    if (!window.confirm(t("deal_confirm_delete"))) return;
    setDeals(p => p.filter(d => d.id !== id));
    setCallsByDeal((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (currentId === id) setCurrentId(deals.find(d => d.id !== id)?.id || null);
  };

  const setStage = (sid) => {
    if (!currentId) return;
    upd(currentId, d => ({ ...d, stage: sid, checklists: { ...d.checklists, [sid]: d.checklists?.[sid] || buildCL(sid) } }));
    addAct(currentId, t("ws_activity_stage_move", t("stage_" + sid)));
    setClStage(sid);
  };

  const toggleCL = (sid, iid) => {
    if (!currentId) return;
    upd(currentId, d => ({ ...d, checklists: { ...d.checklists, [sid]: (d.checklists?.[sid] || []).map(i => i.id === iid ? { ...i, done: !i.done } : i) } }));
  };

  const handleFiles = useCallback(async (list) => {
    if (!currentId || !list?.length) return;
    const arr = Array.from(list);
    const done = await Promise.all(arr.map(f => new Promise(res => {
      const r = new FileReader();
      r.onload = e => res({ id:`f_${Date.now()}_${Math.random().toString(36).slice(2,6)}`, name:f.name, type:f.type, size:f.size, dataUrl:e.target.result, uploadedAt:Date.now() });
      r.readAsDataURL(f);
    })));
    upd(currentId, d => ({ ...d, files: [...(d.files || []), ...done] }));
    addAct(currentId, t("ws_doc_added", done.length, done.map(f=>f.name).join(", ")));
  }, [currentId, upd, addAct, t]);

  const delFile = (fid) => {
    if (!currentId) return;
    upd(currentId, d => ({ ...d, files: (d.files || []).filter(f => f.id !== fid) }));
    if (viewing?.id === fid) setViewing(null);
  };

  const geocodeAddress = useCallback(async (address) => {
    const q = encodeURIComponent(address);
    try {
      const res = await fetch(
        `https://photon.komoot.io/api/?q=${q}&lat=45.5088&lon=-73.5878&limit=1&lang=fr`,
        { headers: { Accept: "application/json" } }
      );
      if (!res.ok) return null;
      const data = await res.json();
      const f = data?.features?.[0];
      if (!f) return null;
      const [lng, lat] = f.geometry?.coordinates || [];
      if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return null;
      return { lat: Number(lat), lng: Number(lng) };
    } catch {
      return null;
    }
  }, []);


  useEffect(() => {
    deals.forEach((deal) => {
      const address = (deal.address || "").trim();
      if (!address || deal.coords) return;
      if (geocodeSkipRef.current[deal.id] === address) return;
      if (geocodeTimersRef.current[deal.id]) return;

      geocodeTimersRef.current[deal.id] = setTimeout(async () => {
        delete geocodeTimersRef.current[deal.id];
        try {
          const coords = await geocodeAddress(address);
          if (!coords) {
            geocodeSkipRef.current[deal.id] = address;
            return;
          }
          setDeals((prev) => prev.map((d) => {
            if (d.id !== deal.id) return d;
            if ((d.address || "").trim() !== address) return d;
            return { ...d, coords, updatedAt: Date.now() };
          }));
        } catch {
          geocodeSkipRef.current[deal.id] = address;
        }
      }, 1000);
    });

    Object.keys(geocodeTimersRef.current).forEach((id) => {
      const deal = deals.find((d) => d.id === id);
      const shouldKeep = !!deal && !!(deal.address || "").trim() && !deal.coords;
      if (!shouldKeep) {
        clearTimeout(geocodeTimersRef.current[id]);
        delete geocodeTimersRef.current[id];
      }
    });
  }, [deals, geocodeAddress]);

  useEffect(() => {
    return () => {
      Object.values(geocodeTimersRef.current).forEach((timer) => clearTimeout(timer));
    };
  }, []);

  const aiSummarize = async (type) => {
    if (!current) return;
    const text = type === "deal" ? current.notesDeal : current.notesVendeur;
    if (!text?.trim()) { alert(t("ws_ai_err_empty")); return; }
    type === "deal" ? setAiLoadD(true) : setAiLoadV(true);
    try {
      const res = await fetch("/api/ai/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: type === "deal" ? "deal" : "vendeur", text })
      });
      const data = await res.json();
      const summary = data.ok ? data.summary : (data.error || t("ws_ai_err_api"));
      upd(current.id, d => ({ ...d, [type==="deal"?"aiDeal":"aiVendeur"]: summary }));
    } catch {
      upd(current.id, d => ({ ...d, [type==="deal"?"aiDeal":"aiVendeur"]: t("ws_ai_err_server") }));
    } finally {
      type === "deal" ? setAiLoadD(false) : setAiLoadV(false);
    }
  };

  // Fetch upcoming events from Google Calendar using a given access token.
  // Returns the mapped event array; throws on API error.
  const fetchGcalEvents = useCallback(async (token) => {
    const timeMin = new Date().toISOString();
    const query = new URLSearchParams({ maxResults: "50", orderBy: "startTime", singleEvents: "true", timeMin });
    const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${query.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Google API ${res.status}`);
    const data = await res.json();
    return (data.items || []).map((event) => {
      if (!event.start?.dateTime && !event.start?.date) return null;
      return {
        id: event.id,
        title: event.summary || t("cal_event_untitled"),
        date: event.start.dateTime ? event.start.dateTime.split("T")[0] : event.start.date,
        time: event.start.dateTime ? event.start.dateTime.split("T")[1].slice(0,5) : "",
        type: "google",
        dealId: null,
      };
    }).filter(Boolean);
  }, [t]);

  // On load, silently restore events if a valid persisted token exists.
  useEffect(() => {
    if (!gcalToken) return;
    fetchGcalEvents(gcalToken)
      .then(mapped => { setGcalEvents(mapped); setGcalOk(true); })
      .catch(() => {
        // Token likely expired — clear it so the "Connect" button reappears.
        setGcalToken(null);
        setGcalOk(false);
        localStorage.removeItem("socle_gcal_token");
      });
  // eslint-disable-next-line
  }, []); // intentionally run once on mount only

  // ── Follow-up → Google Calendar sync ──────────────────────────────────────
  // A deal's followUpDate is mirrored to Google Calendar as an all-day event.
  // We store the Google event id on the deal (gcalFollowUpEventId) so that
  // subsequent edits PATCH the same event rather than piling up duplicates,
  // and clears issue a DELETE. The writes are best-effort — CRM state is the
  // source of truth and network failures are swallowed silently.

  // Create or update a single deal's follow-up event. Returns the Google
  // event id (new or existing), or null if the call failed. Follow-ups with
  // a followUpTime are created as timed events (+1 h duration, America/Toronto);
  // follow-ups without a time fall back to all-day.
  const pushFollowUpToGcal = useCallback(async (deal, token) => {
    if (!deal?.followUpDate || !token) return null;
    const date = deal.followUpDate;
    const time = (deal.followUpTime || "").trim();
    const summary     = `${deal.title || "Suivi"}`;
    const description = `Follow-up acquisition — ${deal.title || ""}`.trim();
    let body;
    if (time && /^\d{2}:\d{2}$/.test(time)) {
      // Timed — add 1 h to get end. Handles midnight rollover.
      const [h, m] = time.split(":").map(Number);
      let endH = h + 1;
      let endDate = date;
      if (endH >= 24) {
        endH -= 24;
        const nd = new Date(date);
        nd.setDate(nd.getDate() + 1);
        endDate = nd.toISOString().split("T")[0];
      }
      const endTime = `${String(endH).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      body = {
        summary,
        description,
        start: { dateTime: `${date}T${time}:00`,       timeZone: "America/Toronto" },
        end:   { dateTime: `${endDate}T${endTime}:00`, timeZone: "America/Toronto" },
      };
    } else {
      const nextDay = new Date(date);
      nextDay.setDate(nextDay.getDate() + 1);
      body = {
        summary,
        description,
        start: { date },
        end:   { date: nextDay.toISOString().split("T")[0] },
      };
    }
    try {
      if (deal.gcalFollowUpEventId) {
        const res = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events/${deal.gcalFollowUpEventId}`,
          { method: "PATCH",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify(body) }
        );
        // If Google lost the event (user deleted it on their side), fall
        // through to re-create instead of surfacing an error.
        if (res.ok) return deal.gcalFollowUpEventId;
        if (res.status !== 404 && res.status !== 410) return null;
      }
      const res = await fetch(
        "https://www.googleapis.com/calendar/v3/calendars/primary/events",
        { method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(body) }
      );
      if (!res.ok) return null;
      const data = await res.json();
      return data.id || null;
    } catch {
      return null;
    }
  }, []);

  // Delete a follow-up event. Best effort; errors are swallowed.
  const deleteFollowUpFromGcal = useCallback(async (eventId, token) => {
    if (!eventId || !token) return;
    try {
      await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }
      );
    } catch {}
  }, []);

  // Backfill: push every unsynced follow-up to Google. Safe to call repeatedly
  // because the per-deal gcalFollowUpEventId stops deals from being re-sent.
  const syncAllFollowUps = useCallback(async (token) => {
    if (!token) return;
    const unsynced = deals.filter(d => d.followUpDate && !d.gcalFollowUpEventId);
    for (const deal of unsynced) {
      const id = await pushFollowUpToGcal(deal, token);
      if (!id) continue;
      setDeals(prev => prev.map(d =>
        d.id === deal.id ? { ...d, gcalFollowUpEventId: id, updatedAt: Date.now() } : d
      ));
    }
  }, [deals, pushFollowUpToGcal]);

  // Run the backfill automatically once the calendar is connected AND deals
  // have loaded from storage. The ref guards against re-firing while the
  // sync is in progress (deals updates would otherwise retrigger the effect).
  const followUpBackfillTokenRef = useRef(null);
  useEffect(() => {
    if (!gcalToken) { followUpBackfillTokenRef.current = null; return; }
    if (followUpBackfillTokenRef.current === gcalToken) return;
    if (!deals.length) return;
    followUpBackfillTokenRef.current = gcalToken;
    syncAllFollowUps(gcalToken);
  }, [gcalToken, deals.length, syncAllFollowUps]);

  // Single-deal follow-up setter — local state first, Google Calendar in the
  // background. Pass both date and time ("" to clear either). Use this instead
  // of raw `upd(id, d => ({ ...d, followUpDate }))` anywhere the follow-up is
  // mutated so the Google side stays in sync.
  const setFollowUp = useCallback((dealId, newDate, newTime) => {
    const cleanedDate = (newDate || "").trim();
    const cleanedTime = (newTime || "").trim();
    const deal = deals.find(d => d.id === dealId);
    if (!deal) return;
    const oldEventId = deal.gcalFollowUpEventId || null;
    const oldDate    = deal.followUpDate        || "";
    const oldTime    = deal.followUpTime        || "";

    // Local update first so the UI never waits on the network.
    upd(dealId, d => ({ ...d, followUpDate: cleanedDate, followUpTime: cleanedTime }));

    if (!gcalToken) return; // Not connected — local only.
    if (cleanedDate === oldDate && cleanedTime === oldTime) return; // No real change.

    if (!cleanedDate) {
      // Cleared — delete the Google event if we had one.
      if (oldEventId) {
        deleteFollowUpFromGcal(oldEventId, gcalToken).finally(() => {
          upd(dealId, d => ({ ...d, gcalFollowUpEventId: null }));
        });
      }
      return;
    }

    // Create-or-update on Google.
    pushFollowUpToGcal(
      { ...deal, followUpDate: cleanedDate, followUpTime: cleanedTime },
      gcalToken
    ).then(id => {
      if (id && id !== oldEventId) {
        upd(dealId, d => ({ ...d, gcalFollowUpEventId: id }));
      }
    });
  }, [deals, gcalToken, upd, pushFollowUpToGcal, deleteFollowUpFromGcal]);

  const connectGoogleCalendar = useCallback(() => {
    const clientId = process.env.REACT_APP_GCAL_CLIENT_ID;
    if (!clientId) { setGcalError(t("cal_err_client_missing")); return; }
    if (!window.google?.accounts?.oauth2) { setGcalError(t("cal_err_oauth_missing")); return; }

    setGcalLoading(true);
    setGcalError("");

    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      // Full calendar scope — needed to create events from the CRM.
      scope: "https://www.googleapis.com/auth/calendar",
      callback: async (tokenResponse) => {
        if (tokenResponse?.error || !tokenResponse?.access_token) {
          setGcalOk(false);
          setGcalLoading(false);
          setGcalError(t("cal_err_auth"));
          return;
        }
        const token = tokenResponse.access_token;
        // Persist token + expiry (GIS tokens last ~3600 s; keep a 60 s buffer).
        const expiry = Date.now() + ((tokenResponse.expires_in ?? 3600) - 60) * 1000;
        try {
          localStorage.setItem("socle_gcal_token", JSON.stringify({ token, expiry }));
        } catch {}
        setGcalToken(token);
        try {
          const mapped = await fetchGcalEvents(token);
          setGcalEvents(mapped);
          setGcalOk(true);
        } catch {
          setGcalOk(false);
          setGcalEvents([]);
          setGcalError(t("cal_err_load"));
        } finally {
          setGcalLoading(false);
        }
      },
    });

    tokenClient.requestAccessToken({ prompt: gcalOk ? "" : "consent" });
  }, [gcalOk, t, fetchGcalEvents]);

  const allEvents = useMemo(() => {
    const evs = [];
    deals.forEach(d => {
      if (d.followUpDate) evs.push({ id:`fu_${d.id}`, date:d.followUpDate, time:d.followUpTime || "", title:`${d.title}`, type:"followup", dealId:d.id });
      (d.events || []).forEach(e => evs.push({ ...e, dealId:d.id }));
    });
    (gcalEvents || []).forEach(e => evs.push(e));
    return evs;
  }, [deals, gcalEvents]);

  const addEvent = () => {
    if (!newEv.title.trim() || !newEv.date) return;
    const did = newEv.dealId || currentId;
    if (!did) { alert(t("modal_event_err_no_deal")); return; }

    const normalizedDate = /^\d{4}-\d{2}-\d{2}$/.test(newEv.date)
      ? newEv.date
      : new Date(newEv.date).toISOString().split("T")[0];

    const ev = { id:`ev_${Date.now()}`, title:newEv.title, date:normalizedDate, time:newEv.time, type:"deal" };
    setDeals(prev => prev.map(d => d.id === did ? { ...d, events: [...(d.events || []), ev], updatedAt: Date.now() } : d));
    addAct(did, t("modal_event_act_created", newEv.title, normalizedDate));

    if (normalizedDate) {
      const [yy, mm] = normalizedDate.split("-").map(Number);
      if (yy && mm) setCalDate(new Date(yy, mm - 1, 1));
    }

    // Mirror the event to Google Calendar if we have a valid token.
    if (gcalToken) {
      const dealTitle = deals.find(d => d.id === did)?.title || "";
      let gcalBody;
      if (newEv.time) {
        const startDT = `${normalizedDate}T${newEv.time}:00`;
        const endDT   = `${normalizedDate}T${newEv.time.replace(/(\d+):(\d+)/, (_, h, m) => `${String(Number(h)+1).padStart(2,"0")}:${m}`)}:00`;
        gcalBody = {
          summary: newEv.title,
          description: dealTitle ? `Acquisition — ${dealTitle}` : undefined,
          start: { dateTime: startDT, timeZone: "America/Toronto" },
          end:   { dateTime: endDT,   timeZone: "America/Toronto" },
        };
      } else {
        const nextDay = new Date(normalizedDate);
        nextDay.setDate(nextDay.getDate() + 1);
        gcalBody = {
          summary: newEv.title,
          description: dealTitle ? `Acquisition — ${dealTitle}` : undefined,
          start: { date: normalizedDate },
          end:   { date: nextDay.toISOString().split("T")[0] },
        };
      }
      fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
        method: "POST",
        headers: { Authorization: `Bearer ${gcalToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(gcalBody),
      }).catch(() => {}); // silent — CRM save already succeeded
    }

    setNewEv({ title:"", date:"", time:"", dealId:"" });
    setModal(null);
  };

  const stats = useMemo(() => {
    const today = new Date(); today.setHours(0,0,0,0);
    const weekAgo = Date.now() - 7 * 86400000;
    return {
      total: deals.length,
      active: deals.filter(d => d.stage !== "perdu").length,
      overdue: deals.filter(d => d.followUpDate && new Date(d.followUpDate) < today).length,
      closing: deals.filter(d => d.stage === "closing").length,
      weekAdds: deals.filter(d => d.createdAt >= weekAgo).length,
      prospection: deals.filter(d => d.stage === "prospection").length,
    };
  }, [deals]);

  // ─── Today's alerts (dashboard banner) ─────────────────────────────────────
  // Drives the in-app "À faire aujourd'hui" widget. Includes:
  //   - overdue follow-ups (followUpDate < today, deal not lost)
  //   - follow-ups due today
  //   - deal events scheduled for today
  // Each item has { kind, dealId, title, sub, sortKey, urgency }. Sorted so
  // overdue items float to the top. React recomputes on every state change
  // of `deals`, so adding a follow-up updates the banner instantly — no
  // polling or push round-trip needed for local changes.
  const todaysAlerts = useMemo(() => {
    const todayISO = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Toronto",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
    const items = [];
    deals.forEach((d) => {
      if (!d || d.stage === "perdu") return;
      const label = d.title || dealLabel(d) || d.id;
      // Follow-up due today or overdue
      if (typeof d.followUpDate === "string" && d.followUpDate && d.followUpDate <= todayISO) {
        const daysOverdue = Math.round(
          (Date.parse(todayISO + "T12:00:00Z") - Date.parse(d.followUpDate + "T12:00:00Z")) / 86400000
        );
        items.push({
          kind: "followup",
          dealId: d.id,
          title: label,
          daysOverdue,
          isOverdue: daysOverdue > 0,
          sortKey: -daysOverdue, // most overdue first
        });
      }
      // Events scheduled for today
      (Array.isArray(d.events) ? d.events : []).forEach((ev) => {
        if (!ev || ev.date !== todayISO) return;
        items.push({
          kind: "event",
          dealId: d.id,
          eventId: ev.id,
          title: ev.title || label,
          sub: label,
          time: ev.time || "",
          sortKey: ev.time ? Number(String(ev.time).replace(":", "")) : 9999,
        });
      });
    });
    items.sort((a, b) => {
      // Overdue follow-ups first, then today's follow-ups, then events by time
      const rank = (x) =>
        x.kind === "followup" && x.isOverdue ? 0 :
        x.kind === "followup" ? 1 : 2;
      const rankDiff = rank(a) - rank(b);
      if (rankDiff !== 0) return rankDiff;
      return a.sortKey - b.sortKey;
    });
    const overdueCount  = items.filter(i => i.kind === "followup" && i.isOverdue).length;
    const dueTodayCount = items.filter(i => i.kind === "followup" && !i.isOverdue).length;
    const eventsCount   = items.filter(i => i.kind === "event").length;
    return { items, overdueCount, dueTodayCount, eventsCount };
  }, [deals]);

  const followUps = useMemo(() => {
    const today = new Date(); today.setHours(0,0,0,0);
    return deals.filter(d => d.followUpDate)
      .map(d => ({ ...d, diff: Math.ceil((new Date(d.followUpDate)-today)/86400000) }))
      .sort((a,b) => a.diff - b.diff);
  }, [deals]);

  const pipeline = useMemo(() => {
    const m = {}; STAGES.forEach(s => { m[s.id] = []; });
    deals.forEach(d => { const k = d.stage || "prospection"; (m[k] || m.prospection).push(d); });
    return m;
  }, [deals]);

  const activityFeed = useMemo(() => {
    return deals.flatMap(d => (d.activities || []).map(a => ({ ...a, dealTitle: d.title })))
      .sort((a,b) => b.time - a.time)
      .slice(0, 8);
  }, [deals]);

  const topOpps = useMemo(() => {
    const scored = deals
      .filter(d => d.stage !== "perdu")
      .map(d => ({ ...d, score: (PRIORITY[d.priority || "medium"]?.score || 1) + (d.stage === "closing" ? 1.5 : d.stage === "financement" ? 1 : 0.5) }))
      .sort((a,b) => b.score - a.score)
      .slice(0, 3);
    return scored;
  }, [deals]);

  const geocodedDeals = useMemo(() => deals.filter((d) => d.coords?.lat && d.coords?.lng), [deals]);
  const filteredMapDeals = useMemo(() => {
    if (mapStageFilter === "all") return geocodedDeals;
    return geocodedDeals.filter((d) => d.stage === mapStageFilter);
  }, [geocodedDeals, mapStageFilter]);

  const todayStr = new Date().toISOString().split("T")[0];
  const y = calDate.getFullYear();
  const mo = calDate.getMonth();
  const days = calDays(y, mo);

  const activeCL = current?.checklists?.[clStage] || [];
  const donePct = activeCL.length ? Math.round(activeCL.filter(i=>i.done).length/activeCL.length*100) : 0;
  const stageCL = current?.checklists?.[current?.stage] || [];
  const stagePct = stageCL.length ? Math.round(stageCL.filter(i=>i.done).length/stageCL.length*100) : 0;

  const currentStageLabel = current?.stage ? t("stage_" + current.stage) : "—";

  // Admin sees the combined count of overdue follow-ups + submitted flags in
  // the topbar bell; employees keep the original overdue-only count.
  const bellCount = currentUser?.role === "admin"
    ? (stats.overdue + flaggedLeads.length)
    : stats.overdue;

  // Common props for the <Topbar> — keeps the nine call sites DRY.
  const topbarCommon = currentUser ? {
    userName: currentUser.name,
    badgeCount: bellCount,
    lang,
    onToggleLang: () => setLang(lang === "fr" ? "en" : "fr"),
    langSwitchLabel: t("lang_switch"),
    onOpenNav: () => setMobileNavOpen(true),
  } : {};

  // Gate the app behind a PIN login. Session lives in localStorage so a
  // refresh doesn't kick the user back to the login screen.
  if (!currentUser) {
    return (
      <>
        <style>{CSS}</style>
        <LoginScreen users={USERS} onLogin={login} lang={lang} setLang={setLang} t={t} />
      </>
    );
  }

  return (
    <>
      <style>{CSS}</style>
      <div className="app-shell">
        <div
          className={`sidebar-scrim${mobileNavOpen ? " open" : ""}`}
          onClick={closeMobileNav}
          aria-hidden="true"
        />
        <aside className={`sidebar${mobileNavOpen ? " open" : ""}`}>
          <div className="sb-head">
            <div className="sb-logo">SOCLE</div>
            <div className="sb-logo-sub">ACQUISITIONS</div>
            <div className="sb-tag">{t("sidebar_tag")}</div>
          </div>

          <div className="sb-nav">
            {[
              { id:"dashboard", label:t("nav_dashboard") },
              { id:"pipeline", label:t("nav_pipeline") },
              // Map is desktop-only — Leaflet has been flaky on phones and
              // the value on a ≤760px screen is low. Hidden from the phone
              // nav; desktop/tablet keep it.
              ...(isPhone ? [] : [{ id:"map", label:t("nav_map") }]),
              { id:"followups", label:t("nav_followups") },
              { id:"calendar", label:t("nav_calendar") },
              // Leads is now the merged owner-grouped page — "Investors"
              // used to be a separate nav item but it pointed at the same
              // data model. Dropped to reduce confusion; "Leads" is the
              // single entry point.
              { id:"leads", label:t("nav_leads") },
              // Phone Finder is admin-only: Gaylord doesn't get it in the nav.
              ...(isAdmin ? [{ id:"phonefinder", label:t("nav_phonefinder") }] : []),
            ].map(item => (
              <button
                key={item.id}
                className={`nav-item${view===item.id?" active":""}`}
                onClick={() => {
                  // Tapping the active nav item again is a common "take me
                  // back" instinct on mobile. Toggle heavy views (map,
                  // calendar) back to Dashboard instead of silently doing
                  // nothing — gives users a second escape hatch if the
                  // close button isn't obvious.
                  if (view === item.id && (item.id === "map" || item.id === "calendar")) {
                    setView("dashboard");
                  } else {
                    setView(item.id);
                  }
                  closeMobileNav();
                }}
                onMouseEnter={NAV_PRELOAD[item.id]}
                onFocus={NAV_PRELOAD[item.id]}
              >
                <NavIcon id={item.id} />
                <span style={{flex:1,textAlign:"left"}}>{item.label}</span>
                {item.id === "followups" && stats.overdue > 0 && <span className="k-count" style={{background:"#FCE9E6",color:"#C0392B"}}>{stats.overdue}</span>}
              </button>
            ))}
          </div>

          <div className="sb-sec">{t("sidebar_recent_deals")}</div>
          <div className="deal-scroll">
            {deals.length===0 && <div className="status-note">{t("sidebar_no_deals")}</div>}
            {deals.slice(0, 30).map(d => {
              const st = STAGES.find(s => s.id === d.stage) || STAGES[0];
              return (
                <div key={d.id} className={`deal-row${d.id===currentId && view==="workspace"?" active":""}`} onClick={() => openDeal(d.id)}>
                  <div className="deal-avatar" style={{background:st.color}}>{initials(d.title, "DL")}</div>
                  <div className="deal-main">
                    <div className="deal-title">{dealLabel(d)}</div>
                    <div className="deal-meta">
                      <span className="stage-pill-mini" style={{background:st.color+"22",color:st.color}}>{t("stage_" + st.id)}</span>
                      <span style={{fontSize:10,color:"var(--text3)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{d.contact?.name || t("sidebar_no_contact")}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <button className="new-btn" onClick={() => setModal("new")}>{t("nav_new_deal")}</button>

          <div className="sb-profile">
            <div className="p-avatar">{currentUser.initials || "?"}</div>
            <div style={{flex:1,minWidth:0}}>
              <div className="p-name">{currentUser.name}</div>
              <div className="p-role">
                {(currentUser.roleLabel && currentUser.roleLabel[lang]) || currentUser.role}
              </div>
            </div>
            <PushToggle t={t} currentUser={currentUser} />
            <button
              type="button"
              onClick={logout}
              title={t("logout")}
              aria-label={t("logout")}
              style={{
                border: "1px solid var(--border)",
                background: "#fff",
                color: "var(--text2)",
                borderRadius: 8,
                width: 30, height: 30,
                display: "grid", placeItems: "center",
                fontSize: 14, cursor: "pointer",
                flexShrink: 0,
              }}
            >↩</button>
          </div>
        </aside>

        <main className="main">
          {view === "dashboard" && (
            <>
              <Topbar title={t("topbar_dashboard")} subtitle={t("topbar_dashboard_sub")} {...topbarCommon} />
              <div className="content">
                {isAdmin && flaggedLeads.length > 0 && (
                  <div
                    className="card sec"
                    style={{
                      background: "linear-gradient(135deg, #FFF8E1 0%, #FAF0C8 100%)",
                      border: "1px solid #E8D79A",
                      marginBottom: 16,
                    }}
                  >
                    <div className="sec-head">
                      <div className="sec-title" style={{color: "#8D6A15"}}>
                        <FlagIcon size={13} style={{marginRight:5,verticalAlign:"middle"}} />{t("admin_flags_title")} ({flaggedLeads.length})
                      </div>
                    </div>
                    <div style={{display: "flex", flexDirection: "column", gap: 8}}>
                      {flaggedLeads
                        .slice()
                        .sort((a, b) => (b.at || 0) - (a.at || 0))
                        .map(f => {
                          const d = deals.find(x => x.id === f.dealId);
                          return (
                            <div
                              key={f.id}
                              style={{
                                background: "#fff",
                                border: "1px solid #E8D79A",
                                borderRadius: 10,
                                padding: "10px 12px",
                                display: "flex",
                                alignItems: "center",
                                gap: 10,
                                flexWrap: "wrap",
                              }}
                            >
                              <div style={{flex: 1, minWidth: 200}}>
                                <div style={{fontSize: 13, fontWeight: 700, color: "var(--text)"}}>
                                  {d ? dealLabel(d) : f.dealId}
                                </div>
                                <div style={{fontSize: 11, color: "var(--text3)", marginTop: 2}}>
                                  {f.byName} · {new Date(f.at).toLocaleString(lang === "en" ? "en-CA" : "fr-CA", {dateStyle: "short", timeStyle: "short"})}
                                </div>
                                {f.note && (
                                  <div style={{fontSize: 12, color: "var(--text2)", marginTop: 6}}>
                                    <span style={{fontWeight: 700}}>{t("admin_flags_note_label")}</span> {f.note}
                                  </div>
                                )}
                              </div>
                              <div style={{display: "flex", gap: 6}}>
                                {d && (
                                  <button
                                    className="btn btn-sm"
                                    onClick={() => openDeal(f.dealId)}
                                  >
                                    {t("flag_view")}
                                  </button>
                                )}
                                <button
                                  className="btn btn-sm"
                                  onClick={() => dismissFlag(f.id)}
                                >
                                  {t("flag_dismiss")}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}
                {/* "À faire aujourd'hui" — in-app notification banner. Mirrors
                    what the push-scan endpoint fires, but lives on the page
                    so users get a visible cue every visit regardless of
                    whether push is enabled. */}
                <div
                  className="card sec"
                  style={{
                    marginBottom: 16,
                    borderLeft: todaysAlerts.overdueCount > 0
                      ? "4px solid var(--red, #C0392B)"
                      : todaysAlerts.items.length > 0
                      ? "4px solid #D4A017"
                      : "4px solid var(--green, #2D8C4E)",
                  }}
                >
                  <div className="sec-head" style={{flexWrap: "wrap", gap: 8}}>
                    <div className="sec-title">
                      <BellIcon size={16} style={{marginRight:6,verticalAlign:"middle"}} />{t("dashboard_today_title")}
                    </div>
                    <div style={{display: "flex", gap: 6, flexWrap: "wrap"}}>
                      {todaysAlerts.overdueCount > 0 && (
                        <span className="k-count" style={{background: "#FCE9E6", color: "#C0392B", fontWeight: 700}}>
                          {t("dashboard_today_overdue", todaysAlerts.overdueCount)}
                        </span>
                      )}
                      {todaysAlerts.dueTodayCount > 0 && (
                        <span className="k-count" style={{background: "#FFF4D6", color: "#8D6A15", fontWeight: 700}}>
                          {t("dashboard_today_due", todaysAlerts.dueTodayCount)}
                        </span>
                      )}
                      {todaysAlerts.eventsCount > 0 && (
                        <span className="k-count" style={{background: "#EAF1FF", color: "#2563EB", fontWeight: 700}}>
                          {t("dashboard_today_events", todaysAlerts.eventsCount)}
                        </span>
                      )}
                    </div>
                  </div>
                  {todaysAlerts.items.length === 0 ? (
                    <div className="status-note" style={{padding: "6px 2px"}}>
                      ✓ {t("dashboard_today_empty")}
                    </div>
                  ) : (
                    <div style={{display: "flex", flexDirection: "column", gap: 6}}>
                      {todaysAlerts.items.slice(0, 8).map((item, idx) => {
                        const tone =
                          item.kind === "event" ? {bg: "#EAF1FF", fg: "#2563EB", icon: <CalendarIcon size={14} />} :
                          item.isOverdue       ? {bg: "#FCE9E6", fg: "#C0392B", icon: <WarningIcon size={14} />} :
                                                 {bg: "#FFF4D6", fg: "#8D6A15", icon: <BellIcon size={14} />};
                        const sub =
                          item.kind === "event"
                            ? (item.time ? `${item.time} · ${item.sub}` : item.sub)
                            : item.isOverdue
                            ? t("dashboard_today_overdue_by", item.daysOverdue)
                            : t("dashboard_today_due_today");
                        return (
                          <button
                            key={`${item.kind}-${item.dealId}-${item.eventId || idx}`}
                            type="button"
                            onClick={() => openDeal(item.dealId)}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                              padding: "8px 10px",
                              border: "1px solid var(--border)",
                              borderRadius: 10,
                              background: "#fff",
                              cursor: "pointer",
                              textAlign: "left",
                              width: "100%",
                              minHeight: 44,
                            }}
                          >
                            <span style={{
                              flex: "0 0 auto",
                              fontSize: 14,
                              width: 28, height: 28,
                              display: "grid", placeItems: "center",
                              borderRadius: 999,
                              background: tone.bg, color: tone.fg,
                            }}>{tone.icon}</span>
                            <span style={{flex: 1, minWidth: 0}}>
                              <span style={{
                                display: "block", fontWeight: 700, fontSize: 13,
                                color: "var(--text)",
                                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                              }}>{item.title}</span>
                              <span style={{
                                display: "block", fontSize: 11, marginTop: 2,
                                color: tone.fg, fontWeight: 600,
                              }}>
                                {item.kind === "event" ? t("dashboard_today_event_label") : t("dashboard_today_followup_label")} · {sub}
                              </span>
                            </span>
                            <span style={{flex: "0 0 auto", color: "var(--text3)", fontSize: 18}}>›</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div className="kpi-grid">
                  <div className="card kpi">
                    <div className="kpi-ico" style={{background:"#F5EDD6",color:"#8D742D"}}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 21h18M5 21V7l7-4 7 4v14"/><path d="M9 21v-6h6v6"/></svg></div>
                    <div className="kpi-body"><div className="kpi-val">{stats.total}</div><div className="kpi-lbl">{t("dashboard_kpi_total")}</div><div className="kpi-sub">{t("dashboard_kpi_total_sub", stats.weekAdds)}</div></div>
                  </div>
                  <div className="card kpi">
                    <div className="kpi-ico" style={{background:"#EAF1FF",color:"#2563EB"}}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M8 12l3 3 5-5"/><path d="M3 12a9 9 0 1 1 18 0 9 9 0 0 1-18 0z"/></svg></div>
                    <div className="kpi-body"><div className="kpi-val">{stats.closing}</div><div className="kpi-lbl">{t("dashboard_kpi_closing")}</div><div className="kpi-sub">{t("dashboard_kpi_closing_sub")}</div></div>
                  </div>
                  <div className="card kpi">
                    <div className="kpi-ico" style={{background:"#FCE9E6",color:"#C0392B"}}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5"/><path d="M9 17a3 3 0 0 0 6 0"/></svg></div>
                    <div className="kpi-body"><div className="kpi-val">{stats.overdue}</div><div className="kpi-lbl">{t("dashboard_kpi_overdue")}</div><div className="kpi-sub" style={{color:stats.overdue>0?"var(--red)":"var(--green)"}}>{stats.overdue>0?t("dashboard_kpi_overdue_action"):t("dashboard_kpi_overdue_ok")}</div></div>
                  </div>
                  <div className="card kpi">
                    <div className="kpi-ico" style={{background:"#EEF9F2",color:"#2D8C4E"}}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg></div>
                    <div className="kpi-body"><div className="kpi-val">{stats.prospection}</div><div className="kpi-lbl">{t("dashboard_kpi_prospection")}</div><div className="kpi-sub">{t("dashboard_kpi_prospection_sub")}</div></div>
                  </div>
                </div>

                <div className="grid-60-40">
                  <div className="card sec">
                    <div className="sec-head"><div className="sec-title">{t("dashboard_section_pipeline")}</div><button className="btn btn-sm" onClick={() => setView("pipeline")}>{t("dashboard_section_pipeline_full")}</button></div>
                    <div className="map-split">
                      <div>
                        {STAGES.filter(s=>s.id!=="perdu").map(s => {
                          const count = pipeline[s.id]?.length || 0;
                          const pct = deals.length ? Math.round((count / deals.length) * 100) : 0;
                          const value = (count * 1.35).toFixed(1);
                          return (
                            <div key={s.id} className="pipe-row">
                              <div className="pipe-name"><div className="dot" style={{background:s.color}}/>{t("stage_" + s.id)}</div>
                              <div className="pipe-bar-wrap"><div className="pipe-bar" style={{width:`${Math.max(pct,4)}%`}}/></div>
                              <div className="pipe-m">{count} | ${value}M</div>
                            </div>
                          );
                        })}
                      </div>
                      {!isPhone && (
                        <div>
                          <div className="map-wrap">
                            <ErrorBoundary label={t("map_err_label")}>
                              <Suspense fallback={<div style={{height:280,display:"grid",placeItems:"center",color:"var(--text2)",fontSize:12}}>{t("dashboard_map_loading")}</div>}>
                                <DealMap deals={geocodedDeals} onOpenDeal={openDeal} interactive={false} height={280} />
                              </Suspense>
                            </ErrorBoundary>
                          </div>
                          <div className="map-mini-foot">
                            <button className="btn btn-sm" onClick={() => setView("map")}>{t("dashboard_map_full")}</button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="card sec">
                    <div className="sec-head"><div className="sec-title">{t("dashboard_section_activity")}</div></div>
                    <div className="activity-list">
                      {activityFeed.length===0 ? <div className="status-note">{t("dashboard_activity_empty")}</div> : activityFeed.map(a => (
                        <div key={a.id} className="act-row">
                          <div className="act-av">AM</div>
                          <div className="act-main">
                            <div className="act-text"><strong>{a.dealTitle}</strong> · {a.text}</div>
                            <div className="act-time">{new Date(a.time).toLocaleString(lang === "en" ? "en-CA" : "fr-CA",{dateStyle:"short",timeStyle:"short"})}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="grid-50">
                  <div className="card sec">
                    <div className="sec-head"><div className="sec-title">{t("dashboard_section_tasks")}</div><button className="btn btn-sm" onClick={() => setView("followups")}>{t("dashboard_section_tasks_all")}</button></div>
                    <div className="task-list">
                      {followUps.slice(0,6).map(d => {
                        const isOD = d.diff < 0;
                        const isToday = d.diff === 0;
                        return (
                          <div key={d.id} className="task" onClick={() => openDeal(d.id)}>
                            <div className="task-main">
                              <div className="task-title">{dealLabel(d)}</div>
                              <div className="task-sub">{d.followUpNote || t("dashboard_task_default")}</div>
                            </div>
                            <span className="date-badge" style={{background:isOD?"#FCE9E6":isToday?"#F5EDD6":"#F4F1E8",color:isOD?"#C0392B":isToday?"#9B7A2A":"#6B6B6B"}}>
                              {isOD?t("dashboard_followup_overdue", Math.abs(d.diff)):isToday?t("dashboard_followup_today"):t("dashboard_followup_in", d.diff)}
                            </span>
                          </div>
                        );
                      })}
                      {followUps.length===0 && <div className="status-note">{t("dashboard_no_followups")}</div>}
                    </div>
                  </div>

                  <div className="card sec">
                    <div className="sec-head"><div className="sec-title">{t("dashboard_section_top_opps")}</div></div>
                    <div className="opp-list">
                      {topOpps.map(d => {
                        const pr = PRIORITY[d.priority || "medium"];
                        return (
                          <div key={d.id} className="opp" onClick={() => openDeal(d.id)}>
                            <div className="opp-l">
                              <div className="opp-title">{dealLabel(d)}</div>
                              <div className="opp-sub">{t("stage_" + (d.stage || "prospection"))}</div>
                            </div>
                            <span className={pr.cls}>{t("ws_priority_tag_" + (d.priority || "medium"))}</span>
                          </div>
                        );
                      })}
                      {topOpps.length===0 && <div className="status-note">{t("dashboard_no_opps")}</div>}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {view === "pipeline" && (
            <>
              <Topbar title={t("topbar_pipeline")} subtitle={t("topbar_pipeline_sub")} {...topbarCommon} />
              <div className="content">
                <div className="kanban-wrap allow-horizontal-scroll">
                  <div className="kanban">
                    {STAGES.map(s => {
                      const col = pipeline[s.id] || [];
                      return (
                        <div key={s.id} className="k-col" style={{borderLeftColor:s.color}}>
                          <div className="k-hd">
                            <div className="k-name"><div className="dot" style={{background:s.color}}/>{t("stage_" + s.id)}</div>
                            <span className="k-count">{col.length}</span>
                          </div>
                          {col.length===0 && <div className="k-empty">{t("pipeline_empty_col")}</div>}
                          {col.map(d => {
                            const today = new Date(); today.setHours(0,0,0,0);
                            const diff = d.followUpDate ? Math.ceil((new Date(d.followUpDate)-today)/86400000) : null;
                            const isOD = d.followUpDate && new Date(d.followUpDate) < today;
                            const cl = d.checklists?.[d.stage] || [];
                            const clPct = cl.length ? Math.round(cl.filter(i=>i.done).length/cl.length*100) : 0;
                            const pr = PRIORITY[d.priority || "medium"];
                            return (
                              <div key={d.id} className="k-card" onClick={() => openDeal(d.id)}>
                                <div className="k-title">{dealLabel(d)}</div>
                                <div className="k-contact"><div className="k-c-av">{initials(d.contact?.name, "CT")}</div><span className="k-c-name">{d.contact?.name || t("pipeline_no_contact")}</span></div>
                                <div className="k-price">{d.askingPrice ? `${Number(d.askingPrice).toLocaleString("en-CA")} $` : t("pipeline_price_tbd")}</div>
                                {d.followUpDate && <div className="k-row"><span className="k-mk">{t("pipeline_followup_label")}</span><span className="k-mv" style={{color:isOD?"var(--red)":"var(--text2)"}}>{isOD?<><WarningIcon size={11} style={{marginRight:3}} />{Math.abs(diff)}j</>:`${d.followUpDate}${d.followUpTime ? ` ${d.followUpTime}` : ""}`}</span></div>}
                                <div className="k-row"><span className="k-mk">{t("pipeline_documents_label")}</span><span className="k-mv">{(d.files||[]).length}</span></div>
                                <div className="k-progress"><div className="k-bar" style={{width:`${clPct}%`}}/></div>
                                <div className="k-foot">
                                  <span className={pr.cls}>{t("ws_priority_tag_" + (d.priority || "medium"))}</span>
                                  <span className="pill" style={{background:"#F4F1E8",color:"#8A7A4D"}}>{t("pipeline_checklist_label", clPct)}</span>
                                  <span className="pill" style={{background:"#F4F1E8",color:"#8A7A4D"}}><PaperclipIcon size={11} style={{marginRight:2}} />{(d.files||[]).length}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </>
          )}

          {view === "map" && !isPhone && (
            <>
              <Topbar title={t("topbar_map")} subtitle={t("topbar_map_sub")} {...topbarCommon} />
              <div className="content">
                <div className="map-layout">
                  <div className="map-wrap">
                    <ErrorBoundary label={t("map_err_label")}>
                      <Suspense fallback={<div style={{height:"calc(100vh - 140px)",display:"grid",placeItems:"center",color:"var(--text2)",fontSize:13}}>{t("dashboard_map_loading")}</div>}>
                        <DealMap deals={filteredMapDeals} onOpenDeal={openDeal} interactive height={"calc(100vh - 140px)"} lang={lang} t={t} />
                      </Suspense>
                    </ErrorBoundary>
                    <button
                      type="button"
                      className="map-close-btn"
                      onClick={() => setView("dashboard")}
                      title={t("map_close")}
                      aria-label={t("map_close")}
                    >
                      {t("map_back")}
                    </button>
                    <div className="map-overlay legend">
                      <h4>{t("map_stages_header")}</h4>
                      {STAGES.map((stage) => (
                        <div key={stage.id} className="legend-row">
                          <span className="dot" style={{background:stage.color}} />
                          <span>{t("stage_" + stage.id)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="map-overlay filters">
                      <div className="map-filter">
                        <div style={{fontSize:10,letterSpacing:".7px",textTransform:"uppercase",color:"var(--text3)",fontWeight:700,marginBottom:5}}>{t("map_filter_label")}</div>
                        <select value={mapStageFilter} onChange={(e) => setMapStageFilter(e.target.value)}>
                          <option value="all">{t("map_filter_all")}</option>
                          {STAGES.map((stage) => <option key={stage.id} value={stage.id}>{t("stage_" + stage.id)}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="status-note">
                  {filteredMapDeals.length > 0
                    ? t("map_status_shown", filteredMapDeals.length)
                    : t("map_status_empty")}
                </div>
              </div>
            </>
          )}

          {view === "followups" && (
            <>
              <Topbar title={t("topbar_followups")} subtitle={t("topbar_followups_sub")} {...topbarCommon} />
              <div className="content">
                {followUps.length===0 ? (
                  <div className="card empty">
                    <div className="empty-ico"><CalendarIcon size={36} /></div>
                    <div className="empty-title">{t("followups_empty_title")}</div>
                    <div className="empty-sub">{t("followups_empty_sub")}</div>
                  </div>
                ) : (
                  <div className="card sec">
                    <div className="task-list">
                      {followUps.map(d => {
                        const st = STAGES.find(s=>s.id===d.stage) || STAGES[0];
                        const isOD = d.diff < 0;
                        const isToday = d.diff === 0;
                        return (
                          <div key={d.id} className="task" onClick={() => openDeal(d.id)}>
                            <div className="task-main">
                              <div className="task-title">{dealLabel(d)}</div>
                              <div className="task-sub">{d.followUpNote || t("dashboard_followup_label")}{d.contact?.name ? ` · ${d.contact.name}` : ""}</div>
                            </div>
                            <span className="pill" style={{background:st.color+"22",color:st.color}}>{t("stage_" + st.id)}</span>
                            <span className="date-badge" style={{background:isOD?"#FCE9E6":isToday?"#F5EDD6":"#F4F1E8",color:isOD?"#C0392B":isToday?"#9B7A2A":"#6B6B6B"}}>
                              {isOD?t("dashboard_followup_overdue", Math.abs(d.diff)):isToday?t("dashboard_followup_today"):t("dashboard_followup_in", d.diff)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {view === "calendar" && (
            <>
              <Topbar title={t("topbar_calendar")} subtitle={t("topbar_calendar_sub")} {...topbarCommon} />
              <div className="content">
                <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                  <button className="btn btn-gold" onClick={connectGoogleCalendar} disabled={gcalLoading}>{gcalLoading?t("cal_btn_connecting"):gcalOk?t("cal_btn_refresh"):t("cal_btn_connect")}</button>
                  {gcalOk && !gcalLoading && <span className="status-note">{t("cal_connected")}</span>}
                  <button className="btn" onClick={() => setModal("event")}>{t("cal_new_event")}</button>
                </div>
                {gcalLoading && <div className="status-note">{t("cal_loading_events")}</div>}
                {gcalError && <div className="status-note error">{gcalError}</div>}

                <div className="cal-layout">
                  <div className="card cal-main">
                    <div className="cal-hd">
                      <button className="btn btn-sm" onClick={() => setCalDate(new Date(y, mo-1, 1))}>‹</button>
                      <div className="cal-month">{t("cal_month_" + mo)} {y}</div>
                      <button className="btn btn-sm" onClick={() => setCalDate(new Date(y, mo+1, 1))}>›</button>
                    </div>
                    <div className="cal-grid">
                      {DAYS.map((d, idx) => <div key={d} className="cal-dlbl">{t("cal_day_" + idx)}</div>)}
                      {days.map((d,i) => {
                        const k = dayKey(d);
                        const evs = allEvents.filter(e => e.date === k);
                        return (
                          <div key={i} className={`cal-day${k===todayStr?" today":""}${d.other?" other":""}`} onClick={() => { setNewEv(n => ({ ...n, date:k })); setModal("event"); }}>
                            <div className="cal-num">{d.d}</div>
                            {evs.slice(0,2).map(ev => <div key={ev.id} className={`cal-event type-${ev.type}`} title={ev.title}>{ev.title}</div>)}
                            {evs.length>2 && <div style={{fontSize:9,color:"var(--text3)"}}>+{evs.length-2}</div>}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="card cal-side">
                    <div className="sec-head"><div className="sec-title">{t("cal_next_events")}</div></div>
                    <div className="task-list">
                      {allEvents.filter(e=>e.date>=todayStr).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,10).map(ev => {
                        const deal = deals.find(d => d.id === ev.dealId);
                        const diff = Math.ceil((new Date(ev.date)-new Date(todayStr))/86400000);
                        return (
                          <div key={ev.id} className="task" onClick={() => ev.dealId && openDeal(ev.dealId)}>
                            <div className="task-main">
                              <div className="task-title">{ev.title}</div>
                              <div className="task-sub">{deal?.title || t("cal_source_google")}{ev.time ? ` · ${ev.time}` : ""}</div>
                            </div>
                            <span className="date-badge" style={{background:diff===0?"#F5EDD6":"#F4F1E8",color:diff===0?"#9B7A2A":"#6B6B6B"}}>{diff===0?t("dashboard_followup_today"):t("dashboard_followup_in", diff)}</span>
                          </div>
                        );
                      })}
                      {allEvents.filter(e=>e.date>=todayStr).length===0 && <div className="status-note">{t("cal_no_upcoming")}</div>}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Legacy "owners" view id stays routed to OwnersManager for
              backwards-compat with anyone bookmarking the old URL hash.
              Primary entry point is now view === "leads" (same render). */}
          {(view === "leads" || view === "owners") && (
            <>
              <Topbar title={t("topbar_leads")} subtitle={t("topbar_leads_sub")} {...topbarCommon} />
              <div className="content">
                <ErrorBoundary label={t("leads_err_label")}>
                  <Suspense fallback={<div style={{padding:40,textAlign:"center",fontSize:13,color:"var(--text2)"}}>{t("leads_loading")}</div>}>
                    <OwnersManager owners={owners} setOwners={setOwners} onAddLeads={importLeadsFromRole} t={t} lang={lang} />
                  </Suspense>
                </ErrorBoundary>
              </div>
            </>
          )}

          {view === "phonefinder" && (
            <ErrorBoundary label={t("ws_phonefinder_err_label")}>
              <Suspense fallback={<div style={{padding:40,textAlign:"center",fontSize:13,color:"var(--text2)"}}>{t("ws_phonefinder_loading")}</div>}>
                <PhoneFinder
                  onExportFoundToLeads={importPhoneFinderResultsToLeads}
                  onOpenLeads={() => setView("leads")}
                  t={t}
                  lang={lang}
                />
              </Suspense>
            </ErrorBoundary>
          )}

          {view === "workspace" && (
            !current ? (
              <>
                <Topbar title={t("topbar_workspace")} subtitle={t("topbar_workspace_empty")} {...topbarCommon} />
                <div className="content">
                  <div className="card empty">
                    <div className="empty-ico"><HomeIcon size={36} /></div>
                    <div className="empty-title">{t("ws_empty_title")}</div>
                    <div className="empty-sub">{t("ws_empty_sub")}</div>
                    <button className="btn btn-gold" onClick={() => setModal("new")}>{t("ws_empty_cta")}</button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <Topbar title={t("topbar_workspace")} subtitle={`${currentStageLabel} • ${current.address || t("ws_address_todo")}`} {...topbarCommon} />
                <div className="content">
                  <div className="ws-head">
                    <div style={{minWidth:0,flex:1}}>
                      <input className="ws-title" value={current.title} onChange={e => upd(current.id, d => ({ ...d, title:e.target.value }))} />
                      <div className="ws-addr">
                        {current.address || t("ws_address_placeholder")}
                        {current.units ? <span style={{marginLeft:10,color:"var(--text2)"}}>{t("ws_units_suffix", current.units)}</span> : null}
                        {current.askingPrice ? <span style={{marginLeft:10,fontWeight:700,color:"var(--gold)"}}>• {Number(current.askingPrice).toLocaleString("en-CA")} $</span> : null}
                      </div>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span className="stage-crumb">{t("ws_updated_on", new Date(current.updatedAt).toLocaleDateString(lang === "en" ? "en-CA" : "fr-CA"))}</span>
                      <button className="btn btn-sm" onClick={() => setModal("event")}>{t("cal_new_event")}</button>
                      {isAdmin && (
                        <button className="btn btn-danger btn-sm" onClick={() => deleteDeal(current.id)}>{t("delete")}</button>
                      )}
                    </div>
                  </div>

                  <div className="stage-wrap">
                    <div className="stage-track allow-horizontal-scroll">
                      {STAGES.map(s => {
                        const cl = current.checklists?.[s.id] || [];
                        const pct = cl.length ? Math.round(cl.filter(i=>i.done).length/cl.length*100) : null;
                        return (
                          <button key={s.id} className={`stage-btn${current.stage===s.id?" active":""}`} onClick={() => setStage(s.id)}>
                            {s.emoji} {t("stage_" + s.id)}{pct!==null && current.stage!==s.id ? ` ${pct}%` : ""}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="tabs">
                    {[ ["crm",t("ws_tab_crm")], ["notes",t("ws_tab_notes")], ["documents",`${t("ws_tab_documents")}${(current.files||[]).length>0?` (${current.files.length})`:""}`], ["checklist",`${t("ws_tab_checklist")}${stageCL.length>0?` ${stagePct}%`:""}`], ["activity",t("ws_tab_activity")], ["agent",t("ws_tab_agent")] ].map(([id,label]) => (
                      <button key={id} className={`tab${tab===id?" active":""}`} onClick={() => setTab(id)}>{label}</button>
                    ))}
                  </div>

                  {tab === "crm" && (
                    <>
                      {!isAdmin && (
                        <FlagForReviewBanner
                          dealId={current.id}
                          existing={flaggedLeads.find(f => f.dealId === current.id) || null}
                          onFlag={flagDeal}
                          t={t}
                        />
                      )}
                      <div className="ws-grid">
                        <div className="card f-card">
                          <div className="f-title">{t("ws_contact_title")}</div>
                          <div className="contact-top">
                            <div className="contact-avatar">{initials(current.contact?.name, "CT")}</div>
                            <div>
                              <div style={{fontSize:14,fontWeight:700,color:"var(--text)"}}>{current.contact?.name || t("ws_contact_main")}</div>
                              <div style={{fontSize:11,color:"var(--text3)"}}>{current.contact?.role || t("ws_contact_role_todo")}</div>
                            </div>
                          </div>
                          {[ ["name",t("ws_contact_name")], ["phone",t("ws_contact_phone")], ["email",t("ws_contact_email")], ["company",t("ws_contact_company")], ["role",t("ws_contact_role")] ].map(([k,lbl]) => (
                            <div key={k} className="f-row"><div className="f-lbl">{lbl}</div><input value={current.contact?.[k] || ""} onChange={e => upd(current.id,d => ({ ...d, contact:{ ...d.contact, [k]:e.target.value } }))} /></div>
                          ))}

                          <div className="call-actions">
                            <button className="btn btn-gold" disabled={calling} onClick={startDealCall}>
                              {calling ? t("ws_call_busy") : t("ws_call_start")}
                            </button>
                            <button className="btn btn-sm" disabled={callsLoading} onClick={() => loadCallsForDeal(current.id)}>
                              {callsLoading ? t("ws_call_loading") : t("ws_call_refresh")}
                            </button>
                          </div>

                          {callNotice.text && (
                            <div className={`status-note${callNotice.type === "error" ? " error" : ""}`} style={{ marginTop: 10 }}>
                              {callNotice.text}
                            </div>
                          )}

                          <div className="call-log-wrap">
                            <div className="f-title" style={{ marginBottom: 0 }}>{t("ws_call_history_title")}</div>
                            {currentCalls.length === 0 ? (
                              <div className="status-note" style={{ marginTop: 8 }}>{t("ws_call_history_empty")}</div>
                            ) : (
                              <div className="call-log-list">
                                {currentCalls.slice(0, 6).map((call) => {
                                  const transcriptState = call.transcript_status || "not_started";
                                  const transcriptClass =
                                    transcriptState === "completed"
                                      ? "success"
                                      : transcriptState === "failed"
                                        ? "failed"
                                        : transcriptState === "processing" || transcriptState === "pending_recording"
                                          ? "pending"
                                          : "neutral";

                                  return (
                                    <div key={call.id} className="call-log-item">
                                      <div className="call-log-top">
                                        <div>
                                          <div className="call-log-title">{call.lead_name || call.to || t("ws_call_contact_fallback")}</div>
                                          <div className="call-log-sub">
                                            {fmtCallDateTime(call.created_at)} · {fmtDurationSeconds(call.duration_seconds)}
                                          </div>
                                        </div>
                                        <span className={`call-pill ${call.status === "completed" ? "success" : call.status === "failed" || call.status === "busy" || call.status === "no-answer" ? "failed" : "pending"}`}>
                                          {call.status || t("ws_call_unknown")}
                                        </span>
                                      </div>

                                      <div className="call-log-meta">
                                        <span className={`call-pill ${transcriptClass}`}>
                                          {t("ws_call_transcript_prefix")} {transcriptState}
                                        </span>
                                        {call.recording_url && (
                                          <a className="btn btn-sm" href={`/api/calls/${encodeURIComponent(call.id)}/recording`} target="_blank" rel="noreferrer">
                                            {t("ws_call_listen")}
                                          </a>
                                        )}
                                        {(transcriptState === "failed" || transcriptState === "not_started") && call.recording_url && (
                                          <button className="btn btn-sm" onClick={() => retryCallTranscription(call.id)}>
                                            {t("ws_call_retry_transcript")}
                                          </button>
                                        )}
                                      </div>

                                      {call.transcript && (
                                        <details className="call-transcript">
                                          <summary>{t("ws_call_show_transcript")}</summary>
                                          <div className="call-transcript-text">{call.transcript}</div>
                                        </details>
                                      )}
                                      {!call.transcript && call.transcript_error && (
                                        <div className="status-note error" style={{ marginTop: 8 }}>{call.transcript_error}</div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="card f-card">
                          <div className="f-title">{t("ws_section_priority")}</div>
                          <div className="f-row">
                            <div className="f-lbl">{t("ws_priority_label")}</div>
                            <div className="pri-row">
                              {Object.entries(PRIORITY).map(([k,{color}]) => (
                                <button key={k} className="pri-btn" style={current.priority===k?{background:color+"18",borderColor:color,color}:undefined} onClick={() => upd(current.id,d => ({ ...d, priority:k }))}>{t("ws_priority_" + k)}</button>
                              ))}
                            </div>
                          </div>
                          <div className="f-row"><div className="f-lbl">{t("ws_field_units")}</div><input type="number" min="1" step="1" value={current.units || ""} onChange={e => upd(current.id,d => ({ ...d, units: e.target.value }))} placeholder={t("ws_field_units_ph")} /></div>
                          <div className="f-row"><div className="f-lbl">{t("ws_field_price")}</div><input type="number" min="0" step="1000" value={current.askingPrice || ""} onChange={e => upd(current.id,d => ({ ...d, askingPrice: e.target.value }))} placeholder={t("ws_field_price_ph")} /></div>
                          <div className="f-row">
                            <div className="f-lbl">{t("ws_field_followup_date")}</div>
                            <div style={{ display: "flex", gap: 8, flex: 1 }}>
                              <input
                                type="date"
                                style={{ flex: 2 }}
                                value={current.followUpDate || ""}
                                onChange={e => setFollowUp(current.id, e.target.value, current.followUpTime || "")}
                              />
                              <input
                                type="time"
                                style={{ flex: 1 }}
                                value={current.followUpTime || ""}
                                onChange={e => setFollowUp(current.id, current.followUpDate || "", e.target.value)}
                              />
                            </div>
                          </div>
                          <div className="f-row"><div className="f-lbl">{t("ws_field_followup_note")}</div><input value={current.followUpNote || ""} onChange={e => upd(current.id,d => ({ ...d, followUpNote:e.target.value }))} placeholder={t("ws_field_followup_note_ph")} /></div>
                          <div className="f-row"><div className="f-lbl">{t("ws_field_next_action")}</div><input value={current.nextAction || ""} onChange={e => upd(current.id,d => ({ ...d, nextAction:e.target.value }))} placeholder={t("ws_field_next_action_ph")} /></div>
                          <div className="f-row">
                            <div className="f-lbl">{t("ws_field_address")}</div>
                            <AddressAutocomplete
                              value={current.address || ""}
                              onChange={v => {
                                delete geocodeSkipRef.current[current.id];
                                upd(current.id, d => ({ ...d, address: v, coords: null }));
                              }}
                              onSelect={s => {
                                delete geocodeSkipRef.current[current.id];
                                upd(current.id, d => ({ ...d, address: s.label, coords: { lat: s.lat, lng: s.lng } }));
                              }}
                              placeholder={t("ws_field_address_ph")}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="card f-card">
                        <div className="f-title">{t("ws_section_activity")}</div>
                        <ActivityLogger dealId={current.id} onLog={addAct} />
                      </div>
                    </>
                  )}

                  {tab === "notes" && (
                    <div className="ws-grid">
                      <div className="card f-card">
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                          <div style={{display:"flex",alignItems:"center",gap:6}}>
                            <div className="f-title" style={{marginBottom:0}}>{t("ws_notes_deal")}</div>
                            <VoiceDictation onTranscript={text => {
                              const cur = current.notesDeal || "";
                              upd(current.id, d => ({ ...d, notesDeal: cur + (cur && !cur.endsWith("\n") ? "\n" : "") + text }));
                            }} />
                          </div>
                          <button className={`ai-btn${aiLoadD?" loading":""}`} onClick={() => aiSummarize("deal")}>{aiLoadD?t("ws_ai_btn_busy"):t("ws_ai_btn")}</button>
                        </div>
                        <textarea value={current.notesDeal || ""} onChange={e => upd(current.id,d => ({ ...d, notesDeal:e.target.value }))} placeholder={t("ws_notes_deal_ph")} />
                        {current.aiDeal && <div className="ai-box"><div className="ai-box-lbl">{t("ws_ai_box_label")}</div><div style={{whiteSpace:"pre-wrap"}}>{current.aiDeal}</div><button className="btn btn-sm" style={{marginTop:10}} onClick={() => upd(current.id,d => ({ ...d, aiDeal:"" }))}>{t("ws_ai_clear")}</button></div>}
                      </div>

                      <div className="card f-card">
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                          <div style={{display:"flex",alignItems:"center",gap:6}}>
                            <div className="f-title" style={{marginBottom:0}}>{t("ws_notes_vendor")}</div>
                            <VoiceDictation onTranscript={text => {
                              const cur = current.notesVendeur || "";
                              upd(current.id, d => ({ ...d, notesVendeur: cur + (cur && !cur.endsWith("\n") ? "\n" : "") + text }));
                            }} />
                          </div>
                          <button className={`ai-btn${aiLoadV?" loading":""}`} onClick={() => aiSummarize("vendeur")}>{aiLoadV?t("ws_ai_btn_busy"):t("ws_ai_btn")}</button>
                        </div>
                        <textarea value={current.notesVendeur || ""} onChange={e => upd(current.id,d => ({ ...d, notesVendeur:e.target.value }))} placeholder={t("ws_notes_vendor_ph")} />
                        {current.aiVendeur && <div className="ai-box"><div className="ai-box-lbl">{t("ws_ai_box_label")}</div><div style={{whiteSpace:"pre-wrap"}}>{current.aiVendeur}</div><button className="btn btn-sm" style={{marginTop:10}} onClick={() => upd(current.id,d => ({ ...d, aiVendeur:"" }))}>{t("ws_ai_clear")}</button></div>}
                      </div>
                    </div>
                  )}

                  {tab === "documents" && (
                    <>
                      {viewing && (
                        <div className="doc-modal">
                          <div className="doc-modal-top">
                            <div className="doc-modal-name"><FileIcon size={14} style={{marginRight:5,verticalAlign:"middle"}} />{viewing.name}</div>
                            <div style={{display:"flex",gap:8,flexShrink:0}}>
                              <a href={viewing.dataUrl} download={viewing.name}><button className="btn btn-sm">{t("ws_doc_download")}</button></a>
                              <button className="btn btn-sm" onClick={() => setViewing(null)}>{t("ws_doc_close")}</button>
                            </div>
                          </div>
                          <div className="doc-modal-body">
                            {viewing.type?.includes("pdf")
                              ? <iframe src={viewing.dataUrl} className="doc-modal-frame" title={viewing.name} />
                              : viewing.type?.includes("image")
                              ? <img src={viewing.dataUrl} alt={viewing.name} style={{maxWidth:"100%",maxHeight:"100%",display:"block",margin:"auto",objectFit:"contain",padding:16}} />
                              : (viewing.type?.includes("spreadsheet") || viewing.name?.match(/\.xlsx?$/i))
                              ? <ErrorBoundary label={t("ws_doc_viewer_err")}>
                                  <Suspense fallback={<div style={{padding:40,textAlign:"center",fontSize:13,color:"var(--text2)"}}>{t("ws_doc_viewer_loading")}</div>}>
                                    <XlsxViewer dataUrl={viewing.dataUrl} />
                                  </Suspense>
                                </ErrorBoundary>
                              : <div style={{padding:40,textAlign:"center",fontSize:13,color:"var(--text2)"}}>{t("ws_doc_preview_unavailable")} <a href={viewing.dataUrl} download={viewing.name} style={{color:"var(--gold)"}}>{t("ws_doc_download")}</a></div>
                            }
                          </div>
                        </div>
                      )}

                      <div className={`doc-drop${dragging?" drag":""}`}
                        onDragOver={e => {e.preventDefault();setDragging(true);}}
                        onDragLeave={() => setDragging(false)}
                        onDrop={e => {e.preventDefault();setDragging(false);handleFiles(e.dataTransfer.files);}}
                        onClick={() => fileRef.current?.click()}>
                        <FolderIcon size={30} style={{marginBottom:8,color:"var(--text3)"}} />
                        <div style={{fontSize:13,fontWeight:700,color:"var(--text)"}}>{t("ws_doc_drop_title")}</div>
                        <div style={{fontSize:11,color:"var(--text3)",marginTop:3}}>{t("ws_doc_drop_sub")}</div>
                        <input ref={fileRef} type="file" multiple style={{display:"none"}} onChange={e => handleFiles(e.target.files)} />
                      </div>

                      {(current.files||[]).length>0 && (
                        <div className="doc-grid">
                          {current.files.map(f => (
                            <div key={f.id} className="doc" onClick={() => setViewing(f)}>
                              <div className="doc-icon">{fileIco(f.type)}</div>
                              <div className="doc-name" title={f.name}>{f.name}</div>
                              <div className="doc-meta">{fmtSz(f.size)} · {new Date(f.uploadedAt).toLocaleDateString(lang === "en" ? "en-CA" : "fr-CA")}</div>
                              <button className="doc-del" onClick={e => {e.stopPropagation();delFile(f.id);}}>✕</button>
                            </div>
                          ))}
                        </div>
                      )}

                      {(current.files||[]).length===0 && !viewing && <div className="status-note">{t("ws_doc_empty")}</div>}
                    </>
                  )}

                  {tab === "checklist" && (
                    <div className="card f-card">
                      <div className="f-title">{t("ws_checklist_title")}</div>
                      <div className="cl-pills">
                        {STAGES.map(s => {
                          const cl = current.checklists?.[s.id] || [];
                          const pct = cl.length ? Math.round(cl.filter(i=>i.done).length/cl.length*100) : null;
                          return (
                            <button key={s.id} className={`cl-pill${clStage===s.id?" active":""}`} onClick={() => {
                              setClStage(s.id);
                              if (!current.checklists?.[s.id]) upd(current.id,d => ({ ...d, checklists:{ ...d.checklists, [s.id]:buildCL(s.id) } }));
                            }}>{t("stage_" + s.id)}{pct!==null ? ` ${pct}%` : ""}</button>
                          );
                        })}
                      </div>

                      {activeCL.length>0 && (
                        <>
                          <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"var(--text3)",marginBottom:4,fontWeight:700}}>
                            <span>{activeCL.filter(i=>i.done).length} / {activeCL.length}</span><span>{donePct}%</span>
                          </div>
                          <div className="cl-progress"><div className="cl-bar" style={{width:`${donePct}%`}}/></div>
                        </>
                      )}

                      {activeCL.map(item => (
                        <div key={item.id} className="cl-item" onClick={() => toggleCL(clStage,item.id)}>
                          <div className={`cl-box${item.done?" done":""}`}>{item.done ? "✓" : ""}</div>
                          <span className={`cl-lbl${item.done?" done":""}`}>{item.label}</span>
                        </div>
                      ))}

                      <div style={{display:"flex",gap:8,marginTop:10}}>
                        <input value={clNew} onChange={e => setClNew(e.target.value)} placeholder={t("ws_checklist_add_ph")}
                          onKeyDown={e => {
                            if (e.key==="Enter" && clNew.trim()) {
                              upd(current.id,d => ({ ...d, checklists:{ ...d.checklists, [clStage]:[...(d.checklists?.[clStage]||[]), { id:`c_${Date.now()}`, label:clNew.trim(), done:false }] } }));
                              setClNew("");
                            }
                          }} />
                        <button className="btn btn-gold" onClick={() => {
                          if (clNew.trim()) {
                            upd(current.id,d => ({ ...d, checklists:{ ...d.checklists, [clStage]:[...(d.checklists?.[clStage]||[]), { id:`c_${Date.now()}`, label:clNew.trim(), done:false }] } }));
                            setClNew("");
                          }
                        }}>{t("ws_checklist_add_btn")}</button>
                      </div>
                    </div>
                  )}

                  {tab === "activity" && (
                    <>
                      <div className="card f-card">
                        <div className="f-title">{t("ws_section_activity")}</div>
                        <ActivityLogger dealId={current.id} onLog={addAct} />
                      </div>
                      <div className="card f-card">
                        <div className="f-title">{t("ws_activity_history")}</div>
                        {(!current.activities || current.activities.length===0)
                          ? <div className="status-note">{t("dashboard_activity_empty")}</div>
                          : <div className="timeline">{current.activities.map(a => (
                              <div key={a.id} className="t-item">
                                <div className="t-dot"/>
                                <div className="t-text">{a.text}</div>
                                <div className="t-time">{new Date(a.time).toLocaleString(lang === "en" ? "en-CA" : "fr-CA",{dateStyle:"short",timeStyle:"short"})}</div>
                              </div>
                            ))}</div>
                        }
                      </div>
                    </>
                  )}

                  {tab === "agent" && (
                    <AgentPanel deal={current} />
                  )}
                </div>
              </>
            )
          )}
        </main>
      </div>

      {modal === "new" && (
        <div className="mo" onClick={() => setModal(null)}>
          <div className="mo-box" onClick={e => e.stopPropagation()}>
            <div className="mo-title">{t("modal_new_deal_title")}</div>
            <div className="f-row">
              <div className="f-lbl">{t("modal_new_field_address")}</div>
              <AddressAutocomplete
                autoFocus
                value={newTitle}
                onChange={v => { setNewTitle(v); setNewAddress(v); setNewAddrCoords(null); }}
                onSelect={s => { setNewTitle(s.label); setNewAddress(s.label); setNewAddrCoords({ lat: s.lat, lng: s.lng }); }}
                placeholder={t("modal_new_address_ph")}
              />
            </div>
            <div className="f-row" style={{display:"flex",gap:10}}>
              <div style={{flex:1}}>
                <div className="f-lbl">{t("ws_field_units")}</div>
                <input type="number" min="1" step="1" value={newUnits} onChange={e => setNewUnits(e.target.value)} placeholder={t("ws_field_units_ph")} />
              </div>
              <div style={{flex:2}}>
                <div className="f-lbl">{t("ws_field_price")}</div>
                <input type="number" min="0" step="1000" value={newAskingPrice} onChange={e => setNewAskingPrice(e.target.value)} placeholder={t("ws_field_price_ph")} onKeyDown={e => e.key === "Enter" && createDealFn()} />
              </div>
            </div>
            <div className="mo-foot">
              <button className="btn" onClick={() => { setModal(null); setNewTitle(""); setNewAddress(""); setNewAddrCoords(null); setNewUnits(""); setNewAskingPrice(""); }}>{t("modal_cancel")}</button>
              <button className="btn btn-gold" onClick={createDealFn}>{t("modal_new_submit")}</button>
            </div>
          </div>
        </div>
      )}

      {modal === "event" && (
        <div className="mo" onClick={() => setModal(null)}>
          <div className="mo-box" onClick={e => e.stopPropagation()}>
            <div className="mo-title">{t("modal_event_title")}</div>
            <div className="f-row"><div className="f-lbl">{t("modal_event_field_title")}</div><input autoFocus value={newEv.title} onChange={e => setNewEv(n => ({ ...n, title:e.target.value }))} placeholder={t("modal_event_title_ph")}/></div>
            <div className="f-row"><div className="f-lbl">{t("modal_event_field_date")}</div><input type="date" value={newEv.date} onChange={e => setNewEv(n => ({ ...n, date:e.target.value }))}/></div>
            <div className="f-row"><div className="f-lbl">{t("modal_event_field_time")}</div><input type="time" value={newEv.time} onChange={e => setNewEv(n => ({ ...n, time:e.target.value }))}/></div>
            <div className="f-row">
              <div className="f-lbl">{t("modal_event_field_deal")}</div>
              <select value={newEv.dealId || currentId || ""} onChange={e => setNewEv(n => ({ ...n, dealId:e.target.value }))}>
                <option value="">{t("modal_event_select_placeholder")}</option>
                {deals.map(d => <option key={d.id} value={d.id}>{dealLabel(d)}</option>)}
              </select>
            </div>
            <div className="mo-foot">
              <button className="btn" onClick={() => setModal(null)}>{t("modal_cancel")}</button>
              <button className="btn btn-gold" onClick={addEvent}>{t("modal_event_submit")}</button>
            </div>
          </div>
        </div>
      )}
      {appToast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            maxWidth: 360,
            padding: "12px 16px",
            background: "#1A1A1A",
            color: "#fff",
            borderRadius: 10,
            boxShadow: "0 6px 24px rgba(0,0,0,0.18)",
            fontSize: 13,
            zIndex: 10000,
          }}
        >
          {appToast}
        </div>
      )}

      {/* Floating chatbox — bottom-right. Collapsed = 💬 gold bubble; expanded
          = small chat panel with messages, an input, and a send button. */}
      <ChatWidget
        open={chatOpen}
        setOpen={setChatOpen}
        messages={chatMessages}
        input={chatInput}
        setInput={setChatInput}
        busy={chatBusy}
        onSend={sendChat}
        t={t}
      />
    </>
  );
}

// XlsxViewer, LeadFiche, LeadListRow, LEAD_ROW_HEIGHT moved to ./components/*.jsx
// LeadsManager and PhoneFinder moved to ./pages/*.jsx (lazy-loaded above).


// AddressAutocomplete, DealMap, ActivityLogger moved to ./components/*.jsx
// (imported at the top of this file).

// ─── ChatWidget ────────────────────────────────────────────────────────────
// Floating OpenAI chat. Closed state = 💬 gold button bottom-right. Opened
// = compact chat panel with messages, an input, and a send button. Renders
// nothing auth-sensitive — `sendChat` / state lives in App().
function ChatWidget({ open, setOpen, messages, input, setInput, busy, onSend, t }) {
  const scrollRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open, messages, busy]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("chat_title")}
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          width: 54,
          height: 54,
          borderRadius: "50%",
          background: "#C9A84C",
          color: "#fff",
          border: "none",
          boxShadow: "0 8px 24px rgba(201,168,76,0.45)",
          fontSize: 24,
          cursor: "pointer",
          zIndex: 9998,
          display: "grid",
          placeItems: "center",
        }}
      >
        <ChatIcon size={18} />
      </button>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        width: 360,
        maxWidth: "92vw",
        height: 480,
        maxHeight: "80vh",
        background: "#fff",
        border: "1px solid var(--border)",
        borderRadius: 14,
        boxShadow: "0 16px 48px rgba(0,0,0,0.18)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        zIndex: 9999,
      }}
    >
      <div
        style={{
          padding: "10px 14px",
          background: "linear-gradient(90deg, #C9A84C 0%, #D4B765 100%)",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{fontSize: 13, fontWeight: 700, letterSpacing: 0.3}}>
          ✦ {t("chat_title")}
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={t("chat_close_label")}
          style={{
            background: "rgba(255,255,255,0.2)",
            border: "none",
            color: "#fff",
            width: 24,
            height: 24,
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 14,
            lineHeight: 1,
          }}
        >×</button>
      </div>

      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: 12,
          background: "#FAF8F2",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              alignSelf: m.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "85%",
              background: m.role === "user" ? "#C9A84C" : "#fff",
              color: m.role === "user" ? "#fff" : "var(--text)",
              border: m.role === "user" ? "none" : "1px solid var(--border)",
              borderRadius: 10,
              padding: "8px 10px",
              fontSize: 12,
              whiteSpace: "pre-wrap",
              lineHeight: 1.45,
            }}
          >
            {m.content}
          </div>
        ))}
        {busy && (
          <div
            style={{
              alignSelf: "flex-start",
              fontSize: 11,
              color: "var(--text3)",
              fontStyle: "italic",
              padding: "4px 10px",
            }}
          >
            {t("chat_thinking")}
          </div>
        )}
      </div>

      <div
        style={{
          padding: 10,
          borderTop: "1px solid var(--border)",
          background: "#fff",
          display: "flex",
          gap: 6,
        }}
      >
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !busy) onSend(input); }}
          placeholder={t("chat_placeholder")}
          disabled={busy}
          style={{
            flex: 1,
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "8px 10px",
            fontSize: 12,
            outline: "none",
          }}
        />
        <button
          type="button"
          onClick={() => onSend(input)}
          disabled={busy || !input.trim()}
          className="btn btn-gold btn-sm"
          style={{whiteSpace: "nowrap"}}
        >
          {t("chat_send")}
        </button>
      </div>
    </div>
  );
}

// ─── FlagForReviewBanner ───────────────────────────────────────────────────
// Yellow banner above the Workspace CRM tab. Employees only. Once the deal
// has a pending flag, the UI switches to "already submitted — update" mode
// so re-submitting with a new note replaces the prior entry (see flagDeal).
function FlagForReviewBanner({ dealId, existing, onFlag, t }) {
  const [note, setNote] = useState(existing?.note || "");
  const [justSent, setJustSent] = useState(false);
  const already = !!existing;

  const submit = () => {
    onFlag(dealId, note);
    setJustSent(true);
    setTimeout(() => setJustSent(false), 2500);
  };

  return (
    <div style={{
      background: "#FFF8E1",
      border: "1px solid #E8D79A",
      borderRadius: 12,
      padding: "12px 14px",
      marginBottom: 14,
      display: "flex",
      flexDirection: "column",
      gap: 8,
    }}>
      <div style={{fontSize: 13, fontWeight: 700, color: "#8D6A15"}}>
        {t("flag_banner")}
      </div>
      <div style={{display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap"}}>
        <input
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder={t("flag_note_placeholder")}
          style={{
            flex: 1, minWidth: 200,
            border: "1px solid #E8D79A",
            background: "#fff",
            borderRadius: 8,
            padding: "8px 10px",
            fontSize: 12,
          }}
          onKeyDown={e => { if (e.key === "Enter") submit(); }}
        />
        <button
          type="button"
          onClick={submit}
          className="btn btn-gold btn-sm"
          style={{whiteSpace: "nowrap"}}
        >
          {already ? t("flag_resubmit") : t("flag_submit")}
        </button>
      </div>
      {justSent && (
        <div style={{fontSize: 11, color: "#2D8C4E", fontWeight: 600}}>
          ✓ {t("flag_submitted")}
        </div>
      )}
    </div>
  );
}

// ─── LoginScreen ────────────────────────────────────────────────────────────
// Gold/white PIN login. Two user tiles (click to pick), 4-digit PIN input,
// Enter button, inline error when PIN is wrong. EN/FR toggle top-right to
// match the rest of the app. Deliberately tiny — not a security boundary,
// just a "who am I" picker that feeds the role-gated UI.
function LoginScreen({ users, onLogin, lang, setLang, t }) {
  const [selected, setSelected] = useState(users[0]?.id || "");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");

  const submit = () => {
    if (!selected) return;
    const ok = onLogin(selected, pin);
    if (!ok) {
      setErr(t("login_error"));
      setPin("");
    } else {
      setErr("");
    }
  };

  const switchLabel = lang === "fr" ? "EN" : "FR";

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "linear-gradient(160deg, #F5F3EE 0%, #FAF7EE 55%, #F0E7C9 100%)",
      display: "grid", placeItems: "center",
      fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
      color: "#1A1A1A",
    }}>
      <button
        type="button"
        onClick={() => setLang(lang === "fr" ? "en" : "fr")}
        style={{
          position: "absolute", top: 20, right: 20,
          border: "1px solid #E8E3D8", background: "#fff",
          borderRadius: 10, padding: "6px 14px",
          fontSize: 12, fontWeight: 700, letterSpacing: 0.3,
          cursor: "pointer",
        }}
      >
        {switchLabel}
      </button>

      <div style={{
        width: 400, maxWidth: "92vw",
        background: "#fff", border: "1px solid #E8E3D8",
        borderRadius: 16, padding: "32px 28px",
        boxShadow: "0 20px 60px rgba(0,0,0,0.08)",
      }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{
            fontSize: 28, fontWeight: 700, letterSpacing: 2,
            color: "#1A1A1A",
          }}>SOCLE</div>
          <div style={{
            fontSize: 11, fontWeight: 700, letterSpacing: 4,
            color: "#C9A84C", marginTop: 2,
          }}>ACQUISITIONS</div>
          <div style={{ fontSize: 12, color: "#6B6B6B", marginTop: 10 }}>
            {t("login_tag")}
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
          {users.map(u => {
            const isActive = selected === u.id;
            return (
              <button
                key={u.id}
                type="button"
                onClick={() => { setSelected(u.id); setPin(""); setErr(""); }}
                style={{
                  flex: 1,
                  padding: "14px 10px",
                  borderRadius: 12,
                  border: `1.5px solid ${isActive ? "#C9A84C" : "#E8E3D8"}`,
                  background: isActive ? "#FAF5E6" : "#fff",
                  cursor: "pointer",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
                }}
              >
                <div style={{
                  width: 44, height: 44, borderRadius: "50%",
                  background: isActive ? "#C9A84C" : "#F5F3EE",
                  color: isActive ? "#fff" : "#6B6B6B",
                  display: "grid", placeItems: "center",
                  fontWeight: 700, fontSize: 14,
                }}>
                  {u.initials}
                </div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#1A1A1A" }}>{u.name}</div>
                <div style={{ fontSize: 10, color: "#A0A0A0" }}>
                  {(u.roleLabel && u.roleLabel[lang]) || u.role}
                </div>
              </button>
            );
          })}
        </div>

        <input
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={4}
          autoFocus
          value={pin}
          placeholder={t("login_pin_placeholder")}
          onChange={e => { setPin(e.target.value.replace(/[^0-9]/g, "").slice(0, 4)); setErr(""); }}
          onKeyDown={e => { if (e.key === "Enter") submit(); }}
          style={{
            width: "100%",
            padding: "12px 14px",
            fontSize: 18, letterSpacing: 8, textAlign: "center",
            border: `1.5px solid ${err ? "#C0392B" : "#E8E3D8"}`,
            borderRadius: 10,
            outline: "none",
            marginBottom: 10,
          }}
        />
        {err && (
          <div style={{ fontSize: 12, color: "#C0392B", textAlign: "center", marginBottom: 8 }}>
            {err}
          </div>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={pin.length < 4}
          style={{
            width: "100%",
            padding: "12px",
            background: pin.length < 4 ? "#E8E3D8" : "#C9A84C",
            color: pin.length < 4 ? "#A0A0A0" : "#fff",
            border: "none", borderRadius: 10,
            fontSize: 13, fontWeight: 700, letterSpacing: 0.5,
            cursor: pin.length < 4 ? "not-allowed" : "pointer",
          }}
        >
          {t("login_submit")}
        </button>
      </div>
    </div>
  );
}
