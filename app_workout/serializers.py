# app_workout/serializers.py
from rest_framework import serializers
from django.utils import timezone
from math import isfinite
from .models import (
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
    SupplementalDailyLog,
    SupplementalDailyLogDetail,
    Bodyweight,
    DistanceConversionSettings,
    CardioWorkoutTMSyncPreference,
    RoutineScheduleDay,
    ROUTINE_SCHEDULE_ALLOWED_CODES,
    ROUTINE_SCHEDULE_CODE_CHOICES,
    derive_activity_date,
)
from .signals import recompute_log_aggregates, recompute_strength_log_aggregates
from .services import (
    get_mph_goal_for_workout,
    get_reps_per_hour_goal_for_routine,
    get_max_reps_goal_for_routine,
    get_max_weight_goal_for_routine,
    get_supplemental_goal_target,
)

class RoutineScheduleDaySerializer(serializers.ModelSerializer):
    day_label = serializers.SerializerMethodField()
    label = serializers.CharField(read_only=True)
    routine_labels = serializers.SerializerMethodField()

    class Meta:
        model = RoutineScheduleDay
        fields = ["day_number", "day_label", "routine_codes", "routine_labels", "label"]

    def get_day_label(self, obj):
        return f"Day {obj.day_number}"

    def get_routine_labels(self, obj):
        return list(obj.routine_labels)


class RoutineScheduleDayWriteSerializer(serializers.Serializer):
    day_number = serializers.IntegerField(min_value=1, max_value=7)
    routine_codes = serializers.ListField(
        child=serializers.ChoiceField(choices=ROUTINE_SCHEDULE_CODE_CHOICES),
        allow_empty=False,
    )

    def validate_routine_codes(self, value):
        codes = []
        seen = set()
        for raw_code in value:
            code = str(raw_code or "").strip().lower()
            if code not in ROUTINE_SCHEDULE_ALLOWED_CODES:
                raise serializers.ValidationError(f"Unsupported routine code '{raw_code}'.")
            if code in seen:
                raise serializers.ValidationError("routine_codes cannot repeat a routine.")
            seen.add(code)
            codes.append(code)
        if len(codes) > 2:
            raise serializers.ValidationError("routine_codes may contain at most two routines.")
        return [
            code
            for code, _label in ROUTINE_SCHEDULE_CODE_CHOICES
            if code in codes
        ]


class WeeklyModelUpdateSerializer(serializers.Serializer):
    days = RoutineScheduleDayWriteSerializer(many=True)

    def validate_days(self, value):
        if len(value) != 7:
            raise serializers.ValidationError("days must include exactly 7 schedule entries.")
        seen = set()
        for item in value:
            day_number = item["day_number"]
            if day_number in seen:
                raise serializers.ValidationError("day_number values must be unique.")
            seen.add(day_number)
        expected = set(range(1, 8))
        if seen != expected:
            missing = sorted(expected - seen)
            extra = sorted(seen - expected)
            details = []
            if missing:
                details.append(f"missing {', '.join(str(day) for day in missing)}")
            if extra:
                details.append(f"unexpected {', '.join(str(day) for day in extra)}")
            raise serializers.ValidationError(
                "days must include day_number 1 through 7 exactly once"
                + (f" ({'; '.join(details)})" if details else ".")
            )
        return sorted(value, key=lambda item: item["day_number"])

SUPPLEMENTAL_SET4_PLUS_REMAINING_OVERRIDE_SECONDS = (2 * 60) + 20


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
            "routine", "unit", "goal_distance",
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
        ]


class CardioWorkoutGoalDistanceUpdateSerializer(serializers.ModelSerializer):
    goal_distance = serializers.FloatField(min_value=0.0)

    class Meta:
        model = CardioWorkout
        fields = ["goal_distance"]


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
    mph_goal_percentage = serializers.FloatField(required=False, allow_null=True, write_only=True)
    mph_goal_avg_percentage = serializers.FloatField(required=False, allow_null=True, write_only=True)

    class Meta:
        model = CardioDailyLog
        fields = [
            "datetime_started",
            "activity_date",
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
            "mph_goal_percentage",
            "mph_goal_avg_percentage",
        ]
        extra_kwargs = {
            "activity_date": {"required": False, "allow_null": True},
            "ignore": {"required": False},
        }

    def create(self, validated_data):
        details_data = validated_data.pop("details", [])
        sentinel = object()
        mph_goal_override = validated_data.pop("mph_goal", sentinel)
        mph_goal_avg_override = validated_data.pop("mph_goal_avg", sentinel)
        mph_goal_pct_override = validated_data.pop("mph_goal_percentage", sentinel)
        mph_goal_avg_pct_override = validated_data.pop("mph_goal_avg_percentage", sentinel)
        # Compute MPH goals from the view at time of logging
        workout = validated_data.get("workout")
        mph_goal_val = None
        mph_goal_avg_val = None
        mph_goal_pct_val = None
        mph_goal_avg_pct_val = None
        if mph_goal_override is not sentinel and mph_goal_override is not None:
            mph_goal_val = float(mph_goal_override)
        if mph_goal_avg_override is not sentinel and mph_goal_avg_override is not None:
            mph_goal_avg_val = float(mph_goal_avg_override)
        if mph_goal_pct_override is not sentinel:
            try:
                pct = float(mph_goal_pct_override)
                if pct > 0:
                    mph_goal_pct_val = int(round(max(1.0, min(100.0, pct))))
            except (TypeError, ValueError):
                mph_goal_pct_val = None
        if mph_goal_avg_pct_override is not sentinel:
            try:
                pct = float(mph_goal_avg_pct_override)
                if pct > 0:
                    mph_goal_avg_pct_val = int(round(max(1.0, min(100.0, pct))))
            except (TypeError, ValueError):
                mph_goal_avg_pct_val = None

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
            mph_goal_percentage=mph_goal_pct_val,
            mph_goal_avg_percentage=mph_goal_avg_pct_val,
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
            "activity_date",
            "workout",
            "goal",
            "total_completed",
            "max_mph",
            "avg_mph",
            "goal_time",
            "mph_goal",
            "mph_goal_avg",
            "mph_goal_percentage",
            "mph_goal_avg_percentage",
            "minutes_elapsed",
            "ignore",
            "details",
        ]


class CardioDailyLogUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = CardioDailyLog
        fields = [
            "datetime_started",
            "activity_date",
            "max_mph",
            "avg_mph",
            "goal_time",
            "mph_goal",
            "mph_goal_avg",
            "mph_goal_percentage",
            "mph_goal_avg_percentage",
            "ignore",
        ]

    def update(self, instance, validated_data):
        sentinel = object()
        goal_time_val = validated_data.get("goal_time", sentinel)
        max_mph_val = validated_data.get("max_mph", sentinel)
        avg_mph_val = validated_data.get("avg_mph", sentinel)
        mph_goal_val = validated_data.get("mph_goal", sentinel)
        mph_goal_avg_val = validated_data.get("mph_goal_avg", sentinel)
        mph_goal_pct_val = validated_data.get("mph_goal_percentage", sentinel)
        mph_goal_avg_pct_val = validated_data.get("mph_goal_avg_percentage", sentinel)

        workout = getattr(instance, "workout", None)
        unit = getattr(workout, "unit", None)
        unit_type = str(getattr(getattr(unit, "unit_type", None), "name", "")).lower()
        try:
            goal_distance = float(getattr(workout, "goal_distance", 0.0) or 0.0)
        except Exception:
            goal_distance = 0.0

        miles_per_unit = 0.0
        if unit_type == "distance":
            try:
                num = float(getattr(unit, "mile_equiv_numerator", 0.0) or 0.0)
                den = float(getattr(unit, "mile_equiv_denominator", 1.0) or 1.0)
                miles_per_unit = (num / den) if den else 0.0
            except Exception:
                miles_per_unit = 0.0

        def to_float(val):
            try:
                return float(val)
            except (TypeError, ValueError):
                return None

        def implied_mph_from_goal_time(goal_time):
            if goal_time is None or goal_time <= 0 or goal_distance <= 0:
                return None
            if unit_type == "distance":
                if miles_per_unit <= 0:
                    return None
                miles = goal_distance * miles_per_unit
                if miles <= 0:
                    return None
                return round(miles * 60.0 / goal_time, 3)
            if unit_type == "time":
                return round(goal_time * 60.0 / goal_distance, 3)
            return None

        def goal_time_from_mph(mph):
            if mph is None or mph <= 0 or goal_distance <= 0:
                return None
            if unit_type == "distance":
                if miles_per_unit <= 0:
                    return None
                miles = goal_distance * miles_per_unit
                if miles <= 0:
                    return None
                return round((miles / mph) * 60.0, 3)
            if unit_type == "time":
                return round((mph * (goal_distance / 60.0)), 3)
            return None

        explicit_mph = None
        if max_mph_val is not sentinel and max_mph_val is not None:
            explicit_mph = to_float(max_mph_val)
            if explicit_mph is not None and explicit_mph <= 0:
                explicit_mph = None

        goal_time_number = None
        if goal_time_val is not sentinel and goal_time_val is not None:
            goal_time_number = to_float(goal_time_val)
            if goal_time_number is not None and goal_time_number <= 0:
                goal_time_number = None

        implied_mph = implied_mph_from_goal_time(goal_time_number) if goal_time_number is not None else None

        if goal_time_val is not sentinel or max_mph_val is not sentinel:
            chosen_mph = None
            if explicit_mph is not None and implied_mph is not None:
                chosen_mph = max(explicit_mph, implied_mph)
            elif explicit_mph is not None:
                chosen_mph = explicit_mph
            elif implied_mph is not None:
                chosen_mph = implied_mph

            if chosen_mph is not None:
                validated_data["max_mph"] = round(chosen_mph, 3)
                synced_goal_time = goal_time_from_mph(chosen_mph)
                if synced_goal_time is not None:
                    validated_data["goal_time"] = synced_goal_time

        if avg_mph_val is not sentinel:
            avg_mph_number = to_float(avg_mph_val)
            if avg_mph_number is not None and avg_mph_number > 0:
                validated_data["avg_mph"] = round(avg_mph_number, 3)
            else:
                validated_data["avg_mph"] = None

        if mph_goal_val is not sentinel:
            mph_goal_number = to_float(mph_goal_val)
            if mph_goal_number is not None and mph_goal_number > 0:
                validated_data["mph_goal"] = round(mph_goal_number, 3)
            else:
                validated_data["mph_goal"] = None

        if mph_goal_avg_val is not sentinel:
            mph_goal_avg_number = to_float(mph_goal_avg_val)
            if mph_goal_avg_number is not None and mph_goal_avg_number > 0:
                validated_data["mph_goal_avg"] = round(mph_goal_avg_number, 3)
            else:
                validated_data["mph_goal_avg"] = None

        if mph_goal_pct_val is not sentinel:
            mph_goal_pct_number = to_float(mph_goal_pct_val)
            if mph_goal_pct_number is not None and mph_goal_pct_number > 0:
                validated_data["mph_goal_percentage"] = int(round(max(1.0, min(100.0, mph_goal_pct_number))))
            else:
                validated_data["mph_goal_percentage"] = None

        if mph_goal_avg_pct_val is not sentinel:
            mph_goal_avg_pct_number = to_float(mph_goal_avg_pct_val)
            if mph_goal_avg_pct_number is not None and mph_goal_avg_pct_number > 0:
                validated_data["mph_goal_avg_percentage"] = int(round(max(1.0, min(100.0, mph_goal_avg_pct_number))))
            else:
                validated_data["mph_goal_avg_percentage"] = None

        if "datetime_started" in validated_data and "activity_date" not in validated_data:
            validated_data["activity_date"] = derive_activity_date(validated_data["datetime_started"])

        return super().update(instance, validated_data)


class BodyweightSerializer(serializers.ModelSerializer):
    class Meta:
        model = Bodyweight
        fields = ["bodyweight"]


class DistanceConversionSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = DistanceConversionSettings
        fields = [
            "ten_k_miles",
            "x800_miles",
            "x800_meters",
            "x800_yards",
            "x400_miles",
            "x400_meters",
            "x400_yards",
            "x200_miles",
            "x200_meters",
            "x200_yards",
        ]

    def validate(self, attrs):
        validated = super().validate(attrs)
        instance = getattr(self, "instance", None)
        for field_name in self.Meta.fields:
            value = validated.get(field_name, getattr(instance, field_name, None) if instance is not None else None)
            try:
                numeric = float(value)
            except (TypeError, ValueError):
                raise serializers.ValidationError({field_name: "A numeric value is required."})
            if numeric <= 0:
                raise serializers.ValidationError({field_name: "Must be greater than 0."})
        return validated


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
            "activity_date",
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
            "activity_date": {"required": False, "allow_null": True},
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
            "activity_date",
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
        fields = ["datetime", "unit_count", "set_number", "weight"]


class SupplementalRoutineSerializer(serializers.ModelSerializer):
    class Meta:
        model = SupplementalRoutine
        fields = [
            "id",
            "name",
            "unit",
            "step_value",
            "max_set",
            "step_weight",
            "rest_yellow_start_seconds",
            "rest_red_start_seconds",
        ]


class SupplementalDailyLogDetailSerializer(serializers.ModelSerializer):
    class Meta:
        model = SupplementalDailyLogDetail
        fields = ["id", "datetime", "unit_count", "set_number", "weight"]


class SupplementalDailyLogCreateSerializer(serializers.ModelSerializer):
    routine_id = serializers.PrimaryKeyRelatedField(
        source="routine", queryset=SupplementalRoutine.objects.all(), write_only=True
    )
    details = SupplementalDailyLogDetailCreateSerializer(many=True, required=False)

    class Meta:
        model = SupplementalDailyLog
        fields = [
            "datetime_started",
            "activity_date",
            "routine_id",
            "goal",
            "goal_set_1",
            "goal_set_2",
            "goal_set_3",
            "goal_weight_set_1",
            "goal_weight_set_2",
            "goal_weight_set_3",
            "rest_yellow_start_seconds",
            "rest_red_start_seconds",
            "total_completed",
            "ignore",
            "details",
        ]
        extra_kwargs = {
            "datetime_started": {"required": False, "allow_null": True},
            "activity_date": {"required": False, "allow_null": True},
            "goal": {"required": False, "allow_null": True, "allow_blank": True},
            "goal_set_1": {"required": False, "allow_null": True},
            "goal_set_2": {"required": False, "allow_null": True},
            "goal_set_3": {"required": False, "allow_null": True},
            "goal_weight_set_1": {"required": False, "allow_null": True},
            "goal_weight_set_2": {"required": False, "allow_null": True},
            "goal_weight_set_3": {"required": False, "allow_null": True},
            "rest_yellow_start_seconds": {"required": False, "allow_null": True},
            "rest_red_start_seconds": {"required": False, "allow_null": True},
            "total_completed": {"required": False, "allow_null": True},
            "ignore": {"required": False},
        }

    def validate(self, attrs):
        return attrs

    def create(self, validated_data):
        details_data = validated_data.pop("details", [])
        routine = validated_data.get("routine")
        goal_val = validated_data.get("goal")
        rid = getattr(routine, "id", None)
        set_targets = None
        if rid:
            try:
                set_targets = get_supplemental_goal_target(rid)
            except Exception:
                set_targets = None
        if set_targets:
            routine_unit = str(getattr(routine, "unit", "") or "").strip().lower()
            is_time_routine = routine_unit == "time"
            def _set_val(num: int, key: str):
                for item in set_targets.get("sets", []):
                    if item.get("set_number") == num:
                        return item.get(key)
                return None
            validated_data.setdefault("goal_set_1", _set_val(1, "goal_unit"))
            validated_data.setdefault("goal_set_2", _set_val(2, "goal_unit"))
            validated_data.setdefault("goal_set_3", _set_val(3, "goal_unit"))
            validated_data.setdefault("goal_weight_set_1", _set_val(1, "goal_weight"))
            validated_data.setdefault("goal_weight_set_2", _set_val(2, "goal_weight"))
            validated_data.setdefault("goal_weight_set_3", _set_val(3, "goal_weight"))
            validated_data.setdefault("rest_yellow_start_seconds", set_targets.get("rest_yellow_start_seconds"))
            validated_data.setdefault("rest_red_start_seconds", set_targets.get("rest_red_start_seconds"))
            if (goal_val is None) or (isinstance(goal_val, str) and goal_val.strip() == ""):
                def _fmt_goal(item):
                    unit = item.get("goal_unit")
                    weight = None if is_time_routine else item.get("goal_weight")
                    parts = []
                    if unit is not None:
                        parts.append(f"{unit}")
                    if weight is not None:
                        parts.append(f"+{weight} wt")
                    return " ".join(parts)
                pieces = [
                    f"Set {item.get('set_number')}: {_fmt_goal(item)}"
                    for item in set_targets.get("sets", [])
                    if item.get("goal_unit") is not None or item.get("goal_weight") is not None
                ]
                if pieces:
                    validated_data["goal"] = "; ".join(pieces)
        if routine:
            validated_data.setdefault("rest_yellow_start_seconds", getattr(routine, "rest_yellow_start_seconds", None))
            validated_data.setdefault("rest_red_start_seconds", getattr(routine, "rest_red_start_seconds", None))

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
    details = SupplementalDailyLogDetailSerializer(many=True, read_only=True)
    set_targets = serializers.SerializerMethodField()
    total_goal = serializers.SerializerMethodField()
    total_completed = serializers.SerializerMethodField()
    remaining = serializers.SerializerMethodField()
    sets_logged = serializers.SerializerMethodField()
    has_next_set = serializers.SerializerMethodField()
    next_set_number = serializers.SerializerMethodField()
    next_set_target = serializers.SerializerMethodField()
    rest_config = serializers.SerializerMethodField()

    class Meta:
        model = SupplementalDailyLog
        fields = [
            "id",
            "datetime_started",
            "activity_date",
            "routine",
            "unit_snapshot",
            "goal",
            "goal_set_1",
            "goal_set_2",
            "goal_set_3",
            "goal_weight_set_1",
            "goal_weight_set_2",
            "goal_weight_set_3",
            "rest_yellow_start_seconds",
            "rest_red_start_seconds",
            "set_targets",
            "total_goal",
            "total_completed",
            "remaining",
            "sets_logged",
            "has_next_set",
            "next_set_number",
            "next_set_target",
            "ignore",
            "rest_config",
            "details",
        ]

    @staticmethod
    def _float_or_none(value):
        try:
            number = float(value)
        except (TypeError, ValueError):
            return None
        if not isfinite(number):
            return None
        return number

    def _build_state(self, obj):
        cache = getattr(self, "_supplemental_state_cache", None)
        if cache is None:
            cache = {}
            self._supplemental_state_cache = cache
        cache_key = getattr(obj, "pk", None) or id(obj)
        if cache_key in cache:
            return cache[cache_key]

        rid = getattr(obj, "routine_id", None)
        details_prefetched = getattr(obj, "_prefetched_objects_cache", {}).get("details")
        if details_prefetched is not None:
            details = list(details_prefetched)
        else:
            details = list(obj.details.all())

        completed_total = 0.0
        max_set_number = 0
        has_set2 = False
        has_set3 = False
        for index, detail in enumerate(details, start=1):
            unit_val = self._float_or_none(getattr(detail, "unit_count", None))
            if unit_val is not None and unit_val > 0:
                completed_total += unit_val

            raw_set_number = getattr(detail, "set_number", None)
            try:
                set_number = int(raw_set_number) if raw_set_number is not None else None
            except (TypeError, ValueError):
                set_number = None
            if set_number is None or set_number < 1:
                set_number = index
            max_set_number = max(max_set_number, set_number)
            if set_number == 2:
                has_set2 = True
            if set_number == 3:
                has_set3 = True
        if max_set_number == 0:
            max_set_number = len(details)

        if completed_total <= 0:
            fallback_total = self._float_or_none(getattr(obj, "total_completed", None))
            completed_total = fallback_total if (fallback_total is not None and fallback_total > 0) else 0.0

        plan = {}
        if rid:
            exclude_log_id = obj.pk if not (has_set2 and has_set3) else None
            plan = get_supplemental_goal_target(rid, exclude_log_id=exclude_log_id) or {}
        plan_sets = plan.get("sets", []) if isinstance(plan, dict) else []
        plan_by_set = {}
        for item in plan_sets:
            try:
                set_number = int(item.get("set_number"))
            except (TypeError, ValueError):
                continue
            if set_number in (1, 2, 3):
                plan_by_set[set_number] = item

        saved_goals = {
            1: getattr(obj, "goal_set_1", None),
            2: getattr(obj, "goal_set_2", None),
            3: getattr(obj, "goal_set_3", None),
        }
        saved_weights = {
            1: getattr(obj, "goal_weight_set_1", None),
            2: getattr(obj, "goal_weight_set_2", None),
            3: getattr(obj, "goal_weight_set_3", None),
        }
        routine_unit = str(getattr(obj, "unit_snapshot", None) or getattr(getattr(obj, "routine", None), "unit", "") or "").strip().lower()
        is_time_routine = routine_unit == "time"

        set_targets = []
        total_goal = 0.0
        total_goal_has_value = False
        for set_number in (1, 2, 3):
            base = plan_by_set.get(set_number, {})
            goal_unit = saved_goals.get(set_number)
            if goal_unit is None:
                goal_unit = base.get("goal_unit")
            goal_weight = None
            min_goal_weight = None
            using_weight = False
            if not is_time_routine:
                goal_weight = saved_weights.get(set_number)
                if goal_weight is None:
                    goal_weight = base.get("goal_weight")
                min_goal_weight = base.get("min_goal_weight")
                using_weight = bool(base.get("using_weight")) or goal_weight is not None
            target = {
                "set_number": set_number,
                "best_unit": base.get("best_unit"),
                "best_weight": None if is_time_routine else base.get("best_weight"),
                "goal_unit": goal_unit,
                "goal_weight": goal_weight,
                "using_weight": using_weight,
                "min_goal_unit": base.get("min_goal_unit"),
                "min_goal_weight": min_goal_weight,
            }
            set_targets.append(target)
            goal_unit_val = self._float_or_none(goal_unit)
            if goal_unit_val is not None and goal_unit_val > 0:
                total_goal += goal_unit_val
                total_goal_has_value = True

        total_goal_value = float(total_goal) if total_goal_has_value else None
        remaining = None
        if total_goal_value is not None:
            remaining = max(0.0, total_goal_value - completed_total)
        has_next_set = bool(remaining and remaining > 0)
        next_set_number = (max_set_number + 1) if has_next_set else None

        set_targets_by_number = {item["set_number"]: item for item in set_targets}
        next_set_target = None
        if has_next_set and next_set_number is not None:
            if next_set_number <= 3:
                base_next = set_targets_by_number.get(next_set_number, {})
            else:
                base_next = (
                    set_targets_by_number.get(3)
                    or set_targets_by_number.get(2)
                    or set_targets_by_number.get(1)
                    or {}
                )
            goal_unit = base_next.get("goal_unit")
            if next_set_number > 3 and is_time_routine:
                remaining_val = self._float_or_none(remaining)
                if (
                    remaining_val is not None
                    and remaining_val > 0
                    and remaining_val < SUPPLEMENTAL_SET4_PLUS_REMAINING_OVERRIDE_SECONDS
                ):
                    goal_unit = remaining_val
            next_set_target = {
                "set_number": next_set_number,
                "goal_unit": goal_unit,
                "goal_weight": None if is_time_routine else base_next.get("goal_weight"),
                "using_weight": False if is_time_routine else (bool(base_next.get("using_weight")) or base_next.get("goal_weight") is not None),
                "min_goal_unit": base_next.get("min_goal_unit"),
                "min_goal_weight": None if is_time_routine else base_next.get("min_goal_weight"),
            }

        state = {
            "set_targets": set_targets,
            "total_goal": total_goal_value,
            "total_completed": float(completed_total) if completed_total > 0 else None,
            "remaining": remaining,
            "sets_logged": len(details),
            "has_next_set": has_next_set,
            "next_set_number": next_set_number,
            "next_set_target": next_set_target,
        }
        cache[cache_key] = state
        return state

    def get_set_targets(self, obj):
        return self._build_state(obj)["set_targets"]

    def get_total_goal(self, obj):
        return self._build_state(obj)["total_goal"]

    def get_total_completed(self, obj):
        return self._build_state(obj)["total_completed"]

    def get_remaining(self, obj):
        return self._build_state(obj)["remaining"]

    def get_sets_logged(self, obj):
        return self._build_state(obj)["sets_logged"]

    def get_has_next_set(self, obj):
        return self._build_state(obj)["has_next_set"]

    def get_next_set_number(self, obj):
        return self._build_state(obj)["next_set_number"]

    def get_next_set_target(self, obj):
        return self._build_state(obj)["next_set_target"]

    def get_rest_config(self, obj):
        ry = getattr(obj, "rest_yellow_start_seconds", None) or getattr(getattr(obj, "routine", None), "rest_yellow_start_seconds", None) or 60
        rr = getattr(obj, "rest_red_start_seconds", None) or getattr(getattr(obj, "routine", None), "rest_red_start_seconds", None) or 90
        return {
            "yellow_start_seconds": ry,
            "red_start_seconds": rr,
            "critical_start_seconds": rr,
        }


class SupplementalDailyLogUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = SupplementalDailyLog
        fields = [
            "datetime_started",
            "activity_date",
            "goal",
            "goal_set_1",
            "goal_set_2",
            "goal_set_3",
            "goal_weight_set_1",
            "goal_weight_set_2",
            "goal_weight_set_3",
            "rest_yellow_start_seconds",
            "rest_red_start_seconds",
            "total_completed",
            "ignore",
        ]

    def update(self, instance, validated_data):
        if "datetime_started" in validated_data and "activity_date" not in validated_data:
            validated_data["activity_date"] = derive_activity_date(validated_data["datetime_started"])
        return super().update(instance, validated_data)


class SupplementalDailyLogDetailUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = SupplementalDailyLogDetail
        fields = ["datetime", "unit_count", "set_number", "weight"]

class StrengthDailyLogUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = StrengthDailyLog
        fields = ["datetime_started", "activity_date", "max_weight", "max_reps", "ignore"]

    def update(self, instance, validated_data):
        if "datetime_started" in validated_data and "activity_date" not in validated_data:
            validated_data["activity_date"] = derive_activity_date(validated_data["datetime_started"])
        return super().update(instance, validated_data)

















