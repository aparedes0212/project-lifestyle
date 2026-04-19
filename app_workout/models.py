from django.conf import settings
from django.db import models
from django.core.exceptions import ValidationError
from django.utils import timezone
from zoneinfo import ZoneInfo
from math import ceil, isfinite


def default_pick_priority_order():
    return ["cardio", "strength", "supplemental"]


ROUTINE_SCHEDULE_CODE_CHOICES = [
    ("5k_prep", "5K Prep"),
    ("sprints", "Sprints"),
    ("strength", "Strength"),
    ("supplemental", "Supplemental"),
]
ROUTINE_SCHEDULE_CODE_LABELS = dict(ROUTINE_SCHEDULE_CODE_CHOICES)
ROUTINE_SCHEDULE_ALLOWED_CODES = tuple(code for code, _label in ROUTINE_SCHEDULE_CODE_CHOICES)


def get_calendar_zone() -> ZoneInfo:
    tz_name = getattr(settings, "CALENDAR_TIME_ZONE", "America/Denver")
    try:
        return ZoneInfo(tz_name)
    except Exception:
        return ZoneInfo("America/Denver")


def derive_activity_date(datetime_value):
    if datetime_value is None:
        return timezone.localdate(timezone=get_calendar_zone())

    dt = datetime_value
    if timezone.is_naive(dt):
        dt = timezone.make_aware(dt, timezone.utc)
    return timezone.localtime(dt, get_calendar_zone()).date()

# ---------- Dimensions ----------

class RestThresholdMixin(models.Model):
    """Reusable fields for rest timer color thresholds."""
    yellow_start_seconds = models.PositiveIntegerField(default=120)
    red_start_seconds = models.PositiveIntegerField(default=180)
    critical_start_seconds = models.PositiveIntegerField(default=300)

    class Meta:
        abstract = True

    def clean(self):
        super().clean()
        yellow = self.yellow_start_seconds
        red = self.red_start_seconds
        critical = self.critical_start_seconds
        if not (yellow < red < critical):
            raise ValidationError("Thresholds must increase: yellow < red < critical.")

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)

class CardioRoutine(models.Model):
    name = models.CharField(max_length=50, unique=True)

    class Meta:
        verbose_name = "Cardio Routine"
        verbose_name_plural = "Cardio Routines"
        ordering = ["name"]

    def __str__(self):
        return self.name


class UnitType(models.Model):
    """Time or Distance."""
    name = models.CharField(max_length=30, unique=True)

    class Meta:
        verbose_name = "Unit Type"
        verbose_name_plural = "Unit Types"
        ordering = ["name"]

    def __str__(self):
        return self.name


class SpeedName(models.Model):
    SPEED_TYPE_CHOICES = [
        ("distance/time", "Distance/Time"),
        ("time/distance", "Time/Distance"),
    ]
    name = models.CharField(max_length=50, unique=True)
    speed_type = models.CharField(max_length=20, choices=SPEED_TYPE_CHOICES)

    class Meta:
        verbose_name = "Speed Name"
        verbose_name_plural = "Speed Names"
        ordering = ["name"]

    def __str__(self):
        return self.name


class CardioUnit(models.Model):
    """
    Examples: Miles, Minutes, 400m Intervals, Meters, Yards.
    """
    name = models.CharField(max_length=50, unique=True)
    unit_type = models.ForeignKey(UnitType, on_delete=models.PROTECT, related_name="units")
    mround_numerator = models.PositiveIntegerField(default=1)
    mround_denominator = models.PositiveIntegerField(default=1)
    speed_name = models.ForeignKey(SpeedName, on_delete=models.PROTECT, related_name="units")
    mile_equiv_numerator = models.DecimalField(max_digits=10, decimal_places=3, default=1)
    mile_equiv_denominator = models.DecimalField(max_digits=10, decimal_places=3, default=1)

    class Meta:
        verbose_name = "Cardio Unit"
        verbose_name_plural = "Cardio Units"
        ordering = ["name"]

    def __str__(self):
        return self.name


class CardioWorkout(models.Model):
    """
    Examples: Mi Run, Tempo, Fast, x400, x200, x800, Rest.
    """
    name = models.CharField(max_length=50, unique=True)
    routine = models.ForeignKey(CardioRoutine, on_delete=models.PROTECT, related_name="workouts")
    unit = models.ForeignKey(CardioUnit, on_delete=models.PROTECT, related_name="workouts")
    priority_order = models.PositiveIntegerField(default=1)
    skip = models.BooleanField(default=False)
    difficulty = models.PositiveIntegerField(default=1)
    goal_distance = models.FloatField(default=3, help_text= 'The Distance for the goal')

    class Meta:
        verbose_name = "Cardio Workout"
        verbose_name_plural = "Cardio Workouts"
        ordering = ["routine__name", "priority_order", "name"]

    def __str__(self):
        return self.name

    @staticmethod
    def _round_up_to_tenth(value):
        if value is None or not isfinite(value):
            return None
        return ceil(value * 10) / 10.0

    @staticmethod
    def _min_next_value_for_uptrend(points, now_ts):
        clean = [(ts, val) for ts, val in points if isfinite(ts) and isfinite(val)]
        if not clean or not isfinite(now_ts):
            return None
        clean.sort(key=lambda item: item[0])
        start_ts = clean[0][0]
        if not isfinite(start_ts):
            return None
        day_seconds = 24 * 60 * 60
        normalized = []
        for ts, val in clean:
            x = ((ts - start_ts) / day_seconds) + 1
            if not isfinite(x):
                continue
            normalized.append((x, val))
        if not normalized:
            return None

        m = len(normalized)
        x0 = ((now_ts - start_ts) / day_seconds) + 1
        if not isfinite(x0) or x0 <= 0:
            return None

        sum_x = 0.0
        sum_y = 0.0
        sum_xy = 0.0
        for x, y in normalized:
            sum_x += x
            sum_y += y
            sum_xy += x * y

        a = (m * x0) - sum_x
        c = ((m + 1) * sum_xy) - (sum_x * sum_y) - (x0 * sum_y)
        if abs(a) < 1e-9:
            return {"type": "any"} if c >= 0 else {"type": "none"}

        threshold = -c / a
        if not isfinite(threshold):
            return None
        if a > 0:
            return {"type": "min", "value": threshold}
        return {"type": "max", "value": threshold}

class CardioWorkoutRestThreshold(RestThresholdMixin):
    workout = models.OneToOneField(
        CardioWorkout, on_delete=models.CASCADE, related_name="rest_threshold"
    )

    class Meta:
        verbose_name = "Cardio Workout Rest Threshold"
        verbose_name_plural = "Cardio Workout Rest Thresholds"
        ordering = ["workout__routine__name", "workout__name"]

    def __str__(self):
        return f"{self.workout.name} thresholds"

class CardioWorkoutTMSyncPreference(models.Model):
    """
    Per-workout default TM sync behavior for the logging UI.

    Values mirror frontend options:
      - run_to_tm: run interval time drives cumulative TM
      - tm_to_run: cumulative TM drives run interval time
      - run_equals_tm: two-way (keep run time and TM equal)
      - none: no automatic sync
    """
    SYNC_CHOICES = [
        ("run_to_tm", "Run time → TM"),
        ("tm_to_run", "TM → Run time"),
        ("run_equals_tm", "Run time = TM"),
        ("none", "No sync"),
    ]

    workout = models.OneToOneField(
        CardioWorkout, on_delete=models.CASCADE, related_name="tm_sync_pref"
    )
    default_tm_sync = models.CharField(max_length=32, choices=SYNC_CHOICES, default="run_to_tm")

    class Meta:
        verbose_name = "Cardio Workout TM Sync Preference"
        verbose_name_plural = "Cardio Workout TM Sync Preferences"
        ordering = ["workout__routine__name", "workout__name"]

    def __str__(self):
        return f"{self.workout.name}: {self.default_tm_sync}"


class CardioProgression(models.Model):
    """
    Defines the progression values per workout (distance, reps, minutes, etc.).
    """
    workout = models.ForeignKey(CardioWorkout, on_delete=models.CASCADE, related_name="progressions")
    progression_order = models.PositiveIntegerField()
    progression = models.FloatField()

    class Meta:
        verbose_name = "Cardio Progression"
        verbose_name_plural = "Cardio Progressions"
        ordering = ["workout__name", "progression_order"]
        unique_together = [("workout", "progression_order")]

    def __str__(self):
        return f"{self.workout.name} #{self.progression_order}: {self.progression}"


class CardioExercise(models.Model):
    """
    Run/Swim/Row/Bike with their unit and 3-mile equivalency.
    """
    name = models.CharField(max_length=50, unique=True)
    unit = models.ForeignKey(CardioUnit, on_delete=models.PROTECT, related_name="exercises")
    three_mile_equivalent = models.DecimalField(max_digits=8, decimal_places=2)

    class Meta:
        verbose_name = "Cardio Exercise"
        verbose_name_plural = "Cardio Exercises"
        ordering = ["name"]

    def __str__(self):
        return self.name


class RoutineScheduleDay(models.Model):
    day_number = models.PositiveSmallIntegerField(unique=True)
    routine_codes = models.JSONField(default=list)

    class Meta:
        verbose_name = "Routine Schedule Day"
        verbose_name_plural = "Routine Schedule Days"
        ordering = ["day_number"]

    def clean(self):
        super().clean()
        codes = list(self.routine_codes or [])
        if not codes:
            raise ValidationError("routine_codes must contain at least one routine.")
        if len(codes) > 2:
            raise ValidationError("routine_codes may contain at most two routines.")

        normalized = []
        seen = set()
        for raw_code in codes:
            code = str(raw_code or "").strip().lower()
            if code not in ROUTINE_SCHEDULE_ALLOWED_CODES:
                raise ValidationError(f"Unsupported routine code '{raw_code}'.")
            if code in seen:
                raise ValidationError("routine_codes cannot repeat a routine.")
            normalized.append(code)
            seen.add(code)

        if self.day_number < 1 or self.day_number > 7:
            raise ValidationError("day_number must be between 1 and 7.")

        self.routine_codes = normalized

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)

    @property
    def routine_labels(self):
        return [ROUTINE_SCHEDULE_CODE_LABELS.get(code, code) for code in self.routine_codes]

    @property
    def label(self):
        return " & ".join(self.routine_labels)

    def __str__(self):
        return f"Day {self.day_number}: {self.label}"


# ---------- Facts ----------

class CardioDailyLog(models.Model):
    """
    One session per start datetime.
    """
    datetime_started = models.DateTimeField()
    activity_date = models.DateField(db_index=True)
    workout = models.ForeignKey(CardioWorkout, on_delete=models.PROTECT, related_name="daily_logs")
    goal = models.FloatField(null=True, blank=True)
    total_completed = models.FloatField(null=True, blank=True)
    max_mph = models.FloatField(null=True, blank=True)
    avg_mph = models.FloatField(null=True, blank=True)
    goal_time = models.FloatField(null=True, blank=True)
    # Persisted speed goals (from Vw_MPH_Goal at time of logging)
    mph_goal = models.FloatField(null=True, blank=True)
    mph_goal_avg = models.FloatField(null=True, blank=True)
    # Persisted treadline slider percentages (1-100) at time of goal creation/edit.
    mph_goal_percentage = models.PositiveSmallIntegerField(null=True, blank=True)
    mph_goal_avg_percentage = models.PositiveSmallIntegerField(null=True, blank=True)
    minutes_elapsed = models.FloatField(null=True, blank=True)
    ignore = models.BooleanField(default=False)

    class Meta:
        verbose_name = "Cardio Daily Log"
        verbose_name_plural = "Cardio Daily Logs"
        ordering = ["-datetime_started"]

    def save(self, *args, **kwargs):
        if not self.activity_date:
            self.activity_date = derive_activity_date(self.datetime_started)
        return super().save(*args, **kwargs)

    def save(self, *args, **kwargs):
        if not self.activity_date:
            self.activity_date = derive_activity_date(self.datetime_started)
        return super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.datetime_started:%Y-%m-%d %H:%M} – {self.workout.routine.name}"


class CardioDailyLogDetail(models.Model):
    """
    Per-interval details for a session.
    """
    log = models.ForeignKey(CardioDailyLog, on_delete=models.CASCADE, related_name="details")
    datetime = models.DateTimeField()
    exercise = models.ForeignKey(CardioExercise, on_delete=models.PROTECT, related_name="log_details")
    running_minutes = models.PositiveIntegerField(null=True, blank=True)
    running_seconds = models.FloatField(null=True, blank=True)
    running_miles = models.FloatField(null=True, blank=True)
    running_mph = models.FloatField(null=True, blank=True)
    treadmill_time_minutes = models.PositiveIntegerField(null=True, blank=True)
    treadmill_time_seconds = models.FloatField(null=True, blank=True)

    class Meta:
        verbose_name = "Cardio Daily Log Detail"
        verbose_name_plural = "Cardio Daily Log Details"
        ordering = ["datetime"]

    def __str__(self):
        return f"{self.log_id} – {self.exercise.name} @ {self.datetime:%Y-%m-%d %H:%M}"

# ---------- Strength: Dimensions ----------

class StrengthRoutine(models.Model):
    name = models.CharField(max_length=50, unique=True)
    hundred_points_reps = models.PositiveIntegerField()
    hundred_points_weight = models.PositiveIntegerField()

    class Meta:
        verbose_name = "Strength Routine"
        verbose_name_plural = "Strength Routines"
        ordering = ["name"]

    def __str__(self):
        return self.name

class Bodyweight(models.Model):
    bodyweight = models.FloatField(default=186)

    def save(self, *args, **kwargs):
        if not self.pk and Bodyweight.objects.exists():
            raise ValidationError("Only one Bodyweight instance is allowed.")
        return super().save(*args, **kwargs)

    def __str__(self):
        return f"Bodyweight: {self.bodyweight}"

    class Meta:
        verbose_name = "Bodyweight"
        verbose_name_plural = "Bodyweight"


class StrengthExercise(models.Model):
    name = models.CharField(max_length=80, unique=True)
    routine = models.ForeignKey(
        StrengthRoutine, on_delete=models.PROTECT, related_name="exercises"
    )
    bodyweight_percentage = models.FloatField(default=0)

    class Meta:
        verbose_name = "Strength Exercise"
        verbose_name_plural = "Strength Exercises"
        ordering = ["routine__name", "name"]

    def __str__(self):
        return f"{self.name} ({self.routine.name})"

    @property
    def default_weight(self):
        try:
            bw = Bodyweight.objects.first()
            if self.bodyweight_percentage > 0 and bw:
                return (self.bodyweight_percentage / 100.0) * bw.bodyweight
            return self.routine.hundred_points_weight
        except Bodyweight.DoesNotExist:
            return self.routine.hundred_points_weight
    @property
    def standard_weight(self):
        try:
            bw = Bodyweight.objects.first()
            if self.bodyweight_percentage > 0 and bw:
                return (self.bodyweight_percentage / 100.0) * bw.bodyweight
            return 0
        except Bodyweight.DoesNotExist:
            return 0



class StrengthExerciseRestThreshold(RestThresholdMixin):
    exercise = models.OneToOneField(
        StrengthExercise, on_delete=models.CASCADE, related_name="rest_threshold"
    )

    class Meta:
        verbose_name = "Strength Exercise Rest Threshold"
        verbose_name_plural = "Strength Exercise Rest Thresholds"
        ordering = ["exercise__routine__name", "exercise__name"]

    def __str__(self):
        return f"{self.exercise.name} thresholds"

# ---------- Strength: Facts & Plans ----------

class StrengthVolumeBucket(models.Model):
    min_max_reps = models.PositiveIntegerField()
    max_max_reps = models.PositiveIntegerField()
    training_set_reps = models.FloatField()
    daily_volume_min = models.FloatField()
    daily_volume_max = models.FloatField()
    weekly_volume_min = models.FloatField()
    weekly_volume_max = models.FloatField()

    class Meta:
        verbose_name = "Strength Volume Bucket"
        verbose_name_plural = "Strength Volume Buckets"
        ordering = ["min_max_reps", "max_max_reps"]
        constraints = [
            models.UniqueConstraint(
                fields=["min_max_reps", "max_max_reps"],
                name="uniq_strengthvolumebucket_range",
            ),
        ]

    @property
    def range_label(self):
        return f"{self.min_max_reps}-{self.max_max_reps}"

    @property
    def increment(self):
        span = self.max_max_reps - self.min_max_reps
        if span <= 0:
            return 0.0
        return (self.daily_volume_max - self.daily_volume_min) / span

    def __str__(self):
        return self.range_label


class StrengthDailyLog(models.Model):
    """Fact_Strength_Daily_Log"""
    datetime_started = models.DateTimeField()
    activity_date = models.DateField(db_index=True)
    routine = models.ForeignKey(StrengthRoutine, on_delete=models.PROTECT, related_name="daily_logs")
    rep_goal = models.FloatField(null=True, blank=True)
    total_reps_completed = models.FloatField(null=True, blank=True)
    max_reps_goal = models.FloatField(null=True, blank=True)
    max_reps = models.FloatField(null=True, blank=True)
    max_weight_goal = models.FloatField(null=True, blank=True)
    max_weight = models.FloatField(null=True, blank=True)
    minutes_elapsed = models.FloatField(null=True, blank=True)
    # Persisted reps-per-hour goals at time of logging
    rph_goal = models.FloatField(null=True, blank=True)
    rph_goal_avg = models.FloatField(null=True, blank=True)
    ignore = models.BooleanField(default=False)

    class Meta:
        verbose_name = "Strength Daily Log"
        verbose_name_plural = "Strength Daily Logs"
        ordering = ["-datetime_started"]

    def save(self, *args, **kwargs):
        if not self.activity_date:
            self.activity_date = derive_activity_date(self.datetime_started)
        return super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.datetime_started:%Y-%m-%d %H:%M} – {self.routine.name}"


class StrengthDailyLogDetail(models.Model):
    """Fact_Strength_Daily_Log_Details"""
    log = models.ForeignKey(StrengthDailyLog, on_delete=models.CASCADE, related_name="details")
    datetime = models.DateTimeField()
    exercise = models.ForeignKey(StrengthExercise, on_delete=models.PROTECT, related_name="log_details")
    reps = models.PositiveIntegerField(null=True, blank=True)
    weight = models.FloatField(null=True, blank=True)

    class Meta:
        verbose_name = "Strength Daily Log Detail"
        verbose_name_plural = "Strength Daily Log Details"
        ordering = ["-datetime", "-id"]

    def __str__(self):
        return f"{self.log_id} – {self.exercise.name} @ {self.datetime:%Y-%m-%d %H:%M}"

# ---------- Supplemental: Dimensions ----------

class SupplementalRoutine(models.Model):
    UNIT_CHOICES = [
        ("Time", "Time"),
        ("Reps", "Reps"),
    ]
    name = models.CharField(max_length=50, unique=True)
    unit = models.CharField(max_length=10, choices=UNIT_CHOICES)
    step_value = models.FloatField(default=5.0)
    max_set = models.FloatField(default=60.0)
    step_weight = models.FloatField(default=5.0)
    rest_yellow_start_seconds = models.PositiveIntegerField(default=60)
    rest_red_start_seconds = models.PositiveIntegerField(default=90)

    class Meta:
        verbose_name = "Supplemental Routine"
        verbose_name_plural = "Supplemental Routines"
        ordering = ["name"]

    def __str__(self):
        return self.name


# ---------- Supplemental: Facts ----------

class SupplementalDailyLog(models.Model):
    """
    Session-level supplemental log.
    'total_completed' is cumulative completed units (seconds or reps) across all sets.
    """
    datetime_started = models.DateTimeField()
    activity_date = models.DateField(db_index=True)
    routine = models.ForeignKey(
        SupplementalRoutine, on_delete=models.PROTECT, related_name="daily_logs"
    )
    unit_snapshot = models.CharField(max_length=10, choices=SupplementalRoutine.UNIT_CHOICES)
    goal = models.CharField(max_length=80, null=True, blank=True)
    goal_set_1 = models.FloatField(null=True, blank=True)
    goal_set_2 = models.FloatField(null=True, blank=True)
    goal_set_3 = models.FloatField(null=True, blank=True)
    goal_weight_set_1 = models.FloatField(null=True, blank=True)
    goal_weight_set_2 = models.FloatField(null=True, blank=True)
    goal_weight_set_3 = models.FloatField(null=True, blank=True)
    rest_yellow_start_seconds = models.PositiveIntegerField(null=True, blank=True)
    rest_red_start_seconds = models.PositiveIntegerField(null=True, blank=True)
    total_completed = models.FloatField(null=True, blank=True)
    ignore = models.BooleanField(default=False)

    class Meta:
        verbose_name = "Supplemental Daily Log"
        verbose_name_plural = "Supplemental Daily Logs"
        ordering = ["-datetime_started"]

    def save(self, *args, **kwargs):
        if not self.activity_date:
            self.activity_date = derive_activity_date(self.datetime_started)
        if not self.unit_snapshot and self.routine_id:
            self.unit_snapshot = getattr(self.routine, "unit", "") or ""
        return super().save(*args, **kwargs)

    @property
    def effective_unit(self):
        return self.unit_snapshot or getattr(self.routine, "unit", None)

    def __str__(self):
        return f"{self.datetime_started:%Y-%m-%d %H:%M} x {self.routine.name}"


class SupplementalDailyLogDetail(models.Model):
    """
    Per-set detail. 'unit_count' is seconds for Time routines or reps for Reps routines.
    'set_number' tracks the set index within the session, and
    'weight' captures any added load once max_set is reached.
    """
    log = models.ForeignKey(
        SupplementalDailyLog, on_delete=models.CASCADE, related_name="details"
    )
    datetime = models.DateTimeField()
    unit_count = models.FloatField()
    set_number = models.PositiveSmallIntegerField(null=True, blank=True)
    weight = models.FloatField(null=True, blank=True)

    class Meta:
        verbose_name = "Supplemental Daily Log Detail"
        verbose_name_plural = "Supplemental Daily Log Details"
        ordering = ["datetime"]

    def __str__(self):
        return f"{self.log_id} @ {self.datetime:%Y-%m-%d %H:%M}"
class CardioGoals(models.Model):
    RIEGEL_MAX_6_MONTHS_GOAL_TYPE = "riegel_predicted_max_mph_6months"
    RIEGEL_AVG_6_MONTHS_GOAL_TYPE = "riegel_predicted_avg_mph_6months"
    RIEGEL_MAX_8_WEEKS_GOAL_TYPE = "riegel_predicted_max_mph_8weeks"
    RIEGEL_AVG_8_WEEKS_GOAL_TYPE = "riegel_predicted_avg_mph_8weeks"
    GOAL_TYPE_CHOICES = [
        ("highest_max_mph_6months", "Highest Max MPH in Last 6 Months"),
        ("highest_avg_mph_6months", "Highest Avg MPH in Last 6 Months"),
        ("highest_max_mph_8weeks", "Highest Max MPH in Last 8 Weeks"),
        ("highest_avg_mph_8weeks", "Highest Avg MPH in Last 8 Weeks"),
        ("last_max_mph", "Last Max MPH"),
        ("last_avg_mph", "Last Avg MPH"),
        (
            "upward_trend_threshold_max_mph_6months",
            "Minimum Max MPH for Upward Trend (Last 6 Months)",
        ),
        (
            "upward_trend_threshold_avg_mph_6months",
            "Minimum Avg MPH for Upward Trend (Last 6 Months)",
        ),
        (
            "upward_trend_threshold_max_mph_8weeks",
            "Minimum Max MPH for Upward Trend (Last 8 Weeks)",
        ),
        (
            "upward_trend_threshold_avg_mph_8weeks",
            "Minimum Avg MPH for Upward Trend (Last 8 Weeks)",
        ),
        (
            "current_trend_max_mph_6months",
            "Current Max MPH Trend (Last 6 Months)",
        ),
        (
            "current_trend_avg_mph_6months",
            "Current Avg MPH Trend (Last 6 Months)",
        ),
        (
            "current_trend_max_mph_8weeks",
            "Current Max MPH Trend (Last 8 Weeks)",
        ),
        (
            "current_trend_avg_mph_8weeks",
            "Current Avg MPH Trend (Last 8 Weeks)",
        ),
        (
            RIEGEL_MAX_6_MONTHS_GOAL_TYPE,
            "Riegel Predicted Max MPH 6 Months (T2 = T1 * (D2 / D1)^1.06)",
        ),
        (
            RIEGEL_AVG_6_MONTHS_GOAL_TYPE,
            "Riegel Predicted Avg MPH 6 Months (T2 = T1 * (D2 / D1)^1.06)",
        ),
        (
            RIEGEL_MAX_8_WEEKS_GOAL_TYPE,
            "Riegel Predicted Max MPH 8 Weeks (T2 = T1 * (D2 / D1)^1.06)",
        ),
        (
            RIEGEL_AVG_8_WEEKS_GOAL_TYPE,
            "Riegel Predicted Avg MPH 8 Weeks (T2 = T1 * (D2 / D1)^1.06)",
        ),
    ]
    GOAL_TYPES = tuple(choice[0] for choice in GOAL_TYPE_CHOICES)
    MAX_AVG_TYPE_CHOICES = [
        ("max", "Max"),
        ("avg", "Avg"),
    ]

    workout = models.ForeignKey(
        CardioWorkout, on_delete=models.CASCADE, related_name="goal_metrics"
    )
    goal_type = models.CharField(
        max_length=64,
        choices=GOAL_TYPE_CHOICES,
        default="upward_trend_threshold_max_mph_8weeks",
    )
    max_avg_type = models.CharField(
        max_length=3,
        choices=MAX_AVG_TYPE_CHOICES,
        default="max",
    )
    mph_raw = models.FloatField(null=True, blank=True)
    mph_rounded = models.FloatField(null=True, blank=True)
    inter_rank = models.PositiveIntegerField(null=True, blank=True)
    last_updated = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Cardio Goal"
        verbose_name_plural = "Cardio Goals"
        ordering = ["workout__routine__name", "workout__name", "max_avg_type", "goal_type"]
        constraints = [
            models.UniqueConstraint(
                fields=["workout", "goal_type"],
                name="uniq_cardiogoals_workout_goal_type",
            ),
            models.UniqueConstraint(
                fields=["workout", "mph_rounded"],
                condition=models.Q(mph_rounded__isnull=False),
                name="uniq_cardiogoals_workout_mph_rounded",
            ),
        ]

    def __str__(self):
        return f"{self.workout.name} - {self.max_avg_type} - {self.goal_type}"

    @staticmethod
    def round_up_to_tenth(value):
        try:
            number = float(value)
        except (TypeError, ValueError):
            return None
        if not isfinite(number):
            return None
        return ceil(number * 10.0) / 10.0

    @classmethod
    def infer_max_avg_type_for_goal_type(cls, goal_type):
        text = str(goal_type or "").lower()
        if "_avg_" in text or text.endswith("_avg_mph"):
            return "avg"
        return "max"

    @classmethod
    def riegel_goal_types(cls):
        return {
            cls.RIEGEL_MAX_6_MONTHS_GOAL_TYPE,
            cls.RIEGEL_AVG_6_MONTHS_GOAL_TYPE,
            cls.RIEGEL_MAX_8_WEEKS_GOAL_TYPE,
            cls.RIEGEL_AVG_8_WEEKS_GOAL_TYPE,
        }

    @classmethod
    def is_riegel_goal_type(cls, goal_type):
        return goal_type in cls.riegel_goal_types()

    @classmethod
    def goal_type_variants(cls, goal_type):
        return (cls.infer_max_avg_type_for_goal_type(goal_type),)

    @classmethod
    def goal_type_pairs(cls):
        pairs = []
        for goal_type in cls.GOAL_TYPES:
            for max_avg_type in cls.goal_type_variants(goal_type):
                pairs.append((goal_type, max_avg_type))
        return pairs

    def recompute(self, now=None):
        from .cardio_goals_utils import sync_cardio_goals_for_workout

        sync_cardio_goals_for_workout(self.workout_id, now=now)
        self.refresh_from_db()
        return self

    @classmethod
    def recompute_for_workout(cls, workout_id, now=None):
        from .cardio_goals_utils import sync_cardio_goals_for_workout

        return sync_cardio_goals_for_workout(workout_id, now=now)


class StrengthGoals(models.Model):
    GOAL_TYPE_CHOICES = [
        ("highest_max_rph_6months", "Highest Max RPH in Last 6 Months"),
        ("highest_avg_rph_6months", "Highest Avg RPH in Last 6 Months"),
        ("highest_max_rph_8weeks", "Highest Max RPH in Last 8 Weeks"),
        ("highest_avg_rph_8weeks", "Highest Avg RPH in Last 8 Weeks"),
        ("last_max_rph", "Last Max RPH"),
        ("last_avg_rph", "Last Avg RPH"),
        (
            "upward_trend_threshold_max_rph_6months",
            "Minimum Max RPH for Upward Trend (Last 6 Months)",
        ),
        (
            "upward_trend_threshold_avg_rph_6months",
            "Minimum Avg RPH for Upward Trend (Last 6 Months)",
        ),
        (
            "upward_trend_threshold_max_rph_8weeks",
            "Minimum Max RPH for Upward Trend (Last 8 Weeks)",
        ),
        (
            "upward_trend_threshold_avg_rph_8weeks",
            "Minimum Avg RPH for Upward Trend (Last 8 Weeks)",
        ),
        (
            "current_trend_max_rph_6months",
            "Current Max RPH Trend (Last 6 Months)",
        ),
        (
            "current_trend_avg_rph_6months",
            "Current Avg RPH Trend (Last 6 Months)",
        ),
        (
            "current_trend_max_rph_8weeks",
            "Current Max RPH Trend (Last 8 Weeks)",
        ),
        (
            "current_trend_avg_rph_8weeks",
            "Current Avg RPH Trend (Last 8 Weeks)",
        ),
    ]
    GOAL_TYPES = tuple(choice[0] for choice in GOAL_TYPE_CHOICES)
    MAX_AVG_TYPE_CHOICES = [
        ("max", "Max"),
        ("avg", "Avg"),
    ]

    routine = models.ForeignKey(
        StrengthRoutine, on_delete=models.CASCADE, related_name="goal_metrics"
    )
    goal_type = models.CharField(
        max_length=64,
        choices=GOAL_TYPE_CHOICES,
        default="upward_trend_threshold_max_rph_8weeks",
    )
    max_avg_type = models.CharField(
        max_length=3,
        choices=MAX_AVG_TYPE_CHOICES,
        default="max",
    )
    rph_raw = models.FloatField(null=True, blank=True)
    rph_rounded = models.FloatField(null=True, blank=True)
    inter_rank = models.PositiveIntegerField(null=True, blank=True)
    last_updated = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Strength Goal"
        verbose_name_plural = "Strength Goals"
        ordering = ["routine__name", "max_avg_type", "goal_type"]
        constraints = [
            models.UniqueConstraint(
                fields=["routine", "goal_type"],
                name="uniq_strengthgoals_routine_goal_type",
            ),
            models.UniqueConstraint(
                fields=["routine", "rph_rounded"],
                condition=models.Q(rph_rounded__isnull=False),
                name="uniq_strengthgoals_routine_rph_rounded",
            ),
        ]

    def __str__(self):
        return f"{self.routine.name} - {self.max_avg_type} - {self.goal_type}"

    @staticmethod
    def round_up_to_whole(value):
        try:
            number = float(value)
        except (TypeError, ValueError):
            return None
        if not isfinite(number):
            return None
        return float(ceil(number))

    @classmethod
    def infer_max_avg_type_for_goal_type(cls, goal_type):
        text = str(goal_type or "").lower()
        if "_avg_" in text or text.endswith("_avg_rph"):
            return "avg"
        return "max"

    @classmethod
    def goal_type_variants(cls, goal_type):
        return (cls.infer_max_avg_type_for_goal_type(goal_type),)

    @classmethod
    def goal_type_pairs(cls):
        pairs = []
        for goal_type in cls.GOAL_TYPES:
            for max_avg_type in cls.goal_type_variants(goal_type):
                pairs.append((goal_type, max_avg_type))
        return pairs

    def recompute(self, now=None):
        from .strength_goals_utils import sync_strength_goals_for_routine

        sync_strength_goals_for_routine(self.routine_id, now=now)
        self.refresh_from_db()
        return self

    @classmethod
    def recompute_for_routine(cls, routine_id, now=None):
        from .strength_goals_utils import sync_strength_goals_for_routine

        return sync_strength_goals_for_routine(routine_id, now=now)


class SupplementalGoals(models.Model):
    GOAL_TYPE_CHOICES = [
        ("highest_max_unit_6months", "Highest Max Unit in Last 6 Months"),
        ("highest_avg_unit_6months", "Highest Avg Unit in Last 6 Months"),
        ("highest_max_unit_8weeks", "Highest Max Unit in Last 8 Weeks"),
        ("highest_avg_unit_8weeks", "Highest Avg Unit in Last 8 Weeks"),
        ("last_max_unit", "Last Max Unit"),
        ("last_avg_unit", "Last Avg Unit"),
        (
            "upward_trend_threshold_max_unit_6months",
            "Minimum Max Unit for Upward Trend (Last 6 Months)",
        ),
        (
            "upward_trend_threshold_avg_unit_6months",
            "Minimum Avg Unit for Upward Trend (Last 6 Months)",
        ),
        (
            "upward_trend_threshold_max_unit_8weeks",
            "Minimum Max Unit for Upward Trend (Last 8 Weeks)",
        ),
        (
            "upward_trend_threshold_avg_unit_8weeks",
            "Minimum Avg Unit for Upward Trend (Last 8 Weeks)",
        ),
        (
            "current_trend_max_unit_6months",
            "Current Max Unit Trend (Last 6 Months)",
        ),
        (
            "current_trend_avg_unit_6months",
            "Current Avg Unit Trend (Last 6 Months)",
        ),
        (
            "current_trend_max_unit_8weeks",
            "Current Max Unit Trend (Last 8 Weeks)",
        ),
        (
            "current_trend_avg_unit_8weeks",
            "Current Avg Unit Trend (Last 8 Weeks)",
        ),
    ]
    GOAL_TYPES = tuple(choice[0] for choice in GOAL_TYPE_CHOICES)
    MAX_AVG_TYPE_CHOICES = [
        ("max", "Max"),
        ("avg", "Avg"),
    ]

    routine = models.ForeignKey(
        SupplementalRoutine, on_delete=models.CASCADE, related_name="goal_metrics"
    )
    goal_type = models.CharField(
        max_length=64,
        choices=GOAL_TYPE_CHOICES,
        default="upward_trend_threshold_max_unit_8weeks",
    )
    max_avg_type = models.CharField(
        max_length=3,
        choices=MAX_AVG_TYPE_CHOICES,
        default="max",
    )
    unit_raw = models.FloatField(null=True, blank=True)
    unit_rounded = models.FloatField(null=True, blank=True)
    inter_rank = models.PositiveIntegerField(null=True, blank=True)
    last_updated = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Supplemental Goal"
        verbose_name_plural = "Supplemental Goals"
        ordering = ["routine__name", "max_avg_type", "goal_type"]
        constraints = [
            models.UniqueConstraint(
                fields=["routine", "goal_type"],
                name="uniq_supplementalgoals_routine_goal_type",
            ),
            models.UniqueConstraint(
                fields=["routine", "unit_rounded"],
                condition=models.Q(unit_rounded__isnull=False),
                name="uniq_supplementalgoals_routine_unit_rounded",
            ),
        ]

    def __str__(self):
        return f"{self.routine.name} - {self.max_avg_type} - {self.goal_type}"

    @staticmethod
    def round_up_to_whole(value):
        try:
            number = float(value)
        except (TypeError, ValueError):
            return None
        if not isfinite(number):
            return None
        return float(ceil(number))

    @classmethod
    def infer_max_avg_type_for_goal_type(cls, goal_type):
        text = str(goal_type or "").lower()
        if "_avg_" in text or text.endswith("_avg_unit"):
            return "avg"
        return "max"

    @classmethod
    def goal_type_variants(cls, goal_type):
        return (cls.infer_max_avg_type_for_goal_type(goal_type),)

    @classmethod
    def goal_type_pairs(cls):
        pairs = []
        for goal_type in cls.GOAL_TYPES:
            for max_avg_type in cls.goal_type_variants(goal_type):
                pairs.append((goal_type, max_avg_type))
        return pairs

    def recompute(self, now=None):
        from .supplemental_goals_utils import sync_supplemental_goals_for_routine

        sync_supplemental_goals_for_routine(self.routine_id, now=now)
        self.refresh_from_db()
        return self

    @classmethod
    def recompute_for_routine(cls, routine_id, now=None):
        from .supplemental_goals_utils import sync_supplemental_goals_for_routine

        return sync_supplemental_goals_for_routine(routine_id, now=now)

