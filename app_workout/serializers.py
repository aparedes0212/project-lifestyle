# app_workout/serializers.py
from rest_framework import serializers
from django.utils import timezone
from .models import (
    Program,
    CardioRoutine,
    CardioWorkout,
    CardioWorkoutRestThreshold,
    CardioProgression,
    CardioDailyLog,
    CardioDailyLogDetail,
    CardioExercise,
    CardioUnit,
    StrengthRoutine,
    StrengthExercise,
    StrengthExerciseRestThreshold,
    StrengthDailyLog,
    StrengthDailyLogDetail,
    SupplementalRoutine,
    SupplementalWorkout,
    SupplementalWorkoutDescription,
    SupplementalDailyLog,
    SupplementalDailyLogDetail,
    VwStrengthProgression,
    CardioWorkoutWarmup,
    Bodyweight,
    CardioWorkoutTMSyncPreference,
    SpecialRule,
)
from .signals import recompute_log_aggregates, recompute_strength_log_aggregates
from .services import (
    get_mph_goal_for_workout,
    get_reps_per_hour_goal_for_routine,
    get_max_reps_goal_for_routine,
    get_max_weight_goal_for_routine,
    get_supplemental_goal_target,
    get_supplemental_best_recent,
)

class ProgramSerializer(serializers.ModelSerializer):
    class Meta:
        model = Program
        fields = ["id", "name", "selected_cardio", "selected_strength", "selected_supplemental"]


class SpecialRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = SpecialRule
        fields = ["skip_marathon_prep_weekdays"]


class CardioUnitSerializer(serializers.ModelSerializer):
    speed_type = serializers.CharField(source="speed_name.speed_type")
    speed_label = serializers.CharField(source="speed_name.name")  # <-- add this
    unit_type = serializers.CharField(source="unit_type.name")

    class Meta:
        model = CardioUnit
        fields = [
            "id", "name",
            "mround_numerator", "mround_denominator",
            "mile_equiv_numerator", "mile_equiv_denominator",
            "speed_type", "speed_label", "unit_type",       # <-- include
        ]

class CardioRoutineSerializer(serializers.ModelSerializer):
    class Meta:
        model = CardioRoutine
        fields = ["id", "name"]

class CardioWorkoutSerializer(serializers.ModelSerializer):
    routine = CardioRoutineSerializer(read_only=True)
    unit = CardioUnitSerializer(read_only=True)

    class Meta:
        model = CardioWorkout
        fields = [
            "id", "name", "priority_order", "skip", "difficulty",
            "routine", "unit", "goal_distance", "mph_goal_strategy",
        ]


class CardioWorkoutGoalDistanceSerializer(serializers.ModelSerializer):
    routine_name = serializers.CharField(source="routine.name", read_only=True)
    workout_name = serializers.CharField(source="name", read_only=True)
    unit_name = serializers.CharField(source="unit.name", read_only=True)
    unit_type = serializers.CharField(source="unit.unit_type.name", read_only=True)

    class Meta:
        model = CardioWorkout
        fields = [
            "id",
            "routine_name",
            "workout_name",
            "unit_name",
            "unit_type",
            "goal_distance",
            "mph_goal_strategy",
        ]


class CardioWorkoutGoalDistanceUpdateSerializer(serializers.ModelSerializer):
    goal_distance = serializers.FloatField(min_value=0.0)

    class Meta:
        model = CardioWorkout
        fields = ["goal_distance", "mph_goal_strategy"]


class CardioWorkoutTMSyncPreferenceSerializer(serializers.ModelSerializer):
    workout = serializers.PrimaryKeyRelatedField(read_only=True)
    workout_name = serializers.CharField(source="workout.name", read_only=True)
    routine_name = serializers.CharField(source="workout.routine.name", read_only=True)

    class Meta:
        model = CardioWorkoutTMSyncPreference
        fields = ["workout", "workout_name", "routine_name", "default_tm_sync"]


class CardioWorkoutTMSyncPreferenceUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = CardioWorkoutTMSyncPreference
        fields = ["default_tm_sync"]


class CardioRestThresholdSerializer(serializers.ModelSerializer):
    workout = serializers.PrimaryKeyRelatedField(read_only=True)
    workout_name = serializers.CharField(source="workout.name", read_only=True)
    routine_name = serializers.CharField(source="workout.routine.name", read_only=True)

    class Meta:
        model = CardioWorkoutRestThreshold
        fields = [
            "workout",
            "workout_name",
            "routine_name",
            "yellow_start_seconds",
            "red_start_seconds",
            "critical_start_seconds",
        ]


class CardioRestThresholdUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = CardioWorkoutRestThreshold
        fields = ["yellow_start_seconds", "red_start_seconds", "critical_start_seconds"]

    def validate(self, attrs):
        instance = getattr(self, "instance", None)
        yellow = attrs.get("yellow_start_seconds", getattr(instance, "yellow_start_seconds", 120))
        red = attrs.get("red_start_seconds", getattr(instance, "red_start_seconds", 180))
        critical = attrs.get("critical_start_seconds", getattr(instance, "critical_start_seconds", 300))
        if not (yellow < red < critical):
            raise serializers.ValidationError("Thresholds must increase: yellow < red < critical.")
        return attrs
class CardioProgressionSerializer(serializers.ModelSerializer):
    workout = serializers.PrimaryKeyRelatedField(read_only=True)

    class Meta:
        model = CardioProgression
        fields = ["id", "workout", "progression_order", "progression"]


class CardioProgressionWriteSerializer(serializers.Serializer):
    progression_order = serializers.IntegerField(min_value=1)
    progression = serializers.FloatField()


class CardioProgressionBulkUpdateSerializer(serializers.Serializer):
    progressions = CardioProgressionWriteSerializer(many=True)

    def validate_progressions(self, value):
        orders = [item["progression_order"] for item in value]
        if len(orders) != len(set(orders)):
            raise serializers.ValidationError("progression_order values must be unique within a workout.")
        return value


# ---------- NEW: logging serializers ----------

class CardioDailyLogDetailCreateSerializer(serializers.ModelSerializer):
    # accept exercise_id instead of nested object
    exercise_id = serializers.PrimaryKeyRelatedField(
        source="exercise", queryset=CardioExercise.objects.all(), write_only=True
    )

    class Meta:
        model = CardioDailyLogDetail
        fields = [
            "datetime",
            "exercise_id",
            "running_minutes",
            "running_seconds",
            "running_miles",
            "running_mph",
            "treadmill_time_minutes",
            "treadmill_time_seconds",
        ]


class CardioDailyLogDetailUpdateSerializer(serializers.ModelSerializer):
    """Allows partial updates for an existing interval."""

    exercise_id = serializers.PrimaryKeyRelatedField(
        source="exercise", queryset=CardioExercise.objects.all(), required=False
    )

    class Meta:
        model = CardioDailyLogDetail
        fields = [
            "datetime",
            "exercise_id",
            "running_minutes",
            "running_seconds",
            "running_miles",
            "running_mph",
            "treadmill_time_minutes",
            "treadmill_time_seconds",
        ]

class CardioDailyLogDetailSerializer(serializers.ModelSerializer):
    exercise = serializers.StringRelatedField()
    class Meta:
        model = CardioDailyLogDetail
        fields = [
            "id", "datetime", "exercise",
            "running_minutes", "running_seconds", "running_miles", "running_mph",
            "treadmill_time_minutes", "treadmill_time_seconds",
        ]

class CardioDailyLogCreateSerializer(serializers.ModelSerializer):
    # accept workout_id, and an optional details array
    workout_id = serializers.PrimaryKeyRelatedField(
        source="workout", queryset=CardioWorkout.objects.all(), write_only=True
    )
    details = CardioDailyLogDetailCreateSerializer(many=True, required=False)
    mph_goal = serializers.FloatField(required=False, allow_null=True, write_only=True)
    mph_goal_avg = serializers.FloatField(required=False, allow_null=True, write_only=True)

    class Meta:
        model = CardioDailyLog
        fields = [
            "datetime_started",
            "workout_id",
            "goal",
            "total_completed",
            "max_mph",
            "avg_mph",
            "goal_time",
            "minutes_elapsed",
            "ignore",
            "details",
            "mph_goal",
            "mph_goal_avg",
        ]
        extra_kwargs = {
            "ignore": {"required": False},
        }

    def create(self, validated_data):
        details_data = validated_data.pop("details", [])
        sentinel = object()
        mph_goal_override = validated_data.pop("mph_goal", sentinel)
        mph_goal_avg_override = validated_data.pop("mph_goal_avg", sentinel)
        # Compute MPH goals from the view at time of logging
        workout = validated_data.get("workout")
        mph_goal_val = None
        mph_goal_avg_val = None
        if mph_goal_override is not sentinel and mph_goal_override is not None:
            mph_goal_val = float(mph_goal_override)
        if mph_goal_avg_override is not sentinel and mph_goal_avg_override is not None:
            mph_goal_avg_val = float(mph_goal_avg_override)

        if workout is not None and (mph_goal_val is None or mph_goal_avg_val is None):
            try:
                g, gavg = get_mph_goal_for_workout(workout.id)
                if mph_goal_val is None:
                    mph_goal_val = float(g)
                if mph_goal_avg_val is None:
                    mph_goal_avg_val = float(gavg)
            except Exception:
                mph_goal_val = None
                mph_goal_avg_val = None

        log = CardioDailyLog.objects.create(
            mph_goal=mph_goal_val,
            mph_goal_avg=mph_goal_avg_val,
            **validated_data,
        )
        if details_data:
            CardioDailyLogDetail.objects.bulk_create(
                CardioDailyLogDetail(log=log, **d) for d in details_data
            )
            recompute_log_aggregates(log.id)  # ensure aggregates are fresh
        return log

class CardioDailyLogSerializer(serializers.ModelSerializer):
    workout = CardioWorkoutSerializer(read_only=True)
    details = CardioDailyLogDetailSerializer(many=True, read_only=True)

    class Meta:
        model = CardioDailyLog
        fields = [
            "id",
            "datetime_started",
            "workout",
            "goal",
            "total_completed",
            "max_mph",
            "avg_mph",
            "goal_time",
            "mph_goal",
            "mph_goal_avg",
            "minutes_elapsed",
            "ignore",
            "details",
        ]


class CardioDailyLogUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = CardioDailyLog
        fields = ["datetime_started", "max_mph", "goal_time", "ignore"]

    def update(self, instance, validated_data):
        sentinel = object()
        goal_time_val = validated_data.get("goal_time", sentinel)

        # When goal_time is provided, derive an implied max_mph using the workout's
        # goal_distance (in the workout's unit) and only bump max_mph if higher.
        if goal_time_val is not sentinel and goal_time_val is not None:
            try:
                minutes = float(goal_time_val)
            except (TypeError, ValueError):
                minutes = None

            if minutes is not None and minutes > 0:
                workout = getattr(instance, "workout", None)
                unit = getattr(workout, "unit", None)
                unit_type = getattr(getattr(unit, "unit_type", None), "name", "")

                implied_mph = None
                if str(unit_type).lower() == "distance":
                    try:
                        goal_distance = float(getattr(workout, "goal_distance", 0.0) or 0.0)
                        num = float(getattr(unit, "mile_equiv_numerator", 0.0) or 0.0)
                        den = float(getattr(unit, "mile_equiv_denominator", 1.0) or 1.0)
                        miles_per_unit = (num / den) if den else 0.0
                        miles = goal_distance * miles_per_unit
                        if miles > 0:
                            implied_mph = round(miles * 60.0 / minutes, 3)
                    except Exception:
                        implied_mph = None

                # Prefer an explicitly provided max_mph in the same request
                # as the baseline for comparison; otherwise use the current instance.
                if implied_mph is not None:
                    explicit_max = validated_data.get("max_mph", sentinel)
                    if explicit_max is not sentinel and explicit_max is not None:
                        current_max = float(explicit_max)
                    else:
                        current_max = float(instance.max_mph) if instance.max_mph is not None else None

                    if current_max is None or implied_mph > current_max:
                        validated_data["max_mph"] = implied_mph

        return super().update(instance, validated_data)


class CardioWorkoutWarmupSerializer(serializers.ModelSerializer):
    workout = serializers.PrimaryKeyRelatedField(read_only=True)
    workout_name = serializers.CharField(source="workout.name", read_only=True)
    routine_name = serializers.CharField(source="workout.routine.name", read_only=True)

    class Meta:
        model = CardioWorkoutWarmup
        fields = [
            "workout",
            "workout_name",
            "routine_name",
            "warmup_minutes",
            "warmup_mph",
        ]


class CardioWorkoutWarmupUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = CardioWorkoutWarmup
        fields = ["warmup_minutes", "warmup_mph"]

class BodyweightSerializer(serializers.ModelSerializer):
    class Meta:
        model = Bodyweight
        fields = ["bodyweight"]


# ---------- Strength serializers ----------


class StrengthRestThresholdSerializer(serializers.ModelSerializer):
    exercise = serializers.PrimaryKeyRelatedField(read_only=True)
    exercise_name = serializers.CharField(source="exercise.name", read_only=True)
    routine_name = serializers.CharField(source="exercise.routine.name", read_only=True)

    class Meta:
        model = StrengthExerciseRestThreshold
        fields = [
            "exercise",
            "exercise_name",
            "routine_name",
            "yellow_start_seconds",
            "red_start_seconds",
            "critical_start_seconds",
        ]


class StrengthRestThresholdUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = StrengthExerciseRestThreshold
        fields = ["yellow_start_seconds", "red_start_seconds", "critical_start_seconds"]

    def validate(self, attrs):
        instance = getattr(self, "instance", None)
        yellow = attrs.get("yellow_start_seconds", getattr(instance, "yellow_start_seconds", 120))
        red = attrs.get("red_start_seconds", getattr(instance, "red_start_seconds", 180))
        critical = attrs.get("critical_start_seconds", getattr(instance, "critical_start_seconds", 300))
        if not (yellow < red < critical):
            raise serializers.ValidationError("Thresholds must increase: yellow < red < critical.")
        return attrs
class StrengthDailyLogDetailCreateSerializer(serializers.ModelSerializer):
    exercise_id = serializers.PrimaryKeyRelatedField(
        source="exercise", queryset=StrengthExercise.objects.all(), write_only=True
    )

    class Meta:
        model = StrengthDailyLogDetail
        fields = ["datetime", "exercise_id", "reps", "weight"]


class StrengthDailyLogDetailUpdateSerializer(serializers.ModelSerializer):
    exercise_id = serializers.PrimaryKeyRelatedField(
        source="exercise", queryset=StrengthExercise.objects.all(), required=False
    )

    class Meta:
        model = StrengthDailyLogDetail
        fields = ["datetime", "exercise_id", "reps", "weight"]


class StrengthDailyLogDetailSerializer(serializers.ModelSerializer):
    exercise = serializers.StringRelatedField()
    exercise_id = serializers.PrimaryKeyRelatedField(
        source="exercise", read_only=True
    )

    class Meta:
        model = StrengthDailyLogDetail
        fields = ["id", "datetime", "exercise", "exercise_id", "reps", "weight"]


class StrengthRoutineSerializer(serializers.ModelSerializer):
    class Meta:
        model = StrengthRoutine
        fields = ["id", "name", "hundred_points_reps", "hundred_points_weight"]


class StrengthProgressionSerializer(serializers.ModelSerializer):
    class Meta:
        model = VwStrengthProgression
        fields = [
            "id",
            "progression_order",
            "routine_name",
            "current_max",
            "training_set",
            "daily_volume",
            "weekly_volume",
        ]


class StrengthDailyLogCreateSerializer(serializers.ModelSerializer):
    routine_id = serializers.PrimaryKeyRelatedField(
        source="routine", queryset=StrengthRoutine.objects.all(), write_only=True
    )
    rep_goal = serializers.FloatField(required=False, allow_null=True)
    details = StrengthDailyLogDetailCreateSerializer(many=True, required=False)

    class Meta:
        model = StrengthDailyLog
        fields = [
            "datetime_started",
            "routine_id",
            "rep_goal",
            "total_reps_completed",
            "max_reps",
            "max_weight",
            "minutes_elapsed",
            "ignore",
            "details",
        ]
        extra_kwargs = {
            "total_reps_completed": {"required": False, "allow_null": True},
            "max_reps": {"required": False, "allow_null": True},
            "max_weight": {"required": False, "allow_null": True},
            "minutes_elapsed": {"required": False, "allow_null": True},
            "ignore": {"required": False},
        }

    def create(self, validated_data):
        details_data = validated_data.pop("details", [])

        # Compute RPH goals at time of logging (mirrors Cardio mph_goal persistence)
        routine = validated_data.get("routine")
        rep_goal = validated_data.get("rep_goal")
        rph_goal_val = None
        rph_goal_avg_val = None
        max_reps_goal_val = None
        max_weight_goal_val = None
        if routine is not None:
            try:
                # Tailor to the current planned volume if provided
                g, gavg = get_reps_per_hour_goal_for_routine(routine.id, total_volume_input=rep_goal)
                rph_goal_val = float(g)
                rph_goal_avg_val = float(gavg)
            except Exception:
                rph_goal_val = None
                rph_goal_avg_val = None
            try:
                max_goal = get_max_reps_goal_for_routine(routine.id, rep_goal)
                if max_goal is not None:
                    max_reps_goal_val = float(max_goal)
            except Exception:
                max_reps_goal_val = None
            try:
                weight_goal = get_max_weight_goal_for_routine(routine.id, rep_goal)
                if weight_goal is not None:
                    max_weight_goal_val = float(weight_goal)
            except Exception:
                max_weight_goal_val = None

        log = StrengthDailyLog.objects.create(
            rph_goal=rph_goal_val,
            rph_goal_avg=rph_goal_avg_val,
            max_reps_goal=max_reps_goal_val,
            max_weight_goal=max_weight_goal_val,
            **validated_data,
        )
        if details_data:
            StrengthDailyLogDetail.objects.bulk_create(
                StrengthDailyLogDetail(log=log, **d) for d in details_data
            )
            recompute_strength_log_aggregates(log.id)
        return log


class StrengthDailyLogSerializer(serializers.ModelSerializer):
    routine = StrengthRoutineSerializer(read_only=True)
    details = serializers.SerializerMethodField()
    rph_current = serializers.SerializerMethodField()

    class Meta:
        model = StrengthDailyLog
        fields = [
            "id",
            "datetime_started",
            "routine",
            "rep_goal",
            "total_reps_completed",
            "max_reps_goal",
            "max_reps",
            "max_weight_goal",
            "max_weight",
            "minutes_elapsed",
            "rph_goal",
            "rph_goal_avg",
            "rph_current",
            "ignore",
            "details",
        ]

    @staticmethod
    def _detail_sort_key(detail):
        """Sort details by most-recent timestamp, then newest id."""
        timestamp = detail.datetime.timestamp() if detail.datetime else float("-inf")
        # pk should always be present, but guard just in case
        return (timestamp, detail.pk or 0)

    def get_details(self, obj):
        prefetched = getattr(obj, "_prefetched_objects_cache", {}).get("details")
        if prefetched is not None:
            ordered = sorted(prefetched, key=self._detail_sort_key, reverse=True)
            return StrengthDailyLogDetailSerializer(ordered, many=True).data

        queryset = obj.details.select_related("exercise").order_by("-datetime", "-pk")
        return StrengthDailyLogDetailSerializer(queryset, many=True).data

    def get_rph_current(self, obj):
        try:
            total = float(obj.total_reps_completed)
            minutes = float(obj.minutes_elapsed)
        except (TypeError, ValueError):
            return None
        if not (minutes and minutes > 0 and total and total > 0):
            return None
        hours = minutes / 60.0
        if hours <= 0:
            return None
        return float(total / hours)



class SupplementalDailyLogDetailCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = SupplementalDailyLogDetail
        fields = ["datetime", "unit_count"]


class SupplementalWorkoutSerializer(serializers.ModelSerializer):
    class Meta:
        model = SupplementalWorkout
        fields = ["id", "name"]


class SupplementalRoutineSerializer(serializers.ModelSerializer):
    class Meta:
        model = SupplementalRoutine
        fields = ["id", "name", "unit"]


class SupplementalWorkoutDescriptionSerializer(serializers.ModelSerializer):
    routine = SupplementalRoutineSerializer(read_only=True)
    workout = SupplementalWorkoutSerializer(read_only=True)

    class Meta:
        model = SupplementalWorkoutDescription
        fields = ["id", "routine", "workout", "description", "goal_metric"]


class SupplementalDailyLogDetailSerializer(serializers.ModelSerializer):
    class Meta:
        model = SupplementalDailyLogDetail
        fields = ["id", "datetime", "unit_count"]


class SupplementalDailyLogCreateSerializer(serializers.ModelSerializer):
    routine_id = serializers.PrimaryKeyRelatedField(
        source="routine", queryset=SupplementalRoutine.objects.all(), write_only=True
    )
    workout_id = serializers.PrimaryKeyRelatedField(
        source="workout", queryset=SupplementalWorkout.objects.all(), required=False, allow_null=True, write_only=True
    )
    details = SupplementalDailyLogDetailCreateSerializer(many=True, required=False)

    class Meta:
        model = SupplementalDailyLog
        fields = [
            "datetime_started",
            "routine_id",
            "workout_id",
            "goal",
            "goal_metric",
            "total_completed",
            "ignore",
            "details",
        ]
        extra_kwargs = {
            "datetime_started": {"required": False, "allow_null": True},
            "goal": {"required": False, "allow_null": True, "allow_blank": True},
            "total_completed": {"required": False, "allow_null": True},
            "goal_metric": {"required": False, "allow_null": True},
            "ignore": {"required": False},
        }

    def validate(self, attrs):
        return attrs

    def create(self, validated_data):
        details_data = validated_data.pop("details", [])
        routine = validated_data.get("routine")
        workout = validated_data.get("workout")

        # Resolve the workout/goal metric from description if possible.
        desc = None
        if routine:
            qs = SupplementalWorkoutDescription.objects.filter(routine=routine)
            if workout:
                desc = qs.filter(workout=workout).first()
            if desc is None:
                desc = qs.order_by("workout__id").first()
                if desc and workout is None:
                    validated_data["workout"] = desc.workout
        if desc and not validated_data.get("goal_metric"):
            validated_data["goal_metric"] = desc.goal_metric

        total_completed = validated_data.get("total_completed")
        detail_datetimes = []
        detail_total = 0.0
        for item in details_data:
            dt = item.get("datetime")
            if dt is not None:
                detail_datetimes.append(dt)
            try:
                val = float(item.get("unit_count"))
            except (TypeError, ValueError):
                val = 0.0
            if val > 0:
                detail_total += val

        if total_completed is None and detail_total > 0:
            validated_data["total_completed"] = detail_total

        if not validated_data.get("datetime_started"):
            if detail_datetimes:
                validated_data["datetime_started"] = min(detail_datetimes)
            else:
                validated_data["datetime_started"] = timezone.now()

        log = SupplementalDailyLog.objects.create(**validated_data)

        if details_data:
            SupplementalDailyLogDetail.objects.bulk_create(
                SupplementalDailyLogDetail(log=log, **detail) for detail in details_data
            )
            from .signals import recompute_supplemental_log_aggregates
            recompute_supplemental_log_aggregates(log.id)
        return log

class SupplementalDailyLogSerializer(serializers.ModelSerializer):
    routine = SupplementalRoutineSerializer(read_only=True)
    workout = SupplementalWorkoutSerializer(read_only=True)
    details = SupplementalDailyLogDetailSerializer(many=True, read_only=True)
    target_to_beat = serializers.SerializerMethodField()
    best_recent = serializers.SerializerMethodField()

    class Meta:
        model = SupplementalDailyLog
        fields = [
            "id",
            "datetime_started",
            "routine",
            "workout",
            "goal",
            "goal_metric",
            "target_to_beat",
            "best_recent",
            "total_completed",
            "ignore",
            "details",
        ]

    def get_target_to_beat(self, obj):
        rid = getattr(obj, "routine_id", None)
        wid = getattr(obj, "workout_id", None)
        metric = getattr(obj, "goal_metric", None)
        if not rid:
            return 0.0
        return get_supplemental_goal_target(rid, workout_id=wid, goal_metric=metric)

    def get_best_recent(self, obj):
        rid = getattr(obj, "routine_id", None)
        wid = getattr(obj, "workout_id", None)
        metric = getattr(obj, "goal_metric", None)
        if not rid:
            return None
        return get_supplemental_best_recent(rid, workout_id=wid, goal_metric=metric)


class SupplementalDailyLogUpdateSerializer(serializers.ModelSerializer):
    workout_id = serializers.PrimaryKeyRelatedField(
        source="workout", queryset=SupplementalWorkout.objects.all(), required=False, allow_null=True
    )

    class Meta:
        model = SupplementalDailyLog
        fields = ["datetime_started", "goal", "goal_metric", "total_completed", "workout_id", "ignore"]


class SupplementalDailyLogDetailUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = SupplementalDailyLogDetail
        fields = ["datetime", "unit_count"]

class StrengthDailyLogUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = StrengthDailyLog
        fields = ["datetime_started", "max_weight", "max_reps", "ignore"]

















