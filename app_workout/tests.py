from django.test import TestCase
from unittest.mock import patch
from rest_framework.test import APIRequestFactory, APIClient
from django.utils import timezone

from .views import CardioLogsRecentView
from .models import (
    CardioRoutine,
    CardioWorkout,
    CardioUnit,
    UnitType,
    SpeedName,
    CardioDailyLog,
    CardioExercise,
    CardioDailyLogDetail,
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
