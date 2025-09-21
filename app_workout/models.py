from django.db import models
from django.core.exceptions import ValidationError

# ---------- Dimensions ----------

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

    class Meta:
        verbose_name = "Cardio Workout"
        verbose_name_plural = "Cardio Workouts"
        ordering = ["routine__name", "priority_order", "name"]

    def __str__(self):
        return self.name


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


class Program(models.Model):
    """
    PFT / CFT / HFT with a single 'selected' flag.
    """
    name = models.CharField(max_length=50, unique=True)
    selected = models.BooleanField(default=False)

    class Meta:
        verbose_name = "Program"
        verbose_name_plural = "Programs"
        ordering = ["name"]

    def __str__(self):
        return self.name


class CardioPlan(models.Model):
    """
    Ordered plan of routines for a program.
    """
    program = models.ForeignKey(Program, on_delete=models.CASCADE, related_name="plans")
    routine = models.ForeignKey(CardioRoutine, on_delete=models.PROTECT, related_name="plans")
    routine_order = models.PositiveIntegerField()

    class Meta:
        verbose_name = "Cardio Plan"
        verbose_name_plural = "Cardio Plans"
        ordering = ["program__name", "routine_order"]
        unique_together = [("program", "routine_order")]

    def __str__(self):
        return f"{self.program.name} #{self.routine_order}: {self.routine.name}"


# ---------- Facts ----------

class CardioDailyLog(models.Model):
    """
    One session per start datetime.
    """
    datetime_started = models.DateTimeField()
    workout = models.ForeignKey(CardioWorkout, on_delete=models.PROTECT, related_name="daily_logs")
    goal = models.FloatField(null=True, blank=True)
    total_completed = models.FloatField(null=True, blank=True)
    max_mph = models.FloatField(null=True, blank=True)
    avg_mph = models.FloatField(null=True, blank=True)
    # Persisted speed goals (from Vw_MPH_Goal at time of logging)
    mph_goal = models.FloatField(null=True, blank=True)
    mph_goal_avg = models.FloatField(null=True, blank=True)
    minutes_elapsed = models.FloatField(null=True, blank=True)

    class Meta:
        verbose_name = "Cardio Daily Log"
        verbose_name_plural = "Cardio Daily Logs"
        ordering = ["-datetime_started"]

    def __str__(self):
        return f"{self.datetime_started:%Y-%m-%d %H:%M} – {self.workout.routine.name}"


class CardioWorkoutWarmup(models.Model):
    """
    Stores per-workout cardio warmup defaults used when seeding treadmill time.
    """

    workout = models.OneToOneField(
        CardioWorkout, on_delete=models.CASCADE, related_name="warmup_pref"
    )
    warmup_minutes = models.FloatField(null=True, blank=True)
    warmup_mph = models.FloatField(null=True, blank=True)

    class Meta:
        verbose_name = "Cardio Workout Warmup"
        verbose_name_plural = "Cardio Workout Warmups"
        ordering = ["workout__routine__name", "workout__name"]

    def __str__(self):
        minutes = self.warmup_minutes or 0
        mph = self.warmup_mph or 0
        return f"{self.workout.name}: {minutes} min @ {mph} mph"


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


# ---------- Strength: Facts & Plans ----------

class PullProgression(models.Model):
    """Your Fact_Pull_Progression table."""
    current_max = models.PositiveIntegerField()
    training_set = models.PositiveIntegerField()
    daily_volume = models.PositiveIntegerField()
    weekly_volume = models.PositiveIntegerField()

    class Meta:
        verbose_name = "Pull Progression"
        verbose_name_plural = "Pull Progressions"
        ordering = ["current_max"]

    def __str__(self):
        return f"Pull @ {self.current_max}"


class StrengthPlan(models.Model):
    """Fact_Strength_Plans"""
    routine = models.ForeignKey(StrengthRoutine, on_delete=models.PROTECT, related_name="plans")
    program = models.ForeignKey(Program, on_delete=models.CASCADE, related_name="strength_plans")

    class Meta:
        verbose_name = "Strength Plan"
        verbose_name_plural = "Strength Plans"
        ordering = ["program__name", "routine__name"]

    def __str__(self):
        return f"{self.program.name} – {self.routine.name}"


class StrengthDailyLog(models.Model):
    """Fact_Strength_Daily_Log"""
    datetime_started = models.DateTimeField()
    routine = models.ForeignKey(StrengthRoutine, on_delete=models.PROTECT, related_name="daily_logs")
    rep_goal = models.FloatField(null=True, blank=True)
    total_reps_completed = models.FloatField(null=True, blank=True)
    max_reps = models.FloatField(null=True, blank=True)
    max_weight = models.FloatField(null=True, blank=True)
    minutes_elapsed = models.FloatField(null=True, blank=True)
    # Persisted reps-per-hour goals at time of logging
    rph_goal = models.FloatField(null=True, blank=True)
    rph_goal_avg = models.FloatField(null=True, blank=True)

    class Meta:
        verbose_name = "Strength Daily Log"
        verbose_name_plural = "Strength Daily Logs"
        ordering = ["-datetime_started"]

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
        ordering = ["datetime"]

    def __str__(self):
        return f"{self.log_id} – {self.exercise.name} @ {self.datetime:%Y-%m-%d %H:%M}"



# ---------- Strength: Read-only View ----------

'''
WITH
pull AS (
  SELECT current_max, training_set, daily_volume, weekly_volume
  FROM app_workout_pullprogression
),
stats AS (
  SELECT
    COUNT(*)                          AS n,
    SUM(current_max)                  AS sx,
    SUM(training_set)                 AS sy_ts,
    SUM(daily_volume)                 AS sy_dv,
    SUM(weekly_volume)                AS sy_wv,
    SUM(current_max * training_set)   AS sxy_ts,
    SUM(current_max * daily_volume)   AS sxy_dv,
    SUM(current_max * weekly_volume)  AS sxy_wv,
    SUM(current_max * current_max)    AS sxx
  FROM pull
),
coef AS (
  SELECT
    (1.0 * (n*sxy_ts - sx*sy_ts)) / (n*sxx - sx*sx) AS m_ts,
    (1.0 * (n*sxy_dv - sx*sy_dv)) / (n*sxx - sx*sx) AS m_dv,
    (1.0 * (n*sxy_wv - sx*sy_wv)) / (n*sxx - sx*sx) AS m_wv,
    (1.0 * (sy_ts)) / n - ((1.0 * (n*sxy_ts - sx*sy_ts)) / (n*sxx - sx*sx)) * (1.0 * sx) / n AS b_ts,
    (1.0 * (sy_dv)) / n - ((1.0 * (n*sxy_dv - sx*sy_dv)) / (n*sxx - sx*sx)) * (1.0 * sx) / n AS b_dv,
    (1.0 * (sy_wv)) / n - ((1.0 * (n*sxy_wv - sx*sy_wv)) / (n*sxx - sx*sx)) * (1.0 * sx) / n AS b_wv
  FROM stats
),
series AS (
  WITH RECURSIVE s(i) AS (
    SELECT 1
    UNION ALL
    SELECT i+1 FROM s WHERE i < 25
  )
  SELECT i AS progression_order, i AS current_max FROM s
),
pull_pred AS (
  SELECT
    s.progression_order,
    'Pull'                       AS routine_name,
    1.0 * s.current_max          AS current_max,
    (c.b_ts + c.m_ts * s.current_max)  AS training_set,
    (c.b_dv + c.m_dv * s.current_max)  AS daily_volume,
    (c.b_wv + c.m_wv * s.current_max)  AS weekly_volume
  FROM series s, coef c
),
ratio AS (
  SELECT
    (SELECT 1.0 * hundred_points_reps
       FROM app_workout_strengthroutine
       WHERE name = 'Push')
    /
    (SELECT 1.0 * hundred_points_reps
       FROM app_workout_strengthroutine
       WHERE name = 'Pull') AS r
),
push_pred AS (
  SELECT
    p.progression_order,
    'Push' AS routine_name,
    p.current_max * r           AS current_max,
    p.training_set * r          AS training_set,
    p.daily_volume * r          AS daily_volume,
    p.weekly_volume * r         AS weekly_volume
  FROM pull_pred p, ratio
),
all_rows AS (
  SELECT * FROM pull_pred
  UNION ALL
  SELECT * FROM push_pred
)
SELECT
  ROW_NUMBER() OVER (ORDER BY routine_name, progression_order) AS id,
  progression_order,
  routine_name,
  current_max,
  training_set,
  daily_volume,
  weekly_volume
FROM all_rows
ORDER BY routine_name, progression_order
'''

class VwStrengthProgression(models.Model):
    id = models.IntegerField(primary_key=True)
    progression_order = models.PositiveIntegerField() #synonymous with level
    routine_name = models.CharField(max_length=50)
    current_max = models.FloatField()
    training_set = models.FloatField()
    daily_volume = models.FloatField()
    weekly_volume = models.FloatField()

    class Meta:
        managed = False
        db_table = "Vw_Strength_Progression"
        ordering = ["routine_name", "progression_order"]

    def __str__(self):
        return f"{self.routine_name} #{self.progression_order}"
    

# ---------- Supplemental: Dimensions ----------

class SupplementalRoutine(models.Model):
    UNIT_CHOICES = [
        ("Time", "Time"),
        ("Reps", "Reps"),
    ]
    name = models.CharField(max_length=50, unique=True)
    unit = models.CharField(max_length=10, choices=UNIT_CHOICES)

    class Meta:
        verbose_name = "Supplemental Routine"
        verbose_name_plural = "Supplemental Routines"
        ordering = ["name"]

    def __str__(self):
        return self.name


class SupplementalWorkout(models.Model):
    name = models.CharField(max_length=80, unique=True)

    class Meta:
        verbose_name = "Supplemental Workout"
        verbose_name_plural = "Supplemental Workouts"
        ordering = ["name"]

    def __str__(self):
        return self.name


class SupplementalWorkoutDescription(models.Model):
    GOAL_METRIC_CHOICES = [
        ("Max Unit", "Max Unit"),   # e.g., max seconds or max reps depending on routine.unit
        ("Max Sets", "Max Sets"),
    ]

    routine = models.ForeignKey(
        SupplementalRoutine, on_delete=models.PROTECT, related_name="workout_descriptions"
    )
    workout = models.ForeignKey(
        SupplementalWorkout, on_delete=models.PROTECT, related_name="routine_descriptions"
    )
    description = models.TextField()
    goal_metric = models.CharField(max_length=20, choices=GOAL_METRIC_CHOICES)

    class Meta:
        verbose_name = "Supplemental Workout Description"
        verbose_name_plural = "Supplemental Workout Descriptions"
        ordering = ["routine__name", "workout__name"]
        unique_together = [("routine", "workout")]

    def __str__(self):
        return f"{self.routine.name} – {self.workout.name}"


# ---------- Supplemental: Facts ----------

class SupplementalDailyLog(models.Model):
    """
    Session-level log. 'goal' can mirror the description (e.g., 'Max Unit', 'Max Sets').
    'total_completed' is a generic number: seconds for Time routines, reps for Reps routines.
    """
    datetime_started = models.DateTimeField()
    routine = models.ForeignKey(
        SupplementalRoutine, on_delete=models.PROTECT, related_name="daily_logs"
    )
    goal = models.CharField(max_length=80, null=True, blank=True)
    total_completed = models.FloatField(null=True,blank=True)

    class Meta:
        verbose_name = "Supplemental Daily Log"
        verbose_name_plural = "Supplemental Daily Logs"
        ordering = ["-datetime_started"]

    def __str__(self):
        return f"{self.datetime_started:%Y-%m-%d %H:%M} – {self.routine.name}"


class SupplementalDailyLogDetail(models.Model):
    """
    Per-interval detail. 'unit_count' is seconds for Time routines or reps for Reps routines.
    """
    log = models.ForeignKey(
        SupplementalDailyLog, on_delete=models.CASCADE, related_name="details"
    )
    datetime = models.DateTimeField()
    unit_count = models.FloatField()

    class Meta:
        verbose_name = "Supplemental Daily Log Detail"
        verbose_name_plural = "Supplemental Daily Log Details"
        ordering = ["datetime"]

    def __str__(self):
        return f"{self.log_id} @ {self.datetime:%Y-%m-%d %H:%M}"


# ---------- Supplemental: Plans ----------

class SupplementalPlan(models.Model):
    """
    Maps a supplemental routine into a Program (PFT / CFT / HFT).
    """
    routine = models.ForeignKey(
        SupplementalRoutine, on_delete=models.PROTECT, related_name="plans"
    )
    program = models.ForeignKey(
        Program, on_delete=models.CASCADE, related_name="supplemental_plans"
    )

    class Meta:
        verbose_name = "Supplemental Plan"
        verbose_name_plural = "Supplemental Plans"
        ordering = ["program__name", "routine__name"]
        unique_together = [("routine", "program")]

    def __str__(self):
        return f"{self.program.name} – {self.routine.name}"

