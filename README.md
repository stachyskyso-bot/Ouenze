# Ouenze - Documentation technique

## Présentation

Ouenze est une plateforme complète de marketplace e-commerce dédiée au Congo Brazzaville. Elle permet aux vendeurs de créer et personnaliser leurs boutiques en ligne, et aux clients d'acheter des produits avec un système de suivi de livraison en temps réel, de notation, et d'investissement.

---

## Architecture du projet

Le projet est composé de plusieurs pages HTML interconnectées :

| Fichier | Rôle | Accès |
|---------|------|-------|
| `index.html` | Page d'accueil de la marketplace | Public |
| `shop-designer.html` | Création et personnalisation de boutique | Vendeur (lien email) |
| `vendor-dashboard.html` | Tableau de bord vendeur | Vendeur connecté |
| `tracking.html` | Suivi de livraison en temps réel | Client après commande |
| `invest.html` | Plateforme d'investissement | Public |
| `accounting.html` | Comptabilité vendeur | Vendeur connecté |
| `help.html` | Centre d'aide | Public |
| `privacy.html` | Politique de confidentialité | Public |
| `about.html` | À propos | Public |

---

## Parcours utilisateur

### Client non connecté

```
Inscription / Connexion
        ↓
     Accueil
        ↓
Recherche / Navigation
        ↓
   Boutique
        ↓
    Panier
        ↓
 Validation + Paiement
        ↓
  Suivi commande (tracking.html)
        ↓
   Notation de la boutique
```

### Vendeur

```
Inscription (type vendeur)
        ↓
Email avec lien de création
        ↓
shop-designer.html (personnalisation)
        ↓
Publication de la boutique
        ↓
vendor-dashboard.html (gestion)
        ↓
├── Gestion produits
├── Gestion stock / ravitaillement
├── Gestion actifs / passifs
├── Proposition à l'investissement
└── Comptabilité (accounting.html)
```

### Investisseur

```
Accès à invest.html
        ↓
Consultation des boutiques éligibles (≥3⭐)
        ↓
Analyse des indicateurs financiers
        ↓
Achat d'actions / Acquisition de boutique
        ↓
Soumission de demande (vérification 48h)
```

---

## Fonctionnalités principales

### Marketplace (index.html)

- **Classement des boutiques** : par note, date, ventes
- **Recherche avancée** : boutiques, produits, tous
- **Système de niveaux** (Or, Argent, Bronze) avec commissions personnalisées
- **Inscription 3 étapes** avec pièce d'identité
- **Panier** avec calcul des frais de livraison (10%)
- **Paiement sécurisé** : carte bancaire (Visa/MasterCard), Mobile Money (MTN/Airtel), PayPal, espèces
- **Modale produit** avec galerie photos, couleurs, tailles, infos alimentaires

### Création de boutique (shop-designer.html)

- **Logo personnalisable** (carré, arrondi, cercle)
- **Menu de navigation** (horizontal, vertical gauche/droite) avec sous-catégories déroulantes
- **Carrousel** (images/vidéos) avec hauteur, arrondi, vitesse auto réglables
- **Personnalisation complète** : couleurs, dimensions produits, disposition (grille/liste)
- **Produits illimités** avec photos, couleurs, tailles
- **Type alimentaire** avec champs spécifiques (expiration, poids, origine, ingrédients)
- **Aperçu en temps réel**

### Tableau de bord vendeur (vendor-dashboard.html)

- **Statistiques globales** (boutiques, produits, commandes, CA)
- **Gestion des actifs et passifs** avec valorisation professionnelle
- **Ajout de produits** avec quantité
- **Ravitaillement de stock**
- **Système de niveaux** (Or, Argent, Bronze) avec commissions et bonus
- **Partage de boutique** sur les réseaux sociaux
- **Vente de boutique** (transfert ou suppression)
- **Lien vers la comptabilité**

### Suivi de livraison (tracking.html)

- **Jauge de progression** dynamique
- **Étapes détaillées** (6 étapes)
- **Animation de voiture** en temps réel
- **Historique complet** avec dates
- **Notification email** à chaque étape
- **Système de notation** après livraison

### Plateforme d'investissement (invest.html)

- **Classement des boutiques** par note, prix, croissance, niveau
- **Fourchettes d'investissement** selon le niveau (Or, Argent, Bronze)
- **Graphiques interactifs** (évolution du prix, volume, CA, actifs/passifs)
- **Achat/vente d'actions**
- **Acquisition de boutique**
- **Système de vérification** 48h
- **Validation des informations de paiement**

### Comptabilité (accounting.html)

- **Livre journal** automatisé (généré depuis les commandes)
- **Compte de résultat (CPC)** avec produits/charges
- **Balance générale**
- **Saisie manuelle d'écritures**
- **Graphiques d'évolution du CA**
- **Export CSV**

---

## Système de niveaux et commissions

| Niveau | Conditions | Commission Ouenze | Bonus vendeur |
|--------|------------|-------------------|---------------|
| **Or** | ⭐ ≥ 4.5, CA > 10M FCFA, valorisation > 1M FCFA, boutique physique | 21% | +1% |
| **Argent** | ⭐ ≥ 4, CA 5-10M FCFA, valorisation > 500k FCFA | 21.5% | +0.5% |
| **Bronze** | ⭐ ≥ 3 | 22% | 0% |

---

## Formules de calcul

### Valorisation d'une boutique
```
Valorisation = (Résultat × Multiple) + Trésorerie estimée + Actifs - Dettes
```
- Résultat = CA - Charges estimées (35%)
- Multiple = 2 à 8 selon la note et le nombre de produits
- Trésorerie estimée = CA × 0.2

### Prix par action
```
Prix par action = Valorisation / 1000
```

### Frais de livraison
```
Frais de livraison = Sous-total × 10%
```

---

## Technologies utilisées

- **HTML5** : Structure des pages
- **CSS3** : Styles, animations, grid, flexbox
- **JavaScript ES6** : Logique métier, gestion localStorage
- **Chart.js** : Graphiques et visualisations
- **Font Awesome 6** : Icônes
- **Google Fonts (Inter)** : Typographie

---

## Stockage des données

Toutes les données sont stockées dans le `localStorage` du navigateur :

| Clé | Contenu |
|-----|---------|
| `ouenze_shops` | Liste des boutiques |
| `ouenze_orders` | Historique des commandes |
| `ouenze_cart` | Panier utilisateur |
| `ouenze_current_user` | Utilisateur connecté |
| `ouenze_investments` | Investissements réalisés |
| `ouenze_investment_requests` | Demandes d'investissement |
| `ouenze_manual_entries` | Écritures comptables manuelles |
| `ouenze_holdings` | Actions détenues par les investisseurs |

---

## Sécurité

- **Système de séquestre** : les fonds sont bloqués jusqu'à validation
- **Validation des coordonnées bancaires** pour les vendeurs
- **Pièce d'identité** obligatoire à l'inscription
- **Garantie anti-escroquerie** : remboursement intégral en cas de fraude prouvée
- **Simulation d'envoi d'email** pour toutes les notifications

---

## Évolutions prévues

- Intégration d'une base de données distante (Firebase / Supabase)
- Système de paiement réel avec API (Stripe, Orange Money, MTN Money)
- Notifications push et emails réels
- Application mobile
- Système de livraison avec API de suivi
- Chat entre vendeurs et acheteurs

---

## Statut

Projet en développement actif - Version 2.0
Dernière mise à jour : 31 mars 2024
