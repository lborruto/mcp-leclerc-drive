<h1 align="center">mcp-leclerc-drive</h1>

<p align="center">
  <strong>Remplissez votre panier E.Leclerc Drive depuis Claude.</strong><br>
  Un serveur MCP qui trouve votre drive, cherche dans les rayons et ajoute au panier, à travers votre propre Chrome. Rien au-delà du panier : c'est vous qui commandez.
</p>

<p align="center">🇬🇧 <a href="../README.md">Read in English</a></p>

<p align="center"><img src="screenshots/demo.svg" alt="Une conversation de courses : Claude cherche du beurre sur E.Leclerc Drive, ajoute deux packs d'eau gazeuse au panier, puis liste les promotions sur le café moulu triées au kilo. Rien n'est commandé." width="980"></p>

<sub>Sortie des outils lors d'essais réels les 1ᵉʳ et 11 novembre 2026 (magasin, prix et promotions de ces jours-là), raccourcie pour tenir.</sub>

## Ce que ça fait

- **Trouve votre drive.** Par code postal ou par ville, du plus proche au plus loin, puis retient
  celui que vous choisissez.
- **Cherche dans les rayons.** Prix, prix au kilo ou au litre, format, famille, avis clients,
  remises immédiates, stock, et ce qui est déjà dans votre panier. Du moins cher au plus cher, ou
  au kilo, si vous le demandez.
- **Remplit le panier.** Un produit ou jusqu'à 30 d'un coup, fixer une quantité, retirer une
  ligne, lire le panier et son total. Chaque changement est confirmé par Leclerc Drive ; s'il en
  a gardé moins (stock, limite), c'est dit.
- **Retient vos produits habituels.** « Mémorise ce lait comme mon lait habituel » : la semaine
  suivante, « ajoute mon lait » se passe de recherche. Rien ne quitte votre ordinateur.
- **S'arrête au panier.** Aucun outil ne valide le panier, ne réserve de créneau, ne commande ni
  ne paie. Vous vérifiez le panier et terminez sur le site, comme d'habitude.
- **À travers votre propre Chrome.** Le serveur ouvre une fenêtre Chrome avec son propre profil ;
  vous vous y connectez à Leclerc Drive une fois, et la connexion est gardée. Les requêtes partent
  une par une, au rythme d'une personne.

## Sécurité

À lire avant d'installer.

- **Il ne voit jamais votre mot de passe.** Vous vous connectez vous-même, dans la fenêtre Chrome
  qu'il ouvre. Votre session reste dans ce profil Chrome dédié (`~/.mcp-leclerc-drive/chrome`) ;
  le serveur ne lit, n'enregistre et ne journalise aucun cookie, mot de passe ou code de
  vérification.
- **Il ne parle qu'à Leclerc Drive.** Chaque page et chaque requête est vérifiée contre une courte
  liste d'hôtes `leclercdrive.fr`, même après une redirection. Pas de télémétrie, aucun autre site.
- **Votre Chrome de tous les jours n'est jamais touché.** Le serveur refuse d'utiliser votre profil
  Chrome habituel et ne se connecte jamais à un Chrome qu'il n'a pas lancé.
- **Les changements de panier sont réels.** C'est votre panier Leclerc. Les noms de produits
  viennent du site et sont montrés au modèle comme des données ; vérifiez le panier avant de
  commander.
- **Tant qu'elle est ouverte, la fenêtre est pilotable depuis cet ordinateur.** Chrome écoute sur
  un port local de débogage (127.0.0.1:9333) pour que le serveur le pilote ; un autre programme
  lancé sous votre compte sur cet ordinateur le pourrait aussi. Fermez la fenêtre quand vous avez
  fini vos courses.

Le détail, et comment signaler une faille : [SECURITY.md](../SECURITY.md) (en anglais).

## Démarrer

**Il vous faut :** Google Chrome, un compte Leclerc Drive, et un client MCP comme Claude Desktop
ou [Claude Code](https://claude.com/claude-code) (pour Claude Code : Node.js 22 ou plus récent).

**1a. Claude Desktop, sans terminal :** téléchargez `mcp-leclerc-drive-0.5.0.mcpb` depuis la
[dernière version](https://github.com/lborruto/mcp-leclerc-drive/releases/latest) et ouvrez-le
(ou glissez-le dans Réglages › Extensions de Claude Desktop), puis passez à l'étape 2.

**1b. Claude Code**, depuis la dernière version (construite et attestée par GitHub Actions) :

```bash
claude mcp add --scope user leclerc-drive -- npx -y \
  --package=https://github.com/lborruto/mcp-leclerc-drive/releases/download/v0.5.0/mcp-leclerc-drive-0.5.0.tgz \
  mcp-leclerc-drive
```

> Pas `npx mcp-leclerc-drive` tout court : ce nom, sur npm, est la version 0.3.0 d'origine, qui
> n'est plus maintenue et n'a ni ces corrections ni ces vérifications. Ce projet n'est jamais
> publié sur npm.

**2. Connectez-vous une fois.** Demandez à Claude quelque chose qui a besoin du site (« trouve
les drives autour de 74100 »). Une fenêtre Chrome s'ouvre : connectez-vous à Leclerc Drive et
choisissez-y votre drive. Laissez la fenêtre ouverte pendant vos courses ; la connexion est
gardée pour la prochaine fois.

**3. Choisissez votre drive** dans Claude : « trouve les drives autour de 74100 », puis « prends
le 027411 » avec l'identifiant affiché. Les courses se font sur le drive auquel la fenêtre Chrome
est connectée.

**4. Faites vos courses.** « Ajoute 2 packs de lait et du beurre », « qu'y a-t-il dans mon
panier ? », « enlève le beurre ». Ou donnez toute la liste d'un coup avec le prompt `courses`.
Ouvrez ensuite le panier sur leclercdrive.fr et commandez vous-même.

## Les outils

| Outil | Ce qu'il fait |
|---|---|
| `find_stores` | Les drives proches d'un code postal ou d'une ville, avec l'identifiant pour en choisir un. |
| `set_store` / `get_store` | Choisir le drive (retenu d'une session à l'autre) / l'afficher. |
| `search_product` | Chercher dans le catalogue du drive : prix, prix au kilo, format, famille, avis, offres, stock, déjà au panier. Par pertinence, par prix ou par prix au kilo. |
| `browse_offers` | Les produits en promotion dans votre drive, filtrés par mots si vous en donnez. |
| `add_to_cart` | Ajouter des unités d'un produit, en plus de ce que le panier contient. |
| `add_many` | Ajouter jusqu'à 30 produits d'un coup ; un échec n'arrête pas les autres. |
| `update_quantity` | Fixer une ligne à une quantité exacte (0 la retire). |
| `remove_from_cart` | Retirer une ligne. |
| `get_cart` | Le panier, ligne par ligne, avec le total. |
| `list_usuals` / `save_usual` / `forget_usual` | Vos produits habituels : un nom court pour un produit, par drive, gardé sur votre ordinateur. |
| `diagnostic` | Vérifie l'installation (versions, Chrome, drive, session). Peut être collé tel quel dans un rapport de bug. |

Et un prompt, `courses` : donnez-lui votre liste, il remplit le panier (vos produits habituels
d'abord) et s'arrête là.

## Bon à savoir

- **Un drive à la fois.** Votre session Leclerc est liée au drive choisi sur le site.
  `find_stores` signale le drive sur lequel se trouve la fenêtre Chrome, et `set_store` prévient
  si vous en choisissez un autre : pour y faire vos courses, choisissez-le aussi dans la fenêtre
  Chrome ; sinon Leclerc répond par une page de session expirée.
- **Déconnecté ?** Les outils du panier le disent quand personne n'est connecté dans la fenêtre
  Chrome : le panier qu'ils remplissent est alors celui d'un visiteur, pas celui de votre compte.
- **Bloqué ou déconnecté ?** Si un outil dit que Leclerc Drive l'a bloqué ou que la session a
  expiré, rechargez la page dans la fenêtre Chrome du serveur (reconnectez-vous si on vous le
  demande) et réessayez. Gardez le rythme d'une personne : une liste de courses à la fois.
- **Les quantités sont vérifiées par Leclerc.** Si un produit manque ou est limité, l'outil dit
  combien sont allés au panier. Les prix sont ceux du site au moment de la recherche.
- **Les relais ont leur propre identifiant.** `find_stores` affiche les relais camion et piéton
  sous la forme `027411-027499` : ils partagent le numéro de leur drive.
- **Une seule session Claude à la fois.** Plusieurs sessions partagent le même Chrome et la même
  connexion, mais chacune ne rythme que ses propres requêtes.

## Mettre à jour

Dans Claude Desktop, ouvrez le fichier `.mcpb` de la nouvelle version. Dans Claude Code, changez
la version dans la commande `claude mcp add` (retirez l'ancienne entrée avec `claude mcp remove
leclerc-drive`). Ce qui a changé est dans [CHANGELOG.md](../CHANGELOG.md). Votre connexion, votre
drive et vos produits habituels sont conservés.

## Aide

Réglages avancés, autres clients MCP, fonctionnement interne : voir le
[README en anglais](../README.md) et [CONTRIBUTING.md](../CONTRIBUTING.md).

Un bug ? [Ouvrez une issue](https://github.com/lborruto/mcp-leclerc-drive/issues), en français
si vous préférez, avec le résultat de l'outil `diagnostic` (« lance le diagnostic ») et le texte
de l'erreur. Jamais vos cookies, votre compte, votre adresse ni de capture d'écran de votre
compte connecté.

## Licence et crédits

MIT, voir [LICENSE](../LICENSE). Parti de [skunkobi/mcp-leclerc-drive](https://github.com/skunkobi/mcp-leclerc-drive)
0.3.0 (MIT), qui a cartographié le site et trouvé comment passer par un vrai Chrome ; ce projet
le continue, avec son historique.

## Non affilié, sans garantie

Projet indépendant et non officiel. Il n'est ni réalisé, ni approuvé, ni soutenu par E.Leclerc,
DataDome, Google ou Anthropic ; ces noms leur appartiennent et ne servent ici qu'à dire avec quoi
il fonctionne. Il pilote un site web qui peut changer à tout moment, sans aucune garantie :
vérifiez votre panier avant de commander.
