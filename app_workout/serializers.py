# app_workout/serializers.py
from rest_framework import serializers
from .models import (
    CardioRoutine, CardioWorkout, CardioProgression,
    CardioDailyLog, CardioDailyLogDetail, CardioExercise,CardioUnit
)
from .signals import recompute_log_aggregates

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
        log = CardioDailyLog.objects.create(**validated_data)
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
            "minutes_elapsed",
            "details",
        ]


class CardioDailyLogUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = CardioDailyLog
        fields = ["datetime_started", "max_mph"]
