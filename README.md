# Ouenze

## Présation

Ouenze est une plateforme de création et de gestion de boutiques en ligne, permettant aux vendeurs de créer facilement leur espace de vente et aux utilisateurs de découvrir, commander et suivre leurs produits.

---

## Fonctionnement global

### Utilisateur non connecté / client

1. Accès à la plateforme

* Inscription ou connexion
* Accès à la page d’accueil

2. Navigation

* Recherche de boutiques ou produits
* Consultation d’une boutique
* Ajout de produits au panier

3. Achat

* Validation du panier
* Passage de commande

4. Suivi

* Accès au suivi de livraison
* Possibilité de noter la boutique après réception

---

### Parcours utilisateur

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
 Validation
        ↓
  Suivi commande
        ↓
   Notation
```

---

## Pages principales

* `index.html`
  Page d’accueil avec recherche et affichage des boutiques

* `shop.html`
  Page d’une boutique avec ses produits

* `tracking.html`
  Suivi des commandes et de la livraison

---

## Espace vendeur

### Accès

Le vendeur doit être connecté pour accéder à son espace.

### Fonctionnalités

* Création de boutique
* Ajout et gestion de produits
* Gestion du stock
* Ravitaillement

### Tableau de bord

* `ouenze-vendor-dashboard`
  Interface principale de gestion

---

## Création de boutique

* `ouenze-shop-designer.html`

Permet de :

* Personnaliser le design
* Ajouter des catégories
* Ajouter des produits
* Configurer le menu
* Gérer le carrousel
* Définir les couleurs et le style

---

## Architecture du projet

```
Utilisateur
│
├── index.html (Accueil)
│
├── shop.html (Boutique)
│
├── tracking.html (Suivi)
│
└── Panier / Commande

Vendeur
│
├── Dashboard
│
├── Création boutique
│   └── ouenze-shop-designer.html
│
├── Gestion produits
│
└── Ravitaillement
```

---

## Fonctionnalités clés

* Création de boutiques personnalisées
* Produits illimités
* Gestion des catégories et sous-catégories
* Système de panier
* Suivi des commandes
* Système de notation
* Interface vendeur complète

---

## Limitations actuelles

* Les données sont stockées en local (localStorage)
* Les boutiques ne sont pas partagées entre utilisateurs
* Pas encore de base de données distante

---

## Évolutions prévues

* Intégration d’une base de données (Firebase / Supabase)
* Système de comptes utilisateurs avancé
* Paiement en ligne sécurisé
* Système d’investissement dans les boutiques
* Système de livraison avec suivi en temps réel

---

## Objectif

Créer une plateforme simple, accessible et performante pour permettre :

* Aux vendeurs de gérer leur activité facilement
* Aux utilisateurs de commander en toute confiance
* Aux investisseurs de soutenir des boutiques fiables

---

## Statut

Projet en cours de développement.
