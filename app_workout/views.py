# app_workout/views.py
from typing import Any, Dict
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status, permissions
from django.db import transaction
from .models import (
    Program,
    CardioExercise,
    CardioDailyLog,
    CardioDailyLogDetail,
    CardioUnit,
    StrengthExercise,
    StrengthDailyLog,
    StrengthDailyLogDetail,
)
from .serializers import (
    CardioRoutineSerializer,
    CardioWorkoutSerializer,
    CardioProgressionSerializer,
    CardioDailyLogCreateSerializer,
    CardioDailyLogSerializer,
    CardioDailyLogUpdateSerializer,
    CardioDailyLogDetailCreateSerializer,
    CardioDailyLogDetailUpdateSerializer,
    CardioDailyLogDetailSerializer,
    CardioUnitSerializer,
    StrengthDailyLogCreateSerializer,
    StrengthDailyLogSerializer,
    StrengthDailyLogUpdateSerializer,
    StrengthDailyLogDetailCreateSerializer,
    StrengthDailyLogDetailUpdateSerializer,
    StrengthDailyLogDetailSerializer,
    StrengthRoutineSerializer,
)
from .services import (
    predict_next_cardio_routine,
    predict_next_cardio_workout,
    get_routines_ordered_by_last_completed,
    get_workouts_for_routine_ordered_by_last_completed,
    get_next_progression_for_workout,
    get_next_cardio_workout, backfill_rest_days_if_gap,
    get_next_strength_routine,
)
from rest_framework import serializers
from rest_framework.generics import ListAPIView

# app_workout/views.py (additions)
from datetime import timedelta
from django.utils import timezone
from django.shortcuts import get_object_or_404

from .signals import recompute_log_aggregates, recompute_strength_log_aggregates


class CardioUnitListView(ListAPIView):
    permission_classes = [permissions.AllowAny]
    serializer_class = CardioUnitSerializer
    queryset = CardioUnit.objects.select_related("speed_name").all().order_by("name")

class CardioLogDestroyView(APIView):
    """
    DELETE /api/cardio/log/<id>/
    Deletes the daily log and cascades its intervals (FK CASCADE).
    """
    permission_classes = [permissions.AllowAny]

    @transaction.atomic
    def delete(self, request, pk, *args, **kwargs):
        log = get_object_or_404(CardioDailyLog, pk=pk)
        log.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

class CardioLogDetailDestroyView(APIView):
    """
    DELETE /api/cardio/log/<id>/details/<detail_id>/
    Deletes a single interval and recomputes aggregates.
    """
    permission_classes = [permissions.AllowAny]

    @transaction.atomic
    def delete(self, request, pk, detail_id, *args, **kwargs):
        detail = get_object_or_404(CardioDailyLogDetail, pk=detail_id, log_id=pk)
        log_id = detail.log_id
        detail.delete()
        # Recompute aggregates
        recompute_log_aggregates(log_id)
        return Response(status=status.HTTP_204_NO_CONTENT)
        # If you'd rather return the refreshed log:
        # log = CardioDailyLog.objects.select_related("workout","workout__routine").prefetch_related("details","details__exercise").get(pk=log_id)
        # return Response(CardioDailyLogSerializer(log).data, status=status.HTTP_200_OK)


class NextCardioView(APIView):
    """
    GET /api/cardio/next/
    Returns: { next_workout, next_progression, workout_list }
    """
    permission_classes = [permissions.AllowAny]

    def get(self, request, *args, **kwargs):
        next_workout, next_progression, workout_list = get_next_cardio_workout(
            include_skipped=request.query_params.get("include_skipped", "false").lower() == "true"
        )

        payload: Dict[str, Any] = {
            "next_workout": CardioWorkoutSerializer(next_workout).data if next_workout else None,
            "next_progression": CardioProgressionSerializer(next_progression).data if next_progression else None,
            "workout_list": CardioWorkoutSerializer(workout_list, many=True).data,
        }
        return Response(payload, status=status.HTTP_200_OK)


class NextStrengthView(APIView):
    """
    GET /api/strength/next/
    Returns: { next_routine, routine_list }
    """
    permission_classes = [permissions.AllowAny]

    def get(self, request, *args, **kwargs):
        next_routine, routine_list = get_next_strength_routine()
        payload: Dict[str, Any] = {
            "next_routine": StrengthRoutineSerializer(next_routine).data if next_routine else None,
            "routine_list": StrengthRoutineSerializer(routine_list, many=True).data,
        }
        return Response(payload, status=status.HTTP_200_OK)


class RoutinesOrderedView(APIView):
    """
    GET /api/cardio/routines-ordered/?program_id=ID
    """
    permission_classes = [permissions.AllowAny]

    def get(self, request, *args, **kwargs):
        program_id = request.query_params.get("program_id")
        program = None
        if program_id:
            program = Program.objects.filter(pk=program_id).first()
            if not program:
                return Response({"detail": "Program not found."}, status=status.HTTP_404_NOT_FOUND)

        routines = get_routines_ordered_by_last_completed(program=program)
        return Response(CardioRoutineSerializer(routines, many=True).data, status=status.HTTP_200_OK)


class WorkoutsOrderedView(APIView):
    """
    GET /api/cardio/workouts-ordered/?routine_id=ID&include_skipped=false
    """
    permission_classes = [permissions.AllowAny]

    def get(self, request, *args, **kwargs):
        routine_id = request.query_params.get("routine_id")
        if not routine_id:
            return Response({"detail": "routine_id is required."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            rid = int(routine_id)
        except ValueError:
            return Response({"detail": "routine_id must be an integer."}, status=status.HTTP_400_BAD_REQUEST)

        include_skipped = request.query_params.get("include_skipped", "false").lower() == "true"
        workouts = get_workouts_for_routine_ordered_by_last_completed(routine_id=rid, include_skipped=include_skipped)
        return Response(CardioWorkoutSerializer(workouts, many=True).data, status=status.HTTP_200_OK)


class PredictWorkoutForRoutineView(APIView):
    """
    GET /api/cardio/predict-workout/?routine_id=ID
    Returns the next workout for the given routine, plus the next progression for it.
    """
    permission_classes = [permissions.AllowAny]

    def get(self, request, *args, **kwargs):
        routine_id = request.query_params.get("routine_id")
        if not routine_id:
            return Response({"detail": "routine_id is required."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            rid = int(routine_id)
        except ValueError:
            return Response({"detail": "routine_id must be an integer."}, status=status.HTTP_400_BAD_REQUEST)

        next_w = predict_next_cardio_workout(routine_id=rid)
        next_prog = get_next_progression_for_workout(next_w.id) if next_w else None

        return Response(
            {
                "next_workout": CardioWorkoutSerializer(next_w).data if next_w else None,
                "next_progression": CardioProgressionSerializer(next_prog).data if next_prog else None,
            },
            status=status.HTTP_200_OK,
        )

class LogCardioView(APIView):
    """
    POST /api/cardio/log/
    Payload:
    {
      "datetime_started": "2025-08-11T14:05:00Z",
      "workout_id": 2,
      "goal": 40.0,
      "total_completed": 40.05,
      "max_mph": 6.38,
      "avg_mph": 6.10,
      "minutes_elapsed": 40.05,
      "details": [
        {
          "datetime": "2025-08-11T14:10:00Z",
          "exercise_id": 1,
          "running_minutes": 5,
          "running_seconds": 0,
          "running_miles": 0.5,
          "running_mph": 6.0
        }
      ]
    }
    Returns 201 with created log (+ details).
    """
    permission_classes = [permissions.AllowAny]

    @transaction.atomic
    def post(self, request, *args, **kwargs):
        ser = CardioDailyLogCreateSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)
        log = ser.save()
        return Response(CardioDailyLogSerializer(log).data, status=status.HTTP_201_CREATED)
    


class CardioExerciseSerializer(serializers.ModelSerializer):
    class Meta:
        model = CardioExercise
        fields = ["id", "name"]

class CardioExerciseListView(ListAPIView):
    permission_classes = [permissions.AllowAny]
    serializer_class = CardioExerciseSerializer
    queryset = CardioExercise.objects.all().order_by("name")






class CardioLogsRecentView(ListAPIView):
    """
    GET /api/cardio/logs/?weeks=8
    Returns CardioDailyLog (+details) for the last N weeks (default 8).
    """
    backfill_rest_days_if_gap()
    permission_classes = [permissions.AllowAny]
    serializer_class = CardioDailyLogSerializer

    def get_queryset(self):


        weeks = int(self.request.query_params.get("weeks", 8))
        since = timezone.now() - timedelta(weeks=weeks)
        return (
            CardioDailyLog.objects
            .filter(datetime_started__gte=since)
            .select_related("workout", "workout__routine")
            .prefetch_related("details", "details__exercise")
            .order_by("-datetime_started")
        )

class CardioLogRetrieveView(APIView):
    """
    GET /api/cardio/log/<id>/
    PATCH /api/cardio/log/<id>/
    """
    permission_classes = [permissions.AllowAny]

    def get(self, request, pk, *args, **kwargs):
        log = get_object_or_404(
            CardioDailyLog.objects.select_related("workout", "workout__routine").prefetch_related("details", "details__exercise"),
            pk=pk,
        )
        return Response(CardioDailyLogSerializer(log).data, status=status.HTTP_200_OK)

    @transaction.atomic
    def patch(self, request, pk, *args, **kwargs):
        log = get_object_or_404(CardioDailyLog, pk=pk)
        ser = CardioDailyLogUpdateSerializer(log, data=request.data, partial=True)
        if ser.is_valid():
            ser.save()
            log = CardioDailyLog.objects.select_related("workout", "workout__routine").prefetch_related("details", "details__exercise").get(pk=pk)
            return Response(CardioDailyLogSerializer(log).data, status=status.HTTP_200_OK)
        return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

class CardioLogDetailsCreateView(APIView):
    """
    POST /api/cardio/log/<id>/details/
    Body: { "details": [ CardioDailyLogDetailCreateSerializer, ... ] }
    Creates intervals for the given log and recomputes aggregates.
    """
    permission_classes = [permissions.AllowAny]

    @transaction.atomic
    def post(self, request, pk, *args, **kwargs):
        log = get_object_or_404(CardioDailyLog, pk=pk)
        items = request.data.get("details") or []
        if not isinstance(items, list) or len(items) == 0:
            return Response({"detail": "details must be a non-empty list."},
                            status=status.HTTP_400_BAD_REQUEST)

        to_create = []
        for payload in items:
            ser = CardioDailyLogDetailCreateSerializer(data=payload)
            ser.is_valid(raise_exception=True)
            to_create.append(CardioDailyLogDetail(log=log, **ser.validated_data))

        # insert once
        CardioDailyLogDetail.objects.bulk_create(to_create)

        # recompute mph and log aggregates
        recompute_log_aggregates(log.id)

        log.refresh_from_db()
        return Response(CardioDailyLogSerializer(log).data, status=status.HTTP_201_CREATED)


class CardioLogDetailUpdateView(APIView):
    """PATCH /api/cardio/log/<id>/details/<detail_id>/"""

    permission_classes = [permissions.AllowAny]

    @transaction.atomic
    def patch(self, request, pk, detail_id, *args, **kwargs):
        detail = get_object_or_404(CardioDailyLogDetail, pk=detail_id, log_id=pk)
        ser = CardioDailyLogDetailUpdateSerializer(detail, data=request.data, partial=True)
        if ser.is_valid():
            ser.save()
            recompute_log_aggregates(pk)
            log = (
                CardioDailyLog.objects
                .select_related("workout", "workout__routine")
                .prefetch_related("details", "details__exercise")
                .get(pk=pk)
            )
            return Response(CardioDailyLogSerializer(log).data, status=status.HTTP_200_OK)
        return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)


class CardioLogLastIntervalView(APIView):
    """
    GET /api/cardio/log/<id>/last-interval/
    Return the most recent interval for this log. If none exists, fall back to
    the latest log of the same workout. If still none, return zeros.
    """
    permission_classes = [permissions.AllowAny]

    def get(self, request, pk, *args, **kwargs):
        log = get_object_or_404(
            CardioDailyLog.objects.select_related("workout"), pk=pk
        )

        detail = log.details.order_by("-datetime").first()
        if detail is None:
            prev_log = (
                CardioDailyLog.objects
                .filter(workout=log.workout)
                .exclude(pk=log.pk)
                .order_by("-datetime_started")
                .first()
            )
            if prev_log:
                detail = prev_log.details.order_by("-datetime").first()

        if detail:
            return Response(
                CardioDailyLogDetailSerializer(detail).data,
                status=status.HTTP_200_OK,
            )

        return Response(
            {
                "running_minutes": 0,
                "running_seconds": 0,
                "running_miles": 0,
                "running_mph": 0,
            },
            status=status.HTTP_200_OK,
        )


# ---------- Strength logging views ----------

class StrengthLogsRecentView(ListAPIView):
    """GET /api/strength/logs/?weeks=8"""
    permission_classes = [permissions.AllowAny]
    serializer_class = StrengthDailyLogSerializer

    def get_queryset(self):
        weeks = int(self.request.query_params.get("weeks", 8))
        since = timezone.now() - timedelta(weeks=weeks)
        return (
            StrengthDailyLog.objects
            .filter(datetime_started__gte=since)
            .select_related("routine")
            .prefetch_related("details", "details__exercise")
            .order_by("-datetime_started")
        )


class StrengthLogRetrieveView(APIView):
    """GET/PATCH /api/strength/log/<id>/"""
    permission_classes = [permissions.AllowAny]

    def get(self, request, pk, *args, **kwargs):
        log = get_object_or_404(
            StrengthDailyLog.objects.select_related("routine").prefetch_related("details", "details__exercise"),
            pk=pk,
        )
        return Response(StrengthDailyLogSerializer(log).data, status=status.HTTP_200_OK)

    @transaction.atomic
    def patch(self, request, pk, *args, **kwargs):
        log = get_object_or_404(StrengthDailyLog, pk=pk)
        ser = StrengthDailyLogUpdateSerializer(log, data=request.data, partial=True)
        if ser.is_valid():
            ser.save()
            log = (
                StrengthDailyLog.objects
                .select_related("routine")
                .prefetch_related("details", "details__exercise")
                .get(pk=pk)
            )
            return Response(StrengthDailyLogSerializer(log).data, status=status.HTTP_200_OK)
        return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)


class StrengthLogDetailsCreateView(APIView):
    """POST /api/strength/log/<id>/details/"""
    permission_classes = [permissions.AllowAny]

    @transaction.atomic
    def post(self, request, pk, *args, **kwargs):
        log = get_object_or_404(StrengthDailyLog, pk=pk)
        items = request.data.get("details") or []
        if not isinstance(items, list) or len(items) == 0:
            return Response({"detail": "details must be a non-empty list."}, status=status.HTTP_400_BAD_REQUEST)

        to_create = []
        for payload in items:
            ser = StrengthDailyLogDetailCreateSerializer(data=payload)
            ser.is_valid(raise_exception=True)
            to_create.append(StrengthDailyLogDetail(log=log, **ser.validated_data))

        StrengthDailyLogDetail.objects.bulk_create(to_create)
        recompute_strength_log_aggregates(log.id)
        log.refresh_from_db()
        return Response(StrengthDailyLogSerializer(log).data, status=status.HTTP_201_CREATED)


class StrengthLogDetailUpdateView(APIView):
    """PATCH /api/strength/log/<id>/details/<detail_id>/"""
    permission_classes = [permissions.AllowAny]

    @transaction.atomic
    def patch(self, request, pk, detail_id, *args, **kwargs):
        detail = get_object_or_404(StrengthDailyLogDetail, pk=detail_id, log_id=pk)
        ser = StrengthDailyLogDetailUpdateSerializer(detail, data=request.data, partial=True)
        if ser.is_valid():
            ser.save()
            recompute_strength_log_aggregates(pk)
            log = (
                StrengthDailyLog.objects
                .select_related("routine")
                .prefetch_related("details", "details__exercise")
                .get(pk=pk)
            )
            return Response(StrengthDailyLogSerializer(log).data, status=status.HTTP_200_OK)
        return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)


class StrengthLogLastSetView(APIView):
    """GET /api/strength/log/<id>/last-set/"""
    permission_classes = [permissions.AllowAny]

    def get(self, request, pk, *args, **kwargs):
        log = get_object_or_404(
            StrengthDailyLog.objects.select_related("routine"), pk=pk
        )
        detail = log.details.order_by("-datetime").first()
        if detail is None:
            prev_log = (
                StrengthDailyLog.objects
                .filter(routine=log.routine)
                .exclude(pk=log.pk)
                .order_by("-datetime_started")
                .first()
            )
            if prev_log:
                detail = prev_log.details.order_by("-datetime").first()

        if detail:
            return Response(
                StrengthDailyLogDetailSerializer(detail).data,
                status=status.HTTP_200_OK,
            )
        return Response({"reps": 0, "weight": 0}, status=status.HTTP_200_OK)


class LogStrengthView(APIView):
    """POST /api/strength/log/"""
    permission_classes = [permissions.AllowAny]

    @transaction.atomic
    def post(self, request, *args, **kwargs):
        ser = StrengthDailyLogCreateSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)
        log = ser.save()
        return Response(StrengthDailyLogSerializer(log).data, status=status.HTTP_201_CREATED)


class StrengthLogDestroyView(APIView):
    """DELETE /api/strength/log/<id>/"""
    permission_classes = [permissions.AllowAny]

    @transaction.atomic
    def delete(self, request, pk, *args, **kwargs):
        log = get_object_or_404(StrengthDailyLog, pk=pk)
        log.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class StrengthLogDetailDestroyView(APIView):
    """DELETE /api/strength/log/<id>/details/<detail_id>/"""
    permission_classes = [permissions.AllowAny]

    @transaction.atomic
    def delete(self, request, pk, detail_id, *args, **kwargs):
        detail = get_object_or_404(StrengthDailyLogDetail, pk=detail_id, log_id=pk)
        log_id = detail.log_id
        detail.delete()
        recompute_strength_log_aggregates(log_id)
        return Response(status=status.HTTP_204_NO_CONTENT)


class StrengthExerciseSerializer(serializers.ModelSerializer):
    class Meta:
        model = StrengthExercise
        fields = ["id", "name"]


class StrengthExerciseListView(ListAPIView):
    permission_classes = [permissions.AllowAny]
    serializer_class = StrengthExerciseSerializer
    queryset = StrengthExercise.objects.all().order_by("name")
