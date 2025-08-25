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
    minutes_elapsed = models.FloatField(null=True, blank=True)

    class Meta:
        verbose_name = "Cardio Daily Log"
        verbose_name_plural = "Cardio Daily Logs"
        ordering = ["-datetime_started"]

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


class StrengthCurrentMax(models.Model):
    """Fact_Strength_Current_Max"""
    current_max = models.FloatField()
    datetime_accomplished = models.DateTimeField()
    routine = models.ForeignKey(StrengthRoutine, on_delete=models.PROTECT, related_name="current_maxes")

    class Meta:
        verbose_name = "Strength Current Max"
        verbose_name_plural = "Strength Current Max"
        ordering = ["-datetime_accomplished"]


class StrengthCurrentMaxDailyVolume(models.Model):
    """Fact_Strength_Current_Max_Daily_Volume"""
    daily_volume = models.FloatField()
    datetime_accomplished = models.DateTimeField()
    routine = models.ForeignKey(StrengthRoutine, on_delete=models.PROTECT, related_name="daily_volume_marks")

    class Meta:
        verbose_name = "Strength Current Max Daily Volume"
        verbose_name_plural = "Strength Current Max Daily Volumes"
        ordering = ["-datetime_accomplished"]


class StrengthCurrentMaxWeeklyVolume(models.Model):
    """Fact_Strength_Current_Max_Weekly_Volume"""
    weekly_volume = models.FloatField()
    datetime_accomplished = models.DateTimeField()
    routine = models.ForeignKey(StrengthRoutine, on_delete=models.PROTECT, related_name="weekly_volume_marks")

    class Meta:
        verbose_name = "Strength Current Max Weekly Volume"
        verbose_name_plural = "Strength Current Max Weekly Volumes"
        ordering = ["-datetime_accomplished"]


# ---------- Strength: Read-only View ----------

class VwStrengthProgression(models.Model):
    id = models.IntegerField(primary_key=True)
    progression_order = models.PositiveIntegerField()
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