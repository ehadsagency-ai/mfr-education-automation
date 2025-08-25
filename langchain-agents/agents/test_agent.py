import os
from openai import OpenAI

class TestAgent:
    def __init__(self):
        # Récupérer la clé API depuis les variables d'environnement
        self.client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

    def test_connection(self):
        try:
            chat_completion = self.client.chat.completions.create(
                messages=[
                    {
                        "role": "user",
                        "content": "Dis bonjour en français.",
                    }
                ],
                model="gpt-3.5-turbo",
            )
            return chat_completion.choices[0].message.content
        except Exception as e:
            return f"Erreur de connexion à OpenAI : {e}"

if __name__ == "__main__":
    # Pour tester localement, assurez-vous que OPENAI_API_KEY est défini dans votre .env
    # ou directement dans votre environnement.
    agent = TestAgent()
    response = agent.test_connection()
    print(response)
