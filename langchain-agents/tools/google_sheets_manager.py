import os
import json
from google.oauth2 import service_account
from googleapiclient.discovery import build

class GoogleSheetsManager:
    def __init__(self):
        self.creds = self._get_credentials()
        self.service = build('sheets', 'v4', credentials=self.creds)

    def _get_credentials(self):
        # Récupère les credentials depuis le secret GitHub GOOGLE_CREDENTIALS
        creds_json = os.getenv("GOOGLE_CREDENTIALS")
        if not creds_json:
            raise ValueError("GOOGLE_CREDENTIALS environment variable not set.")
        
        creds_info = json.loads(creds_json)
        creds = service_account.Credentials.from_service_account_info(
            creds_info,
            scopes=['https://www.googleapis.com/auth/spreadsheets']
         )
        return creds

    def read_sheet_data(self, spreadsheet_id, range_name):
        """
        Lit les données d'une feuille Google Sheets.
        Args:
            spreadsheet_id (str): L'ID de la feuille de calcul.
            range_name (str): La plage de cellules à lire (ex: 'Feuille1!A1:B10').
        Returns:
            list: Une liste de listes représentant les données lues.
        """
        try:
            result = self.service.spreadsheets().values().get(
                spreadsheetId=spreadsheet_id, range=range_name).execute()
            rows = result.get('values', [])
            return rows
        except Exception as e:
            return f"Erreur lors de la lecture de la feuille: {e}"

    def write_sheet_data(self, spreadsheet_id, range_name, values):
        """
        Écrit des données dans une feuille Google Sheets.
        Args:
            spreadsheet_id (str): L'ID de la feuille de calcul.
            range_name (str): La plage de cellules où écrire (ex: 'Feuille1!A1').
            values (list): Une liste de listes représentant les données à écrire.
        Returns:
            dict: Le résultat de l'opération d'écriture.
        """
        try:
            body = {
                'values': values
            }
            result = self.service.spreadsheets().values().update(
                spreadsheetId=spreadsheet_id, range=range_name,
                valueInputOption='RAW', body=body).execute()
            return result
        except Exception as e:
            return f"Erreur lors de l'écriture dans la feuille: {e}"

if __name__ == "__main__":
    # Exemple d'utilisation (pour les tests locaux)
    # Assurez-vous que GOOGLE_CREDENTIALS est défini dans votre environnement ou .env
    # et que vous avez un spreadsheet_id valide.
    
    # Remplacez par l'ID de votre feuille de calcul de test
    TEST_SPREADSHEET_ID = "YOUR_SPREADSHEET_ID_HERE"

    if TEST_SPREADSHEET_ID == "YOUR_SPREADSHEET_ID_HERE":
        print("Veuillez remplacer YOUR_SPREADSHEET_ID_HERE par l'ID de votre feuille de calcul de test.")
    else:
        sheets_manager = GoogleSheetsManager()

        # Test de lecture
        print("\n--- Lecture de données ---")
        read_result = sheets_manager.read_sheet_data(TEST_SPREADSHEET_ID, 'Feuille1!A1:B2')
        print(read_result)

        # Test d'écriture
        print("\n--- Écriture de données ---")
        write_values = [['Nom', 'Valeur'], ['Test', '123']]
        write_result = sheets_manager.write_sheet_data(TEST_SPREADSHEET_ID, 'Feuille1!A1', write_values)
        print(write_result)

        # Relire pour vérifier l'écriture
        print("\n--- Re-lecture après écriture ---")
        read_after_write_result = sheets_manager.read_sheet_data(TEST_SPREADSHEET_ID, 'Feuille1!A1:B2')
        print(read_after_write_result)
