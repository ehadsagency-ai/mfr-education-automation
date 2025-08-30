import os
import yaml
from openai import OpenAI

class AcademicComplianceAgent:
    def __init__(self, referentiels_path="data-schemas/referentiels.yaml"):
        self.client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        self.referentiels = self._load_referentiels(referentiels_path)

    def _load_referentiels(self, path):
        with open(path, "r", encoding="utf-8") as file:
            return yaml.safe_load(file)

    def check_compliance(self, content_to_check, competence_id):
        """
        Vérifie la conformité d'un contenu pédagogique par rapport à une compétence donnée.
        Args:
            content_to_check (str): Le contenu pédagogique à vérifier (par exemple, un extrait de cours, un exercice).
            competence_id (str): L'ID de la compétence du référentiel (ex: "D1.3").
        Returns:
            dict: Un dictionnaire contenant le statut de conformité et des suggestions.
        """
        competence = next((c for r in self.referentiels["referentiels"] for c in r["competences"] if c["id"] == competence_id), None)
        if not competence:
            return {"status": "error", "message": f"Compétence {competence_id} non trouvée dans les référentiels."}

        prompt = f"""
        En tant qu'expert en conformité académique, analysez le contenu pédagogique suivant et déterminez s'il est conforme aux indicateurs de la compétence '{competence["name"]}' ({competence["description"]}).
        Indicateurs de la compétence:
        {'- '.join(competence['indicateurs'])}

        Contenu pédagogique à vérifier:
        {content_to_check}

        Fournissez une évaluation claire (Conforme, Partiellement Conforme, Non Conforme) et des suggestions spécifiques pour améliorer la conformité si nécessaire.
        """

        try:
            chat_completion = self.client.chat.completions.create(
                messages=[
                    {
                        "role": "system",
                        "content": "Vous êtes un assistant expert en conformité académique.",
                    },
                    {
                        "role": "user",
                        "content": prompt,
                    }
                ],
                model="gpt-4", # Utilisation d'un modèle plus avancé pour la conformité
            )
            response = chat_completion.choices[0].message.content
            return {"status": "success", "evaluation": response}
        except Exception as e:
            return {"status": "error", "message": f"Erreur lors de la vérification de conformité : {e}"}

    def generate_remediation_plan(self, student_data, competence_id, identified_gaps):
        """
        Génère un plan de remédiation personnalisé pour un élève.
        Args:
            student_data (dict): Données de l'élève (nom, niveau, etc.).
            competence_id (str): L'ID de la compétence concernée.
            identified_gaps (str): Description des lacunes identifiées.
        Returns:
            dict: Un dictionnaire contenant le plan de remédiation.
        """
        competence = next((c for r in self.referentiels["referentiels"] for c in r["competences"] if c["id"] == competence_id), None)
        if not competence:
            return {"status": "error", "message": f"Compétence {competence_id} non trouvée."}

        prompt = f"""
        Générez un plan de remédiation personnalisé pour l'élève {student_data.get('name', 'cet élève')}, qui a des lacunes identifiées suivantes pour la compétence '{competence["name"]}' ({competence["description"]}) :
        Lacunes: {identified_gaps}

        Le plan doit inclure des exercices spécifiques, des ressources et des étapes claires pour améliorer la maîtrise de cette compétence.
        """
        try:
            chat_completion = self.client.chat.completions.create(
                messages=[
                    {
                        "role": "system",
                        "content": "Vous êtes un tuteur IA expert en pédagogie.",
                    },
                    {
                        "role": "user",
                        "content": prompt,
                    }
                ],
                model="gpt-4",
            )
            response = chat_completion.choices[0].message.content
            return {"status": "success", "plan": response}
        except Exception as e:
            return {"status": "error", "message": f"Erreur lors de la génération du plan de remédiation : {e}"}

    def generate_enrichment_plan(self, student_data, competence_id):
        """
        Génère un plan d'approfondissement pour un élève ayant maîtrisé une compétence.
        Args:
            student_data (dict): Données de l'élève.
            competence_id (str): L'ID de la compétence concernée.
        Returns:
            dict: Un dictionnaire contenant le plan d'approfondissement.
        """
        competence = next((c for r in self.referentiels["referentiels"] for c in r["competences"] if c["id"] == competence_id), None)
        if not competence:
            return {"status": "error", "message": f"Compétence {competence_id} non trouvée."}

        prompt = f"""
        Générez un plan d'approfondissement pour l'élève {student_data.get('name', 'cet élève')}, qui a démontré une excellente maîtrise de la compétence '{competence["name"]}' ({competence["description"]}).
        Le plan doit inclure des projets avancés, des lectures complémentaires ou des défis créatifs pour stimuler son intérêt et étendre ses connaissances.
        """
        try:
            chat_completion = self.client.chat.completions.create(
                messages=[
                    {
                        "role": "system",
                        "content": "Vous êtes un tuteur IA expert en pédagogie et en développement de talents.",
                    },
                    {
                        "role": "user",
                        "content": prompt,
                    }
                ],
                model="gpt-4",
            )
            response = chat_completion.choices[0].message.content
            return {"status": "success", "plan": response}
        except Exception as e:
            return {"status": "error", "message": f"Erreur lors de la génération du plan d'approfondissement : {e}"}

if __name__ == "__main__":
    # Exemple d'utilisation (pour les tests locaux)
    # Assurez-vous que OPENAI_API_KEY est défini dans votre environnement ou .env
    # et que data-schemas/referentiels.yaml existe.

    # Test de vérification de conformité
    agent = AcademicComplianceAgent()
    content = "Le théorème de Pythagore permet de calculer la longueur des côtés d'un triangle rectangle."
    result = agent.check_compliance(content, "D1.3")
    print("\n--- Vérification de Conformité ---")
    print(result)

    # Test de génération de plan de remédiation
    student = {"name": "Alice", "level": "débutant"}
    gaps = "Difficulté à appliquer le théorème de Pythagore dans des problèmes concrets."
    remediation_plan = agent.generate_remediation_plan(student, "D1.3", gaps)
    print("\n--- Plan de Remédiation ---")
    print(remediation_plan)

    # Test de génération de plan d'approfondissement
    enrichment_plan = agent.generate_enrichment_plan(student, "D1.3")
    print("\n--- Plan d'Approfondissement ---")
    print(enrichment_plan)
