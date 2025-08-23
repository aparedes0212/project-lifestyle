# app_workout/apps.py
from django.apps import AppConfig

class AppWorkoutConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "app_workout"

    def ready(self):
        from . import signals  # noqa