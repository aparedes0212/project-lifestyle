# app_workout/serializers.py
from rest_framework import serializers
from .models import (
    CardioRoutine,
    CardioWorkout,
    CardioProgression,
    CardioDailyLog,
    CardioDailyLogDetail,
    CardioExercise,
    CardioUnit,
    StrengthRoutine,
    StrengthExercise,
    StrengthDailyLog,
    StrengthDailyLogDetail,
    VwStrengthProgression,
    VwMPHGoal,
    CardioWarmupSettings,
    Bodyweight,
    CardioWorkoutTMSyncPreference,
)
from .signals import recompute_log_aggregates, recompute_strength_log_aggregates

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
            "routine", "unit",
        ]


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

class CardioProgressionSerializer(serializers.ModelSerializer):
    workout = serializers.PrimaryKeyRelatedField(read_only=True)

    class Meta:
        model = CardioProgression
        fields = ["id", "workout", "progression_order", "progression"]


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

    class Meta:
        model = CardioDailyLog
        fields = [
            "datetime_started",
            "workout_id",
            "goal",
            "total_completed",
            "max_mph",
            "avg_mph",
            "minutes_elapsed",
            "details",
        ]

    def create(self, validated_data):
        details_data = validated_data.pop("details", [])
        # Compute MPH goals from the view at time of logging
        workout = validated_data.get("workout")
        mph_goal_val = None
        mph_goal_avg_val = None
        if workout is not None:
            vw = VwMPHGoal.objects.filter(pk=workout.id).first()
            if vw is not None:
                try:
                    mph_goal_val = float(vw.mph_goal)
                except Exception:
                    mph_goal_val = None
                try:
                    mph_goal_avg_val = float(vw.mph_goal_avg)
                except Exception:
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
            "mph_goal",
            "mph_goal_avg",
            "minutes_elapsed",
            "details",
        ]


class CardioDailyLogUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = CardioDailyLog
        fields = ["datetime_started", "max_mph"]


class CardioWarmupSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = CardioWarmupSettings
        fields = [
            "warmup_minutes_5k_prep",
            "warmup_mph_5k_prep",
            "warmup_minutes_sprints",
            "warmup_mph_sprints",
        ]


class BodyweightSerializer(serializers.ModelSerializer):
    class Meta:
        model = Bodyweight
        fields = ["bodyweight"]


# ---------- Strength serializers ----------

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
            "details",
        ]
        extra_kwargs = {
            "total_reps_completed": {"required": False, "allow_null": True},
            "max_reps": {"required": False, "allow_null": True},
            "max_weight": {"required": False, "allow_null": True},
            "minutes_elapsed": {"required": False, "allow_null": True},
        }

    def create(self, validated_data):
        details_data = validated_data.pop("details", [])
        log = StrengthDailyLog.objects.create(**validated_data)
        if details_data:
            StrengthDailyLogDetail.objects.bulk_create(
                StrengthDailyLogDetail(log=log, **d) for d in details_data
            )
            recompute_strength_log_aggregates(log.id)
        return log


class StrengthDailyLogSerializer(serializers.ModelSerializer):
    routine = StrengthRoutineSerializer(read_only=True)
    details = StrengthDailyLogDetailSerializer(many=True, read_only=True)

    class Meta:
        model = StrengthDailyLog
        fields = [
            "id",
            "datetime_started",
            "routine",
            "rep_goal",
            "total_reps_completed",
            "max_reps",
            "max_weight",
            "minutes_elapsed",
            "details",
        ]


class StrengthDailyLogUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = StrengthDailyLog
        fields = ["datetime_started", "max_weight", "max_reps"]
