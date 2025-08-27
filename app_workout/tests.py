from django.test import TestCase
from unittest.mock import patch
from rest_framework.test import APIRequestFactory, APIClient
from django.utils import timezone
from datetime import timedelta

from .views import CardioLogsRecentView
from .services import predict_next_cardio_routine
from .models import (
    CardioRoutine,
    CardioWorkout,
    CardioUnit,
    UnitType,
    SpeedName,
    CardioDailyLog,
    CardioExercise,
    CardioDailyLogDetail,
    StrengthRoutine,
    StrengthDailyLog,
    StrengthExercise,
    StrengthDailyLogDetail,
    VwStrengthProgression,
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

        program = Program.objects.create(name="P", selected=True)
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
        self.assertEqual(log.rep_goal, 399)


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
            weight=250,
        )
        log.refresh_from_db()
        self.assertAlmostEqual(log.max_reps, (3 * 250) / 200)
