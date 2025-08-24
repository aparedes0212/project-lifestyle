# app_workout/urls.py
from django.urls import path
from .views import (
    NextCardioView,
    RoutinesOrderedView,
    WorkoutsOrderedView,
    PredictWorkoutForRoutineView,
    LogCardioView,
    CardioExerciseListView,
    CardioLogsRecentView,
    CardioLogRetrieveView,
    CardioLogDetailsCreateView,
    CardioLogDetailUpdateView,
    CardioLogDestroyView,
    CardioLogDetailDestroyView,
    CardioUnitListView,
    CardioLogLastIntervalView,
    StrengthLogsRecentView,
    StrengthLogRetrieveView,
    StrengthLogDetailsCreateView,
    StrengthLogDetailUpdateView,
    StrengthLogDestroyView,
    StrengthLogDetailDestroyView,
    LogStrengthView,
    StrengthExerciseListView,
    StrengthLogLastSetView,
)

urlpatterns = [
    path("cardio/next/", NextCardioView.as_view(), name="cardio-next"),
    path("cardio/routines-ordered/", RoutinesOrderedView.as_view(), name="cardio-routines-ordered"),
    path("cardio/workouts-ordered/", WorkoutsOrderedView.as_view(), name="cardio-workouts-ordered"),
    path("cardio/predict-workout/", PredictWorkoutForRoutineView.as_view(), name="cardio-predict-workout"),

    path("cardio/logs/", CardioLogsRecentView.as_view(), name="cardio-logs-recent"),
    path("cardio/log/<int:pk>/", CardioLogRetrieveView.as_view(), name="cardio-log-retrieve"),
    path("cardio/log/<int:pk>/details/", CardioLogDetailsCreateView.as_view(), name="cardio-log-details-create"),
    path("cardio/log/<int:pk>/details/<int:detail_id>/", CardioLogDetailUpdateView.as_view(), name="cardio-log-detail-update"),
    path("cardio/log/<int:pk>/last-interval/", CardioLogLastIntervalView.as_view(), name="cardio-log-last-interval"),

    # NEW deletes
    path("cardio/log/<int:pk>/delete/", CardioLogDestroyView.as_view(), name="cardio-log-delete"),
    path("cardio/log/<int:pk>/details/<int:detail_id>/delete/", CardioLogDetailDestroyView.as_view(), name="cardio-log-detail-delete"),

    path("cardio/log/", LogCardioView.as_view(), name="cardio-log"),
    path("cardio/exercises/", CardioExerciseListView.as_view(), name="cardio-exercises"),

    path("cardio/units/", CardioUnitListView.as_view(), name="cardio-units"),

    path("strength/logs/", StrengthLogsRecentView.as_view(), name="strength-logs-recent"),
    path("strength/log/<int:pk>/", StrengthLogRetrieveView.as_view(), name="strength-log-retrieve"),
    path("strength/log/<int:pk>/details/", StrengthLogDetailsCreateView.as_view(), name="strength-log-details-create"),
    path("strength/log/<int:pk>/details/<int:detail_id>/", StrengthLogDetailUpdateView.as_view(), name="strength-log-detail-update"),
    path("strength/log/<int:pk>/last-set/", StrengthLogLastSetView.as_view(), name="strength-log-last-set"),
    path("strength/log/<int:pk>/delete/", StrengthLogDestroyView.as_view(), name="strength-log-delete"),
    path("strength/log/<int:pk>/details/<int:detail_id>/delete/", StrengthLogDetailDestroyView.as_view(), name="strength-log-detail-delete"),
    path("strength/log/", LogStrengthView.as_view(), name="strength-log"),
    path("strength/exercises/", StrengthExerciseListView.as_view(), name="strength-exercises"),
]
