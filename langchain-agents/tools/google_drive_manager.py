import os
import json
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

class GoogleDriveManager:
    def __init__(self ):
        self.creds = self._get_credentials()
        self.service = build("drive", "v3", credentials=self.creds)

    def _get_credentials(self):
        creds_json = os.getenv("GOOGLE_CREDENTIALS")
        if not creds_json:
            raise ValueError("GOOGLE_CREDENTIALS environment variable not set.")
        
        creds_info = json.loads(creds_json)
        creds = service_account.Credentials.from_service_account_info(
            creds_info,
            scopes=["https://www.googleapis.com/auth/drive"]
         )
        return creds

    def upload_file(self, file_path, file_name, mime_type, folder_id=None):
        """
        Uploade un fichier sur Google Drive.
        Args:
            file_path (str): Chemin local du fichier à uploader.
            file_name (str): Nom du fichier sur Google Drive.
            mime_type (str): Type MIME du fichier (ex: 'application/pdf', 'image/jpeg').
            folder_id (str, optional): ID du dossier parent sur Drive. Si None, le fichier est uploadé à la racine.
        Returns:
            dict: Les métadonnées du fichier uploadé.
        """
        try:
            file_metadata = {"name": file_name}
            if folder_id:
                file_metadata["parents"] = [folder_id]

            media = MediaFileUpload(file_path, mimetype=mime_type, resumable=True)
            file = self.service.files().create(
                body=file_metadata, media_body=media, fields="id, webViewLink"
            ).execute()
            return {"status": "success", "file_id": file.get("id"), "web_view_link": file.get("webViewLink")}
        except Exception as e:
            return {"status": "error", "message": f"Erreur lors de l'upload du fichier: {e}"}

    def create_folder(self, folder_name, parent_folder_id=None):
        """
        Crée un nouveau dossier sur Google Drive.
        Args:
            folder_name (str): Nom du dossier à créer.
            parent_folder_id (str, optional): ID du dossier parent. Si None, le dossier est créé à la racine.
        Returns:
            dict: Les métadonnées du dossier créé.
        """
        try:
            file_metadata = {
                "name": folder_name,
                "mimeType": "application/vnd.google-apps.folder",
            }
            if parent_folder_id:
                file_metadata["parents"] = [parent_folder_id]

            folder = self.service.files().create(body=file_metadata, fields="id").execute()
            return {"status": "success", "folder_id": folder.get("id")}
        except Exception as e:
            return {"status": "error", "message": f"Erreur lors de la création du dossier: {e}"}

    def search_files(self, query):
        """
        Recherche des fichiers sur Google Drive.
        Args:
            query (str): La requête de recherche (ex: "name = 'mon_fichier.pdf'").
        Returns:
            list: Une liste de dictionnaires représentant les fichiers trouvés.
        """
        try:
            results = self.service.files().list(
                q=query, fields="nextPageToken, files(id, name, mimeType, webViewLink)"
            ).execute()
            items = results.get("files", [])
            return {"status": "success", "files": items}
        except Exception as e:
            return {"status": "error", "message": f"Erreur lors de la recherche de fichiers: {e}"}

if __name__ == "__main__":
    # Exemple d'utilisation (pour les tests locaux)
    # Assurez-vous que GOOGLE_CREDENTIALS est défini dans votre environnement ou .env
    # et que vous avez activé Google Drive API dans votre projet GCP.

    drive_manager = GoogleDriveManager()

    # 1. Créer un dossier de test
    print("\n--- Création d'un dossier de test ---")
    folder_result = drive_manager.create_folder("MFR_Test_Folder")
    print(folder_result)
    test_folder_id = folder_result.get("folder_id")

    if test_folder_id:
        # 2. Créer un fichier local pour l'upload
        test_file_path = "test_upload.txt"
        with open(test_file_path, "w") as f:
            f.write("Ceci est un fichier de test pour Google Drive.")

        # 3. Uploader un fichier
        print("\n--- Upload d'un fichier ---")
        upload_result = drive_manager.upload_file(
            test_file_path, "MonFichierTest.txt", "text/plain", folder_id=test_folder_id
        )
        print(upload_result)

        # 4. Rechercher le fichier uploadé
        print("\n--- Recherche du fichier ---")
        search_result = drive_manager.search_files(f"name = 'MonFichierTest.txt' and '{test_folder_id}' in parents")
        print(search_result)

        # Nettoyage (supprimer le fichier local)
        os.remove(test_file_path)
    else:
        print("Impossible de procéder aux tests d'upload/recherche sans ID de dossier.")
