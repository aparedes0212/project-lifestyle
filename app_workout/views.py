# app_workout/views.py
from typing import Any, Dict, List
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status, permissions
from django.db import transaction
from django.db.models import F, Prefetch, Max
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
    SupplementalRoutine,
    VwStrengthProgression,
)
from .serializers import (
    CardioRoutineSerializer,
    CardioWorkoutSerializer,
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
    SupplementalRoutineSerializer,
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
    get_next_supplemental_routine,
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
from django.db.models.functions import TruncDate
from django.shortcuts import get_object_or_404

from .signals import recompute_log_aggregates, recompute_strength_log_aggregates
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
    """Return daily training recommendation across cardio, strength, and supplemental."""
    permission_classes = [permissions.AllowAny]

    def get(self, request, *args, **kwargs):
        now = timezone.now()
        RestBackfillService.instance().ensure_backfilled(now=now)

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

        strength_plan_non_rest = 3 #DO NOT CHANGE EVER
        supplemental_plan_non_rest = 5 #DO NOT CHANGE EVER

        since = now - timedelta(days=7)

        cardio_done_qs = (
            CardioDailyLog.objects
            .filter(datetime_started__gte=since)
            .exclude(workout__routine__name__iexact="Rest")
        )
        # Sum per-log completion ratio (total_completed / goal)
        cardio_done = 0.0
        for log in cardio_done_qs.only("goal", "total_completed"):
            try:
                goal_val = float(log.goal or 0.0)
                comp_val = float(log.total_completed or 0.0)
            except (TypeError, ValueError):
                goal_val = 0.0
                comp_val = 0.0
            if goal_val > 0 and comp_val > 0:
                cardio_done += comp_val / goal_val

        strength_done_qs = (
            StrengthDailyLog.objects
            .filter(datetime_started__gte=since)
            .exclude(rep_goal__isnull=True)
            .exclude(total_reps_completed__isnull=True)
        )
        # Sum per-log completion ratio (total_reps_completed / rep_goal)
        strength_done = 0.0
        for log in strength_done_qs.only("rep_goal", "total_reps_completed"):
            try:
                goal_val = float(log.rep_goal or 0.0)
                comp_val = float(log.total_reps_completed or 0.0)
            except (TypeError, ValueError):
                goal_val = 0.0
                comp_val = 0.0
            if goal_val > 0 and comp_val > 0:
                strength_done += comp_val / goal_val

        supplemental_done_qs = (
            SupplementalDailyLog.objects
            .filter(datetime_started__gte=since)
            .exclude(routine__name__iexact="Rest")
        )
        # Supplemental logs have a textual goal; attempt numeric ratio if possible, else treat as 1 per log
        supplemental_done = 0.0
        for log in supplemental_done_qs.only("goal", "total_completed"):
            ratio = 1.0
            try:
                goal_val = float(log.goal) if log.goal is not None else None
                comp_val = float(log.total_completed or 0.0)
                if goal_val is not None and goal_val > 0 and comp_val > 0:
                    ratio = comp_val / goal_val
            except (TypeError, ValueError):
                # Non-numeric goal; default to counting the session as 1
                ratio = 1.0
            supplemental_done += ratio

        delta_cardio = max(0, cardio_plan_non_rest - cardio_done)
        delta_strength = max(0, strength_plan_non_rest - strength_done)
        delta_supplemental = max(0, supplemental_plan_non_rest - supplemental_done)

        def pct(done: float, plan: int) -> float:
            if plan <= 0:
                return 1.0
            val = done / float(plan)
            if val < 0.0:
                return 0.0
            return val

        pct_cardio = pct(cardio_done, cardio_plan_non_rest)
        pct_strength = pct(strength_done, strength_plan_non_rest)
        pct_supplemental = pct(supplemental_done, supplemental_plan_non_rest)

        # Prepare rounded display values (3 decimals)
        cardio_done_out = round(float(cardio_done), 3)
        strength_done_out = round(float(strength_done), 3)
        supplemental_done_out = round(float(supplemental_done), 3)
        delta_cardio_out = round(float(delta_cardio), 3)
        delta_strength_out = round(float(delta_strength), 3)
        delta_supplemental_out = round(float(delta_supplemental), 3)
        pct_cardio_out = round(float(pct_cardio), 3)
        pct_strength_out = round(float(pct_strength), 3)
        pct_supplemental_out = round(float(pct_supplemental), 3)

        next_cardio, next_cardio_progression, _ = get_next_cardio_workout()
        next_cardio_is_rest = bool(
            next_cardio and getattr(getattr(next_cardio, "routine", None), "name", "").lower() == "rest"
        )
        cardio_eligible = cardio_plan_non_rest > 0 and not next_cardio_is_rest

        since24 = now - timedelta(hours=24)
        strength_done_last24 = (
            strength_done_qs
            .annotate(datetime_ended=Max("details__datetime"))
            .filter(datetime_ended__gte=since24)
            .exists()
        )
        next_strength, next_strength_goal, _ = get_next_strength_routine()
        strength_eligible = strength_plan_non_rest > 0 and not strength_done_last24

        supplemental_done_last24 = supplemental_done_qs.filter(datetime_started__gte=since24).exists()
        next_supplemental, _ = get_next_supplemental_routine()
        supplemental_eligible = supplemental_plan_non_rest > 0 and not supplemental_done_last24

        type_info = {
            "cardio": {
                "plan": cardio_plan_non_rest,
                "done": cardio_done,
                "delta": delta_cardio,
                "pct": pct_cardio,
                "eligible": cardio_eligible,
            },
            "strength": {
                "plan": strength_plan_non_rest,
                "done": strength_done,
                "delta": delta_strength,
                "pct": pct_strength,
                "eligible": strength_eligible,
            },
            "supplemental": {
                "plan": supplemental_plan_non_rest,
                "done": supplemental_done,
                "delta": delta_supplemental,
                "pct": pct_supplemental,
                "eligible": supplemental_eligible,
            },
        }

        required_cardio_strength = type_info["cardio"]["plan"] + type_info["strength"]["plan"]
        multi_required = max(0, required_cardio_strength - 7)

        day_sets = {}
        for day in cardio_done_qs.annotate(day=TruncDate("datetime_started")).values_list("day", flat=True):
            day_sets.setdefault(day, set()).add("cardio")
        for day in strength_done_qs.annotate(day=TruncDate("datetime_started")).values_list("day", flat=True):
            day_sets.setdefault(day, set()).add("strength")
        for day in supplemental_done_qs.annotate(day=TruncDate("datetime_started")).values_list("day", flat=True):
            day_sets.setdefault(day, set()).add("supplemental")

        multi_completed = sum(max(0, len(labels) - 1) for labels in day_sets.values())
        multi_remaining = max(0, multi_required - multi_completed)

        eligible_info = {k: v for k, v in type_info.items() if v["eligible"]}

        def sort_key(key: str):
            info = type_info[key]
            return (-info["delta"], info["pct"], key)

        recommendation_types: List[str] = []
        sorted_types: List[str] = []
        behind_sorted: List[str] = []
        if eligible_info:
            sorted_types = sorted(eligible_info.keys(), key=sort_key)
            behind_sorted = [t for t in sorted_types if type_info[t]["delta"] > 0]

            if multi_required > 0 and len(behind_sorted) >= 2:
                take = min(2, len(behind_sorted))
                recommendation_types = behind_sorted[:take]
            elif behind_sorted:
                recommendation_types = [behind_sorted[0]]
            else:
                min_pct = min(type_info[t]["pct"] for t in sorted_types)
                recommendation_types = [t for t in sorted_types if abs(type_info[t]["pct"] - min_pct) <= 1e-9]
                if len(recommendation_types) == len(sorted_types) and min_pct >= 1.0:
                    recommendation_types = []

        if len(recommendation_types) > 2:
            recommendation_types = recommendation_types[:2]

        if not eligible_info:
            recommendation = "rest"
        elif not recommendation_types:
            if all(type_info[t]["pct"] >= 1.0 for t in eligible_info):
                recommendation = "rest"
            else:
                recommendation = "tie"
        else:
            if len(recommendation_types) == 2 and set(recommendation_types) == {"cardio", "strength"}:
                recommendation = "both"
            else:
                recommendation = "+".join(recommendation_types)

        cardio_goal_data = (
            CardioProgressionSerializer(next_cardio_progression).data
            if next_cardio_progression
            else None
        )
        strength_goal_data = (
            StrengthProgressionSerializer(next_strength_goal).data
            if next_strength_goal
            else None
        )
        supplemental_routine_data = (
            SupplementalRoutineSerializer(next_supplemental).data
            if next_supplemental
            else None
        )

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
            "name": getattr(next_supplemental, "name", None) or "Supplemental session",
            "routine": supplemental_routine_data,
        }
        rest_pick = {
            "type": "rest",
            "label": "Rest",
            "name": "Rest Day",
            "notes": "You're ahead of plan; take a rest day or choose whatever feels best.",
        }

        cardio_needs_today = cardio_eligible and type_info["cardio"]["delta"] > 0
        strength_needs_today = strength_eligible and type_info["strength"]["delta"] > 0

        routine_name = getattr(getattr(next_cardio, "routine", None), "name", "") or ""
        normalized_routine_name = routine_name.lower()
        is_5k_prep_day = "5k" in normalized_routine_name or "5 k" in normalized_routine_name
        is_sprint_day = "sprint" in normalized_routine_name

        if cardio_needs_today:
            if is_5k_prep_day:
                selected_types = ["cardio", "supplemental"]
            elif is_sprint_day and strength_needs_today:
                selected_types = ["cardio", "strength"]
            else:
                selected_types = ["cardio", "supplemental"]
        elif strength_needs_today:
            selected_types = ["strength", "supplemental"]
        else:
            selected_types = ["supplemental", "supplemental"]

        type_to_pick = {
            "cardio": cardio_pick,
            "strength": strength_pick,
            "supplemental": supplemental_pick,
            "rest": rest_pick,
        }
        picks_payload = [dict(type_to_pick[t]) for t in selected_types if t in type_to_pick]

        return Response(
            {
                "program": program.name,
                "cardio_plan_non_rest": cardio_plan_non_rest,
                "strength_plan_non_rest": strength_plan_non_rest,
                "supplemental_plan_non_rest": supplemental_plan_non_rest,
                "cardio_done_last7": cardio_done_out,
                "strength_done_last7": strength_done_out,
                "supplemental_done_last7": supplemental_done_out,
                "delta_cardio": delta_cardio_out,
                "delta_strength": delta_strength_out,
                "delta_supplemental": delta_supplemental_out,
                "pct_cardio": pct_cardio_out,
                "pct_strength": pct_strength_out,
                "pct_supplemental": pct_supplemental_out,
                "double_required_per_week": multi_required,
                "double_completed_last7": multi_completed,
                "double_remaining": multi_remaining,
                "multi_required_per_week": multi_required,
                "multi_completed_last7": multi_completed,
                "multi_remaining": multi_remaining,
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
        display_val = input_val
        if workout.routine.name.lower() == "sprints":
            display_val = 1.0
        mph_goal, mph_goal_avg = get_mph_goal_for_workout(wid, total_completed_input=input_val)

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
            minutes_total = display_val
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
            miles = display_val * miles_per_unit
            minutes_total_max = (miles / mph_goal) * 60.0 if mph_goal else 0.0
            minutes_total_avg = (miles / mph_goal_avg) * 60.0 if mph_goal_avg else 0.0

            # Backward-compat: original fields reflect Max-based computation
            minutes_int = int(minutes_total_max)
            seconds = round((minutes_total_max - minutes_int) * 60.0, 0)

            minutes_int_avg = int(minutes_total_avg)
            seconds_avg = round((minutes_total_avg - minutes_int_avg) * 60.0, 0)

            distance_payload.update({
                "distance": round(display_val, 2),
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













