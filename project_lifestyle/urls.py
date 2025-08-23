# project_lifestyle/urls.py (or your root urls.py)
from django.urls import path, include

urlpatterns = [
    # ...
    path("api/", include("app_workout.urls")),
]
