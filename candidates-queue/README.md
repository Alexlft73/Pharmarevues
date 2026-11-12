# File de candidates (injection automatique)

Toute nouvelle entrée ici déclenche l'Action GitHub « Injection automatique PharmaVeille » :
injection → validation structurelle → recalcul guide-filtres + dépliant → commit → file vidée.

## Format d'un fichier .json
{
  "revues": [ { "id":"...", "ty":"Médicament|Complément|Officine|...", "dom":"...", "n":1-5, "dt":"AAAA-MM", "des":"titre", "tag":"subst", "res":"résumé (option \"En officine : ...\" extraite automatiquement)", "src":[["nom","url"]], "coi":"optionnel", "fin":"optionnel" } ],
  "recos": [ { "spe":"...", "org":"...", "dt":"AAAA ou AAAA-MM", "titre":"...", "res":"...", "src":[["nom","url"]], "geo":"fr" (uniquement si française) } ]
}

Règles d'or inchangées : URL vue, date vérifiée, dédoublonnage contre base-index.md — l'injecteur écarte
automatiquement tout titre déjà en base (signalé dans INJECTION_LOG.md), mais la vérification AVANT poussée reste obligatoire.
Si une validation échoue, l'Action échoue et RIEN n'est publié.
