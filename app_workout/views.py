# app_workout/views.py
from typing import Any, Dict
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status, permissions
from django.db import transaction
from django.db.models import F
from .models import (
    Program,
    CardioExercise,
    CardioDailyLog,
    CardioDailyLogDetail,
    CardioUnit,
    CardioWorkout,
    VwMPHGoal,
    StrengthExercise,
    StrengthDailyLog,
    StrengthDailyLogDetail,
    StrengthRoutine,
    VwStrengthProgression,
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
    StrengthProgressionSerializer,
    CardioWarmupSettingsSerializer,
    BodyweightSerializer,
)
from .services import (
    predict_next_cardio_routine,
    predict_next_cardio_workout,
    get_routines_ordered_by_last_completed,
    get_workouts_for_routine_ordered_by_last_completed,
    get_next_progression_for_workout,
    get_next_cardio_workout, backfill_rest_days_if_gap,
    get_next_strength_routine,
    get_next_strength_goal,
)
from rest_framework import serializers
from rest_framework.generics import ListAPIView

# app_workout/views.py (additions)
from datetime import timedelta
from django.utils import timezone
from django.db.models.functions import TruncDate
from django.shortcuts import get_object_or_404

from .signals import recompute_log_aggregates, recompute_strength_log_aggregates


class CardioUnitListView(ListAPIView):
    permission_classes = [permissions.AllowAny]
    serializer_class = CardioUnitSerializer
    queryset = CardioUnit.objects.select_related("speed_name").all().order_by("name")


class CardioWarmupSettingsView(APIView):
    """
    GET /api/cardio/warmup-settings/
    Returns the singleton warmup settings; if none exists, returns defaults (not persisted).
    """
    permission_classes = [permissions.AllowAny]

    def get(self, request, *args, **kwargs):
        from .models import CardioWarmupSettings
        obj = CardioWarmupSettings.objects.first()
        if not obj:
            # Return a non-persisted instance with defaults
            obj = CardioWarmupSettings()
        data = CardioWarmupSettingsSerializer(obj).data
        return Response(data, status=status.HTTP_200_OK)

    @transaction.atomic
    def patch(self, request, *args, **kwargs):
        from .models import CardioWarmupSettings
        obj = CardioWarmupSettings.objects.first()
        created = False
        if not obj:
            obj = CardioWarmupSettings()
            created = True
        ser = CardioWarmupSettingsSerializer(obj, data=request.data, partial=True)
        if ser.is_valid():
            ser.save()
            return Response(ser.data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)
        return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)


class BodyweightView(APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request, *args, **kwargs):
        from .models import Bodyweight
        obj = Bodyweight.objects.first()
        if not obj:
            obj = Bodyweight()
        data = BodyweightSerializer(obj).data
        return Response(data, status=status.HTTP_200_OK)

    @transaction.atomic
    def patch(self, request, *args, **kwargs):
        from .models import Bodyweight
        obj = Bodyweight.objects.first()
        created = False
        if not obj:
            obj = Bodyweight()
            created = True
        ser = BodyweightSerializer(obj, data=request.data, partial=True)
        if ser.is_valid():
            ser.save()
            return Response(ser.data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)
        return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

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
        next_routine, next_goal, routine_list = get_next_strength_routine()
        payload: Dict[str, Any] = {
            "next_routine": StrengthRoutineSerializer(next_routine).data if next_routine else None,
            "next_goal": StrengthProgressionSerializer(next_goal).data if next_goal else None,
            "routine_list": StrengthRoutineSerializer(routine_list, many=True).data,
        }
        return Response(payload, status=status.HTTP_200_OK)


class TrainingTypeRecommendationView(APIView):
    """
    GET /api/home/recommendation/

    For the selected Program:
    - Count non-rest days in CardioPlan (routine.name != 'Rest').
    - Assume Strength plan has 3 non-rest days.
    - In the last 7 days, count completed non-rest CardioDailyLog
      (exclude routine 'Rest') and StrengthDailyLog.
    - Compute deltas (plan - completed) and recommend the type with
      the higher delta. Ties return 'tie'.
    """
    permission_classes = [permissions.AllowAny]

    def get(self, request, *args, **kwargs):
        from .models import CardioPlan
        program = Program.objects.filter(selected=True).first()
        if not program:
            return Response({"detail": "No selected program found."}, status=status.HTTP_400_BAD_REQUEST)

        cardio_plan_non_rest = (
            CardioPlan.objects
            .select_related("routine")
            .filter(program=program)
            .exclude(routine__name__iexact="Rest")
            .count()
        )
        strength_plan_non_rest = 3

        since = timezone.now() - timedelta(days=7)
        cardio_done = (
            CardioDailyLog.objects
            .filter(datetime_started__gte=since)
            .exclude(workout__routine__name__iexact="Rest")
            .count()
        )
        strength_done_qs = (
            StrengthDailyLog.objects
            .filter(datetime_started__gte=since)
            .exclude(rep_goal__isnull=True)
            .filter(total_reps_completed__gte=F("rep_goal"))
        )
        strength_done = strength_done_qs.count()

        delta_cardio = max(0, cardio_plan_non_rest - cardio_done)
        delta_strength = max(0, strength_plan_non_rest - strength_done)

        # Double-days logic: how many days require both per week, and how many completed in last 7 days
        plan_total = cardio_plan_non_rest + strength_plan_non_rest
        double_required = max(0, plan_total - 7)
        cardio_days = set(
            CardioDailyLog.objects
            .filter(datetime_started__gte=since)
            .exclude(workout__routine__name__iexact="Rest")
            .annotate(day=TruncDate("datetime_started"))
            .values_list("day", flat=True)
        )
        strength_days = set(
            strength_done_qs
            .annotate(day=TruncDate("datetime_started"))
            .values_list("day", flat=True)
        )
        double_completed = len(cardio_days.intersection(strength_days))
        double_remaining = max(0, double_required - double_completed)

        # Percent complete relative to plan (clamped 0..1); use for tie-breaker
        def pct(done: int, plan: int) -> float:
            if plan <= 0:
                return 1.0
            val = done / float(plan)
            return 1.0 if val > 1.0 else (0.0 if val < 0.0 else val)

        pct_cardio = pct(cardio_done, cardio_plan_non_rest)
        pct_strength = pct(strength_done, strength_plan_non_rest)

        if delta_strength > delta_cardio:
            recommendation = "strength"
        elif delta_cardio > delta_strength:
            recommendation = "cardio"
        else:
            # Tie-breaker: pick the lower completion percentage (more behind)
            if pct_strength < pct_cardio:
                recommendation = "strength"
            elif pct_cardio < pct_strength:
                recommendation = "cardio"
            else:
                recommendation = "tie"

        # If both are behind and we still need double days, suggest stacking both today
        if double_remaining > 0 and delta_cardio > 0 and delta_strength > 0:
            recommendation = "both"

        return Response(
            {
                "program": program.name,
                "cardio_plan_non_rest": cardio_plan_non_rest,
                "strength_plan_non_rest": strength_plan_non_rest,
                "cardio_done_last7": cardio_done,
                "strength_done_last7": strength_done,
                "delta_cardio": delta_cardio,
                "delta_strength": delta_strength,
                "pct_cardio": pct_cardio,
                "pct_strength": pct_strength,
                "double_required_per_week": double_required,
                "double_completed_last7": double_completed,
                "double_remaining": double_remaining,
                "recommendation": recommendation,
            },
            status=status.HTTP_200_OK,
        )


class CardioGoalView(APIView):
    """
    GET /api/cardio/goal/?workout_id=ID
    Returns the next cardio goal (progression) for a workout.
    """
    permission_classes = [permissions.AllowAny]

    def get(self, request, *args, **kwargs):
        workout_id = request.query_params.get("workout_id")
        if not workout_id:
            return Response({"detail": "workout_id is required."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            wid = int(workout_id)
        except ValueError:
            return Response({"detail": "workout_id must be an integer."}, status=status.HTTP_400_BAD_REQUEST)

        prog = get_next_progression_for_workout(wid)
        data = CardioProgressionSerializer(prog).data if prog else None
        return Response(data, status=status.HTTP_200_OK)


class StrengthGoalView(APIView):
    """
    GET /api/strength/goal/?routine_id=ID
    Returns the next strength goal (progression) for a routine.
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

        prog = get_next_strength_goal(rid)
        data = StrengthProgressionSerializer(prog).data if prog else None
        return Response(data, status=status.HTTP_200_OK)


class StrengthLevelView(APIView):
    """
    GET /api/strength/level/?routine_id=ID&volume=FLOAT
    Returns the progression level (order) in VwStrengthProgression that best
    matches the provided daily volume for the given routine.
    Response: { progression_order: int, total_levels: int }
    """
    permission_classes = [permissions.AllowAny]

    def get(self, request, *args, **kwargs):
        routine_id = request.query_params.get("routine_id")
        volume = request.query_params.get("volume")
        if not routine_id or volume is None:
            return Response({"detail": "routine_id and volume are required."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            rid = int(routine_id)
            vol = float(volume)
        except ValueError:
            return Response({"detail": "routine_id must be integer and volume numeric."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            routine = StrengthRoutine.objects.get(pk=rid)
        except StrengthRoutine.DoesNotExist:
            return Response({"detail": "Routine not found."}, status=status.HTTP_404_NOT_FOUND)

        progs = list(VwStrengthProgression.objects.filter(routine_name=routine.name).order_by("progression_order"))
        if not progs:
            return Response({"progression_order": None, "total_levels": 0}, status=status.HTTP_200_OK)

        # Pick progression with daily_volume closest to requested volume (tie → lower order)
        best = progs[0]
        best_diff = abs(float(best.daily_volume) - vol)
        for p in progs[1:]:
            d = abs(float(p.daily_volume) - vol)
            if d < best_diff or (d == best_diff and p.progression_order < best.progression_order):
                best = p
                best_diff = d

        return Response({"progression_order": best.progression_order, "total_levels": len(progs)}, status=status.HTTP_200_OK)


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


class CardioMPHGoalView(APIView):
    """Return MPH goal and converted distance/time for a workout.

    GET /api/cardio/mph-goal/?workout_id=ID&value=FLOAT
    The ``value`` is interpreted using the workout's unit.
    """

    permission_classes = [permissions.AllowAny]

    def get(self, request, *args, **kwargs):
        workout_id = request.query_params.get("workout_id")
        value = request.query_params.get("value")
        if workout_id is None or value is None:
            return Response(
                {"detail": "workout_id and value are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            wid = int(workout_id)
            val = float(value)
        except ValueError:
            return Response(
                {"detail": "workout_id must be integer and value must be numeric."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        workout = get_object_or_404(
            CardioWorkout.objects.select_related("unit", "unit__unit_type", "routine"),
            pk=wid,
        )
        if workout.routine.name.lower() == "sprints":
            val = 1.0
        mph_goal_obj = get_object_or_404(VwMPHGoal, pk=wid)
        mph_goal = float(mph_goal_obj.mph_goal)
        mph_goal_avg = float(mph_goal_obj.mph_goal_avg)

        unit = workout.unit
        unit_type = getattr(getattr(unit, "unit_type", None), "name", "").lower()
        num = float(unit.mile_equiv_numerator or 0.0)
        den = float(unit.mile_equiv_denominator or 1.0)
        miles_per_unit = (num / den) if den else 0.0

        # Prepare payloads for both Max and Avg MPH goals
        distance_payload: Dict[str, Any] = {}
        minutes_int = 0
        seconds = 0

        if unit_type == "time":
            # Value is minutes; compute miles for both mph goals
            minutes_total = val
            miles_max = mph_goal * (minutes_total / 60.0)
            miles_avg = mph_goal_avg * (minutes_total / 60.0)
            distance_payload.update({
                "miles": round(miles_max, 2),          # backward-compat: miles for Max
                "miles_max": round(miles_max, 2),
                "miles_avg": round(miles_avg, 2),
            })
            minutes_int = int(minutes_total)
            seconds = round((minutes_total - minutes_int) * 60.0, 0)
        else:
            # Value is distance (in unit); compute time for both mph goals
            miles = val * miles_per_unit
            minutes_total_max = (miles / mph_goal) * 60.0 if mph_goal else 0.0
            minutes_total_avg = (miles / mph_goal_avg) * 60.0 if mph_goal_avg else 0.0

            # Backward-compat: original fields reflect Max-based computation
            minutes_int = int(minutes_total_max)
            seconds = round((minutes_total_max - minutes_int) * 60.0, 0)

            minutes_int_avg = int(minutes_total_avg)
            seconds_avg = round((minutes_total_avg - minutes_int_avg) * 60.0, 0)

            distance_payload.update({
                "distance": round(val, 2),
                "minutes_max": minutes_int,
                "seconds_max": seconds,
                "minutes_avg": minutes_int_avg,
                "seconds_avg": seconds_avg,
            })

        return Response(
            {
                "mph_goal": mph_goal,
                "mph_goal_avg": mph_goal_avg,
                **distance_payload,
                "minutes": minutes_int,  # backward-compat (Max)
                "seconds": seconds,      # backward-compat (Max)
                "unit_type": unit_type,
                "unit_name": getattr(unit, "name", None),
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
    permission_classes = [permissions.AllowAny]
    serializer_class = CardioDailyLogSerializer

    def get_queryset(self):
        backfill_rest_days_if_gap()

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
        print(request.data)
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
        fields = ["id", "name", "standard_weight"]


class StrengthExerciseListView(ListAPIView):
    permission_classes = [permissions.AllowAny]
    serializer_class = StrengthExerciseSerializer
    def get_queryset(self):
        qs = StrengthExercise.objects.all().order_by("name")
        rid = self.request.query_params.get("routine_id")
        if rid is not None:
            try:
                rid_int = int(rid)
            except ValueError:
                return StrengthExercise.objects.none()
            qs = qs.filter(routine_id=rid_int)
        return qs
