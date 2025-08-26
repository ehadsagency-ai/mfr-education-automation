import os
import google.generativeai as genai

class GeminiComplianceAgent:
    def __init__(self):
        # Configurez votre clé API Gemini
        genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
        self.model = genai.GenerativeModel("gemini-pro")

    def verify_system_compliance(self, system_status_report):
        """
        Vérifie la conformité globale du système en analysant un rapport de statut.
        Args:
            system_status_report (str): Un rapport détaillé sur l'état actuel du système (logs, métriques, etc.).
        Returns:
            dict: Un dictionnaire contenant l'évaluation de conformité et les recommandations.
        """
        prompt = f"""
        En tant qu'expert en conformité des systèmes IA, analysez le rapport de statut du système suivant :
        {system_status_report}

        Identifiez les éventuels problèmes de conformité, les incohérences ou les risques potentiels.
        Fournissez une évaluation globale de la conformité du système et des recommandations spécifiques pour améliorer sa robustesse et sa fiabilité.
        """
        try:
            response = self.model.generate_content(prompt)
            return {"status": "success", "evaluation": response.text}
        except Exception as e:
            return {"status": "error", "message": f"Erreur lors de la vérification de conformité du système : {e}"}

    def orchestrate_workflow(self, workflow_description, current_state):
        """
        Orchestre un workflow complexe en fonction de sa description et de l'état actuel.
        Args:
            workflow_description (str): Description détaillée du workflow à orchestrer.
            current_state (str): L'état actuel du workflow.
        Returns:
            dict: Un dictionnaire contenant les prochaines étapes suggérées.
        """
        prompt = f"""
        En tant qu'orchestrateur de workflow IA, analysez la description du workflow suivante :
        {workflow_description}

        L'état actuel du workflow est :
        {current_state}

        Déterminez la prochaine étape logique à exécuter, en tenant compte des dépendances et des conditions.
        """
        try:
            response = self.model.generate_content(prompt)
            return {"status": "success", "next_steps": response.text}
        except Exception as e:
            return {"status": "error", "message": f"Erreur lors de l'orchestration du workflow : {e}"}

if __name__ == "__main__":
    # Exemple d'utilisation (pour les tests locaux)
    # Assurez-vous que GEMINI_API_KEY est défini dans votre environnement ou .env
    agent = GeminiComplianceAgent()

    # Test de vérification de conformité du système
    system_report = "Les logs montrent des erreurs de connexion à l'API OpenAI sporadiques. La base de données des élèves est à jour."
    compliance_result = agent.verify_system_compliance(system_report)
    print("\n--- Vérification de Conformité du Système ---")
    print(compliance_result)

    # Test d'orchestration de workflow
    workflow_desc = "Workflow de préparation hebdomadaire: 1. Lecture planning, 2. Analyse profils élèves, 3. Génération contenu."
    current_state_desc = "Étape 1 (Lecture planning) terminée avec succès."
    orchestration_result = agent.orchestrate_workflow(workflow_desc, current_state_desc)
    print("\n--- Orchestration de Workflow ---")
    print(orchestration_result)
