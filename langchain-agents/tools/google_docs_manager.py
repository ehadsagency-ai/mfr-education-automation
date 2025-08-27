import os
import json
from google.oauth2 import service_account
from googleapiclient.discovery import build

class GoogleDocsManager:
    def __init__(self):
        self.creds = self._get_credentials()
        self.docs_service = build('docs', 'v1', credentials=self.creds)
        self.drive_service = build('drive', 'v3', credentials=self.creds) # Nécessaire pour créer des copies

    def _get_credentials(self):
        creds_json = os.getenv("GOOGLE_CREDENTIALS")
        if not creds_json:
            raise ValueError("GOOGLE_CREDENTIALS environment variable not set.")
        
        creds_info = json.loads(creds_json)
        creds = service_account.Credentials.from_service_account_info(
            creds_info,
            scopes=[
                'https://www.googleapis.com/auth/documents',
                'https://www.googleapis.com/auth/drive'
            ]
         )
        return creds

    def create_document(self, title):
        """
        Crée un nouveau document Google Docs.
        Args:
            title (str): Le titre du nouveau document.
        Returns:
            dict: Les métadonnées du document créé.
        """
        try:
            document = {'title': title}
            doc = self.docs_service.documents().create(body=document).execute()
            return {"status": "success", "document_id": doc.get('documentId'), "document_url": doc.get('webViewLink')}
        except Exception as e:
            return {"status": "error", "message": f"Erreur lors de la création du document: {e}"}

    def copy_document(self, source_document_id, new_title):
        """
        Crée une copie d'un document Google Docs existant.
        Args:
            source_document_id (str): L'ID du document source.
            new_title (str): Le titre du nouveau document copié.
        Returns:
            dict: Les métadonnées du document copié.
        """
        try:
            copy_body = {'name': new_title}
            copied_doc = self.drive_service.files().copy(
                fileId=source_document_id, body=copy_body).execute()
            return {"status": "success", "document_id": copied_doc.get('id'), "document_url": copied_doc.get('webViewLink')}
        except Exception as e:
            return {"status": "error", "message": f"Erreur lors de la copie du document: {e}"}

    def insert_text(self, document_id, text, index=1):
        """
        Insère du texte dans un document Google Docs à un index donné.
        Args:
            document_id (str): L'ID du document.
            text (str): Le texte à insérer.
            index (int): L'index où insérer le texte (par défaut 1 pour le début du corps).
        Returns:
            dict: Le résultat de l'opération.
        """
        try:
            requests = [
                {
                    'insertText': {
                        'location': {
                            'index': index,
                        },
                        'text': text
                    }
                }
            ]
            result = self.docs_service.documents().batchUpdate(
                documentId=document_id, body={'requests': requests}).execute()
            return {"status": "success", "result": result}
        except Exception as e:
            return {"status": "error", "message": f"Erreur lors de l'insertion de texte: {e}"}

    def replace_text(self, document_id, old_text, new_text):
        """
        Remplace toutes les occurrences d'un texte par un autre dans un document.
        Args:
            document_id (str): L'ID du document.
            old_text (str): Le texte à remplacer.
            new_text (str): Le nouveau texte.
        Returns:
            dict: Le résultat de l'opération.
        """
        try:
            requests = [
                {
                    'replaceAllText': {
                        'replaceText': new_text,
                        'containsText': {
                            'text': old_text,
                            'matchCase': 'false'
                        }
                    }
                }
            ]
            result = self.docs_service.documents().batchUpdate(
                documentId=document_id, body={'requests': requests}).execute()
            return {"status": "success", "result": result}
        except Exception as e:
            return {"status": "error", "message": f"Erreur lors du remplacement de texte: {e}"}

if __name__ == "__main__":
    # Exemple d'utilisation (pour les tests locaux)
    # Assurez-vous que GOOGLE_CREDENTIALS est défini dans votre environnement ou .env
    # et que vous avez activé Google Docs API et Google Drive API dans votre projet GCP.

    docs_manager = GoogleDocsManager()

    # 1. Créer un nouveau document
    print("\n--- Création d'un nouveau document ---")
    create_result = docs_manager.create_document("Mon Nouveau Document IA")
    print(create_result)
    new_doc_id = create_result.get("document_id")

    if new_doc_id:
        # 2. Insérer du texte
        print("\n--- Insertion de texte ---")
        insert_result = docs_manager.insert_text(new_doc_id, "Ceci est le contenu généré par l'IA.\n")
        print(insert_result)

        # 3. Remplacer du texte
        print("\n--- Remplacement de texte ---")
        replace_result = docs_manager.replace_text(new_doc_id, "contenu généré par l'IA", "texte mis à jour par l'agent")
        print(replace_result)

        # 4. Copier le document (nécessite un document source existant)
        # Remplacez 'YOUR_SOURCE_DOCUMENT_ID' par un ID de document réel si vous voulez tester
        # source_doc_id = 'YOUR_SOURCE_DOCUMENT_ID'
        # if source_doc_id != 'YOUR_SOURCE_DOCUMENT_ID':
        #     print("\n--- Copie du document ---")
        #     copy_result = docs_manager.copy_document(source_doc_id, "Copie de Mon Document IA")
        #     print(copy_result)
    else:
        print("Impossible de procéder aux tests d'insertion/remplacement/copie sans ID de document.")
