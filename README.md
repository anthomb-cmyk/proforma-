# FluxLocatif — version IA complète

## 1. Ajouter ta clé API
Crée un fichier `.env` à la racine du dossier, en copiant `.env.example`.

Contenu minimal :

```env
OPENAI_API_KEY=ta_cle_openai
OPENAI_MODEL=gpt-4.1-mini
PORT=3000
```

## 2. Installer les dépendances

```bash
npm install
```

## 3. Démarrer l'application

```bash
npm start
```

Puis ouvre :

```text
http://localhost:3000
```

## 4. Comment ça marche

### Mode Assistant des immeubles
- exige une référence comme `L-1001`
- répond seulement sur cet immeuble
- lecture seule
- redirige vers le Traducteur pour toute question de langue

### Mode Traducteur
- traduit ou explique seulement le texte fourni
- refuse toute question liée aux immeubles ou aux logements
- redirige vers l'Assistant des immeubles pour ces questions

## 5. Modifier tes immeubles
Remplace les données du fichier `listings.json` par tes vraies annonces.

Format :

```json
{
  "L-1001": {
    "ref": "L-1001",
    "address": "Adresse",
    "city": "Ville",
    "rent": "1 250 $",
    "bedrooms": "3 1/2",
    "availability": "Disponible maintenant",
    "status": "Actif",
    "notes": "Notes internes visibles en lecture seule.",
    "description": "Description courte."
  }
}
```

## 6. Important
Si tu changes le port, mets aussi à jour l'URL d'ouverture dans ton navigateur.
