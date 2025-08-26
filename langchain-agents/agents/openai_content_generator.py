import os
from openai import OpenAI

class OpenAIContentGenerator:
    def __init__(self):
        self.client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

    def generate_worksheet(self, subject, topic, student_level="moyen", num_questions=5):
        """
        Génère une feuille d'exercices pour un sujet donné.
        Args:
            subject (str): La matière (ex: "Mathématiques").
            topic (str): Le sujet spécifique (ex: "Théorème de Pythagore").
            student_level (str): Le niveau de l'élève (ex: "débutant", "moyen", "avancé").
            num_questions (int): Le nombre de questions à générer.
        Returns:
            dict: Un dictionnaire contenant la feuille d'exercices.
        """
        prompt = f"""
        Créez une feuille d'exercices de {num_questions} questions sur le sujet suivant : {topic} en {subject}.
        Le niveau de difficulté doit être adapté à un élève de niveau {student_level}.
        Incluez les solutions à la fin de la feuille.
        """
        try:
            chat_completion = self.client.chat.completions.create(
                messages=[
                    {
                        "role": "system",
                        "content": "Vous êtes un générateur de contenu pédagogique expert.",
                    },
                    {
                        "role": "user",
                        "content": prompt,
                    }
                ],
                model="gpt-4",
            )
            response = chat_completion.choices[0].message.content
            return {"status": "success", "worksheet": response}
        except Exception as e:
            return {"status": "error", "message": f"Erreur lors de la génération de la feuille d'exercices : {e}"}

    def generate_quiz(self, subject, topic, num_questions=3, quiz_type="QCM"):
        """
        Génère un quiz sur un sujet donné.
        Args:
            subject (str): La matière.
            topic (str): Le sujet spécifique.
            num_questions (int): Le nombre de questions.
            quiz_type (str): Le type de quiz (ex: "QCM", "Vrai/Faux").
        Returns:
            dict: Un dictionnaire contenant le quiz.
        """
        prompt = f"""
        Créez un {quiz_type} de {num_questions} questions sur le sujet suivant : {topic} en {subject}.
        Incluez les bonnes réponses.
        """
        try:
            chat_completion = self.client.chat.completions.create(
                messages=[
                    {
                        "role": "system",
                        "content": "Vous êtes un créateur de quiz pédagogiques.",
                    },
                    {
                        "role": "user",
                        "content": prompt,
                    }
                ],
                model="gpt-4",
            )
            response = chat_completion.choices[0].message.content
            return {"status": "success", "quiz": response}
        except Exception as e:
            return {"status": "error", "message": f"Erreur lors de la génération du quiz : {e}"}

    def generate_lesson_summary(self, subject, topic, length="court"):
        """
        Génère un résumé de leçon.
        Args:
            subject (str): La matière.
            topic (str): Le sujet spécifique.
            length (str): La longueur du résumé (ex: "court", "détaillé").
        Returns:
            dict: Un dictionnaire contenant le résumé.
        """
        prompt = f"""
        Générez un résumé {length} de la leçon sur le sujet suivant : {topic} en {subject}.
        """
        try:
            chat_completion = self.client.chat.completions.create(
                messages=[
                    {
                        "role": "system",
                        "content": "Vous êtes un rédacteur de résumés pédagogiques.",
                    },
                    {
                        "role": "user",
                        "content": prompt,
                    }
                ],
                model="gpt-4",
            )
            response = chat_completion.choices[0].message.content
            return {"status": "success", "summary": response}
        except Exception as e:
            return {"status": "error", "message": f"Erreur lors de la génération du résumé : {e}"}

if __name__ == "__main__":
    # Exemple d'utilisation (pour les tests locaux)
    agent = OpenAIContentGenerator()

    # Test de génération de feuille d'exercices
    worksheet_result = agent.generate_worksheet("Mathématiques", "Les fractions", "moyen")
    print("\n--- Feuille d'exercices ---")
    print(worksheet_result)

    # Test de génération de quiz
    quiz_result = agent.generate_quiz("Physique", "L'électricité", quiz_type="Vrai/Faux")
    print("\n--- Quiz ---")
    print(quiz_result)

    # Test de génération de résumé de leçon
    summary_result = agent.generate_lesson_summary("Informatique", "Création d'adresse mail", "détaillé")
    print("\n--- Résumé de leçon ---")
    print(summary_result)
