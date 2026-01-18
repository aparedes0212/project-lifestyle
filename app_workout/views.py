# app_workout/views.py
from typing import Any, Dict, List
import time
from math import ceil
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status, permissions
from django.db import transaction
from django.db.models import F, Prefetch, Max
from django.db.utils import OperationalError
from .models import (
    Program,
    CardioPlan,
    CardioExercise,
    CardioDailyLog,
    CardioDailyLogDetail,
    CardioUnit,
    CardioWorkout,
    CardioProgression,
    CardioWorkoutWarmup,
    StrengthExercise,
    StrengthPlan,
    StrengthDailyLog,
    StrengthDailyLogDetail,
    StrengthRoutine,
    SupplementalPlan,
    SupplementalDailyLog,
    SupplementalDailyLogDetail,
    SupplementalRoutine,
    VwStrengthProgression,
    SpecialRule,
)
from .serializers import (
    CardioRoutineSerializer,
    CardioWorkoutSerializer,
    CardioWorkoutGoalDistanceSerializer,
    CardioWorkoutGoalDistanceUpdateSerializer,
    CardioProgressionSerializer,
    CardioProgressionBulkUpdateSerializer,
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
    CardioWorkoutWarmupSerializer,
    CardioWorkoutWarmupUpdateSerializer,
    CardioRestThresholdSerializer,
    CardioRestThresholdUpdateSerializer,
    StrengthRestThresholdSerializer,
    StrengthRestThresholdUpdateSerializer,
    BodyweightSerializer,
    CardioWorkoutTMSyncPreferenceSerializer,
    CardioWorkoutTMSyncPreferenceUpdateSerializer,
    SupplementalDailyLogDetailCreateSerializer,
    SupplementalDailyLogCreateSerializer,
    SupplementalDailyLogSerializer,
    SupplementalDailyLogDetailUpdateSerializer,
    SupplementalDailyLogUpdateSerializer,
    SupplementalRoutineSerializer,
    ProgramSerializer,
    SpecialRuleSerializer,
)
from .services import (
    predict_next_cardio_routine,
    predict_next_cardio_workout,
    get_routines_ordered_by_last_completed,
    get_workouts_for_routine_ordered_by_last_completed,
    get_next_progression_for_workout,
    get_next_cardio_workout,
    get_next_strength_routine,
    get_next_strength_goal,
    get_next_supplemental_workout,
    get_supplemental_goal_target,
    RestBackfillService,
    backfill_all_rest_day_gaps,
    delete_rest_on_days_with_activity,
    get_mph_goal_for_workout,
)
from .services import (
    get_reps_per_hour_goal_for_routine,
    get_max_reps_goal_for_routine,
    get_max_weight_goal_for_routine,
)
from rest_framework import serializers
from rest_framework.generics import ListAPIView

# app_workout/views.py (additions)
from datetime import timedelta
from django.utils import timezone
from django.shortcuts import get_object_or_404

from .signals import (
    recompute_log_aggregates,
    recompute_strength_log_aggregates,
    recompute_supplemental_log_aggregates,
)
from .models import CardioWorkoutTMSyncPreference, CardioWorkoutRestThreshold, StrengthExerciseRestThreshold


class CardioUnitListView(ListAPIView):
    permission_classes = [permissions.AllowAny]
    serializer_class = CardioUnitSerializer
    queryset = CardioUnit.objects.select_related("speed_name").all().order_by("name")


class CardioWarmupDefaultsView(APIView):
    """
    GET /api/cardio/warmup-defaults/
      Optional query: workout_id=ID to filter
    Returns list of workouts with their default warmup values.
    """
    permission_classes = [permissions.AllowAny]

    def get(self, request, *args, **kwargs):
        workout_id = request.query_params.get("workout_id")
        qs = CardioWorkout.objects.select_related("routine").order_by("routine__name", "priority_order", "name")
        if workout_id:
            try:
                wid = int(workout_id)
            except ValueError:
                return Response({"detail": "workout_id must be an integer."}, status=status.HTTP_400_BAD_REQUEST)
            qs = qs.filter(pk=wid)

        warmups = {w.workout_id: w for w in CardioWorkoutWarmup.objects.filter(workout__in=qs)}
        payload = []
        for workout in qs:
            pref = warmups.get(workout.id)
            payload.append({
                "workout": workout.id,
                "workout_name": workout.name,
                "routine_name": workout.routine.name if workout.routine else "",
                "warmup_minutes": getattr(pref, "warmup_minutes", None),
                "warmup_mph": getattr(pref, "warmup_mph", None),
            })
        return Response(payload, status=status.HTTP_200_OK)


class CardioWarmupDefaultUpdateView(APIView):
    """PATCH /api/cardio/warmup-defaults/<int:workout_id>/"""
    permission_classes = [permissions.AllowAny]

    @transaction.atomic
    def patch(self, request, workout_id, *args, **kwargs):
        workout = get_object_or_404(CardioWorkout, pk=workout_id)
        pref, _created = CardioWorkoutWarmup.objects.get_or_create(workout=workout)
        serializer = CardioWorkoutWarmupUpdateSerializer(pref, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            pref.refresh_from_db()
            data = CardioWorkoutWarmupSerializer(pref).data
            return Response(data, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class CardioGoalDistanceView(APIView):
    """GET /api/cardio/goal-distances/"""
    permission_classes = [permissions.AllowAny]

    def get(self, request, *args, **kwargs):
        workouts = (
            CardioWorkout.objects
            .select_related("routine", "unit", "unit__unit_type")
            .order_by("routine__name", "priority_order", "name")
        )
        serializer = CardioWorkoutGoalDistanceSerializer(workouts, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)


class CardioGoalDistanceUpdateView(APIView):
    """PATCH /api/cardio/goal-distances/<int:workout_id>/"""
    permission_classes = [permissions.AllowAny]

    @transaction.atomic
    def patch(self, request, workout_id, *args, **kwargs):
        workout = get_object_or_404(CardioWorkout, pk=workout_id)
        serializer = CardioWorkoutGoalDistanceUpdateSerializer(workout, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            data = CardioWorkoutGoalDistanceSerializer(workout).data
            return Response(data, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)



class CardioRestThresholdsView(APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request, *args, **kwargs):
        workouts = CardioWorkout.objects.select_related("routine").order_by("routine__name", "priority_order", "name")
        thresholds_qs = CardioWorkoutRestThreshold.objects.select_related("workout__routine").filter(workout__in=workouts)
        thresholds_map = {t.workout_id: t for t in thresholds_qs}
        missing = [
            CardioWorkoutRestThreshold(workout=w)
            for w in workouts
            if w.id not in thresholds_map
        ]
        if missing:
            CardioWorkoutRestThreshold.objects.bulk_create(missing)
            thresholds_qs = CardioWorkoutRestThreshold.objects.select_related("workout__routine").filter(workout__in=workouts)
        thresholds_map = {t.workout_id: t for t in thresholds_qs}
        ordered = [thresholds_map[w.id] for w in workouts]
        serializer = CardioRestThresholdSerializer(ordered, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)


class CardioRestThresholdUpdateView(APIView):
    permission_classes = [permissions.AllowAny]

    @transaction.atomic
    def patch(self, request, workout_id, *args, **kwargs):
        workout = get_object_or_404(CardioWorkout, pk=workout_id)
        threshold, _ = CardioWorkoutRestThreshold.objects.get_or_create(workout=workout)
        serializer = CardioRestThresholdUpdateSerializer(threshold, data=request.data, partial=True)
        if serializer.is_valid():
            threshold = serializer.save()
            out = CardioRestThresholdSerializer(threshold).data
            return Response(out, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class StrengthRestThresholdsView(APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request, *args, **kwargs):
        exercises = StrengthExercise.objects.select_related("routine").order_by("routine__name", "name")
        thresholds_qs = StrengthExerciseRestThreshold.objects.select_related("exercise__routine").filter(exercise__in=exercises)
        thresholds_map = {t.exercise_id: t for t in thresholds_qs}
        missing = [
            StrengthExerciseRestThreshold(exercise=ex)
            for ex in exercises
            if ex.id not in thresholds_map
        ]
        if missing:
            StrengthExerciseRestThreshold.objects.bulk_create(missing)
            thresholds_qs = StrengthExerciseRestThreshold.objects.select_related("exercise__routine").filter(exercise__in=exercises)
        thresholds_map = {t.exercise_id: t for t in thresholds_qs}
        ordered = [thresholds_map[ex.id] for ex in exercises]
        serializer = StrengthRestThresholdSerializer(ordered, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)


class StrengthRestThresholdUpdateView(APIView):
    permission_classes = [permissions.AllowAny]

    @transaction.atomic
    def patch(self, request, exercise_id, *args, **kwargs):
        exercise = get_object_or_404(StrengthExercise, pk=exercise_id)
        threshold, _ = StrengthExerciseRestThreshold.objects.get_or_create(exercise=exercise)
        serializer = StrengthRestThresholdUpdateSerializer(threshold, data=request.data, partial=True)
        if serializer.is_valid():
            threshold = serializer.save()
            out = StrengthRestThresholdSerializer(threshold).data
            return Response(out, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class CardioProgressionsView(APIView):
    """GET+PUT access to cardio progressions for a workout."""
    permission_classes = [permissions.AllowAny]

    def get(self, request, *args, **kwargs):
        workout_id_raw = request.query_params.get("workout_id")
        try:
            workout_id = int(workout_id_raw)
        except (TypeError, ValueError):
            return Response({"detail": "workout_id must be provided as an integer."}, status=status.HTTP_400_BAD_REQUEST)

        if not CardioWorkout.objects.filter(pk=workout_id).exists():
            return Response({"detail": "Workout not found."}, status=status.HTTP_404_NOT_FOUND)

        qs = CardioProgression.objects.filter(workout_id=workout_id).order_by("progression_order")
        data = CardioProgressionSerializer(qs, many=True).data
        return Response(data, status=status.HTTP_200_OK)

    @transaction.atomic
    def put(self, request, *args, **kwargs):
        workout_id_raw = request.query_params.get("workout_id")
        try:
            workout_id = int(workout_id_raw)
        except (TypeError, ValueError):
            return Response({"detail": "workout_id must be provided as an integer."}, status=status.HTTP_400_BAD_REQUEST)

        workout = get_object_or_404(CardioWorkout, pk=workout_id)
        serializer = CardioProgressionBulkUpdateSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        items = serializer.validated_data["progressions"]
        CardioProgression.objects.filter(workout=workout).delete()
        to_create = [
            CardioProgression(
                workout=workout,
                progression_order=item["progression_order"],
                progression=item["progression"],
            )
            for item in sorted(items, key=lambda entry: entry["progression_order"])
        ]
        if to_create:
            CardioProgression.objects.bulk_create(to_create)

        refreshed = CardioProgression.objects.filter(workout=workout).order_by("progression_order")
        data = CardioProgressionSerializer(refreshed, many=True).data
        return Response(data, status=status.HTTP_200_OK)

    patch = put


class CardioTMSyncDefaultsView(APIView):
    """
    GET /api/cardio/tm-sync-defaults/
      Optional query: workout_id=ID to filter to one
    Returns list of workouts with their default TM sync preference.

    PATCH /api/cardio/tm-sync-defaults/<int:workout_id>/
      Body: { default_tm_sync: "run_to_tm" | "tm_to_run" | "run_equals_tm" | "none" }
    Creates or updates the preference for that workout.
    """
    permission_classes = [permissions.AllowAny]

    def get(self, request, *args, **kwargs):
        workout_id = request.query_params.get("workout_id")
        qs = CardioWorkout.objects.select_related("routine", "unit").order_by("routine__name", "priority_order", "name")
        if workout_id:
            try:
                wid = int(workout_id)
            except ValueError:
                return Response({"detail": "workout_id must be an integer."}, status=status.HTTP_400_BAD_REQUEST)
            qs = qs.filter(pk=wid)

        # For each workout, attach pref; if none, return default 'run_to_tm'
        items = []
        prefs = {p.workout_id: p for p in CardioWorkoutTMSyncPreference.objects.filter(workout__in=qs)}
        for w in qs:
            pref = prefs.get(w.id)
            items.append({
                "workout": w.id,
                "workout_name": w.name,
                "routine_name": w.routine.name,
                "default_tm_sync": pref.default_tm_sync if pref else "run_to_tm",
            })
        return Response(items, status=status.HTTP_200_OK)


class CardioTMSyncDefaultUpdateView(APIView):
    permission_classes = [permissions.AllowAny]

    @transaction.atomic
    def patch(self, request, workout_id, *args, **kwargs):
        try:
            w = CardioWorkout.objects.get(pk=workout_id)
        except CardioWorkout.DoesNotExist:
            return Response({"detail": "Workout not found."}, status=status.HTTP_404_NOT_FOUND)

        pref, _created = CardioWorkoutTMSyncPreference.objects.get_or_create(workout=w)
        ser = CardioWorkoutTMSyncPreferenceUpdateSerializer(pref, data=request.data, partial=True)
        if ser.is_valid():
            ser.save()
            out = CardioWorkoutTMSyncPreferenceSerializer(pref).data
            return Response(out, status=status.HTTP_200_OK)
        return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)


class ProgramListView(APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request, *args, **kwargs):
        programs = Program.objects.all().order_by("name")
        data = ProgramSerializer(programs, many=True).data
        return Response(data, status=status.HTTP_200_OK)


class ProgramSelectionView(APIView):
    permission_classes = [permissions.AllowAny]

    VALID_TYPES = {
        "cardio": "selected_cardio",
        "strength": "selected_strength",
        "supplemental": "selected_supplemental",
    }

    @transaction.atomic
    def patch(self, request, *args, **kwargs):
        training_type = (request.data.get("training_type") or "").strip().lower()
        program_id = request.data.get("program_id")

        if training_type not in self.VALID_TYPES:
            return Response(
                {"detail": "training_type must be one of: cardio, strength, supplemental."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            pid = int(program_id)
        except (TypeError, ValueError):
            return Response({"detail": "program_id must be an integer."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            program = Program.objects.get(pk=pid)
        except Program.DoesNotExist:
            return Response({"detail": "Program not found."}, status=status.HTTP_404_NOT_FOUND)

        flag_field = self.VALID_TYPES[training_type]

        if getattr(program, flag_field):
            programs = Program.objects.all().order_by("name")
            data = ProgramSerializer(programs, many=True).data
            return Response(data, status=status.HTTP_200_OK)

        Program.objects.filter(**{flag_field: True}).update(**{flag_field: False})
        setattr(program, flag_field, True)
        program.save(update_fields=[flag_field])

        programs = Program.objects.all().order_by("name")
        data = ProgramSerializer(programs, many=True).data
        return Response(data, status=status.HTTP_200_OK)


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
        last_exc = None
        for attempt in range(3):
            try:
                with transaction.atomic():
                    # Lock existing row if present to avoid concurrent writes on SQLite
                    obj = Bodyweight.objects.select_for_update().first()
                    created = False
                    if not obj:
                        obj = Bodyweight()
                        created = True
                    ser = BodyweightSerializer(obj, data=request.data, partial=True)
                    if ser.is_valid():
                        ser.save()
                        return Response(
                            ser.data,
                            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
                        )
                    return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)
            except OperationalError as exc:
                last_exc = exc
                time.sleep(0.1)
        msg = "Database is busy; please retry."
        if last_exc:
            msg = f"{msg} ({last_exc})"
        return Response({"detail": msg}, status=status.HTTP_503_SERVICE_UNAVAILABLE)


class SpecialRuleView(APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request, *args, **kwargs):
        rules = SpecialRule.get_solo()
        data = SpecialRuleSerializer(rules).data
        return Response(data, status=status.HTTP_200_OK)

    def patch(self, request, *args, **kwargs):
        # SQLite can throw "database is locked" if another writer is mid-commit;
        # retry briefly to avoid user-facing 500s when toggling settings.
        last_exc = None
        for attempt in range(3):
            try:
                with transaction.atomic():
                    rules = SpecialRule.get_solo()
                    ser = SpecialRuleSerializer(rules, data=request.data, partial=True)
                    if ser.is_valid():
                        ser.save()
                        return Response(ser.data, status=status.HTTP_200_OK)
                    return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)
            except OperationalError as exc:
                last_exc = exc
                msg = str(exc).lower()
                if "locked" not in msg or attempt == 2:
                    raise
                time.sleep(0.15)
        if last_exc:
            raise last_exc
        return Response({"detail": "Unable to update rules."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

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


class NextSupplementalView(APIView):
    """
    GET /api/supplemental/next/
    Returns: { routine, workout, workout_list }
    """
    permission_classes = [permissions.AllowAny]

    def get(self, request, *args, **kwargs):
        routine, _, _ = get_next_supplemental_workout()
        workout = None
        if routine:
            ry = getattr(routine, "rest_yellow_start_seconds", 60)
            rr = getattr(routine, "rest_red_start_seconds", 90)
            workout = {
                "id": None,
                "routine": SupplementalRoutineSerializer(routine).data,
                "workout": {"id": None, "name": "3 Max Sets"},
                "description": f"Do three maximum effort sets. Rest {ry}-{rr} seconds between each set. As soon as you stop (even for one second), that set is complete.",
            }
        payload: Dict[str, Any] = {
            "routine": SupplementalRoutineSerializer(routine).data if routine else None,
            "workout": workout,
            "workout_list": [],
        }
        return Response(payload, status=status.HTTP_200_OK)

class TrainingTypeRecommendationView(APIView):
    """Return daily training recommendation across cardio, strength, and supplemental."""
    permission_classes = [permissions.AllowAny]

    def get(self, request, *args, **kwargs):
        now = timezone.now()
        RestBackfillService.instance().ensure_backfilled(now=now)

        cardio_program = Program.objects.filter(selected_cardio=True).first()
        if not cardio_program:
            return Response({"detail": "No selected cardio program found."}, status=status.HTTP_400_BAD_REQUEST)

        cardio_plan_non_rest = (
            CardioPlan.objects.select_related("routine")
            .filter(program=cardio_program)
            .exclude(routine__name__iexact="Rest")
            .count()
        )

        strength_plan_non_rest = 3  # DO NOT CHANGE EVER
        supplemental_plan_non_rest = 5  # DO NOT CHANGE EVER

        supplemental_plan_non_rest_half = int(ceil(supplemental_plan_non_rest / 2.0))
        supplemental_plan_non_rest_half_hours = (24*supplemental_plan_non_rest_half) + 8

        since7d = now - timedelta(days=7)
        since32h = now - timedelta(hours=32)
        sinceSupph = now - timedelta(hours=supplemental_plan_non_rest_half_hours)

        cardio_done_qs = (
            CardioDailyLog.objects.filter(datetime_started__gte=since7d)
            .exclude(workout__routine__name__iexact="Rest")
            .only("goal", "total_completed", "datetime_started", "workout_id")
        )
        strength_done_qs = (
            StrengthDailyLog.objects.filter(datetime_started__gte=since7d)
            .exclude(rep_goal__isnull=True)
            .exclude(total_reps_completed__isnull=True)
            .only("rep_goal", "total_reps_completed", "datetime_started")
        )
        supplemental_done_qs = (
            SupplementalDailyLog.objects.filter(datetime_started__gte=since7d)
            .exclude(routine__name__iexact="Rest")
            .only("datetime_started")
        )

        def safe_float(val, default=0.0) -> float:
            try:
                return float(val if val is not None else default)
            except (TypeError, ValueError):
                return float(default)

        def sum_completion_ratios(qs, goal_field: str, completed_field: str) -> float:
            total = 0.0
            for log in qs:
                goal_val = safe_float(getattr(log, goal_field, 0.0), 0.0)
                comp_val = safe_float(getattr(log, completed_field, 0.0), 0.0)
                if goal_val > 0 and comp_val > 0:
                    total += comp_val / goal_val
            return total

        def sum_supplemental_3max_sets(qs, cap_sets: int = 3) -> float:
            total = 0.0
            cap = int(cap_sets) if cap_sets else 0
            for log in qs:
                try:
                    sets_completed = int(log.details.count())
                except Exception:
                    sets_completed = 0
                ratio = min(1.0, sets_completed / float(cap)) if cap > 0 else 0.0
                total += ratio
            return total

        def pct(done: float, plan: int) -> float:
            if plan <= 0:
                return 1.0
            val = done / float(plan)
            return 0.0 if val < 0.0 else val

        def r3(val: float) -> float:
            return round(float(val), 3)

        # Next workouts / routines
        next_cardio, next_cardio_progression, _ = get_next_cardio_workout()
        next_strength, next_strength_goal, _ = get_next_strength_routine()
        next_supplemental, next_supplemental_workout, _ = get_next_supplemental_workout()

        next_cardio_is_rest = bool(
            next_cardio and getattr(getattr(next_cardio, "routine", None), "name", "").lower() == "rest"
        )

        # Recent blocks
        strength_done_last32 = (
            strength_done_qs.annotate(datetime_ended=Max("details__datetime"))
            .filter(datetime_ended__gte=since32h)
            .exists()
        )

        supplemental_recent_required = (
            supplemental_plan_non_rest_half if supplemental_plan_non_rest > 0 else 0
        )
        supplemental_recent_count = supplemental_done_qs.filter(datetime_started__gte=sinceSupph).count()
        supplemental_recent_block = (
            supplemental_recent_required > 0 and supplemental_recent_count >= supplemental_recent_required
        )

        # Rules + special-day detection
        rules = SpecialRule.get_solo()

        routine_name = getattr(getattr(next_cardio, "routine", None), "name", "") or ""
        normalized_routine_name = routine_name.lower()
        is_marathon_day = "marathon" in normalized_routine_name
        is_sprint_day = "sprint" in normalized_routine_name

        # Compute done/pct/delta per type in a compact structure
        done_by_type: Dict[str, float] = {
            "cardio": sum_completion_ratios(cardio_done_qs, "goal", "total_completed"),
            "strength": sum_completion_ratios(strength_done_qs, "rep_goal", "total_reps_completed"),
            "supplemental": sum_supplemental_3max_sets(supplemental_done_qs, cap_sets=3),
        }
        plan_by_type: Dict[str, int] = {
            "cardio": cardio_plan_non_rest,
            "strength": strength_plan_non_rest,
            "supplemental": supplemental_plan_non_rest,
        }
        pct_by_type: Dict[str, float] = {k: pct(done_by_type[k], plan_by_type[k]) for k in plan_by_type}
        delta_by_type: Dict[str, float] = {
            k: max(0.0, float(plan_by_type[k]) - float(done_by_type[k])) for k in plan_by_type
        }

        # Eligibility
        complete_by_type = {k: pct_by_type[k] >= 1.0 for k in plan_by_type}

        cardio_eligible = (
            cardio_plan_non_rest > 0 and not complete_by_type["cardio"] and not next_cardio_is_rest
        )
        strength_eligible = (
            strength_plan_non_rest > 0 and not complete_by_type["strength"] and not strength_done_last32
        )
        supplemental_eligible = (
            supplemental_plan_non_rest > 0
            and not supplemental_recent_block
            and not complete_by_type["supplemental"]
        )

        # Marathon weekday skip
        skip_marathon_weekdays = getattr(rules, "skip_marathon_prep_weekdays", False)
        if cardio_eligible and skip_marathon_weekdays and is_marathon_day and now.weekday() < 5:
            cardio_eligible = False

        eligible_by_type: Dict[str, bool] = {
            "cardio": cardio_eligible,
            "strength": strength_eligible,
            "supplemental": supplemental_eligible,
        }

        type_info = {
            k: {
                "plan": plan_by_type[k],
                "done": done_by_type[k],
                "delta": delta_by_type[k],
                "pct": pct_by_type[k],
                "eligible": eligible_by_type[k],
            }
            for k in ("cardio", "strength", "supplemental")
        }

        # Priority order (rules override)
        stored_priority_order = getattr(rules, "pick_priority_order", None)
        priority_order: List[str] = []
        if isinstance(stored_priority_order, (list, tuple)):
            for entry in stored_priority_order:
                v = str(entry).lower()
                if v in type_info and v not in priority_order:
                    priority_order.append(v)
        for fallback in ("cardio", "strength", "supplemental"):
            if fallback not in priority_order:
                priority_order.append(fallback)

        # Recommendation types (based on eligible + behind)
        eligible_types = [k for k in type_info if type_info[k]["eligible"]]

        def sort_key(k: str):
            info = type_info[k]
            return (-info["delta"], info["pct"], k)

        recommendation_types: List[str] = []
        if eligible_types:
            sorted_types = sorted(eligible_types, key=sort_key)
            behind = [t for t in sorted_types if type_info[t]["delta"] > 0]
            if behind:
                recommendation_types = [behind[0]]
            else:
                min_pct = min(type_info[t]["pct"] for t in sorted_types)
                recommendation_types = [t for t in sorted_types if abs(type_info[t]["pct"] - min_pct) <= 1e-9]
                if len(recommendation_types) == len(sorted_types) and min_pct >= 1.0:
                    recommendation_types = []

        if len(recommendation_types) > 2:
            recommendation_types = recommendation_types[:2]

        if not eligible_types:
            recommendation = "rest"
        elif not recommendation_types:
            recommendation = "rest" if all(type_info[t]["pct"] >= 1.0 for t in eligible_types) else "tie"
        else:
            recommendation = (
                "both"
                if len(recommendation_types) == 2 and set(recommendation_types) == {"cardio", "strength"}
                else "+".join(recommendation_types)
            )

        # Serialization payloads
        cardio_goal_data = (
            CardioProgressionSerializer(next_cardio_progression).data if next_cardio_progression else None
        )
        strength_goal_data = (
            StrengthProgressionSerializer(next_strength_goal).data if next_strength_goal else None
        )
        supplemental_routine_data = (
            SupplementalRoutineSerializer(next_supplemental).data if next_supplemental else None
        )

        supplemental_workout_data = None
        if next_supplemental:
            ry = getattr(next_supplemental, "rest_yellow_start_seconds", 60)
            rr = getattr(next_supplemental, "rest_red_start_seconds", 90)
            supplemental_workout_data = {
                "id": None,
                "routine": supplemental_routine_data,
                "workout": {"id": None, "name": "3 Max Sets"},
                "description": (
                    f"Do three maximum effort sets. Rest {ry}-{rr} seconds between each set. "
                    "As soon as you stop (even for one second), that set is complete."
                ),
            }

        cardio_pick = {
            "type": "cardio",
            "label": "Cardio",
            "name": getattr(next_cardio, "name", None) or "Cardio session",
            "workout": CardioWorkoutSerializer(next_cardio).data if next_cardio else None,
            "goal": cardio_goal_data,
        }
        strength_pick = {
            "type": "strength",
            "label": "Strength",
            "name": getattr(next_strength, "name", None) or "Strength session",
            "routine": StrengthRoutineSerializer(next_strength).data if next_strength else None,
            "goal": strength_goal_data,
        }
        supplemental_pick = {
            "type": "supplemental",
            "label": "Supplemental",
            "name": getattr(next_supplemental, "name", None) or "3 Max Sets",
            "routine": supplemental_routine_data,
            "workout": supplemental_workout_data,
        }
        rest_pick = {
            "type": "rest",
            "label": "Rest",
            "name": "Rest Day",
            "notes": "You're ahead of plan; take a rest day or choose whatever feels best.",
        }

        def needs_training(t: str) -> bool:
            return type_info[t]["eligible"] and type_info[t]["delta"] > 0

        # Picks selection (max 2), respecting priority + sprint day coupling
        selected_types: List[str] = []
        for t in priority_order:
            if t == "cardio" and needs_training("cardio"):
                selected_types.append("cardio")
                if is_sprint_day and needs_training("strength") and "strength" not in selected_types:
                    selected_types.append("strength")
                elif supplemental_eligible and "supplemental" not in selected_types:
                    selected_types.append("supplemental")

            elif t == "strength" and needs_training("strength"):
                selected_types.append("strength")
                if supplemental_eligible and "supplemental" not in selected_types:
                    selected_types.append("supplemental")

            elif t == "supplemental" and needs_training("supplemental"):
                selected_types.append("supplemental")

            if len(selected_types) >= 2:
                break

        if len(selected_types) < 2:
            for t in priority_order:
                if not type_info[t]["eligible"]:
                    continue
                if t not in selected_types:
                    selected_types.append(t)
                if len(selected_types) >= 2:
                    break

        if not selected_types:
            selected_types = ["rest"]

        selected_types = selected_types[:2]

        type_to_pick = {
            "cardio": cardio_pick,
            "strength": strength_pick,
            "supplemental": supplemental_pick,
            "rest": rest_pick,
        }
        picks_payload = [dict(type_to_pick[t]) for t in selected_types if t in type_to_pick]

        return Response(
            {
                "program": cardio_program.name,
                "cardio_plan_non_rest": cardio_plan_non_rest,
                "strength_plan_non_rest": strength_plan_non_rest,
                "supplemental_plan_non_rest": supplemental_plan_non_rest,
                "cardio_done_last7": r3(done_by_type["cardio"]),
                "strength_done_last7": r3(done_by_type["strength"]),
                "supplemental_done_last7": r3(done_by_type["supplemental"]),
                "delta_cardio": r3(delta_by_type["cardio"]),
                "delta_strength": r3(delta_by_type["strength"]),
                "delta_supplemental": r3(delta_by_type["supplemental"]),
                "pct_cardio": r3(pct_by_type["cardio"]),
                "pct_strength": r3(pct_by_type["strength"]),
                "pct_supplemental": r3(pct_by_type["supplemental"]),
                "next_cardio_is_rest": next_cardio_is_rest,
                "cardio_eligible": cardio_eligible,
                "strength_eligible": strength_eligible,
                "supplemental_eligible": supplemental_eligible,
                "recommendation": recommendation,
                "recommendation_types": recommendation_types,
                "picks": picks_payload,
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


class SupplementalGoalView(APIView):
    """
    GET /api/supplemental/goal/?routine_id=ID
    Returns the per-set targets to beat (max in last 6 months).
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

        target = get_supplemental_goal_target(rid)
        return Response(
            {
                "routine_id": rid,
                "target_to_beat": target,
            },
            status=status.HTTP_200_OK,
        )


class StrengthRepsPerHourGoalView(APIView):
    """Return reps-per-hour goals and estimated minutes for a routine."""
    permission_classes = [permissions.AllowAny]

    def get(self, request, *args, **kwargs):
        routine_id = request.query_params.get("routine_id")
        volume = request.query_params.get("volume")
        if routine_id is None or volume is None:
            return Response(
                {"detail": "routine_id and volume are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            rid = int(routine_id)
            vol = float(volume)
        except ValueError:
            return Response(
                {"detail": "routine_id must be integer and volume must be numeric."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        rph_goal, rph_goal_avg = get_reps_per_hour_goal_for_routine(
            rid,
            total_volume_input=vol,
        )
        max_reps_goal = get_max_reps_goal_for_routine(rid, vol)
        max_weight_goal = get_max_weight_goal_for_routine(rid, vol)

        def minutes_for(rate: float) -> float:
            if not rate:
                return 0.0
            return (vol / rate) * 60.0

        minutes_max = minutes_for(rph_goal)
        minutes_avg = minutes_for(rph_goal_avg)

        return Response(
            {
                "rph_goal": rph_goal,
                "rph_goal_avg": rph_goal_avg,
                "max_reps_goal": max_reps_goal,
                "max_weight_goal": max_weight_goal,
                "minutes_max": round(minutes_max, 2),
                "minutes_avg": round(minutes_avg, 2),
                "hours_max": round(minutes_max / 60.0, 2) if minutes_max else 0.0,
                "hours_avg": round(minutes_avg / 60.0, 2) if minutes_avg else 0.0,
                "volume": vol,
            },
            status=status.HTTP_200_OK,
        )


class StrengthProgressionsListView(APIView):
    """
    GET /api/strength/progressions/?routine_id=ID
    Returns all progression rows for the routine (from Vw_Strength_Progression),
    ordered by progression_order.
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

        try:
            routine = StrengthRoutine.objects.get(pk=rid)
        except StrengthRoutine.DoesNotExist:
            return Response({"detail": "Routine not found."}, status=status.HTTP_404_NOT_FOUND)

        qs = VwStrengthProgression.objects.filter(routine_name=routine.name).order_by("progression_order")
        data = StrengthProgressionSerializer(qs, many=True).data
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

def _build_mph_goal_payload(workout: CardioWorkout, input_val: float, mph_goal: float, mph_goal_avg: float) -> Dict[str, Any]:
    """
    Shared helper to compute converted miles/time payloads for MPH goals.
    Mirrors the original CardioMPHGoalView calculations.
    """
    display_val = input_val
    routine_name = getattr(getattr(workout, "routine", None), "name", "")
    if isinstance(routine_name, str) and routine_name.lower() == "sprints":
        display_val = 1.0

    unit = getattr(workout, "unit", None)
    unit_type_val = getattr(getattr(unit, "unit_type", None), "name", "")
    unit_type = unit_type_val.lower() if isinstance(unit_type_val, str) else ""
    num = float(getattr(unit, "mile_equiv_numerator", 0.0) or 0.0)
    den = float(getattr(unit, "mile_equiv_denominator", 1.0) or 1.0)
    miles_per_unit = (num / den) if den else 0.0

    distance_payload: Dict[str, Any] = {}
    minutes_int = 0
    seconds = 0

    if unit_type == "time":
        minutes_total = display_val
        miles_max = mph_goal * (minutes_total / 60.0)
        miles_avg = mph_goal_avg * (minutes_total / 60.0)
        distance_payload.update({
            "miles": round(miles_max, 2),
            "miles_max": round(miles_max, 2),
            "miles_avg": round(miles_avg, 2),
        })
        minutes_int = int(minutes_total)
        seconds = round((minutes_total - minutes_int) * 60.0, 0)
        minutes_int_avg = int(minutes_total)
        seconds_avg = seconds
    else:
        miles = display_val * miles_per_unit
        minutes_total_max = (miles / mph_goal) * 60.0 if mph_goal else 0.0
        minutes_total_avg = (miles / mph_goal_avg) * 60.0 if mph_goal_avg else 0.0

        minutes_int = int(minutes_total_max)
        seconds = round((minutes_total_max - minutes_int) * 60.0, 0)

        minutes_int_avg = int(minutes_total_avg)
        seconds_avg = round((minutes_total_avg - minutes_int_avg) * 60.0, 0)

        distance_payload.update({
            "miles": round(miles, 3),
            "distance": round(display_val, 2),
            "minutes_max": minutes_int,
            "seconds_max": seconds,
            "minutes_avg": minutes_int_avg,
            "seconds_avg": seconds_avg,
        })

    goal_time_goal = None
    goal_time_goal_avg = None
    try:
        goal_distance_val = float(getattr(workout, "goal_distance", 0.0) or 0.0)
    except Exception:
        goal_distance_val = 0.0

    if goal_distance_val and goal_distance_val > 0:
        if unit_type == "distance" and miles_per_unit > 0:
            miles_target = goal_distance_val * miles_per_unit
            try:
                if mph_goal:
                    goal_time_goal = round((miles_target / float(mph_goal)) * 60.0, 2)
                if mph_goal_avg:
                    goal_time_goal_avg = round((miles_target / float(mph_goal_avg)) * 60.0, 2)
            except Exception:
                goal_time_goal = None
                goal_time_goal_avg = None
        elif unit_type == "time":
            goal_time_goal = round(goal_distance_val, 2)
            goal_time_goal_avg = round(goal_distance_val, 2)

    unit_name_val = getattr(unit, "name", None)
    unit_name = unit_name_val if isinstance(unit_name_val, str) else None
    return {
        "mph_goal": mph_goal,
        "mph_goal_avg": mph_goal_avg,
        "goal_time_goal": goal_time_goal,
        "goal_time_goal_avg": goal_time_goal_avg,
        **distance_payload,
        "minutes": minutes_int,
        "seconds": seconds,
        "unit_type": unit_type,
        "unit_name": unit_name,
    }

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
            input_val = float(value)
        except ValueError:
            return Response(
                {"detail": "workout_id must be integer and value must be numeric."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        workout = get_object_or_404(
            CardioWorkout.objects.select_related("unit", "unit__unit_type", "routine"),
            pk=wid,
        )
        mph_res = get_mph_goal_for_workout(wid, total_completed_input=input_val)
        mph_goal, mph_goal_avg = mph_res[0], mph_res[1]
        payload = _build_mph_goal_payload(workout, input_val, mph_goal, mph_goal_avg)
        return Response(payload, status=status.HTTP_200_OK)


class CardioGoalDebugView(APIView):
    """Return debug context for cardio progression goal and MPH goal selection."""

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
            input_val = float(value)
        except ValueError:
            return Response(
                {"detail": "workout_id must be integer and value must be numeric."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        workout = get_object_or_404(
            CardioWorkout.objects.select_related("unit", "unit__unit_type", "routine"),
            pk=wid,
        )

        prog_obj, prog_meta = get_next_progression_for_workout(wid, return_debug=True)
        if not isinstance(prog_meta, dict):
            prog_meta = {}
        progression_payload = {
            "progression_id": getattr(prog_obj, "id", None) if prog_obj else None,
            "progression": float(getattr(prog_obj, "progression", 0.0)) if prog_obj is not None else None,
            **prog_meta,
        }

        mph_goal, mph_goal_avg, mph_debug = get_mph_goal_for_workout(
            wid,
            total_completed_input=input_val,
            return_debug=True,
        )
        conversion_payload = _build_mph_goal_payload(workout, input_val, mph_goal, mph_goal_avg)
        mph_payload = {
            **mph_debug,
            "conversion": conversion_payload,
            "mph_goal": mph_goal,
            "mph_goal_avg": mph_goal_avg,
            "strategy": getattr(workout, "mph_goal_strategy", None),
        }

        workout_payload = {
            "id": workout.id,
            "name": getattr(workout, "name", None),
            "routine": getattr(getattr(workout, "routine", None), "name", None),
            "unit": getattr(getattr(workout, "unit", None), "name", None),
            "goal_distance": getattr(workout, "goal_distance", None),
            "mph_goal_strategy": getattr(workout, "mph_goal_strategy", None),
        }

        return Response(
            {
                "workout": workout_payload,
                "goal_value": input_val,
                "progression": progression_payload,
                "mph_goal": mph_payload,
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
        # Debounced singleton ensures we don't aggressively run this every call
        RestBackfillService.instance().ensure_backfilled()

        weeks = int(self.request.query_params.get("weeks", 8))
        since = timezone.now() - timedelta(weeks=weeks)
        return (
            CardioDailyLog.objects
            .filter(datetime_started__gte=since)
            .select_related("workout", "workout__routine")
            .prefetch_related("details", "details__exercise")
            .order_by("-datetime_started")
        )


class CardioBackfillAllGapsView(APIView):
    """
    POST /api/cardio/backfill/all/
    Inserts 'Rest' day logs for every historical gap > 40 hours between
    consecutive cardio logs, and from the last log up to now.

    Response: { created_count: int, created: [ {id, datetime_started} ... ] }
    """
    permission_classes = [permissions.AllowAny]

    @transaction.atomic
    def post(self, request, *args, **kwargs):
        now = timezone.now()
        # First, backfill missing Rest days across history
        created = backfill_all_rest_day_gaps(now=now)
        # Then, clean up any Rest logs that share a day with non-Rest activity
        deleted = delete_rest_on_days_with_activity(now=now)
        payload = {
            "created_count": len(created),
            "created": [
                {"id": obj.id, "datetime_started": obj.datetime_started}
                for obj in created
            ],
            # New fields (backward-compatible): number of deleted Rest logs
            "deleted_rest_count": len(deleted),
            "deleted_rest": [
                {"id": d["id"], "datetime_started": d["datetime_started"]}
                for d in deleted
            ],
        }
        return Response(payload, status=status.HTTP_200_OK)

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
        # Track first-detail timestamp to align daily log start time
        had_existing = log.details.exists()
        first_detail_dt = None
        for payload in items:
            ser = CardioDailyLogDetailCreateSerializer(data=payload)
            ser.is_valid(raise_exception=True)
            vd = ser.validated_data
            to_create.append(CardioDailyLogDetail(log=log, **vd))
            try:
                dt = vd.get("datetime")
                if dt is not None and (first_detail_dt is None or dt < first_detail_dt):
                    first_detail_dt = dt
            except Exception:
                pass

        # insert once
        CardioDailyLogDetail.objects.bulk_create(to_create)

        # recompute mph and log aggregates
        recompute_log_aggregates(log.id)

        # If these were the first details for this log, align log start time
        if not had_existing and first_detail_dt is not None:
            CardioDailyLog.objects.filter(pk=log.pk).update(datetime_started=first_detail_dt)

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



class SupplementalLogsRecentView(ListAPIView):
    """GET /api/supplemental/logs/?weeks=8"""
    permission_classes = [permissions.AllowAny]
    serializer_class = SupplementalDailyLogSerializer

    def get_queryset(self):
        weeks = int(self.request.query_params.get("weeks", 8))
        since = timezone.now() - timedelta(weeks=weeks)
        return (
            SupplementalDailyLog.objects
            .filter(datetime_started__gte=since)
            .select_related("routine")
            .prefetch_related("details")
            .order_by("-datetime_started")
        )

class StrengthLogRetrieveView(APIView):
    """GET/PATCH /api/strength/log/<id>/"""
    permission_classes = [permissions.AllowAny]

    def get(self, request, pk, *args, **kwargs):
        detail_prefetch = Prefetch(
            "details",
            queryset=(
                StrengthDailyLogDetail.objects
                .select_related("exercise")
                .order_by("-datetime", "-pk")
            ),
        )
        log = get_object_or_404(
            StrengthDailyLog.objects
            .select_related("routine")
            .prefetch_related(detail_prefetch),
            pk=pk,
        )
        return Response(StrengthDailyLogSerializer(log).data, status=status.HTTP_200_OK)
    @transaction.atomic
    def patch(self, request, pk, *args, **kwargs):

        log = get_object_or_404(StrengthDailyLog, pk=pk)
        ser = StrengthDailyLogUpdateSerializer(log, data=request.data, partial=True)
        if ser.is_valid():
            ser.save()
            detail_prefetch = Prefetch(
                "details",
                queryset=(
                    StrengthDailyLogDetail.objects
                    .select_related("exercise")
                    .order_by("-datetime", "-pk")
                ),
            )
            log = (
                StrengthDailyLog.objects
                .select_related("routine")
                .prefetch_related(detail_prefetch)
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
        had_existing = log.details.exists()
        first_detail_dt = None
        for payload in items:
            ser = StrengthDailyLogDetailCreateSerializer(data=payload)
            ser.is_valid(raise_exception=True)
            vd = ser.validated_data
            to_create.append(StrengthDailyLogDetail(log=log, **vd))
            try:
                dt = vd.get("datetime")
                if dt is not None and (first_detail_dt is None or dt < first_detail_dt):
                    first_detail_dt = dt
            except Exception:
                pass

        StrengthDailyLogDetail.objects.bulk_create(to_create)
        recompute_strength_log_aggregates(log.id)
        if not had_existing and first_detail_dt is not None:
            StrengthDailyLog.objects.filter(pk=log.pk).update(datetime_started=first_detail_dt)
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
            detail_prefetch = Prefetch(
                "details",
                queryset=(
                    StrengthDailyLogDetail.objects
                    .select_related("exercise")
                    .order_by("-datetime", "-pk")
                ),
            )
            log = (
                StrengthDailyLog.objects
                .select_related("routine")
                .prefetch_related(detail_prefetch)
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
        # Optional per-exercise filter
        ex_id = request.query_params.get("exercise_id")
        details_qs = log.details.all()
        if ex_id is not None:
            try:
                ex_id_int = int(ex_id)
                details_qs = details_qs.filter(exercise_id=ex_id_int)
            except ValueError:
                details_qs = details_qs.none()
        detail = details_qs.order_by("-datetime").first()
        if detail is None:
            prev_log = (
                StrengthDailyLog.objects
                .filter(routine=log.routine)
                .exclude(pk=log.pk)
                .order_by("-datetime_started")
                .first()
            )
            if prev_log:
                prev_details = prev_log.details.all()
                if ex_id is not None:
                    try:
                        ex_id_int = int(ex_id)
                        prev_details = prev_details.filter(exercise_id=ex_id_int)
                    except ValueError:
                        prev_details = prev_details.none()
                detail = prev_details.order_by("-datetime").first()

        # Final fallback: any historical set for this exercise across logs
        if detail is None and ex_id is not None:
            try:
                ex_id_int = int(ex_id)
                detail = (
                    StrengthDailyLogDetail.objects
                    .filter(exercise_id=ex_id_int)
                    .order_by("-datetime", "-pk")
                    .first()
                )
            except ValueError:
                detail = None

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



class LogSupplementalView(APIView):
    """POST /api/supplemental/log/"""
    permission_classes = [permissions.AllowAny]

    @transaction.atomic
    def post(self, request, *args, **kwargs):
        serializer = SupplementalDailyLogCreateSerializer(data=request.data)
        if serializer.is_valid():
            log = serializer.save()
            return Response(SupplementalDailyLogSerializer(log).data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

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



class SupplementalRoutineListView(ListAPIView):
    """Return supplemental routines."""
    permission_classes = [permissions.AllowAny]
    serializer_class = SupplementalRoutineSerializer

    def get_queryset(self):
        return SupplementalRoutine.objects.all().order_by("name")


class SupplementalWorkoutDescriptionListView(APIView):
    """
    Return a synthetic supplemental workout description for compatibility.
    """
    permission_classes = [permissions.AllowAny]

    def get(self, request, *args, **kwargs):
        rid = request.query_params.get("routine_id")
        routine = None
        if rid:
            try:
                routine = SupplementalRoutine.objects.filter(pk=int(rid)).first()
            except (TypeError, ValueError):
                routine = None
        if routine is None:
            routine = SupplementalRoutine.objects.order_by("name").first()
        if routine is None:
            return Response([], status=status.HTTP_200_OK)
        ry = getattr(routine, "rest_yellow_start_seconds", 60)
        rr = getattr(routine, "rest_red_start_seconds", 90)
        payload = {
            "id": None,
            "routine": SupplementalRoutineSerializer(routine).data,
            "workout": {"id": None, "name": "3 Max Sets"},
            "description": f"Do three maximum effort sets. Rest {ry}-{rr} seconds between each set. As soon as you stop (even for one second), that set is complete.",
            "goal_metric": "Max Sets",
        }
        return Response([payload], status=status.HTTP_200_OK)


class SupplementalLogRetrieveView(APIView):
    """GET/PATCH /api/supplemental/log/<id>/"""
    permission_classes = [permissions.AllowAny]

    def get(self, request, pk, *args, **kwargs):
        detail_prefetch = Prefetch(
            "details",
            queryset=SupplementalDailyLogDetail.objects.order_by("-datetime", "-pk"),
        )
        log = get_object_or_404(
            SupplementalDailyLog.objects.select_related("routine").prefetch_related(detail_prefetch),
            pk=pk,
        )
        return Response(SupplementalDailyLogSerializer(log).data, status=status.HTTP_200_OK)

    @transaction.atomic
    def patch(self, request, pk, *args, **kwargs):
        log = get_object_or_404(SupplementalDailyLog, pk=pk)
        ser = SupplementalDailyLogUpdateSerializer(log, data=request.data, partial=True)
        if ser.is_valid():
            ser.save()
            recompute_supplemental_log_aggregates(pk)
            detail_prefetch = Prefetch(
                "details",
                queryset=SupplementalDailyLogDetail.objects.order_by("-datetime", "-pk"),
            )
            log = (
                SupplementalDailyLog.objects
                .select_related("routine")
                .prefetch_related(detail_prefetch)
                .get(pk=pk)
            )
            return Response(SupplementalDailyLogSerializer(log).data, status=status.HTTP_200_OK)
        return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)


class SupplementalLogDetailsCreateView(APIView):
    """POST /api/supplemental/log/<id>/details/"""
    permission_classes = [permissions.AllowAny]

    @transaction.atomic
    def post(self, request, pk, *args, **kwargs):
        log = get_object_or_404(SupplementalDailyLog, pk=pk)
        items = request.data.get("details") or []
        if not isinstance(items, list) or len(items) == 0:
            return Response({"detail": "details must be a non-empty list."}, status=status.HTTP_400_BAD_REQUEST)

        to_create = []
        had_existing = log.details.exists()
        first_detail_dt = None
        next_set_number = (
            log.details.aggregate(max_num=Max("set_number")).get("max_num")
            or log.details.count()
        )
        for payload in items:
            ser = SupplementalDailyLogDetailCreateSerializer(data=payload)
            ser.is_valid(raise_exception=True)
            vd = ser.validated_data
            set_num = vd.get("set_number")
            if not set_num:
                next_set_number += 1
                set_num = next_set_number
            try:
                set_num_int = int(set_num)
            except (TypeError, ValueError):
                set_num_int = next_set_number
            if set_num_int > 3:
                return Response({"detail": "Only 3 sets are allowed for supplemental sessions."}, status=status.HTTP_400_BAD_REQUEST)
            vd["set_number"] = max(1, set_num_int)
            to_create.append(SupplementalDailyLogDetail(log=log, **vd))
            dt = vd.get("datetime")
            if dt is not None and (first_detail_dt is None or dt < first_detail_dt):
                first_detail_dt = dt

        SupplementalDailyLogDetail.objects.bulk_create(to_create)
        recompute_supplemental_log_aggregates(log.id)
        if not had_existing and first_detail_dt is not None:
            SupplementalDailyLog.objects.filter(pk=log.pk).update(datetime_started=first_detail_dt)
        detail_prefetch = Prefetch(
            "details",
            queryset=SupplementalDailyLogDetail.objects.order_by("-datetime", "-pk"),
        )
        log = (
            SupplementalDailyLog.objects
            .select_related("routine")
            .prefetch_related(detail_prefetch)
            .get(pk=pk)
        )
        return Response(SupplementalDailyLogSerializer(log).data, status=status.HTTP_201_CREATED)


class SupplementalLogDetailUpdateView(APIView):
    """PATCH /api/supplemental/log/<id>/details/<detail_id>/"""
    permission_classes = [permissions.AllowAny]

    @transaction.atomic
    def patch(self, request, pk, detail_id, *args, **kwargs):
        detail = get_object_or_404(SupplementalDailyLogDetail, pk=detail_id, log_id=pk)
        ser = SupplementalDailyLogDetailUpdateSerializer(detail, data=request.data, partial=True)
        if ser.is_valid():
            set_num = ser.validated_data.get("set_number")
            if set_num is not None:
                try:
                    set_num_int = int(set_num)
                except (TypeError, ValueError):
                    return Response({"detail": "set_number must be an integer between 1 and 3."}, status=status.HTTP_400_BAD_REQUEST)
                if set_num_int < 1 or set_num_int > 3:
                    return Response({"detail": "Only 3 sets are allowed for supplemental sessions."}, status=status.HTTP_400_BAD_REQUEST)
            ser.save()
            recompute_supplemental_log_aggregates(pk)
            detail_prefetch = Prefetch(
                "details",
                queryset=SupplementalDailyLogDetail.objects.order_by("-datetime", "-pk"),
            )
            log = (
                SupplementalDailyLog.objects
                .select_related("routine")
                .prefetch_related(detail_prefetch)
                .get(pk=pk)
            )
            return Response(SupplementalDailyLogSerializer(log).data, status=status.HTTP_200_OK)
        return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)


class SupplementalLogDestroyView(APIView):
    """DELETE /api/supplemental/log/<id>/"""
    permission_classes = [permissions.AllowAny]

    @transaction.atomic
    def delete(self, request, pk, *args, **kwargs):
        log = get_object_or_404(SupplementalDailyLog, pk=pk)
        log.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class SupplementalLogDetailDestroyView(APIView):
    """DELETE /api/supplemental/log/<id>/details/<detail_id>/"""
    permission_classes = [permissions.AllowAny]

    @transaction.atomic
    def delete(self, request, pk, detail_id, *args, **kwargs):
        detail = get_object_or_404(SupplementalDailyLogDetail, pk=detail_id, log_id=pk)
        log_id = detail.log_id
        detail.delete()
        recompute_supplemental_log_aggregates(log_id)
        return Response(status=status.HTTP_204_NO_CONTENT)

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













