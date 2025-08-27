import os
import json
from google.oauth2 import service_account
from googleapiclient.discovery import build

class GoogleClassroomManager:
    def __init__(self):
        self.creds = self._get_credentials()
        self.service = build("classroom", "v1", credentials=self.creds)

    def _get_credentials(self):
        creds_json = os.getenv("GOOGLE_CREDENTIALS")
        if not creds_json:
            raise ValueError("GOOGLE_CREDENTIALS environment variable not set.")
        
        creds_info = json.loads(creds_json)
        creds = service_account.Credentials.from_service_account_info(
            creds_info,
            scopes=[
                "https://www.googleapis.com/auth/classroom.courses.readonly",
                "https://www.googleapis.com/auth/classroom.announcements",
                "https://www.googleapis.com/auth/classroom.coursework.students",
                "https://www.googleapis.com/auth/classroom.rosters"
            ]
         )
        return creds

    def list_courses(self):
        """
        Liste les cours Google Classroom.
        Returns:
            list: Une liste de dictionnaires représentant les cours.
        """
        try:
            results = self.service.courses().list().execute()
            courses = results.get("courses", [])
            return {"status": "success", "courses": courses}
        except Exception as e:
            return {"status": "error", "message": f"Erreur lors de la liste des cours: {e}"}

    def create_announcement(self, course_id, text):
        """
        Crée une annonce dans un cours Google Classroom.
        Args:
            course_id (str): L'ID du cours.
            text (str): Le texte de l'annonce.
        Returns:
            dict: Les métadonnées de l'annonce créée.
        """
        try:
            announcement = {
                "text": text,
                "state": "PUBLISHED"
            }
            result = self.service.courses().announcements().create(
                courseId=course_id, body=announcement).execute()
            return {"status": "success", "announcement": result}
        except Exception as e:
            return {"status": "error", "message": f"Erreur lors de la création de l'annonce: {e}"}

    def create_coursework(self, course_id, title, description, materials=None):
        """
        Crée un devoir dans un cours Google Classroom.
        Args:
            course_id (str): L'ID du cours.
            title (str): Le titre du devoir.
            description (str): La description du devoir.
            materials (list): Liste d'objets material (ex: {'link': {'url': '...'}}).
        Returns:
            dict: Les métadonnées du devoir créé.
        """
        try:
            coursework = {
                "title": title,
                "description": description,
                "workType": "ASSIGNMENT",
                "state": "PUBLISHED",
                "materials": materials if materials else []
            }
            result = self.service.courses().courseWork().create(
                courseId=course_id, body=coursework).execute()
            return {"status": "success", "coursework": result}
        except Exception as e:
            return {"status": "error", "message": f"Erreur lors de la création du devoir: {e}"}

if __name__ == "__main__":
    # Exemple d'utilisation (pour les tests locaux)
    # Assurez-vous que GOOGLE_CREDENTIALS est défini dans votre environnement ou .env
    # et que vous avez activé Google Classroom API dans votre projet GCP.

    classroom_manager = GoogleClassroomManager()

    # 1. Lister les cours (nécessite des cours existants)
    print("\n--- Liste des cours ---")
    courses_result = classroom_manager.list_courses()
    print(courses_result)

    # Remplacez par un ID de cours valide pour les tests suivants
    test_course_id = "YOUR_COURSE_ID_HERE"

    if test_course_id != "YOUR_COURSE_ID_HERE":
        # 2. Créer une annonce
        print("\n--- Création d'une annonce ---")
        announcement_result = classroom_manager.create_announcement(
            test_course_id, "Bonjour la classe ! Nouvelle annonce de l'IA."
        )
        print(announcement_result)

        # 3. Créer un devoir
        print("\n--- Création d'un devoir ---")
        coursework_result = classroom_manager.create_coursework(
            test_course_id,
            "Devoir généré par l'IA",
            "Veuillez compléter les exercices joints.",
            materials=[{"link": {"url": "https://docs.google.com/document/d/YOUR_DOC_ID/edit"}}]
         )
        print(coursework_result)
    else:
        print("Veuillez remplacer YOUR_COURSE_ID_HERE par un ID de cours valide pour tester la création d'annonces et de devoirs.")
