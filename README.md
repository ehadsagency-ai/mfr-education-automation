# MFR Education Automation

🚀 **Système d'automatisation intelligent pour les Maisons Familiales Rurales**

## 📋 Vue d'ensemble

Ce projet automatise les processus éducatifs et administratifs des MFR en utilisant l'intelligence artificielle et l'intégration Google Workspace.

## 🏗️ Architecture

### 🤖 Agents LangChain
- **Agents intelligents** : Automatisation pilotée par l'IA
- **Outils Google** : Intégration complète Google Workspace
- **Workflows** : Processus orchestrés multi-étapes

### 🛠️ Technologies
- **LangChain/LangGraph** : Framework d'IA
- **Providers d'IA** : Anthropic Claude, OpenAI, DeepSeek, Google Gemini
- **Google Cloud** : APIs et authentification
- **FastAPI** : API web moderne
- **GitHub Actions** : CI/CD automatisé

## 🚀 Démarrage rapide

### Prérequis
- Python 3.11+
- Compte Google Cloud Platform
- Accès aux APIs Google Workspace

### Installation
```bash
# Cloner le projet
git clone https://github.com/ehadsagency-ai/mfr-education-automation.git
cd mfr-education-automation

# Installer les dépendances
pip install -r requirements.txt

# Configurer les variables d'environnement
cp .env.example .env
# Éditer .env avec vos clés API
```

### Configuration
1. **Google Cloud** : Configurer les credentials JSON
2. **APIs d'IA** : Ajouter les clés Anthropic, OpenAI, DeepSeek
3. **GitHub Secrets** : Configurer pour le déploiement automatique

## 📁 Structure du projet

```
mfr-automation/
├── 🤖 langchain-agents/     # Agents IA et outils
│   ├── agents/              # Agents spécialisés
│   ├── tools/               # Intégrations Google
│   └── workflows/           # Processus automatisés
├── ⚙️ .github/workflows/    # Automation CI/CD
├── 🐳 .devcontainer/        # Environnement de développement
├── 📋 config/               # Configurations
├── 📊 data-schemas/         # Schémas de données
├── 🚀 deployment/           # Scripts de déploiement
├── 📖 docs/                 # Documentation
├── 📝 templates/            # Modèles de documents
└── 🧪 tests/                # Tests automatisés
```

## 🔧 Outils Google intégrés

- **📊 Google Sheets** : Gestion des données étudiants
- **📄 Google Docs** : Génération de rapports automatisée
- **📁 Google Drive** : Stockage et partage de fichiers
- **✉️ Gmail** : Communications automatisées
- **🎓 Google Classroom** : Gestion des cours

## 🤖 Workflows automatisés

- **Onboarding enseignants** : Processus d'intégration automatique
- **Tests de performance** : Surveillance continue
- **Gestion des configurations** : Maintenance automatisée
- **Détection d'anomalies** : Alertes intelligentes
- **Mise à jour des référentiels** : Synchronisation des données

## 🔒 Sécurité

- Variables d'environnement sécurisées
- Authentification Google OAuth2
- Secrets GitHub pour les credentials
- Exclusion des données sensibles (.gitignore)

## 📈 Déploiement

Le système se déploie automatiquement via GitHub Actions :
- **Tests automatiques** : Validation du code
- **Linting** : Contrôle qualité
- **Déploiement GCP** : Mise en production
- **Synchronisation** : Mise à jour des scripts Google Apps

## 🤝 Contribution

1. Fork le projet
2. Créer une branche feature (`git checkout -b feature/AmazingFeature`)
3. Commit les changements (`git commit -m 'Add AmazingFeature'`)
4. Push vers la branche (`git push origin feature/AmazingFeature`)
5. Ouvrir une Pull Request

## 📄 Licence

Ce projet est sous licence MIT. Voir `LICENSE` pour plus de détails.

## 🆘 Support

Pour toute question ou support, ouvrir une issue sur GitHub.