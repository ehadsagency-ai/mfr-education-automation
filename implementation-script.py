#!/usr/bin/env python3
"""
Script de création de l'écosystème MFR Education Automation
"""

import os

def create_directory_structure():
    """Crée l'arborescence des dossiers"""
    directories = [
        ".github/workflows",
        "google-apps-scripts",
        "langchain-agents/agents",
        "langchain-agents/tools", 
        "langchain-agents/workflows",
        "templates",
        "data-schemas",
        "docs",
        "tests",
        "deployment",
        ".devcontainer",
        "config",
        "scripts"
    ]
    
    for directory in directories:
        os.makedirs(directory, exist_ok=True)
        print(f"✅ Dossier créé: {directory}")

def create_github_actions():
    """Crée les workflows GitHub Actions"""
    workflows = {
        ".github/workflows/main.yml": """name: MFR Education Automation

on:
  push:
    branches: [main, develop]
  schedule:
    - cron: '0 6 * * 1'

jobs:
  test-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.11'
      - name: Install dependencies
        run: pip install -r requirements.txt
      - name: Run tests
        run: pytest tests/
"""
    }
    
    for file_path, content in workflows.items():
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"✅ Workflow créé: {file_path}")

def main():
    """Fonction principale"""
    print("🚀 Création de l'écosystème MFR Education Automation...")
    create_directory_structure()
    create_github_actions()
    print("🎉 Création terminée avec succès!")

if __name__ == "__main__":
    main()

