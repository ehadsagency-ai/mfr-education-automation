import os
import yaml
from openai import OpenAI

class CollectiveValidationAgent:
    def __init__(self, teachers_path="config/teachers.yaml"):
        self.client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        self.teachers_config = self._load_config(teachers_path)

    def _load_config(self, path):
        with open(path, "r", encoding="utf-8") as file:
            return yaml.safe_load(file)

    def check_collective_mastery(self, student_progress_data, competence_id, threshold=0.9):
        """
        Vérifie si une compétence a atteint le seuil de maîtrise collective.
        Args:
            student_progress_data (list): Une liste de dictionnaires représentant la progression de chaque élève.
            competence_id (str): L'ID de la compétence à vérifier.
            threshold (float): Le seuil de maîtrise (par défaut 90%).
        Returns:
            bool: True si le seuil est atteint, False sinon.
        """
        mastery_count = sum(1 for student in student_progress_data if student.get(competence_id) == "maîtrisé")
        mastery_ratio = mastery_count / len(student_progress_data) if student_progress_data else 0
        return mastery_ratio >= threshold

    def generate_collective_assessment(self, competence_id, student_level="moyen"):
        """
        Génère un devoir de validation collective adapté au niveau de la classe.
        Args:
            competence_id (str): L'ID de la compétence à évaluer.
            student_level (str): Le niveau général de la classe pour cette compétence.
        Returns:
            dict: Un dictionnaire contenant le devoir de validation.
        """
        prompt = f"""
        En tant qu'ingénieur pédagogique, créez un devoir de validation collective pour la compétence avec l'ID '{competence_id}'.
        Le niveau général de la classe est '{student_level}'.
        Le devoir doit être concis, pertinent et permettre de valider rapidement la maîtrise de la compétence par l'ensemble de la classe.
        Il peut prendre la forme d'un QCM, d'un problème court ou d'une étude de cas simple.
        """
        try:
            chat_completion = self.client.chat.completions.create(
                messages=[
                    {
                        "role": "system",
                        "content": "Vous êtes un ingénieur pédagogique spécialisé dans la création d'évaluations collectives.",
                    },
                    {
                        "role": "user",
                        "content": prompt,
                    }
                ],
                model="gpt-4",
            )
            response = chat_completion.choices[0].message.content
            return {"status": "success", "assessment": response}
        except Exception as e:
            return {"status": "error", "message": f"Erreur lors de la génération de l'évaluation collective : {e}"}

if __name__ == "__main__":
    # Exemple d'utilisation (pour les tests locaux)
    agent = CollectiveValidationAgent()

    # Données de progression des élèves (simulées)
    progress_data = [
        {"D1.3": "maîtrisé"}, {"D1.3": "maîtrisé"}, {"D1.3": "en cours"}, {"D1.3": "maîtrisé"},
        {"D1.3": "maîtrisé"}, {"D1.3": "maîtrisé"}, {"D1.3": "maîtrisé"}, {"D1.3": "maîtrisé"},
        {"D1.3": "maîtrisé"}, {"D1.3": "maîtrisé"} # 9 sur 10 ont maîtrisé
    ]

    # Test de vérification de la maîtrise collective
    is_mastered = agent.check_collective_mastery(progress_data, "D1.3")
    print("\n--- Vérification de la Maîtrise Collective ---")
    print(f"La compétence D1.3 a-t-elle atteint le seuil de maîtrise ? {'Oui' if is_mastered else 'Non'}")

    # Test de génération d'une évaluation collective
    if is_mastered:
        assessment = agent.generate_collective_assessment("D1.3")
        print("\n--- Évaluation Collective Générée ---")
        print(assessment)

