import os

class FileManager:
    def read_file(self, file_path):
        """
        Lit le contenu d'un fichier texte.
        Args:
            file_path (str): Le chemin complet du fichier.
        Returns:
            str: Le contenu du fichier ou un message d'erreur.
        """
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                return f.read()
        except FileNotFoundError:
            return f"Erreur: Le fichier {file_path} n'a pas été trouvé."
        except Exception as e:
            return f"Erreur lors de la lecture du fichier {file_path}: {e}"

    def write_file(self, file_path, content):
        """
        Écrit du contenu dans un fichier texte. Crée le fichier s'il n'existe pas.
        Args:
            file_path (str): Le chemin complet du fichier.
            content (str): Le contenu à écrire.
        Returns:
            str: Message de succès ou d'erreur.
        """
        try:
            # Assurez-vous que le répertoire existe
            os.makedirs(os.path.dirname(file_path), exist_ok=True)
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(content)
            return f"Contenu écrit avec succès dans {file_path}."
        except Exception as e:
            return f"Erreur lors de l'écriture dans le fichier {file_path}: {e}"

    def append_to_file(self, file_path, content):
        """
        Ajoute du contenu à la fin d'un fichier texte. Crée le fichier s'il n'existe pas.
        Args:
            file_path (str): Le chemin complet du fichier.
            content (str): Le contenu à ajouter.
        Returns:
            str: Message de succès ou d'erreur.
        """
        try:
            os.makedirs(os.path.dirname(file_path), exist_ok=True)
            with open(file_path, "a", encoding="utf-8") as f:
                f.write(content)
            return f"Contenu ajouté avec succès à {file_path}."
        except Exception as e:
            return f"Erreur lors de l'ajout au fichier {file_path}: {e}"

if __name__ == "__main__":
    # Exemple d'utilisation (pour les tests locaux)
    file_manager = FileManager()

    # Test d'écriture
    write_result = file_manager.write_file("test_output.txt", "Ceci est un test d'écriture.\n")
    print(write_result)

    # Test d'ajout
    append_result = file_manager.append_to_file("test_output.txt", "Ceci est une ligne ajoutée.\n")
    print(append_result)

    # Test de lecture
    read_result = file_manager.read_file("test_output.txt")
    print("\nContenu du fichier:")
    print(read_result)

    # Test de lecture d'un fichier inexistant
    not_found_result = file_manager.read_file("non_existent_file.txt")
    print("\n" + not_found_result)
