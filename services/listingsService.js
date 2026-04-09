export function createListingsService({
  readJsonFile,
  writeJsonFile,
  listingsPath,
  toListingRecord
}) {
  async function loadListingsMap() {
    const raw = await readJsonFile(listingsPath, {});
    const normalized = {};

    Object.entries(raw).forEach(([key, value]) => {
      const record = toListingRecord(key, value);
      normalized[record.ref] = record;
    });

    return normalized;
  }

  async function saveListingsMap(listingsMap) {
    const output = {};

    Object.values(listingsMap)
      .sort((a, b) => Number(a.ref) - Number(b.ref))
      .forEach((listing) => {
        output[`L-${listing.ref}`] = {
          ref: `L-${listing.ref}`,
          address: listing.address || listing.adresse || "",
          city: listing.city || listing.ville || "",
          rent: listing.rent || listing.loyer || "",
          bedrooms: listing.bedrooms || listing.chambres || "",
          availability: listing.availability || listing.disponibilite || "",
          status: listing.status || listing.statut || "",
          notes: listing.notes || "",
          description: listing.description || "",
          adresse: listing.adresse || listing.address || "",
          ville: listing.ville || listing.city || "",
          zone: listing.zone || "",
          lat: listing.lat ?? null,
          lng: listing.lng ?? null,
          type_logement: listing.type_logement || "",
          chambres: listing.chambres || listing.bedrooms || "",
          superficie: listing.superficie || "",
          loyer: listing.loyer || listing.rent || "",
          inclusions: listing.inclusions || "",
          statut: listing.statut || listing.status || "",
          stationnement: listing.stationnement || "",
          animaux_acceptes: listing.animaux_acceptes || "",
          meuble: listing.meuble || "",
          disponibilite: listing.disponibilite || listing.availability || "",
          electricite: listing.electricite || "",
          balcon: listing.balcon || "",
          wifi: listing.wifi || "",
          acces_au_terrain: listing.acces_au_terrain || "",
          nombre_stationnements_gratuits: listing.nombre_stationnements_gratuits ?? null,
          nombre_stationnements_payants: listing.nombre_stationnements_payants ?? null,
          prix_stationnement_payant: listing.prix_stationnement_payant ?? null,
          electros_inclus: listing.electros_inclus || "",
          laveuse_secheuse: listing.laveuse_secheuse || "",
          nombre_logements_batisse: listing.nombre_logements_batisse ?? null,
          rangement: listing.rangement || "",
          client_id: listing.client_id ?? null
        };
      });

    await writeJsonFile(listingsPath, output);
  }

  return {
    loadListingsMap,
    saveListingsMap
  };
}
