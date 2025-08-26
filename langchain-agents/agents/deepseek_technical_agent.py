import os
from openai import OpenAI # DeepSeek utilise une API compatible OpenAI

class DeepSeekTechnicalAgent:
    def __init__(self):
        # L'API DeepSeek est compatible avec l'API OpenAI, donc nous utilisons le même client
        self.client = OpenAI(
            api_key=os.getenv("DEEPSEEK_API_KEY"),
            base_url="https://api.deepseek.com/v1"
         )

    def optimize_learning_path(self, student_data, curriculum_data):
        """
        Optimise le parcours d'apprentissage d'un élève en fonction de ses données et du curriculum.
        Args:
            student_data (dict): Données de l'élève (progression, points faibles, etc.).
            curriculum_data (dict): Données du curriculum (dépendances entre compétences, etc.).
        Returns:
            dict: Un dictionnaire contenant le parcours optimisé.
        """
        prompt = f"""
        En tant qu'expert en optimisation pédagogique et analyse de données, analysez les données de l'élève suivantes :
        {student_data}

        Et les données du curriculum :
        {curriculum_data}

        Proposez un parcours d'apprentissage optimisé pour cet élève, en identifiant les compétences prioritaires à renforcer ou à approfondir, et en suggérant une séquence logique d'apprentissage.
        """
        try:
            chat_completion = self.client.chat.completions.create(
                messages=[
                    {
                        "role": "system",
                        "content": "Vous êtes un agent d'optimisation de parcours d'apprentissage.",
                    },
                    {
                        "role": "user",
                        "content": prompt,
                    }
                ],
                model="deepseek-coder", # Ou un autre modèle DeepSeek pertinent
            )
            response = chat_completion.choices[0].message.content
            return {"status": "success", "optimized_path": response}
        except Exception as e:
            return {"status": "error", "message": f"Erreur lors de l'optimisation du parcours : {e}"}

    def analyze_data_for_insights(self, data_set, analysis_request):
        """
        Analyse un ensemble de données pour en extraire des insights.
        Args:
            data_set (str): Les données à analyser (par exemple, au format JSON ou CSV).
            analysis_request (str): La question ou le type d'analyse à effectuer.
        Returns:
            dict: Un dictionnaire contenant les insights extraits.
        """
        prompt = f"""
        En tant qu'analyste de données expérimenté, analysez l'ensemble de données suivant :
        {data_set}

        Et répondez à la question/effectuez l'analyse suivante :
        {analysis_request}

        Fournissez des insights clairs, des tendances identifiées et des recommandations basées sur les données.
        """
        try:
            chat_completion = self.client.chat.completions.create(
                messages=[
                    {
                        "role": "system",
                        "content": "Vous êtes un expert en analyse de données.",
                    },
                    {
                        "role": "user",
                        "content": prompt,
                    }
                ],
                model="deepseek-coder",
            )
            response = chat_completion.choices[0].message.content
            return {"status": "success", "insights": response}
        except Exception as e:
            return {"status": "error", "message": f"Erreur lors de l'analyse des données : {e}"}

if __name__ == "__main__":
    # Exemple d'utilisation (pour les tests locaux)
    agent = DeepSeekTechnicalAgent()

    # Test d'optimisation de parcours d'apprentissage
    student_example = {"name": "Bob", "current_score_math": 60, "weak_points": ["fractions", "géométrie"]}
    curriculum_example = {"math": {"fractions": ["addition", "soustraction"], "géométrie": ["théorème de Pythagore"]}}
    optimized_path_result = agent.optimize_learning_path(student_example, curriculum_example)
    print("\n--- Parcours d'apprentissage optimisé ---")
    print(optimized_path_result)

    # Test d'analyse de données
    data_example = "[{"student": "Alice", "score": 85}, {"student": "Bob", "score": 60}, {"student": "Charlie", "score": 92}]"
    analysis_request_example = "Quelle est la moyenne des scores et qui a le score le plus élevé ?"
    insights_result = agent.analyze_data_for_insights(data_example, analysis_request_example)
    print("\n--- Insights de données ---")
    print(insights_result)
