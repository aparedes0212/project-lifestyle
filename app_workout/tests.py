from django.test import TestCase
from unittest.mock import patch
from rest_framework.test import APIRequestFactory, APIClient
from django.utils import timezone
from datetime import timedelta, datetime
from zoneinfo import ZoneInfo

from .views import CardioLogsRecentView
from .services import (
    predict_next_cardio_routine,
    predict_next_cardio_workout,
    get_next_progression_for_workout,
    get_max_reps_goal_for_routine,
    get_max_weight_goal_for_routine,
    get_supplemental_goal_targets,
)
from .models import (
    CardioRoutine,
    CardioWorkout,
    CardioUnit,
    UnitType,
    SpeedName,
    CardioDailyLog,
    CardioPlan,
    Program,
    CardioExercise,
    CardioDailyLogDetail,
    CardioProgression,
    StrengthRoutine,
    StrengthDailyLog,
    StrengthExercise,
    StrengthDailyLogDetail,
    VwStrengthProgression,
    SpecialRule,
    SupplementalRoutine,
    SupplementalDailyLog,
    SupplementalDailyLogDetail,
    CardioGoals,
)


class CardioLogsRecentViewTests(TestCase):
    def test_backfill_invoked_each_request(self):
        """Ensure backfill_rest_days_if_gap is called when querying logs."""
        factory = APIRequestFactory()
        request = factory.get("/api/cardio/logs/")
        view = CardioLogsRecentView()
        view.request = request

        with patch("app_workout.views.backfill_rest_days_if_gap") as mock_backfill:
            # We only care that get_queryset triggers the helper; the actual
            # queryset evaluation is secondary for this test.
            view.get_queryset()
            mock_backfill.assert_called_once()


class PredictNextRoutineTests(TestCase):
    def setUp(self):
        # Minimal cardio setup with a plan ending in Sprints. This replicates
        # the scenario where the original predictor would wrap to the start of
        # the plan and skip "Rest".
        unit_type = UnitType.objects.create(name="Distance")
        speed_name = SpeedName.objects.create(name="mph", speed_type="distance/time")
        unit = CardioUnit.objects.create(
            name="Miles",
            unit_type=unit_type,
            mround_numerator=1,
            mround_denominator=1,
            speed_name=speed_name,
            mile_equiv_numerator=1,
            mile_equiv_denominator=1,
        )

        self.r5k = CardioRoutine.objects.create(name="5K Prep")
        self.rsprint = CardioRoutine.objects.create(name="Sprints")
        self.rrest = CardioRoutine.objects.create(name="Rest")

        self.w5k = CardioWorkout.objects.create(
            name="W5K",
            routine=self.r5k,
            unit=unit,
            priority_order=1,
            skip=False,
            difficulty=1,
        )
        self.wsprint = CardioWorkout.objects.create(
            name="WSprint",
            routine=self.rsprint,
            unit=unit,
            priority_order=1,
            skip=False,
            difficulty=1,
        )
        CardioWorkout.objects.create(
            name="Rest",
            routine=self.rrest,
            unit=unit,
            priority_order=1,
            skip=False,
            difficulty=1,
        )

        program = Program.objects.create(
            name="P",
            selected_cardio=True,
            selected_strength=True,
            selected_supplemental=True,
        )
        CardioPlan.objects.create(program=program, routine=self.r5k, routine_order=1)
        CardioPlan.objects.create(program=program, routine=self.rsprint, routine_order=2)
        CardioPlan.objects.create(program=program, routine=self.rrest, routine_order=3)
        CardioPlan.objects.create(program=program, routine=self.r5k, routine_order=4)
        CardioPlan.objects.create(program=program, routine=self.rsprint, routine_order=5)

    def test_predicts_rest_after_sprints(self):
        now = timezone.now()
        CardioDailyLog.objects.create(
            datetime_started=now - timedelta(days=2),
            workout=self.w5k,
        )
        CardioDailyLog.objects.create(
            datetime_started=now - timedelta(hours=1),
            workout=self.wsprint,
        )
        next_routine = predict_next_cardio_routine(now=now)
        self.assertEqual(next_routine.name, "Rest")

        next_routine = predict_next_cardio_routine(now=now)
        self.assertEqual(next_routine.name, "Rest")

    def test_unmatched_history_still_returns_rest(self):
        now = timezone.now()
        CardioDailyLog.objects.create(
            datetime_started=now - timedelta(days=3),
            workout=self.w5k,
        )
        CardioDailyLog.objects.create(
            datetime_started=now - timedelta(days=2),
            workout=self.wsprint,
        )
        CardioDailyLog.objects.create(
            datetime_started=now - timedelta(hours=1),
            workout=self.wsprint,
        )

        next_routine = predict_next_cardio_routine(now=now)
        self.assertEqual(next_routine.name, "Rest")

    def test_partial_match_advances_sequence(self):
        now = timezone.now()
        CardioDailyLog.objects.create(
            datetime_started=now - timedelta(weeks=6),
            workout=self.w5k,
        )
        CardioDailyLog.objects.create(
            datetime_started=now - timedelta(weeks=5, days=1),
            workout=self.w5k,
        )

        next_routine = predict_next_cardio_routine(now=now)
        self.assertEqual(next_routine.name, "Sprints")


class PredictNextRoutineFilteringTests(TestCase):
    def setUp(self):
        # Setup a plan with repeated routines similar to the HFT program
        unit_type = UnitType.objects.create(name="Distance")
        speed_name = SpeedName.objects.create(name="mph", speed_type="distance/time")
        unit = CardioUnit.objects.create(
            name="Miles",
            unit_type=unit_type,
            mround_numerator=1,
            mround_denominator=1,
            speed_name=speed_name,
            mile_equiv_numerator=1,
            mile_equiv_denominator=1,
        )

        self.r1 = CardioRoutine.objects.create(name="R1")
        self.r2 = CardioRoutine.objects.create(name="R2")
        self.r3 = CardioRoutine.objects.create(name="R3")

        self.w1 = CardioWorkout.objects.create(
            name="W1",
            routine=self.r1,
            unit=unit,
            priority_order=1,
            skip=False,
            difficulty=1,
        )
        self.w2 = CardioWorkout.objects.create(
            name="W2",
            routine=self.r2,
            unit=unit,
            priority_order=1,
            skip=False,
            difficulty=1,
        )
        self.w3 = CardioWorkout.objects.create(
            name="W3",
            routine=self.r3,
            unit=unit,
            priority_order=1,
            skip=False,
            difficulty=1,
        )

        program = Program.objects.create(
            name="HFT",
            selected_cardio=True,
            selected_strength=True,
            selected_supplemental=True,
        )
        CardioPlan.objects.create(program=program, routine=self.r1, routine_order=1)
        CardioPlan.objects.create(program=program, routine=self.r2, routine_order=2)
        CardioPlan.objects.create(program=program, routine=self.r3, routine_order=3)
        CardioPlan.objects.create(program=program, routine=self.r1, routine_order=4)
        CardioPlan.objects.create(program=program, routine=self.r3, routine_order=5)
        CardioPlan.objects.create(program=program, routine=self.r1, routine_order=6)
        CardioPlan.objects.create(program=program, routine=self.r2, routine_order=7)

    def test_filters_to_valid_next_from_last_routine(self):
        now = timezone.now()
        CardioDailyLog.objects.create(
            datetime_started=now - timedelta(days=3),
            workout=self.w2,
        )
        CardioDailyLog.objects.create(
            datetime_started=now - timedelta(days=2),
            workout=self.w1,
        )
        CardioDailyLog.objects.create(
            datetime_started=now - timedelta(hours=1),
            workout=self.w3,
        )

        # Last routine was r3; the only valid next routine is r1
        next_routine = predict_next_cardio_routine(now=now)
        self.assertEqual(next_routine, self.r1)


class PredictNextRoutineSpecialRuleTests(TestCase):
    def setUp(self):
        unit_type = UnitType.objects.create(name="Distance")
        speed_name = SpeedName.objects.create(name="mph", speed_type="distance/time")
        unit = CardioUnit.objects.create(
            name="Miles",
            unit_type=unit_type,
            mround_numerator=1,
            mround_denominator=1,
            speed_name=speed_name,
            mile_equiv_numerator=1,
            mile_equiv_denominator=1,
        )

        self.r_tempo = CardioRoutine.objects.create(name="Tempo")
        self.r_marathon = CardioRoutine.objects.create(name="Marathon Prep")
        self.r_sprints = CardioRoutine.objects.create(name="Sprints")

        self.w_tempo = CardioWorkout.objects.create(
            name="WTempo",
            routine=self.r_tempo,
            unit=unit,
            priority_order=1,
            skip=False,
            difficulty=1,
        )
        self.w_marathon = CardioWorkout.objects.create(
            name="WMarathon",
            routine=self.r_marathon,
            unit=unit,
            priority_order=1,
            skip=False,
            difficulty=1,
        )
        self.w_sprints = CardioWorkout.objects.create(
            name="WSprints",
            routine=self.r_sprints,
            unit=unit,
            priority_order=1,
            skip=False,
            difficulty=1,
        )

        program = Program.objects.create(
            name="Specials",
            selected_cardio=True,
            selected_strength=True,
            selected_supplemental=True,
        )
        CardioPlan.objects.create(program=program, routine=self.r_tempo, routine_order=1)
        CardioPlan.objects.create(program=program, routine=self.r_marathon, routine_order=2)
        CardioPlan.objects.create(program=program, routine=self.r_sprints, routine_order=3)

    def _set_rule(self, enabled: bool = True):
        rules = SpecialRule.get_solo()
        rules.skip_marathon_prep_weekdays = enabled
        rules.save()

    def test_skips_marathon_on_weekdays_when_enabled(self):
        self._set_rule(True)
        now = timezone.make_aware(datetime(2024, 9, 2, 9, 0, 0))  # Monday
        CardioDailyLog.objects.create(
            datetime_started=now - timedelta(days=1),
            workout=self.w_tempo,
        )

        next_routine = predict_next_cardio_routine(now=now)
        self.assertEqual(next_routine, self.r_sprints)

    def test_allows_marathon_on_weekends(self):
        self._set_rule(True)
        now = timezone.make_aware(datetime(2024, 9, 7, 9, 0, 0))  # Saturday
        CardioDailyLog.objects.create(
            datetime_started=now - timedelta(days=1),
            workout=self.w_tempo,
        )

        next_routine = predict_next_cardio_routine(now=now)
        self.assertEqual(next_routine, self.r_marathon)


class PredictNextWorkoutTests(TestCase):
    def setUp(self):
        unit_type = UnitType.objects.create(name="Distance")
        speed_name = SpeedName.objects.create(name="mph", speed_type="distance/time")
        unit = CardioUnit.objects.create(
            name="Miles",
            unit_type=unit_type,
            mround_numerator=1,
            mround_denominator=1,
            speed_name=speed_name,
            mile_equiv_numerator=1,
            mile_equiv_denominator=1,
        )
        self.routine = CardioRoutine.objects.create(name="R")
        self.w1 = CardioWorkout.objects.create(
            name="W1",
            routine=self.routine,
            unit=unit,
            priority_order=1,
            skip=False,
            difficulty=1,
        )
        self.w2 = CardioWorkout.objects.create(
            name="W2",
            routine=self.routine,
            unit=unit,
            priority_order=2,
            skip=False,
            difficulty=1,
        )
        self.w3 = CardioWorkout.objects.create(
            name="W3",
            routine=self.routine,
            unit=unit,
            priority_order=3,
            skip=False,
            difficulty=1,
        )

    def test_partial_match_advances_workout(self):
        now = timezone.now()
        CardioDailyLog.objects.create(
            datetime_started=now - timedelta(weeks=6),
            workout=self.w1,
        )
        CardioDailyLog.objects.create(
            datetime_started=now - timedelta(weeks=5, days=1),
            workout=self.w1,
        )

        next_workout = predict_next_cardio_workout(self.routine.id, now=now)
        self.assertEqual(next_workout.name, "W2")

    def test_filters_to_valid_next_from_last_workout(self):
        now = timezone.now()
        CardioDailyLog.objects.create(
            datetime_started=now - timedelta(days=3),
            workout=self.w2,
        )
        CardioDailyLog.objects.create(
            datetime_started=now - timedelta(days=2),
            workout=self.w1,
        )
        CardioDailyLog.objects.create(
            datetime_started=now - timedelta(hours=1),
            workout=self.w3,
        )

        next_workout = predict_next_cardio_workout(self.routine.id, now=now)
        self.assertEqual(next_workout, self.w1)

    def test_prefers_workout_not_done_recently(self):
        now = timezone.now()
        CardioDailyLog.objects.create(
            datetime_started=now - timedelta(days=3),
            workout=self.w1,
        )
        CardioDailyLog.objects.create(
            datetime_started=now - timedelta(days=1),
            workout=self.w3,
        )

        next_workout = predict_next_cardio_workout(self.routine.id, now=now)
        self.assertEqual(next_workout, self.w2)


class CardioProgressionEndOfPlanTests(TestCase):
    def setUp(self):
        unit_type = UnitType.objects.create(name="Distance")
        speed_name = SpeedName.objects.create(name="mph", speed_type="distance/time")
        unit = CardioUnit.objects.create(
            name="Miles",
            unit_type=unit_type,
            mround_numerator=1,
            mround_denominator=1,
            speed_name=speed_name,
            mile_equiv_numerator=1,
            mile_equiv_denominator=1,
        )
        routine = CardioRoutine.objects.create(name="EOP Routine")
        self.workout = CardioWorkout.objects.create(
            name="EOP Workout",
            routine=routine,
            unit=unit,
            priority_order=1,
            skip=False,
            difficulty=1,
        )

        for i, value in enumerate([1.0, 2.0, 3.0, 4.0, 5.0], start=1):
            CardioProgression.objects.create(
                workout=self.workout,
                progression_order=i,
                progression=value,
            )

    def test_when_last_progression_is_max_next_stays_max(self):
        now = timezone.now()
        CardioDailyLog.objects.create(
            datetime_started=now - timedelta(days=1),
            workout=self.workout,
            goal=5.0,
            total_completed=5.0,
            ignore=False,
        )

        selected, meta = get_next_progression_for_workout(
            self.workout.id,
            return_debug=True,
        )

        self.assertIsNotNone(selected)
        self.assertEqual(float(selected.progression), 5.0)
        self.assertEqual(meta.get("reason"), "end_of_plan")
        self.assertTrue(meta.get("used_end_of_plan"))
        self.assertEqual(meta.get("target_val"), 5.0)


class MaxMphUpdateTests(TestCase):
    def setUp(self):
        # minimal setup for a workout and log
        unit_type = UnitType.objects.create(name="Distance")
        speed_name = SpeedName.objects.create(name="mph", speed_type="distance/time")
        unit = CardioUnit.objects.create(
            name="Miles",
            unit_type=unit_type,
            mround_numerator=1,
            mround_denominator=1,
            speed_name=speed_name,
            mile_equiv_numerator=1,
            mile_equiv_denominator=1,
        )
        routine = CardioRoutine.objects.create(name="R1")
        workout = CardioWorkout.objects.create(
            name="W1",
            routine=routine,
            unit=unit,
            priority_order=1,
            skip=False,
            difficulty=1,
        )
        self.log = CardioDailyLog.objects.create(
            datetime_started=timezone.now(),
            workout=workout,
        )
        self.client = APIClient()

    def test_patch_updates_max_mph(self):
        url = f"/api/cardio/log/{self.log.id}/"
        resp = self.client.patch(url, {"max_mph": 7.25}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.log.refresh_from_db()
        self.assertEqual(self.log.max_mph, 7.25)


class GoalTimeUpdateTests(TestCase):
    def setUp(self):
        unit_type = UnitType.objects.create(name="Distance")
        speed_name = SpeedName.objects.create(name="mph", speed_type="distance/time")
        unit = CardioUnit.objects.create(
            name="Miles",
            unit_type=unit_type,
            mround_numerator=1,
            mround_denominator=1,
            speed_name=speed_name,
            mile_equiv_numerator=1,
            mile_equiv_denominator=1,
        )
        self.speed_name = speed_name
        routine = CardioRoutine.objects.create(name="R1")
        workout = CardioWorkout.objects.create(
            name="W1",
            routine=routine,
            unit=unit,
            priority_order=1,
            skip=False,
            difficulty=1,
            goal_distance=4.0,
        )
        self.log = CardioDailyLog.objects.create(
            datetime_started=timezone.now(),
            workout=workout,
        )
        self.client = APIClient()

    def test_patch_updates_goal_time(self):
        url = f"/api/cardio/log/{self.log.id}/"
        resp = self.client.patch(url, {"goal_time": 24.5}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.log.refresh_from_db()
        self.assertEqual(self.log.goal_time, 24.5)

    def test_goal_time_bumps_max_mph_when_higher(self):
        # Seed an existing max_mph lower than what a 24.0 minute 4-mile implies.
        # 4 miles in 24 minutes -> 10.0 mph
        self.log.max_mph = 7.0
        self.log.save()

        url = f"/api/cardio/log/{self.log.id}/"
        resp = self.client.patch(url, {"goal_time": 24.0}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.log.refresh_from_db()
        self.assertEqual(self.log.goal_time, 24.0)
        self.assertAlmostEqual(self.log.max_mph, 10.0, places=3)

    def test_goal_time_updates_max_mph_when_lower(self):
        # Existing max_mph higher than implied speed should be synced down.
        self.log.max_mph = 8.0
        self.log.save()

        # 4 miles in 60 minutes -> 4.0 mph
        url = f"/api/cardio/log/{self.log.id}/"
        resp = self.client.patch(url, {"goal_time": 60.0}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.log.refresh_from_db()
        self.assertEqual(self.log.goal_time, 60.0)
        self.assertEqual(self.log.max_mph, 4.0)

    def test_goal_time_updates_mph_for_time_units(self):
        ut_time = UnitType.objects.create(name="Time")
        time_unit = CardioUnit.objects.create(
            name="Minutes",
            unit_type=ut_time,
            mround_numerator=1,
            mround_denominator=1,
            speed_name=self.speed_name,
            mile_equiv_numerator=1,
            mile_equiv_denominator=1,
        )
        routine = CardioRoutine.objects.create(name="Tempo")
        workout = CardioWorkout.objects.create(
            name="TempoW",
            routine=routine,
            unit=time_unit,
            priority_order=1,
            skip=False,
            difficulty=1,
            goal_distance=30.0,
        )
        log = CardioDailyLog.objects.create(
            datetime_started=timezone.now(),
            workout=workout,
            max_mph=5.0,
        )
        url = f"/api/cardio/log/{log.id}/"
        resp = self.client.patch(url, {"goal_time": 5.0}, format="json")
        self.assertEqual(resp.status_code, 200)
        log.refresh_from_db()
        self.assertEqual(log.goal_time, 5.0)
        self.assertEqual(log.max_mph, 10.0)

    def test_goal_time_and_max_mph_use_fastest_for_both(self):
        url = f"/api/cardio/log/{self.log.id}/"
        resp = self.client.patch(url, {"goal_time": 60.0, "max_mph": 8.0}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.log.refresh_from_db()
        self.assertEqual(self.log.max_mph, 8.0)
        self.assertAlmostEqual(self.log.goal_time, 30.0, places=3)

    def test_goal_time_and_max_mph_use_fastest_for_time_units(self):
        ut_time = UnitType.objects.create(name="Time")
        time_unit = CardioUnit.objects.create(
            name="Minutes",
            unit_type=ut_time,
            mround_numerator=1,
            mround_denominator=1,
            speed_name=self.speed_name,
            mile_equiv_numerator=1,
            mile_equiv_denominator=1,
        )
        routine = CardioRoutine.objects.create(name="Tempo")
        workout = CardioWorkout.objects.create(
            name="TempoW",
            routine=routine,
            unit=time_unit,
            priority_order=1,
            skip=False,
            difficulty=1,
            goal_distance=30.0,
        )
        log = CardioDailyLog.objects.create(
            datetime_started=timezone.now(),
            workout=workout,
        )
        url = f"/api/cardio/log/{log.id}/"
        resp = self.client.patch(url, {"goal_time": 2.0, "max_mph": 12.0}, format="json")
        self.assertEqual(resp.status_code, 200)
        log.refresh_from_db()
        self.assertEqual(log.max_mph, 12.0)
        self.assertAlmostEqual(log.goal_time, 6.0, places=3)

    def test_max_mph_updates_goal_time_for_distance_units(self):
        url = f"/api/cardio/log/{self.log.id}/"
        resp = self.client.patch(url, {"max_mph": 8.0}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.log.refresh_from_db()
        self.assertAlmostEqual(self.log.goal_time, 30.0, places=3)

    def test_max_mph_updates_goal_time_for_time_units(self):
        ut_time = UnitType.objects.create(name="Time")
        time_unit = CardioUnit.objects.create(
            name="Minutes",
            unit_type=ut_time,
            mround_numerator=1,
            mround_denominator=1,
            speed_name=self.speed_name,
            mile_equiv_numerator=1,
            mile_equiv_denominator=1,
        )
        routine = CardioRoutine.objects.create(name="Tempo")
        workout = CardioWorkout.objects.create(
            name="TempoW",
            routine=routine,
            unit=time_unit,
            priority_order=1,
            skip=False,
            difficulty=1,
            goal_distance=5.0,
        )
        log = CardioDailyLog.objects.create(
            datetime_started=timezone.now(),
            workout=workout,
        )
        url = f"/api/cardio/log/{log.id}/"
        resp = self.client.patch(url, {"max_mph": 6.0}, format="json")
        self.assertEqual(resp.status_code, 200)
        log.refresh_from_db()
        self.assertAlmostEqual(log.goal_time, 0.5, places=3)


class CardioLogDetailUpdateTests(TestCase):
    def setUp(self):
        unit_type = UnitType.objects.create(name="Distance")
        speed_name = SpeedName.objects.create(name="mph", speed_type="distance/time")
        unit = CardioUnit.objects.create(
            name="Miles",
            unit_type=unit_type,
            mround_numerator=1,
            mround_denominator=1,
            speed_name=speed_name,
            mile_equiv_numerator=1,
            mile_equiv_denominator=1,
        )
        routine = CardioRoutine.objects.create(name="R1")
        workout = CardioWorkout.objects.create(
            name="W1",
            routine=routine,
            unit=unit,
            priority_order=1,
            skip=False,
            difficulty=1,
        )
        self.exercise = CardioExercise.objects.create(name="Run", unit=unit)
        self.log = CardioDailyLog.objects.create(
            datetime_started=timezone.now(),
            workout=workout,
        )
        self.detail = CardioDailyLogDetail.objects.create(
            log=self.log,
            datetime=timezone.now(),
            exercise=self.exercise,
            running_minutes=5,
        )
        self.client = APIClient()

    def test_patch_updates_interval(self):
        url = f"/api/cardio/log/{self.log.id}/details/{self.detail.id}/"
        resp = self.client.patch(url, {"running_minutes": 10}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.detail.refresh_from_db()
        self.assertEqual(self.detail.running_minutes, 10)


class LastIntervalDefaultsTests(TestCase):
    def setUp(self):
        unit_type = UnitType.objects.create(name="Distance")
        speed_name = SpeedName.objects.create(name="mph", speed_type="distance/time")
        unit = CardioUnit.objects.create(
            name="Miles",
            unit_type=unit_type,
            mround_numerator=1,
            mround_denominator=1,
            speed_name=speed_name,
            mile_equiv_numerator=1,
            mile_equiv_denominator=1,
        )
        routine = CardioRoutine.objects.create(name="R1")
        self.workout = CardioWorkout.objects.create(
            name="W1",
            routine=routine,
            unit=unit,
            priority_order=1,
            skip=False,
            difficulty=1,
        )
        self.exercise = CardioExercise.objects.create(name="Run", unit=unit)
        self.client = APIClient()

    def test_returns_last_interval_from_current_log(self):
        log = CardioDailyLog.objects.create(datetime_started=timezone.now(), workout=self.workout)
        CardioDailyLogDetail.objects.create(
            log=log,
            datetime=timezone.now(),
            exercise=self.exercise,
            running_minutes=4,
            running_miles=1,
            running_mph=6,
        )
        CardioDailyLogDetail.objects.create(
            log=log,
            datetime=timezone.now(),
            exercise=self.exercise,
            running_minutes=5,
            running_miles=1.1,
            running_mph=6.5,
        )
        resp = self.client.get(f"/api/cardio/log/{log.id}/last-interval/")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["running_minutes"], 5)
        self.assertEqual(data["running_miles"], 1.1)

    def test_falls_back_to_previous_log(self):
        prev_log = CardioDailyLog.objects.create(datetime_started=timezone.now(), workout=self.workout)
        CardioDailyLogDetail.objects.create(
            log=prev_log,
            datetime=timezone.now(),
            exercise=self.exercise,
            running_minutes=7,
            running_miles=2,
            running_mph=8,
        )
        current_log = CardioDailyLog.objects.create(datetime_started=timezone.now(), workout=self.workout)
        resp = self.client.get(f"/api/cardio/log/{current_log.id}/last-interval/")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["running_minutes"], 7)
        self.assertEqual(data["running_miles"], 2)

    def test_returns_zero_when_no_history(self):
        log = CardioDailyLog.objects.create(datetime_started=timezone.now(), workout=self.workout)
        resp = self.client.get(f"/api/cardio/log/{log.id}/last-interval/")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["running_minutes"], 0)
        self.assertEqual(data["running_miles"], 0)


class NextStrengthViewTests(TestCase):
    def setUp(self):
        self.r1 = StrengthRoutine.objects.create(name="R1", hundred_points_reps=100, hundred_points_weight=100)
        self.r2 = StrengthRoutine.objects.create(name="R2", hundred_points_reps=100, hundred_points_weight=100)
        StrengthDailyLog.objects.create(datetime_started=timezone.now(), routine=self.r1)
        VwStrengthProgression.objects.create(
            id=1, progression_order=1, routine_name="R1", current_max=1, training_set=1, daily_volume=50, weekly_volume=100
        )
        VwStrengthProgression.objects.create(
            id=2, progression_order=1, routine_name="R2", current_max=1, training_set=1, daily_volume=60, weekly_volume=120
        )
        self.client = APIClient()

    def test_returns_least_recent_routine(self):
        resp = self.client.get("/api/strength/next/")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["next_routine"]["name"], "R2")
        self.assertEqual(data["routine_list"][-1]["name"], "R2")
        self.assertEqual(data["next_goal"]["daily_volume"], 60)


class StrengthLogCreateTests(TestCase):
    def setUp(self):
        self.routine = StrengthRoutine.objects.create(
            name="R1", hundred_points_reps=100, hundred_points_weight=100
        )
        self.client = APIClient()

    def test_accepts_float_rep_goal(self):
        payload = {
            "datetime_started": timezone.now().isoformat(),
            "routine_id": self.routine.id,
            "rep_goal": 399.75,
        }
        resp = self.client.post("/api/strength/log/", payload, format="json")
        self.assertEqual(resp.status_code, 201)
        log = StrengthDailyLog.objects.get(pk=resp.data["id"])
        self.assertAlmostEqual(log.rep_goal, 399.75)

    @patch("app_workout.serializers.get_max_weight_goal_for_routine", return_value=185.0)
    @patch("app_workout.serializers.get_max_reps_goal_for_routine", return_value=3.5)
    def test_persists_goal_values_from_services(self, mock_reps_goal, mock_weight_goal):
        payload = {
            "datetime_started": timezone.now().isoformat(),
            "routine_id": self.routine.id,
            "rep_goal": 400.0,
        }
        resp = self.client.post("/api/strength/log/", payload, format="json")
        self.assertEqual(resp.status_code, 201)
        mock_reps_goal.assert_called_once_with(self.routine.id, 400.0)
        mock_weight_goal.assert_called_once_with(self.routine.id, 400.0)
        log = StrengthDailyLog.objects.get(pk=resp.data["id"])
        self.assertAlmostEqual(log.max_reps_goal, 3.5)
        self.assertAlmostEqual(log.max_weight_goal, 185.0)
        self.assertAlmostEqual(resp.data.get("max_reps_goal"), 3.5)
        self.assertAlmostEqual(resp.data.get("max_weight_goal"), 185.0)
    def test_rph_goal_prefers_peak_history(self):
        routine = StrengthRoutine.objects.create(
            name="RLatest", hundred_points_reps=100, hundred_points_weight=128
        )
        earlier = timezone.now() - timedelta(days=1)
        StrengthDailyLog.objects.create(
            datetime_started=earlier,
            routine=routine,
            max_reps_goal=3.0,
            max_reps=3.0,
            max_weight_goal=90.0,
            max_weight=90.0,
        )
        StrengthDailyLog.objects.create(
            datetime_started=timezone.now(),
            routine=routine,
            max_reps_goal=2.0,
            max_reps=99.17,
            max_weight_goal=120.0,
            max_weight=128.64,
        )
        reps_goal = get_max_reps_goal_for_routine(routine.id, 110)
        weight_goal = get_max_weight_goal_for_routine(routine.id, 110)
        self.assertAlmostEqual(reps_goal, 99.17, places=2)
        self.assertAlmostEqual(weight_goal, 128.64, places=2)



class StrengthAggregateTests(TestCase):
    def test_total_reps_completed_uses_weight_and_routine_factor(self):
        routine = StrengthRoutine.objects.create(
            name="R1", hundred_points_reps=100, hundred_points_weight=200
        )
        exercise = StrengthExercise.objects.create(name="E1", routine=routine)
        log = StrengthDailyLog.objects.create(
            datetime_started=timezone.now(), routine=routine
        )
        StrengthDailyLogDetail.objects.create(
            log=log,
            datetime=timezone.now(),
            exercise=exercise,
            reps=5,
            weight=100,
        )
        StrengthDailyLogDetail.objects.create(
            log=log,
            datetime=timezone.now(),
            exercise=exercise,
            reps=3,
            weight=150,
        )
        log.refresh_from_db()
        self.assertAlmostEqual(log.total_reps_completed, (5 * 100 + 3 * 150) / 200)

    def test_max_reps_uses_weight_and_routine_factor(self):
        routine = StrengthRoutine.objects.create(
            name="R1", hundred_points_reps=100, hundred_points_weight=200
        )
        exercise = StrengthExercise.objects.create(name="E1", routine=routine)
        log = StrengthDailyLog.objects.create(
            datetime_started=timezone.now(),
            routine=routine,
            max_reps_goal=2.5,
            max_weight_goal=180.0,
        )
        StrengthDailyLogDetail.objects.create(
            log=log,
            datetime=timezone.now(),
            exercise=exercise,
            reps=5,
            weight=100,
        )
        StrengthDailyLogDetail.objects.create(
            log=log,
            datetime=timezone.now(),
            exercise=exercise,
            reps=3,
            weight=250,
        )
        log.refresh_from_db()
        expected_max_reps = (3 * 250) / 200
        self.assertAlmostEqual(log.max_reps, expected_max_reps)
        self.assertAlmostEqual(log.max_weight, 250)
        self.assertAlmostEqual(log.max_reps_goal, 2.5)
        self.assertAlmostEqual(log.max_weight_goal, 180.0)
        self.assertGreater(log.max_reps, log.max_reps_goal)
        self.assertGreater(log.max_weight, log.max_weight_goal)

    def test_goals_remain_constant_when_surpassed(self):
        routine = StrengthRoutine.objects.create(
            name="R2", hundred_points_reps=100, hundred_points_weight=100
        )
        exercise = StrengthExercise.objects.create(name="E2", routine=routine)
        log = StrengthDailyLog.objects.create(
            datetime_started=timezone.now(),
            routine=routine,
            max_reps_goal=1.0,
            max_weight_goal=50.0,
        )
        StrengthDailyLogDetail.objects.create(
            log=log,
            datetime=timezone.now(),
            exercise=exercise,
            reps=10,
            weight=100,
        )
        StrengthDailyLogDetail.objects.create(
            log=log,
            datetime=timezone.now(),
            exercise=exercise,
            reps=12,
            weight=150,
        )
        log.refresh_from_db()
        self.assertAlmostEqual(log.max_reps_goal, 1.0)
        self.assertAlmostEqual(log.max_weight_goal, 50.0)
        self.assertAlmostEqual(log.max_reps, (12 * 150) / 100)
        self.assertAlmostEqual(log.max_weight, 150)
        self.assertGreater(log.max_reps, log.max_reps_goal)
        self.assertGreater(log.max_weight, log.max_weight_goal)


class MPHGoalEndpointTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        ut_time = UnitType.objects.create(name="Time")
        ut_dist = UnitType.objects.create(name="Distance")
        speed = SpeedName.objects.create(name="mph", speed_type="distance/time")
        self.unit_minutes = CardioUnit.objects.create(
            name="Minutes",
            unit_type=ut_time,
            mround_numerator=1,
            mround_denominator=1,
            speed_name=speed,
            mile_equiv_numerator=1,
            mile_equiv_denominator=1,
        )
        self.unit_400 = CardioUnit.objects.create(
            name="400m",
            unit_type=ut_dist,
            mround_numerator=1,
            mround_denominator=1,
            speed_name=speed,
            mile_equiv_numerator=400,
            mile_equiv_denominator=1609.344,
        )
        routine = CardioRoutine.objects.create(name="R1")
        self.w_time = CardioWorkout.objects.create(
            name="Tempo",
            routine=routine,
            unit=self.unit_minutes,
            priority_order=1,
            skip=False,
            difficulty=1,
        )
        self.w_400 = CardioWorkout.objects.create(
            name="400s",
            routine=routine,
            unit=self.unit_400,
            priority_order=2,
            skip=False,
            difficulty=1,
        )
        # Seed history so runtime SQL computes mph_goal=6.0
        CardioDailyLog.objects.create(
            datetime_started=timezone.now(), workout=self.w_time, max_mph=6.0, avg_mph=6.0
        )
        CardioDailyLog.objects.create(
            datetime_started=timezone.now(), workout=self.w_400, max_mph=6.0, avg_mph=6.0
        )

    def test_minutes_unit_conversion(self):
        resp = self.client.get(
            "/api/cardio/mph-goal/",
            {"workout_id": self.w_time.id, "value": 60},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertAlmostEqual(resp.data["mph_goal"], 6.2)
        self.assertAlmostEqual(resp.data["miles"], 6.2)
        self.assertEqual(resp.data["minutes"], 60)
        self.assertEqual(resp.data["seconds"], 0.0)

    def test_distance_unit_conversion(self):
        resp = self.client.get(
            "/api/cardio/mph-goal/",
            {"workout_id": self.w_400.id, "value": 2},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertAlmostEqual(resp.data["miles"], 0.497, places=3)
        self.assertEqual(resp.data["minutes"], 4)
        self.assertEqual(resp.data["seconds"], 49.0)

    def test_sprints_overrides_value(self):
        routine = CardioRoutine.objects.create(name="Sprints")
        w_sprint = CardioWorkout.objects.create(
            name="400s Sprint",
            routine=routine,
            unit=self.unit_400,
            priority_order=1,
            skip=False,
            difficulty=1,
        )
        CardioDailyLog.objects.create(
            datetime_started=timezone.now(), workout=w_sprint, max_mph=6.0, avg_mph=6.0
        )
        resp = self.client.get(
            "/api/cardio/mph-goal/",
            {"workout_id": w_sprint.id, "value": 5},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertAlmostEqual(resp.data["miles"], 0.249, places=3)
        self.assertEqual(resp.data["minutes"], 2)
        self.assertEqual(resp.data["seconds"], 24.0)


class CardioBestCompletedLogEndpointTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        unit_type = UnitType.objects.create(name="Distance")
        speed = SpeedName.objects.create(name="mph", speed_type="distance/time")
        unit = CardioUnit.objects.create(
            name="Miles",
            unit_type=unit_type,
            mround_numerator=1,
            mround_denominator=1,
            speed_name=speed,
            mile_equiv_numerator=1,
            mile_equiv_denominator=1,
        )
        routine = CardioRoutine.objects.create(name="R Best Log")
        self.workout = CardioWorkout.objects.create(
            name="Workout Best Log",
            routine=routine,
            unit=unit,
            priority_order=1,
            skip=False,
            difficulty=1,
        )

    def _create_log(self, *, days_ago, max_mph, avg_mph=None, goal=3.0, total_completed=3.0, ignore=False):
        if avg_mph is None:
            avg_mph = max_mph
        return CardioDailyLog.objects.create(
            datetime_started=timezone.now() - timedelta(days=days_ago),
            workout=self.workout,
            goal=goal,
            total_completed=total_completed,
            max_mph=max_mph,
            avg_mph=avg_mph,
            ignore=ignore,
        )

    def test_uses_highest_max_in_last_8_weeks(self):
        best_8_weeks = self._create_log(days_ago=35, max_mph=8.4)
        self._create_log(days_ago=10, max_mph=7.1)
        self._create_log(days_ago=3, max_mph=9.9, total_completed=2.9)  # not done
        self._create_log(days_ago=2, max_mph=10.2, ignore=True)  # ignored
        self._create_log(days_ago=90, max_mph=12.0)  # outside 8 weeks

        resp = self.client.get(
            "/api/cardio/best-completed-log/",
            {"workout_id": self.workout.id},
        )

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["id"], best_8_weeks.id)

    def test_falls_back_to_highest_max_in_last_6_months(self):
        best_6_months = self._create_log(days_ago=120, max_mph=9.3)
        self._create_log(days_ago=70, max_mph=8.6)
        self._create_log(days_ago=5, max_mph=10.1, total_completed=1.0)  # not done in 8 weeks

        resp = self.client.get(
            "/api/cardio/best-completed-log/",
            {"workout_id": self.workout.id},
        )

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["id"], best_6_months.id)

    def test_falls_back_to_most_recent_done_when_no_6_month_match(self):
        most_recent_done = self._create_log(days_ago=220, max_mph=5.5)
        self._create_log(days_ago=260, max_mph=9.8)
        self._create_log(days_ago=4, max_mph=11.2, total_completed=0.5)  # not done

        resp = self.client.get(
            "/api/cardio/best-completed-log/",
            {"workout_id": self.workout.id},
        )

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["id"], most_recent_done.id)

    def test_includes_percentage_loss_with_6048_second_steps(self):
        fixed_now = timezone.make_aware(datetime(2026, 1, 1, 12, 0, 0))
        log = CardioDailyLog.objects.create(
            datetime_started=fixed_now - timedelta(seconds=(6048 * 3) + 42),
            workout=self.workout,
            goal=3.0,
            total_completed=3.0,
            max_mph=8.0,
            avg_mph=8.0,
            ignore=False,
        )

        with patch("app_workout.views.timezone.now", return_value=fixed_now):
            resp = self.client.get(
                "/api/cardio/best-completed-log/",
                {"workout_id": self.workout.id},
            )

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["id"], log.id)
        self.assertEqual(resp.data["weekly_based_max_percentage_loss"], 97)

    def test_percentage_loss_has_zero_minimum(self):
        fixed_now = timezone.make_aware(datetime(2026, 1, 1, 12, 0, 0))
        log = CardioDailyLog.objects.create(
            datetime_started=fixed_now - timedelta(seconds=(6048 * 150)),
            workout=self.workout,
            goal=3.0,
            total_completed=3.0,
            max_mph=8.0,
            avg_mph=8.0,
            ignore=False,
        )

        with patch("app_workout.views.timezone.now", return_value=fixed_now):
            resp = self.client.get(
                "/api/cardio/best-completed-log/",
                {"workout_id": self.workout.id},
            )

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["id"], log.id)
        self.assertEqual(resp.data["weekly_based_max_percentage_loss"], 0)


class CardioBestCompletedAvgLogEndpointTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        unit_type = UnitType.objects.create(name="Distance")
        speed = SpeedName.objects.create(name="mph", speed_type="distance/time")
        unit = CardioUnit.objects.create(
            name="Miles",
            unit_type=unit_type,
            mround_numerator=1,
            mround_denominator=1,
            speed_name=speed,
            mile_equiv_numerator=1,
            mile_equiv_denominator=1,
        )
        routine = CardioRoutine.objects.create(name="R Best Avg Log")
        self.workout = CardioWorkout.objects.create(
            name="Workout Best Avg Log",
            routine=routine,
            unit=unit,
            priority_order=1,
            skip=False,
            difficulty=1,
        )

    def _create_log(self, *, days_ago, max_mph, avg_mph, goal=3.0, total_completed=3.0, ignore=False):
        return CardioDailyLog.objects.create(
            datetime_started=timezone.now() - timedelta(days=days_ago),
            workout=self.workout,
            goal=goal,
            total_completed=total_completed,
            max_mph=max_mph,
            avg_mph=avg_mph,
            ignore=ignore,
        )

    def test_uses_highest_avg_in_last_8_weeks(self):
        best_8_weeks = self._create_log(days_ago=30, max_mph=8.2, avg_mph=7.8)
        self._create_log(days_ago=7, max_mph=9.6, avg_mph=7.1)
        self._create_log(days_ago=3, max_mph=9.9, avg_mph=8.9, total_completed=2.9)  # not done
        self._create_log(days_ago=2, max_mph=7.0, avg_mph=8.8, ignore=True)  # ignored

        resp = self.client.get(
            "/api/cardio/best-completed-avg-log/",
            {"workout_id": self.workout.id},
        )

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["id"], best_8_weeks.id)

    def test_includes_weekly_based_avg_percentage_loss_with_6048_second_steps(self):
        fixed_now = timezone.make_aware(datetime(2026, 1, 1, 12, 0, 0))
        log = CardioDailyLog.objects.create(
            datetime_started=fixed_now - timedelta(seconds=(6048 * 3) + 42),
            workout=self.workout,
            goal=3.0,
            total_completed=3.0,
            max_mph=8.5,
            avg_mph=7.5,
            ignore=False,
        )

        with patch("app_workout.views.timezone.now", return_value=fixed_now):
            resp = self.client.get(
                "/api/cardio/best-completed-avg-log/",
                {"workout_id": self.workout.id},
            )

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["id"], log.id)
        self.assertEqual(resp.data["weekly_based_avg_percentage_loss"], 97)


class CardioDailyBasedPercentageLossEndpointTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.et = ZoneInfo("America/New_York")

    def test_returns_100_when_before_noon_et(self):
        fixed_now = datetime(2026, 1, 1, 11, 59, 59, tzinfo=self.et)
        with patch("app_workout.views.timezone.now", return_value=fixed_now):
            resp = self.client.get("/api/cardio/daily-based-percentage-loss/")

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["daily_based_percentage_loss"], 100)

    def test_returns_zero_at_noon_et(self):
        fixed_now = datetime(2026, 1, 1, 12, 0, 0, tzinfo=self.et)
        with patch("app_workout.views.timezone.now", return_value=fixed_now):
            resp = self.client.get("/api/cardio/daily-based-percentage-loss/")

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["daily_based_percentage_loss"], 0)

    def test_adds_one_per_432_seconds_after_noon_et(self):
        fixed_now = datetime(2026, 1, 1, 12, 0, 0, tzinfo=self.et) + timedelta(seconds=(432 * 3) + 11)
        with patch("app_workout.views.timezone.now", return_value=fixed_now):
            resp = self.client.get("/api/cardio/daily-based-percentage-loss/")

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["daily_based_percentage_loss"], 3)

    def test_returns_100_outside_window_after_midnight_et(self):
        fixed_now = datetime(2026, 1, 2, 0, 0, 0, tzinfo=self.et)
        with patch("app_workout.views.timezone.now", return_value=fixed_now):
            resp = self.client.get("/api/cardio/daily-based-percentage-loss/")

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["daily_based_percentage_loss"], 100)


class SupplementalGoalTargetsTests(TestCase):
    def test_goal_targets_include_weight_progression(self):
        routine = SupplementalRoutine.objects.create(
            name="Plank",
            unit="Time",
            step_value=5,
            max_set=60,
            step_weight=10,
            rest_yellow_start_seconds=60,
            rest_red_start_seconds=90,
        )
        log = SupplementalDailyLog.objects.create(datetime_started=timezone.now(), routine=routine)
        now = timezone.now()
        SupplementalDailyLogDetail.objects.create(
            log=log,
            datetime=now - timedelta(seconds=90),
            unit_count=45,
            set_number=1,
        )
        SupplementalDailyLogDetail.objects.create(
            log=log,
            datetime=now - timedelta(seconds=60),
            unit_count=60,
            weight=5,
            set_number=2,
        )

        plan = get_supplemental_goal_targets(routine.id)
        sets = {item["set_number"]: item for item in plan.get("sets", [])}

        self.assertEqual(sets[1]["goal_unit"], 50)
        self.assertFalse(sets[1]["using_weight"])
        self.assertEqual(sets[2]["goal_unit"], 60)
        self.assertEqual(sets[2]["goal_weight"], 15)
        self.assertTrue(sets[2]["using_weight"])
        self.assertEqual(sets[3]["goal_unit"], 5)
        self.assertIsNone(sets[3]["goal_weight"])
        self.assertEqual(plan["rest_yellow_start_seconds"], 60)
        self.assertEqual(plan["rest_red_start_seconds"], 90)

    def test_minimum_goals_follow_best_set1_session(self):
        routine = SupplementalRoutine.objects.create(
            name="Plank",
            unit="Time",
            step_value=5,
            max_set=60,
            step_weight=10,
        )
        now = timezone.now()

        # A session with the best Set #1 but modest Set #2/#3 results
        log_best_set1 = SupplementalDailyLog.objects.create(
            datetime_started=now - timedelta(days=1),
            routine=routine,
        )
        SupplementalDailyLogDetail.objects.create(
            log=log_best_set1,
            datetime=now - timedelta(hours=1),
            unit_count=90,
            set_number=1,
        )
        SupplementalDailyLogDetail.objects.create(
            log=log_best_set1,
            datetime=now - timedelta(hours=1, minutes=1),
            unit_count=45,
            weight=15,
            set_number=2,
        )
        SupplementalDailyLogDetail.objects.create(
            log=log_best_set1,
            datetime=now - timedelta(hours=1, minutes=2),
            unit_count=35,
            weight=5,
            set_number=3,
        )

        # Another session with better Set #2/#3 highs to ensure bests remain all-time
        log_best_other_sets = SupplementalDailyLog.objects.create(
            datetime_started=now - timedelta(days=2),
            routine=routine,
        )
        SupplementalDailyLogDetail.objects.create(
            log=log_best_other_sets,
            datetime=now - timedelta(days=2, minutes=5),
            unit_count=50,
            set_number=1,
        )
        SupplementalDailyLogDetail.objects.create(
            log=log_best_other_sets,
            datetime=now - timedelta(days=2, minutes=4),
            unit_count=120,
            set_number=2,
        )
        SupplementalDailyLogDetail.objects.create(
            log=log_best_other_sets,
            datetime=now - timedelta(days=2, minutes=3),
            unit_count=110,
            set_number=3,
        )

        plan = get_supplemental_goal_targets(routine.id)
        sets = {item["set_number"]: item for item in plan.get("sets", [])}

        # Minimum goals for sets 2/3 come from the session with the top Set #1
        self.assertEqual(sets[1]["min_goal_unit"], 90)
        self.assertEqual(sets[2]["min_goal_unit"], 45)
        self.assertEqual(sets[2]["min_goal_weight"], 15)
        self.assertEqual(sets[3]["min_goal_unit"], 35)
        self.assertEqual(sets[3]["min_goal_weight"], 5)

        # Bests remain based on overall highs
        self.assertEqual(sets[2]["best_unit"], 120)
        self.assertEqual(sets[3]["best_unit"], 110)

    def test_minimum_goals_skip_current_log_missing_set2_and_set3(self):
        routine = SupplementalRoutine.objects.create(
            name="Plank",
            unit="Time",
            step_value=5,
            max_set=60,
            step_weight=10,
        )
        now = timezone.now()

        # Previous session with full sets that should seed minimum goals
        log_prev = SupplementalDailyLog.objects.create(
            datetime_started=now - timedelta(days=2),
            routine=routine,
        )
        SupplementalDailyLogDetail.objects.create(
            log=log_prev,
            datetime=now - timedelta(days=2, minutes=5),
            unit_count=80,
            set_number=1,
        )
        SupplementalDailyLogDetail.objects.create(
            log=log_prev,
            datetime=now - timedelta(days=2, minutes=4),
            unit_count=40,
            weight=10,
            set_number=2,
        )
        SupplementalDailyLogDetail.objects.create(
            log=log_prev,
            datetime=now - timedelta(days=2, minutes=3),
            unit_count=30,
            weight=5,
            set_number=3,
        )

        # Current session sets a new Set #1 max but lacks Set #2/#3
        log_current = SupplementalDailyLog.objects.create(
            datetime_started=now - timedelta(hours=1),
            routine=routine,
        )
        SupplementalDailyLogDetail.objects.create(
            log=log_current,
            datetime=now - timedelta(hours=1, minutes=2),
            unit_count=100,
            set_number=1,
        )

        plan = get_supplemental_goal_targets(routine.id, exclude_log_id=log_current.id)
        sets = {item["set_number"]: item for item in plan.get("sets", [])}

        # Minimum goals for sets 2/3 should come from the previous full session
        self.assertEqual(sets[1]["min_goal_unit"], 80)
        self.assertEqual(sets[2]["min_goal_unit"], 40)
        self.assertEqual(sets[2]["min_goal_weight"], 10)
        self.assertEqual(sets[3]["min_goal_unit"], 30)
        self.assertEqual(sets[3]["min_goal_weight"], 5)

        # Best Set #1 still reflects the current max
        self.assertEqual(sets[1]["best_unit"], 100)


class CardioDistributionViewTests(TestCase):
    def setUp(self):
        self.client = APIClient()

        self.unit_type = UnitType.objects.create(name="Distance")
        self.speed_name = SpeedName.objects.create(name="mph", speed_type="distance/time")
        unit = CardioUnit.objects.create(
            name="Sets",
            unit_type=self.unit_type,
            mround_numerator=1,
            mround_denominator=1,
            speed_name=self.speed_name,
            mile_equiv_numerator=1,
            mile_equiv_denominator=1,
        )

        self.routine = CardioRoutine.objects.create(name="Sprints")
        self.workout = CardioWorkout.objects.create(
            name="Sprint Workout",
            routine=self.routine,
            unit=unit,
            priority_order=1,
            skip=False,
            difficulty=1,
            goal_distance=10.0,
        )

    def test_distribution_uses_goal_max_mph_not_log_max_mph(self):
        log = CardioDailyLog.objects.create(
            datetime_started=timezone.now(),
            workout=self.workout,
            goal=10.0,
            total_completed=2.0,
            max_mph=11.1,  # recorded/override value (should NOT drive distribution)
            avg_mph=10.0,
            mph_goal=8.5,  # goal value (should drive distribution)
            mph_goal_avg=7.0,
        )

        resp = self.client.post(
            "/api/cardio/distribution/",
            {"log_id": log.id, "remaining_only": True},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        meta = resp.json().get("meta") or []
        self.assertIn("Max MPH: 8.5", meta)

    def test_distribution_keeps_max_when_set_is_below_goal_distance_threshold(self):
        unit = CardioUnit.objects.create(
            name="400m",
            unit_type=self.unit_type,
            mround_numerator=1,
            mround_denominator=1,
            speed_name=self.speed_name,
            mile_equiv_numerator=1,
            mile_equiv_denominator=4,
        )
        workout = CardioWorkout.objects.create(
            name="Sprint Workout 400m",
            routine=self.routine,
            unit=unit,
            priority_order=1,
            skip=False,
            difficulty=1,
            goal_distance=5.0,
        )
        exercise = CardioExercise.objects.create(
            name="Run",
            unit=unit,
            three_mile_equivalent=3.0,
        )

        log = CardioDailyLog.objects.create(
            datetime_started=timezone.now(),
            workout=workout,
            goal=5.0,
            total_completed=2.0,
            mph_goal=8.5,
            mph_goal_avg=7.0,
        )

        for _ in range(2):
            CardioDailyLogDetail.objects.create(
                log=log,
                datetime=timezone.now(),
                exercise=exercise,
                running_miles=0.25,
                running_minutes=1,
                running_seconds=45,
            )

        resp = self.client.post(
            "/api/cardio/distribution/",
            {"log_id": log.id, "remaining_only": True},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        rows_remaining = resp.json().get("rows_remaining") or []
        self.assertTrue(rows_remaining)
        self.assertTrue(any(row.get("primary") == "8.5 mph" for row in rows_remaining))


class CardioGoalsSignalTests(TestCase):
    def setUp(self):
        self.unit_type = UnitType.objects.create(name="Distance")
        self.speed_name = SpeedName.objects.create(name="mph", speed_type="distance/time")
        self.unit = CardioUnit.objects.create(
            name="Miles",
            unit_type=self.unit_type,
            mround_numerator=1,
            mround_denominator=1,
            speed_name=self.speed_name,
            mile_equiv_numerator=1,
            mile_equiv_denominator=1,
        )
        self.routine = CardioRoutine.objects.create(name="5K Prep")

    def test_creates_one_goal_row_per_workout_and_updates_values(self):
        workout = CardioWorkout.objects.create(
            name="Goal Sync Workout",
            routine=self.routine,
            unit=self.unit,
            priority_order=1,
            skip=False,
            difficulty=1,
            goal_distance=3.0,
        )

        self.assertEqual(
            CardioGoals.objects.filter(workout=workout).count(),
            len(CardioGoals.GOAL_TYPES),
        )

        now = timezone.now()
        CardioDailyLog.objects.create(
            datetime_started=now - timedelta(days=7),
            workout=workout,
            max_mph=6.11,
            avg_mph=5.73,
        )
        CardioDailyLog.objects.create(
            datetime_started=now - timedelta(days=1),
            workout=workout,
            max_mph=6.67,
            avg_mph=6.01,
        )

        rows = list(CardioGoals.objects.filter(workout=workout))
        by_type = {row.goal_type: row for row in rows}

        self.assertEqual(len(by_type), len(CardioGoals.GOAL_TYPES))
        highest_max_6 = by_type["highest_max_mph_6months"]
        self.assertEqual(highest_max_6.max_avg_type, "max")
        self.assertEqual(highest_max_6.mph_raw, 6.67)
        self.assertEqual(highest_max_6.mph_rounded, 6.7)
        self.assertIsNotNone(highest_max_6.last_updated)

        self.assertIn(CardioGoals.RIEGEL_MAX_6_MONTHS_GOAL_TYPE, by_type)
        self.assertIn(CardioGoals.RIEGEL_AVG_6_MONTHS_GOAL_TYPE, by_type)
        self.assertIn(CardioGoals.RIEGEL_MAX_8_WEEKS_GOAL_TYPE, by_type)
        self.assertIn(CardioGoals.RIEGEL_AVG_8_WEEKS_GOAL_TYPE, by_type)
        self.assertEqual(by_type[CardioGoals.RIEGEL_MAX_6_MONTHS_GOAL_TYPE].max_avg_type, "max")
        self.assertEqual(by_type[CardioGoals.RIEGEL_AVG_6_MONTHS_GOAL_TYPE].max_avg_type, "avg")
        self.assertEqual(by_type[CardioGoals.RIEGEL_MAX_8_WEEKS_GOAL_TYPE].max_avg_type, "max")
        self.assertEqual(by_type[CardioGoals.RIEGEL_AVG_8_WEEKS_GOAL_TYPE].max_avg_type, "avg")

        last_avg = by_type["last_avg_mph"]
        self.assertEqual(last_avg.max_avg_type, "avg")
        self.assertEqual(last_avg.mph_raw, 6.01)
        self.assertIn(
            6.1,
            [row.mph_rounded for row in rows if row.max_avg_type == "avg" and row.mph_rounded is not None],
        )

        rounded_values = [row.mph_rounded for row in rows if row.mph_rounded is not None]
        self.assertEqual(len(rounded_values), len(set(rounded_values)))

        ranked_max = [
            row
            for row in rows
            if row.max_avg_type == "max" and row.mph_raw is not None and row.mph_rounded is not None
        ]
        ranked_avg = [
            row
            for row in rows
            if row.max_avg_type == "avg" and row.mph_raw is not None and row.mph_rounded is not None
        ]
        self.assertTrue(ranked_max)
        self.assertTrue(ranked_avg)
        max_raw_max = max(row.mph_raw for row in ranked_max)
        max_raw_avg = max(row.mph_raw for row in ranked_avg)
        top_max_rows = [row for row in ranked_max if row.inter_rank == 1]
        top_avg_rows = [row for row in ranked_avg if row.inter_rank == 1]
        self.assertTrue(top_max_rows)
        self.assertTrue(top_avg_rows)
        self.assertTrue(any(abs(row.mph_raw - max_raw_max) < 1e-9 for row in top_max_rows))
        self.assertTrue(any(abs(row.mph_raw - max_raw_avg) < 1e-9 for row in top_avg_rows))
        self.assertTrue(
            all(
                (row.inter_rank is None) == (row.mph_raw is None or row.mph_rounded is None)
                for row in rows
            )
        )

    def test_dedupes_rounded_values_and_prefers_non_riegel(self):
        now = timezone.now()

        source_workout = CardioWorkout.objects.create(
            id=3,
            name="5K Source Workout",
            routine=self.routine,
            unit=self.unit,
            priority_order=1,
            skip=False,
            difficulty=1,
            goal_distance=3.0,
        )
        CardioDailyLog.objects.create(
            datetime_started=now - timedelta(days=3),
            workout=source_workout,
            max_mph=6.61,
            avg_mph=6.21,
        )

        target_workout = CardioWorkout.objects.create(
            name="5K Target Workout",
            routine=self.routine,
            unit=self.unit,
            priority_order=2,
            skip=False,
            difficulty=1,
            goal_distance=3.0,
        )
        CardioDailyLog.objects.create(
            datetime_started=now - timedelta(days=1),
            workout=target_workout,
            max_mph=6.61,
            avg_mph=6.05,
        )

        rows = list(CardioGoals.objects.filter(workout=target_workout))
        rounded_values = [row.mph_rounded for row in rows if row.mph_rounded is not None]
        self.assertEqual(len(rounded_values), len(set(rounded_values)))

        non_riegel_67 = [
            row
            for row in rows
            if (not CardioGoals.is_riegel_goal_type(row.goal_type)) and row.mph_rounded == 6.7
        ]
        riegel_max_6 = CardioGoals.objects.get(
            workout=target_workout,
            goal_type=CardioGoals.RIEGEL_MAX_6_MONTHS_GOAL_TYPE,
        )
        self.assertTrue(non_riegel_67)
        self.assertIsNone(riegel_max_6.mph_rounded)
        self.assertIsNone(riegel_max_6.inter_rank)

    def test_tempo_runs_riegel_max_uses_10k_distance(self):
        now = timezone.now()

        source_workout = CardioWorkout.objects.create(
            id=3,
            name="5K Source Workout",
            routine=self.routine,
            unit=self.unit,
            priority_order=1,
            skip=False,
            difficulty=1,
            goal_distance=3.0,
        )
        CardioDailyLog.objects.create(
            datetime_started=now - timedelta(days=3),
            workout=source_workout,
            max_mph=6.0,
            avg_mph=5.2,
        )

        tempo_workout = CardioWorkout.objects.create(
            name="Tempo Runs",
            routine=self.routine,
            unit=self.unit,
            priority_order=2,
            skip=False,
            difficulty=1,
            goal_distance=3.0,
        )
        CardioDailyLog.objects.create(
            datetime_started=now - timedelta(days=1),
            workout=tempo_workout,
            max_mph=4.0,
            avg_mph=3.5,
        )

        riegel_max_6 = CardioGoals.objects.get(
            workout=tempo_workout,
            goal_type=CardioGoals.RIEGEL_MAX_6_MONTHS_GOAL_TYPE,
        )
        self.assertIsNotNone(riegel_max_6.mph_raw)

        d1_miles = 3.0
        d2_miles = 10000.0 / 1609.344
        t1_hours = d1_miles / 6.0
        t2_hours = t1_hours * ((d2_miles / d1_miles) ** 1.06)
        expected_mph = d2_miles / t2_hours

        self.assertAlmostEqual(riegel_max_6.mph_raw, expected_mph, places=6)
        self.assertLess(riegel_max_6.mph_raw, 6.0)

    def test_riegel_source_uses_logs_not_stale_goal_row(self):
        now = timezone.now()

        source_workout = CardioWorkout.objects.create(
            id=3,
            name="5K Source Workout",
            routine=self.routine,
            unit=self.unit,
            priority_order=1,
            skip=False,
            difficulty=1,
            goal_distance=3.0,
        )
        CardioDailyLog.objects.create(
            datetime_started=now - timedelta(days=2),
            workout=source_workout,
            max_mph=9.0,
            avg_mph=7.0,
        )

        tempo_workout = CardioWorkout.objects.create(
            name="Tempo Runs",
            routine=self.routine,
            unit=self.unit,
            priority_order=2,
            skip=False,
            difficulty=1,
            goal_distance=3.0,
        )
        CardioDailyLog.objects.create(
            datetime_started=now - timedelta(days=1),
            workout=tempo_workout,
            max_mph=5.0,
            avg_mph=4.5,
        )

        stale_source_goal = CardioGoals.objects.get(
            workout=source_workout,
            goal_type="highest_max_mph_6months",
        )
        stale_source_goal.mph_raw = 12.0
        stale_source_goal.mph_rounded = 12.0
        stale_source_goal.save(update_fields=["mph_raw", "mph_rounded"])

        from .cardio_goals_utils import sync_cardio_goals_for_workout

        sync_cardio_goals_for_workout(tempo_workout.id, now=now)

        riegel_max_6 = CardioGoals.objects.get(
            workout=tempo_workout,
            goal_type=CardioGoals.RIEGEL_MAX_6_MONTHS_GOAL_TYPE,
        )

        d1_miles = 3.0
        d2_miles = 10000.0 / 1609.344
        t1_hours = d1_miles / 9.0
        t2_hours = t1_hours * ((d2_miles / d1_miles) ** 1.06)
        expected_from_logs = d2_miles / t2_hours

        self.assertAlmostEqual(riegel_max_6.mph_raw, expected_from_logs, places=6)
        self.assertLess(riegel_max_6.mph_raw, 9.0)

    def test_riegel_avg_d2_uses_highest_progression_when_accomplished_in_8_weeks(self):
        now = timezone.now()

        source_workout = CardioWorkout.objects.create(
            id=3,
            name="5K Source Workout",
            routine=self.routine,
            unit=self.unit,
            priority_order=1,
            skip=False,
            difficulty=1,
            goal_distance=3.0,
        )
        CardioDailyLog.objects.create(
            datetime_started=now - timedelta(days=2),
            workout=source_workout,
            max_mph=9.0,
            avg_mph=7.0,
        )

        target_workout = CardioWorkout.objects.create(
            name="Avg D2 Highest Accomplished",
            routine=self.routine,
            unit=self.unit,
            priority_order=2,
            skip=False,
            difficulty=1,
            goal_distance=3.0,
        )
        CardioProgression.objects.create(workout=target_workout, progression_order=1, progression=2.0)
        CardioProgression.objects.create(workout=target_workout, progression_order=2, progression=4.0)
        CardioProgression.objects.create(workout=target_workout, progression_order=3, progression=6.0)
        CardioDailyLog.objects.create(
            datetime_started=now - timedelta(days=1),
            workout=target_workout,
            goal=6.0,
            total_completed=6.0,
            max_mph=6.0,
            avg_mph=5.5,
        )

        from .cardio_goals_utils import sync_cardio_goals_for_workout

        sync_cardio_goals_for_workout(target_workout.id, now=now)

        riegel_avg_6 = CardioGoals.objects.get(
            workout=target_workout,
            goal_type=CardioGoals.RIEGEL_AVG_6_MONTHS_GOAL_TYPE,
        )

        d1_miles = 3.0
        d2_miles = 6.0
        t1_hours = d1_miles / 9.0
        t2_hours = t1_hours * ((d2_miles / d1_miles) ** 1.06)
        expected = d2_miles / t2_hours
        self.assertAlmostEqual(riegel_avg_6.mph_raw, expected, places=6)

    def test_riegel_avg_d2_uses_highest_done_in_8_weeks_when_highest_not_accomplished(self):
        now = timezone.now()

        source_workout = CardioWorkout.objects.create(
            id=3,
            name="5K Source Workout",
            routine=self.routine,
            unit=self.unit,
            priority_order=1,
            skip=False,
            difficulty=1,
            goal_distance=3.0,
        )
        CardioDailyLog.objects.create(
            datetime_started=now - timedelta(days=2),
            workout=source_workout,
            max_mph=9.0,
            avg_mph=7.0,
        )

        target_workout = CardioWorkout.objects.create(
            name="Avg D2 Highest Done",
            routine=self.routine,
            unit=self.unit,
            priority_order=2,
            skip=False,
            difficulty=1,
            goal_distance=3.0,
        )
        CardioProgression.objects.create(workout=target_workout, progression_order=1, progression=2.0)
        CardioProgression.objects.create(workout=target_workout, progression_order=2, progression=4.0)
        CardioProgression.objects.create(workout=target_workout, progression_order=3, progression=6.0)
        CardioDailyLog.objects.create(
            datetime_started=now - timedelta(days=1),
            workout=target_workout,
            goal=6.0,
            total_completed=5.0,
            max_mph=6.0,
            avg_mph=5.5,
        )

        from .cardio_goals_utils import sync_cardio_goals_for_workout

        sync_cardio_goals_for_workout(target_workout.id, now=now)

        riegel_avg_6 = CardioGoals.objects.get(
            workout=target_workout,
            goal_type=CardioGoals.RIEGEL_AVG_6_MONTHS_GOAL_TYPE,
        )

        d1_miles = 3.0
        d2_miles = 6.0
        t1_hours = d1_miles / 9.0
        t2_hours = t1_hours * ((d2_miles / d1_miles) ** 1.06)
        expected = d2_miles / t2_hours
        self.assertAlmostEqual(riegel_avg_6.mph_raw, expected, places=6)

    def test_riegel_avg_d2_falls_back_to_lowest_progression_when_no_8_week_logs(self):
        now = timezone.now()

        source_workout = CardioWorkout.objects.create(
            id=3,
            name="5K Source Workout",
            routine=self.routine,
            unit=self.unit,
            priority_order=1,
            skip=False,
            difficulty=1,
            goal_distance=3.0,
        )
        CardioDailyLog.objects.create(
            datetime_started=now - timedelta(days=2),
            workout=source_workout,
            max_mph=9.0,
            avg_mph=7.0,
        )

        target_workout = CardioWorkout.objects.create(
            name="Avg D2 Lowest Fallback",
            routine=self.routine,
            unit=self.unit,
            priority_order=2,
            skip=False,
            difficulty=1,
            goal_distance=3.0,
        )
        CardioProgression.objects.create(workout=target_workout, progression_order=1, progression=2.0)
        CardioProgression.objects.create(workout=target_workout, progression_order=2, progression=4.0)
        CardioProgression.objects.create(workout=target_workout, progression_order=3, progression=6.0)
        CardioDailyLog.objects.create(
            datetime_started=now - timedelta(weeks=9),
            workout=target_workout,
            goal=6.0,
            total_completed=6.0,
            max_mph=6.0,
            avg_mph=5.5,
        )

        from .cardio_goals_utils import sync_cardio_goals_for_workout

        sync_cardio_goals_for_workout(target_workout.id, now=now)

        riegel_avg_6 = CardioGoals.objects.get(
            workout=target_workout,
            goal_type=CardioGoals.RIEGEL_AVG_6_MONTHS_GOAL_TYPE,
        )

        d1_miles = 3.0
        d2_miles = 2.0
        t1_hours = d1_miles / 9.0
        t2_hours = t1_hours * ((d2_miles / d1_miles) ** 1.06)
        expected = d2_miles / t2_hours
        self.assertAlmostEqual(riegel_avg_6.mph_raw, expected, places=6)

    def test_goal_row_updates_after_log_delete(self):
        workout = CardioWorkout.objects.create(
            name="Goal Sync Workout Delete",
            routine=self.routine,
            unit=self.unit,
            priority_order=1,
            skip=False,
            difficulty=1,
            goal_distance=3.0,
        )
        log = CardioDailyLog.objects.create(
            datetime_started=timezone.now(),
            workout=workout,
            max_mph=6.0,
            avg_mph=5.0,
        )

        goals_before = CardioGoals.objects.get(workout=workout, goal_type="last_max_mph")
        self.assertEqual(goals_before.mph_raw, 6.0)

        log.delete()

        goals_after = CardioGoals.objects.get(workout=workout, goal_type="last_max_mph")
        self.assertIsNone(goals_after.mph_raw)
        self.assertIsNone(goals_after.mph_rounded)


class CardioGoalsRefreshAllApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        unit_type = UnitType.objects.create(name="Distance")
        speed_name = SpeedName.objects.create(name="mph", speed_type="distance/time")
        unit = CardioUnit.objects.create(
            name="Miles",
            unit_type=unit_type,
            mround_numerator=1,
            mround_denominator=1,
            speed_name=speed_name,
            mile_equiv_numerator=1,
            mile_equiv_denominator=1,
        )
        routine = CardioRoutine.objects.create(name="5K Prep")
        CardioWorkout.objects.create(
            name="Refresh API Workout",
            routine=routine,
            unit=unit,
            priority_order=1,
            skip=False,
            difficulty=1,
            goal_distance=3.0,
        )

    def test_refresh_all_endpoint_recomputes_all_workouts(self):
        resp = self.client.post("/api/cardio/goals/refresh-all/", {}, format="json")
        self.assertEqual(resp.status_code, 200)
        payload = resp.json()
        self.assertIn("updated_workouts", payload)
        self.assertEqual(payload["updated_workouts"], CardioWorkout.objects.count())


class CardioGoalsTrendlineFitApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        unit_type = UnitType.objects.create(name="Distance")
        speed_name = SpeedName.objects.create(name="mph", speed_type="distance/time")
        self.unit = CardioUnit.objects.create(
            name="Miles",
            unit_type=unit_type,
            mround_numerator=1,
            mround_denominator=1,
            speed_name=speed_name,
            mile_equiv_numerator=1,
            mile_equiv_denominator=1,
        )
        self.routine = CardioRoutine.objects.create(name="5K Prep")

        # Riegel source for 5K Prep.
        self.source_workout = CardioWorkout.objects.create(
            id=3,
            name="Trendline Source Workout",
            routine=self.routine,
            unit=self.unit,
            priority_order=1,
            skip=False,
            difficulty=1,
            goal_distance=3.0,
        )
        CardioDailyLog.objects.create(
            datetime_started=timezone.now() - timedelta(days=3),
            workout=self.source_workout,
            max_mph=9.0,
            avg_mph=7.5,
            goal=3.0,
            total_completed=3.0,
        )

        self.target_workout = CardioWorkout.objects.create(
            name="Trendline Target Workout",
            routine=self.routine,
            unit=self.unit,
            priority_order=2,
            skip=False,
            difficulty=1,
            goal_distance=6.0,
        )
        CardioProgression.objects.create(workout=self.target_workout, progression_order=1, progression=2.0)
        CardioProgression.objects.create(workout=self.target_workout, progression_order=2, progression=4.0)
        CardioProgression.objects.create(workout=self.target_workout, progression_order=3, progression=6.0)
        now = timezone.now()
        CardioDailyLog.objects.create(
            datetime_started=now - timedelta(days=20),
            workout=self.target_workout,
            max_mph=6.2,
            avg_mph=5.4,
            goal=2.0,
            total_completed=2.0,
        )
        CardioDailyLog.objects.create(
            datetime_started=now - timedelta(days=10),
            workout=self.target_workout,
            max_mph=7.0,
            avg_mph=6.1,
            goal=4.0,
            total_completed=4.0,
        )
        CardioDailyLog.objects.create(
            datetime_started=now - timedelta(days=2),
            workout=self.target_workout,
            max_mph=8.0,
            avg_mph=6.8,
            goal=6.0,
            total_completed=5.5,
        )

    def test_trendline_fit_endpoint_returns_max_payload(self):
        resp = self.client.get(
            f"/api/cardio/goals/trendline-fit/?workout_id={self.target_workout.id}&max_avg_type=max"
        )
        self.assertEqual(resp.status_code, 200)
        payload = resp.json()
        self.assertIn(payload.get("best_fit_type"), {"linear", "exponential", "logarithmic", "power"})
        self.assertTrue(payload.get("formula"))
        self.assertIsInstance(payload.get("model_params"), dict)
        self.assertEqual(payload.get("highest_goal_type"), "highest_max_mph_6months")
        self.assertIsNotNone(payload.get("highest_goal_mph_raw"))
        pct = payload.get("highest_goal_inter_rank_percentage")
        self.assertIsNotNone(pct)
        self.assertGreaterEqual(float(pct), 1.0)
        self.assertLessEqual(float(pct), 100.0)

    def test_trendline_fit_endpoint_returns_avg_payload(self):
        resp = self.client.get(
            f"/api/cardio/goals/trendline-fit/?workout_id={self.target_workout.id}&max_avg_type=avg"
        )
        self.assertEqual(resp.status_code, 200)
        payload = resp.json()
        self.assertIn(payload.get("best_fit_type"), {"linear", "exponential", "logarithmic", "power"})
        self.assertTrue(payload.get("formula"))
        self.assertIsInstance(payload.get("model_params"), dict)
        self.assertEqual(payload.get("highest_goal_type"), "highest_avg_mph_6months")
        self.assertIsNotNone(payload.get("highest_goal_mph_raw"))
        pct = payload.get("highest_goal_inter_rank_percentage")
        self.assertIsNotNone(pct)
        self.assertGreaterEqual(float(pct), 1.0)
        self.assertLessEqual(float(pct), 100.0)
