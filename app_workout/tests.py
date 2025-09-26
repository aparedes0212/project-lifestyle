from django.test import TestCase
from unittest.mock import patch
from rest_framework.test import APIRequestFactory, APIClient
from django.utils import timezone
from datetime import timedelta

from .views import CardioLogsRecentView
from .services import predict_next_cardio_routine, predict_next_cardio_workout
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

        program = Program.objects.create(name="HFT", selected=True)
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
        self.assertAlmostEqual(log.rep_goal, 399.75)

    @patch("app_workout.serializers.get_max_reps_goal_for_routine", return_value=3.5)
    def test_persists_max_reps_goal_from_progression(self, mock_goal):
        payload = {
            "datetime_started": timezone.now().isoformat(),
            "routine_id": self.routine.id,
            "rep_goal": 400.0,
        }
        resp = self.client.post("/api/strength/log/", payload, format="json")
        self.assertEqual(resp.status_code, 201)
        mock_goal.assert_called_once_with(self.routine.id, 400.0)
        log = StrengthDailyLog.objects.get(pk=resp.data["id"])
        self.assertAlmostEqual(log.max_reps_goal, 3.5)
        self.assertAlmostEqual(resp.data.get("max_reps_goal"), 3.5)


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
        self.assertAlmostEqual(resp.data["mph_goal"], 6.0)
        self.assertAlmostEqual(resp.data["miles"], 6.0)
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
        self.assertAlmostEqual(resp.data["seconds"], 58.258, places=3)

    def test_sprints_overrides_value(self):
        routine = CardioRoutine.objects.create(name="Sprints")
        w_sprint = CardioWorkout.objects.create(
            name="400s",
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
        self.assertAlmostEqual(resp.data["seconds"], 29.129, places=3)
