import os
import json
import base64
from email.mime.text import MIMEText
from google.oauth2 import service_account
from googleapiclient.discovery import build

class GmailManager:
    def __init__(self):
        self.creds = self._get_credentials()
        self.service = build("gmail", "v1", credentials=self.creds)

    def _get_credentials(self):
        creds_json = os.getenv("GOOGLE_CREDENTIALS")
        if not creds_json:
            raise ValueError("GOOGLE_CREDENTIALS environment variable not set.")
        
        creds_info = json.loads(creds_json)
        creds = service_account.Credentials.from_service_account_info(
            creds_info,
            scopes=["https://www.googleapis.com/auth/gmail.send"]
         )
        return creds

    def send_email(self, to, subject, message_text):
        """
        Envoie un email via Gmail.
        Args:
            to (str): L'adresse email du destinataire.
            subject (str): Le sujet de l'email.
            message_text (str): Le corps du message.
        Returns:
            dict: Le résultat de l'opération d'envoi.
        """
        try:
            message = MIMEText(message_text)
            message["to"] = to
            message["subject"] = subject
            raw_message = base64.urlsafe_b64encode(message.as_bytes()).decode()
            
            send_message = (
                self.service.users()
                .messages()
                .send(userId="me", body={"raw": raw_message})
                .execute()
            )
            return {"status": "success", "message_id": send_message["id"]}
        except Exception as e:
            return {"status": "error", "message": f"Erreur lors de l'envoi de l'email: {e}"}

if __name__ == "__main__":
    # Exemple d'utilisation (pour les tests locaux)
    # Assurez-vous que GOOGLE_CREDENTIALS est défini dans votre environnement ou .env
    # et que vous avez activé Gmail API dans votre projet GCP.

    gmail_manager = GmailManager()

    # Remplacez par une adresse email valide pour les tests
    TEST_EMAIL_TO = "votre_email@example.com"

    if TEST_EMAIL_TO == "votre_email@example.com":
        print("Veuillez remplacer votre_email@example.com par une adresse email valide pour tester l'envoi.")
    else:
        print("\n--- Envoi d'email de test ---")
        send_result = gmail_manager.send_email(
            TEST_EMAIL_TO,
            "Test d'email depuis l'IA MFR",
            "Ceci est un email de test envoyé automatiquement par l'agent IA de MFR."
        )
        print(send_result)
