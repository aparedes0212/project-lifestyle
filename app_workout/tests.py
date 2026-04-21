from django.test import TestCase
from unittest.mock import patch
from rest_framework.test import APIRequestFactory, APIClient
from django.utils import timezone
from django.db import connection
from datetime import timedelta, datetime, date
from types import SimpleNamespace
from zoneinfo import ZoneInfo

from .views import CardioLogsRecentView
from .serializers import SupplementalDailyLogCreateSerializer, SupplementalDailyLogSerializer, StrengthDailyLogSerializer
from .cardio_metrics import get_cardio_metrics_snapshot, get_selected_cardio_metric_plan
from .distance_conversions import get_distance_conversion_settings, sync_interval_units_from_settings
from .services import (
    predict_next_cardio_routine,
    predict_next_cardio_workout,
    get_next_progression_for_workout,
    get_daily_routine_recommendation,
    get_existing_logs_for_activity_date,
    get_next_strength_goal,
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
    CardioExercise,
    CardioDailyLogDetail,
    CardioProgression,
    StrengthRoutine,
    StrengthDailyLog,
    StrengthExercise,
    StrengthDailyLogDetail,
    StrengthVolumeBucket,
    SupplementalRoutine,
    SupplementalDailyLog,
    SupplementalDailyLogDetail,
    RoutineScheduleDay,
    CardioGoals,
    StrengthGoals,
    SupplementalGoals,
    DistanceConversionSettings,
    CardioMetricPeriodSelection,
)


class CardioLogsRecentViewTests(TestCase):
    def test_backfill_invoked_each_request(self):
        """Ensure backfill_rest_days_if_gap is called when querying logs."""
        factory = APIRequestFactory()
        request = factory.get("/api/cardio/logs/")
        request.query_params = request.GET
        view = CardioLogsRecentView()
        view.request = request

        with patch("app_workout.views.RestBackfillService.instance") as mock_instance:
            # We only care that get_queryset triggers the helper; the actual
            # queryset evaluation is secondary for this test.
            view.get_queryset()
            mock_instance.return_value.ensure_backfilled.assert_called_once()


class PredictNextRoutineTests(TestCase):
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
        self.wrest = CardioWorkout.objects.create(
            name="Rest",
            routine=self.rrest,
            unit=unit,
            priority_order=1,
            skip=False,
            difficulty=1,
        )

    def test_prefers_never_done_canonical_routine(self):
        now = timezone.now()
        CardioDailyLog.objects.create(
            datetime_started=now - timedelta(days=1),
            workout=self.w5k,
        )

        next_routine = predict_next_cardio_routine(now=now)
        self.assertEqual(next_routine, self.rsprint)

    def test_ignores_rest_and_picks_least_recent_canonical_routine(self):
        now = timezone.now()
        CardioDailyLog.objects.create(
            datetime_started=now - timedelta(days=10),
            workout=self.wrest,
        )
        CardioDailyLog.objects.create(
            datetime_started=now - timedelta(days=4),
            workout=self.w5k,
        )
        CardioDailyLog.objects.create(
            datetime_started=now - timedelta(hours=6),
            workout=self.wsprint,
        )

        next_routine = predict_next_cardio_routine(now=now)
        self.assertEqual(next_routine, self.r5k)


class PredictNextRoutineFilteringTests(TestCase):
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

        self.r1 = CardioRoutine.objects.create(name="R1")
        self.r2 = CardioRoutine.objects.create(name="R2")
        self.r3 = CardioRoutine.objects.create(name="R3")
        self.rrest = CardioRoutine.objects.create(name="Rest")

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
        self.wrest = CardioWorkout.objects.create(
            name="WRest",
            routine=self.rrest,
            unit=unit,
            priority_order=1,
            skip=False,
            difficulty=1,
        )

    def test_falls_back_to_non_rest_routines_when_canonical_routines_do_not_exist(self):
        now = timezone.now()
        CardioDailyLog.objects.create(
            datetime_started=now - timedelta(days=2),
            workout=self.w2,
        )
        CardioDailyLog.objects.create(
            datetime_started=now - timedelta(hours=3),
            workout=self.w3,
        )

        next_routine = predict_next_cardio_routine(now=now)
        self.assertEqual(next_routine, self.r1)

    def test_non_rest_fallback_still_ignores_rest_history(self):
        now = timezone.now()
        CardioDailyLog.objects.create(
            datetime_started=now - timedelta(days=12),
            workout=self.wrest,
        )
        CardioDailyLog.objects.create(
            datetime_started=now - timedelta(days=4),
            workout=self.w1,
        )
        CardioDailyLog.objects.create(
            datetime_started=now - timedelta(days=1),
            workout=self.w2,
        )
        CardioDailyLog.objects.create(
            datetime_started=now - timedelta(hours=2),
            workout=self.w3,
        )

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


class DailyRoutineRecommendationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.calendar_zone = ZoneInfo("America/Denver")
        self.today = timezone.localdate(timezone=self.calendar_zone)
        self.yesterday = self.today - timedelta(days=1)

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

        self.five_k_routine = CardioRoutine.objects.create(name="5K Prep")
        self.sprints_routine = CardioRoutine.objects.create(name="Sprints")
        self.five_k_workout = CardioWorkout.objects.create(
            name="5K Session",
            routine=self.five_k_routine,
            unit=unit,
            priority_order=1,
            skip=False,
            difficulty=1,
            goal_distance=3.0,
        )
        self.sprints_workout = CardioWorkout.objects.create(
            name="Sprint Session",
            routine=self.sprints_routine,
            unit=unit,
            priority_order=1,
            skip=False,
            difficulty=1,
            goal_distance=0.5,
        )
        CardioProgression.objects.create(workout=self.five_k_workout, progression_order=1, progression=3.0)
        CardioProgression.objects.create(workout=self.sprints_workout, progression_order=1, progression=0.5)

        self.strength_routine = StrengthRoutine.objects.create(
            name="Strength",
            hundred_points_reps=100,
            hundred_points_weight=100,
        )
        self.supplemental_routine = SupplementalRoutine.objects.create(
            name="Supplemental",
            unit="Time",
            step_value=5,
            max_set=60,
            step_weight=10,
            rest_yellow_start_seconds=60,
            rest_red_start_seconds=90,
        )

        for day_number, routine_codes in [
            (1, ["5k_prep", "supplemental"]),
            (2, ["sprints", "strength"]),
            (3, ["5k_prep", "supplemental"]),
            (4, ["strength", "supplemental"]),
            (5, ["5k_prep", "supplemental"]),
            (6, ["sprints"]),
            (7, ["strength", "supplemental"]),
        ]:
            RoutineScheduleDay.objects.update_or_create(
                day_number=day_number,
                defaults={"routine_codes": routine_codes},
            )

    def _dt_for(self, activity_date, hour=12):
        return datetime(
            activity_date.year,
            activity_date.month,
            activity_date.day,
            hour,
            0,
            0,
            tzinfo=self.calendar_zone,
        )

    def _log_combo(self, activity_date, cardio_workout=None, include_strength=False, include_supplemental=False):
        dt = self._dt_for(activity_date)
        if cardio_workout is not None:
            CardioDailyLog.objects.create(
                datetime_started=dt,
                activity_date=activity_date,
                workout=cardio_workout,
            )
        if include_strength:
            StrengthDailyLog.objects.create(
                datetime_started=dt,
                activity_date=activity_date,
                routine=self.strength_routine,
            )
        if include_supplemental:
            SupplementalDailyLog.objects.create(
                datetime_started=dt,
                activity_date=activity_date,
                routine=self.supplemental_routine,
                unit_snapshot=self.supplemental_routine.unit,
            )

    def _log_day_number(self, activity_date, day_number):
        schedule_day = RoutineScheduleDay.objects.get(day_number=day_number)
        routine_codes = set(schedule_day.routine_codes or [])
        cardio_workout = None
        if "5k_prep" in routine_codes:
            cardio_workout = self.five_k_workout
        elif "sprints" in routine_codes:
            cardio_workout = self.sprints_workout
        self._log_combo(
            activity_date,
            cardio_workout=cardio_workout,
            include_strength="strength" in routine_codes,
            include_supplemental="supplemental" in routine_codes,
        )

    def test_duplicate_routine_sets_are_ranked_by_specific_day_number(self):
        self._log_day_number(self.today - timedelta(days=3), 1)
        self._log_day_number(self.today - timedelta(days=2), 2)
        self._log_day_number(self.yesterday, 4)

        recommendation = get_daily_routine_recommendation()

        self.assertEqual(recommendation["reference_source"], "yesterday")
        self.assertEqual(recommendation["recommended_candidate"]["candidate_key"], "5k_prep+supplemental")
        self.assertEqual(recommendation["recommended_candidate"]["day_number"], 5)
        self.assertEqual(
            [candidate["day_number"] for candidate in recommendation["alternative_candidates"]],
            [1],
        )
        self.assertIsNone(recommendation["today_selection"])

    def test_partial_match_uses_overlap_and_ranks_specific_days(self):
        self._log_day_number(self.today - timedelta(days=3), 1)
        self._log_combo(self.yesterday, include_supplemental=True)

        recommendation = get_daily_routine_recommendation()
        ranked_model_day_numbers = [day["day_number"] for day in recommendation["ranked_model_days"]]

        self.assertEqual(recommendation["reference_entry"]["combination_key"], "supplemental")
        self.assertEqual(recommendation["recommended_candidate"]["day_number"], 1)
        self.assertEqual(
            {candidate["day_number"] for candidate in recommendation["all_candidates"]},
            {1, 2, 4, 5, 6},
        )
        self.assertEqual(ranked_model_day_numbers[0], 1)
        self.assertEqual(set(ranked_model_day_numbers), {1, 2, 3, 4, 5, 6, 7})

    def test_recommendation_includes_today_selection_when_logs_exist(self):
        self._log_combo(self.today, include_strength=True, include_supplemental=True)

        recommendation = get_daily_routine_recommendation()

        self.assertIsNotNone(recommendation["today_selection"])
        self.assertEqual(recommendation["today_selection"]["candidate_key"], "strength+supplemental")
        self.assertEqual(recommendation["today_selection"]["day_numbers"], [4])

    def test_home_recommendation_endpoint_includes_recent_history(self):
        self._log_combo(self.yesterday, cardio_workout=self.five_k_workout, include_supplemental=True)

        response = self.client.get("/api/home/recommendation/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(len(payload["recent_history"]) >= 1)
        self.assertEqual(
            payload["recent_history"][0],
            {
                "activity_date": self.yesterday.isoformat(),
                "label": "5K Prep & Supplemental",
                "routine_codes": ["5k_prep", "supplemental"],
                "routine_labels": ["5K Prep", "Supplemental"],
                "combination_key": "5k_prep+supplemental",
                "matched_day_number": 1,
                "matched_day_label": "Day 1",
                "matched_schedule_label": "5K Prep & Supplemental",
                "match_quality": "exact",
            },
        )

    def test_weekly_model_endpoint_lists_days_and_options(self):
        response = self.client.get("/api/settings/weekly-model/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()

        self.assertEqual(len(payload["days"]), 7)
        self.assertEqual(
            payload["days"][0],
            {
                "day_number": 1,
                "day_label": "Day 1",
                "routine_codes": ["5k_prep", "supplemental"],
                "routine_labels": ["5K Prep", "Supplemental"],
                "label": "5K Prep & Supplemental",
            },
        )
        self.assertEqual(
            payload["routine_options"],
            [
                {"code": "5k_prep", "label": "5K Prep"},
                {"code": "sprints", "label": "Sprints"},
                {"code": "strength", "label": "Strength"},
                {"code": "supplemental", "label": "Supplemental"},
            ],
        )

    def test_weekly_model_endpoint_updates_all_days(self):
        response = self.client.put(
            "/api/settings/weekly-model/",
            {
                "days": [
                    {"day_number": 1, "routine_codes": ["strength"]},
                    {"day_number": 2, "routine_codes": ["5k_prep", "supplemental"]},
                    {"day_number": 3, "routine_codes": ["sprints"]},
                    {"day_number": 4, "routine_codes": ["strength", "supplemental"]},
                    {"day_number": 5, "routine_codes": ["5k_prep"]},
                    {"day_number": 6, "routine_codes": ["sprints", "strength"]},
                    {"day_number": 7, "routine_codes": ["supplemental"]},
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            list(RoutineScheduleDay.objects.order_by("day_number").values_list("routine_codes", flat=True)),
            [
                ["strength"],
                ["5k_prep", "supplemental"],
                ["sprints"],
                ["strength", "supplemental"],
                ["5k_prep"],
                ["sprints", "strength"],
                ["supplemental"],
            ],
        )

    def test_weekly_model_endpoint_requires_all_seven_days(self):
        response = self.client.put(
            "/api/settings/weekly-model/",
            {
                "days": [
                    {"day_number": 1, "routine_codes": ["strength"]},
                    {"day_number": 2, "routine_codes": ["5k_prep"]},
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("exactly 7", response.json()["days"][0])

    @patch("app_workout.views.get_next_strength_goal", return_value=SimpleNamespace(daily_volume=60))
    def test_accept_endpoint_creates_logs_for_selected_alternative(self, _mock_strength_goal):
        self._log_combo(self.yesterday, include_supplemental=True)

        response = self.client.post(
            "/api/home/recommendation/accept/",
            {"candidate_key": "sprints+strength"},
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        payload = response.json()
        created_items = {item["routine_code"]: item for item in payload["items"]}

        self.assertEqual(payload["accepted_candidate"]["candidate_key"], "sprints+strength")
        self.assertTrue(CardioDailyLog.objects.filter(activity_date=self.today, workout=self.sprints_workout).exists())
        self.assertTrue(StrengthDailyLog.objects.filter(activity_date=self.today, routine=self.strength_routine).exists())
        self.assertTrue(created_items["sprints"]["created"])
        self.assertTrue(created_items["strength"]["created"])
        self.assertEqual(created_items["sprints"]["detail_path"], f"/logs/{created_items['sprints']['log']['id']}")
        self.assertEqual(created_items["strength"]["detail_path"], f"/strength/logs/{created_items['strength']['log']['id']}")

    def test_accept_endpoint_allows_selecting_any_model_day(self):
        self._log_combo(self.yesterday, include_supplemental=True)

        response = self.client.post(
            "/api/home/recommendation/accept/",
            {"day_number": 1},
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        payload = response.json()
        created_items = {item["routine_code"]: item for item in payload["items"]}

        self.assertEqual(payload["accepted_candidate"]["day_numbers"], [1])
        self.assertTrue(CardioDailyLog.objects.filter(activity_date=self.today, workout=self.five_k_workout).exists())
        self.assertTrue(SupplementalDailyLog.objects.filter(activity_date=self.today, routine=self.supplemental_routine).exists())
        self.assertTrue(created_items["5k_prep"]["created"])
        self.assertTrue(created_items["supplemental"]["created"])

    def test_accept_endpoint_replaces_non_target_today_logs(self):
        strength_log = StrengthDailyLog.objects.create(
            datetime_started=self._dt_for(self.today),
            activity_date=self.today,
            routine=self.strength_routine,
        )
        supplemental_log = SupplementalDailyLog.objects.create(
            datetime_started=self._dt_for(self.today),
            activity_date=self.today,
            routine=self.supplemental_routine,
            unit_snapshot=self.supplemental_routine.unit,
        )

        response = self.client.post(
            "/api/home/recommendation/accept/",
            {"day_number": 1},
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        payload = response.json()
        removed_codes = sorted(item["routine_code"] for item in payload["removed_items"])
        created_items = {item["routine_code"]: item for item in payload["items"]}

        self.assertFalse(StrengthDailyLog.objects.filter(pk=strength_log.pk).exists())
        self.assertTrue(SupplementalDailyLog.objects.filter(pk=supplemental_log.pk).exists())
        self.assertTrue(CardioDailyLog.objects.filter(activity_date=self.today, workout=self.five_k_workout).exists())
        self.assertEqual(removed_codes, ["strength"])
        self.assertEqual(created_items["supplemental"]["log"]["id"], supplemental_log.id)
        self.assertFalse(created_items["supplemental"]["created"])
        self.assertTrue(created_items["5k_prep"]["created"])

    def test_recommendations_eventually_converge_to_day_order_when_followed(self):
        self._log_day_number(self.today - timedelta(days=4), 4)
        self._log_day_number(self.today - timedelta(days=3), 1)
        self._log_day_number(self.today - timedelta(days=2), 6)
        self._log_day_number(self.yesterday, 2)

        recommended_days = []
        current_date = self.today
        for _ in range(35):
            recommendation = get_daily_routine_recommendation(now=self._dt_for(current_date))
            recommended = recommendation["recommended_candidate"]
            self.assertIsNotNone(recommended)

            day_number = recommended["day_number"]
            recommended_days.append(day_number)
            self._log_day_number(current_date, day_number)
            current_date += timedelta(days=1)

        windows = [
            recommended_days[idx:idx + 7]
            for idx in range(len(recommended_days) - 6)
        ]
        self.assertIn([1, 2, 3, 4, 5, 6, 7], windows)


class UserTimezoneConsistencyTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.strength_routine = StrengthRoutine.objects.create(
            name="Strength",
            hundred_points_reps=100,
            hundred_points_weight=100,
        )
        self.session_started_utc = datetime(2026, 4, 20, 4, 6, 41, tzinfo=ZoneInfo("UTC"))
        self.log = StrengthDailyLog.objects.create(
            datetime_started=self.session_started_utc,
            routine=self.strength_routine,
        )
        StrengthDailyLog.objects.filter(pk=self.log.pk).update(activity_date=date(2026, 4, 20))
        self.log.refresh_from_db()

    def test_strength_serializer_uses_active_timezone_for_activity_date(self):
        with timezone.override(ZoneInfo("America/Denver")):
            data = StrengthDailyLogSerializer(self.log).data
        self.assertEqual(data["activity_date"], "2026-04-19")

    def test_existing_log_lookup_uses_timezone_boundaries_instead_of_stored_activity_date(self):
        with timezone.override(ZoneInfo("America/Denver")):
            by_previous_day = get_existing_logs_for_activity_date(date(2026, 4, 19))
            by_next_day = get_existing_logs_for_activity_date(date(2026, 4, 20))

        self.assertEqual([log.id for log in by_previous_day.get("strength", [])], [self.log.id])
        self.assertEqual(by_next_day.get("strength", []), [])

    def test_strength_logs_endpoint_uses_request_timezone_header(self):
        denver_response = self.client.get(
            "/api/strength/logs/?weeks=8",
            HTTP_X_USER_TIMEZONE="America/Denver",
        )
        new_york_response = self.client.get(
            "/api/strength/logs/?weeks=8",
            HTTP_X_USER_TIMEZONE="America/New_York",
        )

        self.assertEqual(denver_response.status_code, 200)
        self.assertEqual(new_york_response.status_code, 200)
        self.assertEqual(denver_response.json()[0]["activity_date"], "2026-04-19")
        self.assertEqual(new_york_response.json()[0]["activity_date"], "2026-04-20")


class HomeRecommendationMetricsSelectionTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.calendar_zone = ZoneInfo("America/Denver")
        self.today = timezone.localdate(timezone=self.calendar_zone)

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

        self.five_k_routine = CardioRoutine.objects.create(name="5K Prep")
        self.fast_workout = CardioWorkout.objects.create(
            name="Fast",
            routine=self.five_k_routine,
            unit=unit,
            priority_order=1,
            skip=False,
            difficulty=1,
            goal_distance=3.0,
        )
        CardioProgression.objects.create(workout=self.fast_workout, progression_order=1, progression=3.0)

        for day_number, routine_codes in [
            (1, ["5k_prep"]),
            (2, ["sprints"]),
            (3, ["5k_prep"]),
            (4, ["strength"]),
            (5, ["5k_prep"]),
            (6, ["sprints"]),
            (7, ["supplemental"]),
        ]:
            RoutineScheduleDay.objects.update_or_create(
                day_number=day_number,
                defaults={"routine_codes": routine_codes},
            )

    def _dt_for(self, activity_date, hour=12):
        return datetime(
            activity_date.year,
            activity_date.month,
            activity_date.day,
            hour,
            0,
            0,
            tzinfo=self.calendar_zone,
        )

    def test_accept_endpoint_uses_saved_metric_selection_for_created_cardio_log(self):
        CardioDailyLog.objects.create(
            datetime_started=self._dt_for(self.today - timedelta(days=2)),
            activity_date=self.today - timedelta(days=2),
            workout=self.fast_workout,
            goal=3.0,
            total_completed=3.0,
            max_mph=6.5,
            avg_mph=6.2,
        )
        CardioMetricPeriodSelection.objects.create(workout=self.fast_workout, period_key="last_time")

        response = self.client.post(
            "/api/home/recommendation/accept/",
            {"day_number": 1},
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        created = CardioDailyLog.objects.get(activity_date=self.today, workout=self.fast_workout)
        self.assertAlmostEqual(created.mph_goal, 6.6, places=6)
        self.assertAlmostEqual(created.mph_goal_avg, 6.3, places=6)


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

    def test_patch_updates_avg_mph(self):
        url = f"/api/cardio/log/{self.log.id}/"
        resp = self.client.patch(url, {"avg_mph": 6.75}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.log.refresh_from_db()
        self.assertEqual(self.log.avg_mph, 6.75)

    def test_patch_updates_mph_goal(self):
        url = f"/api/cardio/log/{self.log.id}/"
        resp = self.client.patch(url, {"mph_goal": 6.4}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.log.refresh_from_db()
        self.assertEqual(self.log.mph_goal, 6.4)

    def test_patch_updates_mph_goal_avg(self):
        url = f"/api/cardio/log/{self.log.id}/"
        resp = self.client.patch(url, {"mph_goal_avg": 5.9}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.log.refresh_from_db()
        self.assertEqual(self.log.mph_goal_avg, 5.9)

    def test_patch_updates_goal_percentages(self):
        url = f"/api/cardio/log/{self.log.id}/"
        resp = self.client.patch(
            url,
            {"mph_goal_percentage": 47, "mph_goal_avg_percentage": 34},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.log.refresh_from_db()
        self.assertEqual(self.log.mph_goal_percentage, 47)
        self.assertEqual(self.log.mph_goal_avg_percentage, 34)

    def test_create_persists_goal_percentages(self):
        resp = self.client.post(
            "/api/cardio/log/",
            {
                "datetime_started": timezone.now().isoformat(),
                "workout_id": self.log.workout_id,
                "goal": 5.0,
                "mph_goal": 6.4,
                "mph_goal_avg": 5.9,
                "mph_goal_percentage": 47,
                "mph_goal_avg_percentage": 34,
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201)
        created_id = resp.data.get("id")
        created = CardioDailyLog.objects.get(pk=created_id)
        self.assertEqual(created.mph_goal_percentage, 47)
        self.assertEqual(created.mph_goal_avg_percentage, 34)


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


class CardioGoalDistanceEndpointTests(TestCase):
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

        self.five_k_routine = CardioRoutine.objects.create(name="5K Prep")
        self.sprints_routine = CardioRoutine.objects.create(name="Sprints")
        self.rest_routine = CardioRoutine.objects.create(name="Rest")

        self.five_k_workout = CardioWorkout.objects.create(
            name="Tempo",
            routine=self.five_k_routine,
            unit=unit,
            priority_order=1,
            skip=False,
            difficulty=1,
            goal_distance=3.0,
        )
        self.sprints_workout = CardioWorkout.objects.create(
            name="x200",
            routine=self.sprints_routine,
            unit=unit,
            priority_order=1,
            skip=False,
            difficulty=1,
            goal_distance=0.5,
        )
        self.rest_workout = CardioWorkout.objects.create(
            name="Rest Day",
            routine=self.rest_routine,
            unit=unit,
            priority_order=1,
            skip=False,
            difficulty=1,
            goal_distance=0.0,
        )

    def test_goal_distance_list_excludes_rest_and_sprints(self):
        response = self.client.get("/api/cardio/goal-distances/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        workout_names = [item["workout_name"] for item in payload]

        self.assertEqual(workout_names, ["Tempo"])

    def test_goal_distance_patch_rejects_sprints_and_rest(self):
        response = self.client.patch(
            f"/api/cardio/goal-distances/{self.sprints_workout.id}/",
            {"goal_distance": 1.0},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

        response = self.client.patch(
            f"/api/cardio/goal-distances/{self.rest_workout.id}/",
            {"goal_distance": 1.0},
            format="json",
        )
        self.assertEqual(response.status_code, 400)


class DistanceConversionSettingsViewTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        unit_type = UnitType.objects.create(name="Distance")
        speed_name = SpeedName.objects.create(name="mph", speed_type="distance/time")
        CardioUnit.objects.create(
            name="800m Intervals",
            unit_type=unit_type,
            mround_numerator=1,
            mround_denominator=1,
            speed_name=speed_name,
            mile_equiv_numerator=800,
            mile_equiv_denominator=1609.344,
        )
        self.x400_unit = CardioUnit.objects.create(
            name="400m Intervals",
            unit_type=unit_type,
            mround_numerator=1,
            mround_denominator=1,
            speed_name=speed_name,
            mile_equiv_numerator=400,
            mile_equiv_denominator=1609.344,
        )
        CardioUnit.objects.create(
            name="200m Intervals",
            unit_type=unit_type,
            mround_numerator=1,
            mround_denominator=1,
            speed_name=speed_name,
            mile_equiv_numerator=200,
            mile_equiv_denominator=1609.344,
        )

    def test_get_creates_default_settings_and_syncs_interval_units(self):
        response = self.client.get("/api/settings/distance-conversions/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertAlmostEqual(payload["ten_k_miles"], 6.21371192, places=8)
        self.assertEqual(DistanceConversionSettings.objects.count(), 1)

        x800_unit = CardioUnit.objects.get(name="800m Intervals")
        self.x400_unit.refresh_from_db()
        x200_unit = CardioUnit.objects.get(name="200m Intervals")
        self.assertAlmostEqual(float(x800_unit.mile_equiv_numerator), 0.5, places=6)
        self.assertAlmostEqual(float(x800_unit.mile_equiv_denominator), 1.0, places=6)
        self.assertAlmostEqual(float(self.x400_unit.mile_equiv_numerator), 0.25, places=6)
        self.assertAlmostEqual(float(self.x400_unit.mile_equiv_denominator), 1.0, places=6)
        self.assertAlmostEqual(float(x200_unit.mile_equiv_numerator), 0.125, places=6)
        self.assertAlmostEqual(float(x200_unit.mile_equiv_denominator), 1.0, places=6)

    def test_patch_updates_settings_and_interval_units(self):
        self.client.get("/api/settings/distance-conversions/")

        response = self.client.patch(
            "/api/settings/distance-conversions/",
            {
                "x400_miles": 0.3,
                "x400_meters": 405,
                "x400_yards": 445,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertAlmostEqual(payload["x400_miles"], 0.3, places=6)
        self.assertAlmostEqual(payload["x400_meters"], 405.0, places=6)
        self.assertAlmostEqual(payload["x400_yards"], 445.0, places=6)

        self.x400_unit.refresh_from_db()
        self.assertAlmostEqual(float(self.x400_unit.mile_equiv_numerator), 0.3, places=6)
        self.assertAlmostEqual(float(self.x400_unit.mile_equiv_denominator), 1.0, places=6)


class CardioMetricsViewTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        distance_type = UnitType.objects.create(name="Distance")
        time_type = UnitType.objects.create(name="Time")
        speed_name = SpeedName.objects.create(name="mph", speed_type="distance/time")
        miles_unit = CardioUnit.objects.create(
            name="Miles",
            unit_type=distance_type,
            mround_numerator=1,
            mround_denominator=1,
            speed_name=speed_name,
            mile_equiv_numerator=1,
            mile_equiv_denominator=1,
        )
        x800_unit = CardioUnit.objects.create(
            name="800m Intervals",
            unit_type=distance_type,
            mround_numerator=1,
            mround_denominator=1,
            speed_name=speed_name,
            mile_equiv_numerator=800,
            mile_equiv_denominator=1609.344,
        )
        x400_unit = CardioUnit.objects.create(
            name="400m Intervals",
            unit_type=distance_type,
            mround_numerator=1,
            mround_denominator=1,
            speed_name=speed_name,
            mile_equiv_numerator=400,
            mile_equiv_denominator=1609.344,
        )
        x200_unit = CardioUnit.objects.create(
            name="200m Intervals",
            unit_type=distance_type,
            mround_numerator=1,
            mround_denominator=1,
            speed_name=speed_name,
            mile_equiv_numerator=200,
            mile_equiv_denominator=1609.344,
        )
        minutes_unit = CardioUnit.objects.create(
            name="Minutes",
            unit_type=time_type,
            mround_numerator=1,
            mround_denominator=1,
            speed_name=speed_name,
            mile_equiv_numerator=1,
            mile_equiv_denominator=1,
        )

        self.routine_5k = CardioRoutine.objects.create(name="5K Prep")
        self.routine_sprints = CardioRoutine.objects.create(name="Sprints")

        self.fast_workout = CardioWorkout.objects.create(
            name="Fast",
            routine=self.routine_5k,
            unit=miles_unit,
            priority_order=1,
            skip=False,
            difficulty=1,
            goal_distance=3.0,
        )
        CardioProgression.objects.create(workout=self.fast_workout, progression_order=1, progression=4.0)
        CardioProgression.objects.create(workout=self.fast_workout, progression_order=2, progression=4.0)
        CardioProgression.objects.create(workout=self.fast_workout, progression_order=3, progression=5.0)
        CardioProgression.objects.create(workout=self.fast_workout, progression_order=4, progression=5.0)
        CardioProgression.objects.create(workout=self.fast_workout, progression_order=5, progression=6.0)
        CardioProgression.objects.create(workout=self.fast_workout, progression_order=6, progression=6.0)
        self.tempo_workout = CardioWorkout.objects.create(
            name="Tempo",
            routine=self.routine_5k,
            unit=minutes_unit,
            priority_order=2,
            skip=False,
            difficulty=1,
            goal_distance=5.0,
        )
        CardioProgression.objects.create(workout=self.tempo_workout, progression_order=1, progression=30.0)
        CardioProgression.objects.create(workout=self.tempo_workout, progression_order=2, progression=30.0)
        CardioProgression.objects.create(workout=self.tempo_workout, progression_order=3, progression=35.0)
        CardioProgression.objects.create(workout=self.tempo_workout, progression_order=4, progression=35.0)
        CardioProgression.objects.create(workout=self.tempo_workout, progression_order=5, progression=40.0)
        CardioProgression.objects.create(workout=self.tempo_workout, progression_order=6, progression=40.0)
        CardioProgression.objects.create(workout=self.tempo_workout, progression_order=7, progression=45.0)
        self.min_run_workout = CardioWorkout.objects.create(
            name="Min Run",
            routine=self.routine_5k,
            unit=minutes_unit,
            priority_order=3,
            skip=False,
            difficulty=1,
            goal_distance=30.0,
        )
        CardioProgression.objects.create(workout=self.min_run_workout, progression_order=1, progression=60.0)
        CardioProgression.objects.create(workout=self.min_run_workout, progression_order=2, progression=65.0)
        CardioProgression.objects.create(workout=self.min_run_workout, progression_order=3, progression=70.0)
        CardioProgression.objects.create(workout=self.min_run_workout, progression_order=4, progression=75.0)
        CardioProgression.objects.create(workout=self.min_run_workout, progression_order=5, progression=85.0)
        CardioProgression.objects.create(workout=self.min_run_workout, progression_order=6, progression=90.0)
        self.x800_workout = CardioWorkout.objects.create(
            name="x800",
            routine=self.routine_sprints,
            unit=x800_unit,
            priority_order=1,
            skip=False,
            difficulty=1,
            goal_distance=1.0,
        )
        CardioProgression.objects.create(workout=self.x800_workout, progression_order=1, progression=3.0)
        CardioProgression.objects.create(workout=self.x800_workout, progression_order=2, progression=4.0)
        CardioProgression.objects.create(workout=self.x800_workout, progression_order=3, progression=5.0)
        self.x400_workout = CardioWorkout.objects.create(
            name="x400",
            routine=self.routine_sprints,
            unit=x400_unit,
            priority_order=2,
            skip=False,
            difficulty=1,
            goal_distance=1.0,
        )
        CardioProgression.objects.create(workout=self.x400_workout, progression_order=1, progression=5.0)
        CardioProgression.objects.create(workout=self.x400_workout, progression_order=2, progression=6.0)
        CardioProgression.objects.create(workout=self.x400_workout, progression_order=3, progression=7.0)
        CardioProgression.objects.create(workout=self.x400_workout, progression_order=4, progression=8.0)
        self.x200_workout = CardioWorkout.objects.create(
            name="x200",
            routine=self.routine_sprints,
            unit=x200_unit,
            priority_order=3,
            skip=False,
            difficulty=1,
            goal_distance=1.0,
        )
        CardioProgression.objects.create(workout=self.x200_workout, progression_order=1, progression=8.0)
        CardioProgression.objects.create(workout=self.x200_workout, progression_order=2, progression=9.0)
        CardioProgression.objects.create(workout=self.x200_workout, progression_order=3, progression=10.0)

        now = timezone.now()
        CardioDailyLog.objects.create(datetime_started=now - timedelta(days=150), workout=self.fast_workout, goal=4.0, total_completed=4.0, max_mph=9.9, avg_mph=9.4)
        CardioDailyLog.objects.create(datetime_started=now - timedelta(days=20), workout=self.fast_workout, goal=6.0, total_completed=6.0, max_mph=6.5, avg_mph=6.2)
        CardioDailyLog.objects.create(datetime_started=now - timedelta(days=2), workout=self.fast_workout, goal=6.0, total_completed=6.0, max_mph=6.0, avg_mph=5.8)

        CardioDailyLog.objects.create(datetime_started=now - timedelta(days=160), workout=self.tempo_workout, goal=30.0, total_completed=30.0, max_mph=6.8, avg_mph=8.1)
        CardioDailyLog.objects.create(datetime_started=now - timedelta(days=12), workout=self.tempo_workout, goal=45.0, total_completed=45.0, max_mph=6.3, avg_mph=5.9)
        CardioDailyLog.objects.create(datetime_started=now - timedelta(days=1), workout=self.tempo_workout, goal=45.0, total_completed=45.0, max_mph=6.0, avg_mph=5.7)

        CardioDailyLog.objects.create(datetime_started=now - timedelta(days=140), workout=self.min_run_workout, goal=60.0, total_completed=60.0, max_mph=6.4, avg_mph=6.4)
        CardioDailyLog.objects.create(datetime_started=now - timedelta(days=15), workout=self.min_run_workout, goal=90.0, total_completed=90.0, max_mph=5.6, avg_mph=5.2)
        CardioDailyLog.objects.create(datetime_started=now - timedelta(days=3), workout=self.min_run_workout, goal=90.0, total_completed=90.0, max_mph=5.3, avg_mph=5.0)

        CardioDailyLog.objects.create(datetime_started=now - timedelta(days=100), workout=self.x800_workout, goal=3.0, total_completed=3.0, max_mph=10.0, avg_mph=9.2)
        CardioDailyLog.objects.create(datetime_started=now - timedelta(days=10), workout=self.x800_workout, goal=5.0, total_completed=5.0, max_mph=9.5, avg_mph=8.9)
        CardioDailyLog.objects.create(datetime_started=now - timedelta(days=1), workout=self.x800_workout, goal=5.0, total_completed=5.0, max_mph=9.0, avg_mph=8.5)

        CardioDailyLog.objects.create(datetime_started=now - timedelta(days=90), workout=self.x400_workout, goal=6.0, total_completed=6.0, max_mph=11.0, avg_mph=10.1)
        CardioDailyLog.objects.create(datetime_started=now - timedelta(days=6), workout=self.x400_workout, goal=8.0, total_completed=8.0, max_mph=10.6, avg_mph=9.9)
        CardioDailyLog.objects.create(datetime_started=now - timedelta(hours=12), workout=self.x400_workout, goal=8.0, total_completed=8.0, max_mph=10.2, avg_mph=9.7)

        CardioDailyLog.objects.create(datetime_started=now - timedelta(days=80), workout=self.x200_workout, goal=8.0, total_completed=8.0, max_mph=12.0, avg_mph=11.0)
        CardioDailyLog.objects.create(datetime_started=now - timedelta(days=5), workout=self.x200_workout, goal=10.0, total_completed=10.0, max_mph=11.3, avg_mph=10.6)
        CardioDailyLog.objects.create(datetime_started=now - timedelta(hours=6), workout=self.x200_workout, goal=10.0, total_completed=10.0, max_mph=10.9, avg_mph=10.3)

    def test_metrics_endpoint_returns_fast_and_sprint_riegel_snapshots(self):
        response = self.client.get("/api/metrics/cardio/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertAlmostEqual(payload["conversions"]["ten_k_miles"], 6.21371192, places=8)
        self.assertAlmostEqual(payload["fast"]["source_distance_miles"], 3.0, places=6)
        self.assertAlmostEqual(payload["fast"]["next_progression"], 6.0, places=6)
        self.assertAlmostEqual(payload["fast"]["next_progression_miles"], 6.0, places=6)
        self.assertAlmostEqual(payload["tempo"]["goal_distance"], 5.0, places=6)
        self.assertAlmostEqual(payload["tempo"]["next_progression"], 45.0, places=6)
        self.assertEqual(payload["tempo"]["progression_unit"], "minutes")
        self.assertAlmostEqual(payload["min_run"]["goal_distance"], 30.0, places=6)
        self.assertAlmostEqual(payload["min_run"]["next_progression"], 90.0, places=6)
        self.assertEqual(payload["min_run"]["progression_unit"], "minutes")

        fast_by_key = {item["key"]: item for item in payload["fast"]["periods"]}
        self.assertEqual(
            [item["key"] for item in payload["fast"]["periods"]],
            ["last_6_months", "last_8_weeks", "last_time", "taper"],
        )
        self.assertAlmostEqual(fast_by_key["last_6_months"]["max_mph"], 6.5, places=6)
        self.assertAlmostEqual(fast_by_key["last_6_months"]["avg_mph"], 6.2, places=6)
        self.assertAlmostEqual(fast_by_key["last_8_weeks"]["max_mph"], 6.5, places=6)
        self.assertAlmostEqual(fast_by_key["last_8_weeks"]["avg_mph"], 6.2, places=6)
        self.assertAlmostEqual(fast_by_key["last_time"]["max_mph"], 6.0, places=6)
        self.assertAlmostEqual(fast_by_key["last_time"]["avg_mph"], 5.8, places=6)
        self.assertAlmostEqual(fast_by_key["taper"]["max_mph"], 5.8333333333, places=6)
        self.assertAlmostEqual(fast_by_key["taper"]["avg_mph"], 5.6666666667, places=6)
        self.assertIsNone(fast_by_key["taper"]["max_activity_date"])
        self.assertIsNone(fast_by_key["taper"]["avg_activity_date"])

        d1_fast = 3.0
        d2_ten_k = 6.21371192
        t1_fast = d1_fast / 6.5
        expected_fast_10k = d2_ten_k / (t1_fast * ((d2_ten_k / d1_fast) ** 1.06))
        self.assertAlmostEqual(
            fast_by_key["last_6_months"]["riegel"]["predicted_mph"],
            expected_fast_10k,
            places=6,
        )
        self.assertAlmostEqual(
            fast_by_key["last_6_months"]["riegel"]["easy_low_mph"],
            expected_fast_10k * 0.70,
            places=6,
        )
        self.assertAlmostEqual(
            fast_by_key["last_6_months"]["riegel"]["easy_high_mph"],
            expected_fast_10k * 0.85,
            places=6,
        )

        tempo_by_key = {item["key"]: item for item in payload["tempo"]["periods"]}
        self.assertAlmostEqual(tempo_by_key["last_6_months"]["avg_mph"], 5.9, places=6)
        self.assertAlmostEqual(tempo_by_key["last_8_weeks"]["avg_mph"], 5.9, places=6)
        self.assertAlmostEqual(tempo_by_key["last_time"]["avg_mph"], 5.7, places=6)
        self.assertAlmostEqual(tempo_by_key["taper"]["avg_mph"], 5.6333333333, places=6)
        self.assertIsNone(tempo_by_key["last_6_months"]["riegel"]["predicted_mph"])

        min_run_by_key = {item["key"]: item for item in payload["min_run"]["periods"]}
        self.assertAlmostEqual(min_run_by_key["last_6_months"]["avg_mph"], 5.2, places=6)
        self.assertAlmostEqual(min_run_by_key["last_8_weeks"]["avg_mph"], 5.2, places=6)
        self.assertAlmostEqual(min_run_by_key["last_time"]["avg_mph"], 5.0, places=6)
        self.assertAlmostEqual(min_run_by_key["taper"]["avg_mph"], 4.9333333333, places=6)

        sprint_workouts = {item["workout_name"]: item for item in payload["sprints"]["workouts"]}
        self.assertIn("x800", sprint_workouts)
        self.assertIn("x400", sprint_workouts)
        self.assertIn("x200", sprint_workouts)
        self.assertAlmostEqual(sprint_workouts["x800"]["next_progression"], 5.0, places=6)
        self.assertEqual(sprint_workouts["x800"]["progression_unit"], "intervals")
        self.assertAlmostEqual(sprint_workouts["x400"]["next_progression"], 8.0, places=6)
        self.assertEqual(sprint_workouts["x400"]["progression_unit"], "intervals")
        self.assertAlmostEqual(sprint_workouts["x200"]["next_progression"], 10.0, places=6)
        self.assertEqual(sprint_workouts["x200"]["progression_unit"], "intervals")

        x800_by_key = {item["key"]: item for item in sprint_workouts["x800"]["periods"]}
        self.assertAlmostEqual(x800_by_key["last_6_months"]["avg_mph"], 8.9, places=6)
        self.assertAlmostEqual(x800_by_key["last_8_weeks"]["avg_mph"], 8.9, places=6)
        self.assertAlmostEqual(x800_by_key["last_time"]["avg_mph"], 8.5, places=6)
        self.assertAlmostEqual(x800_by_key["taper"]["max_mph"], 8.8333333333, places=6)
        self.assertAlmostEqual(x800_by_key["taper"]["avg_mph"], 8.3666666667, places=6)

        x400_by_key = {item["key"]: item for item in sprint_workouts["x400"]["periods"]}
        self.assertAlmostEqual(x400_by_key["last_6_months"]["max_mph"], 10.6, places=6)
        self.assertAlmostEqual(x400_by_key["last_6_months"]["avg_mph"], 9.9, places=6)
        self.assertAlmostEqual(x400_by_key["last_8_weeks"]["max_mph"], 10.6, places=6)
        self.assertAlmostEqual(x400_by_key["last_8_weeks"]["avg_mph"], 9.9, places=6)
        self.assertAlmostEqual(x400_by_key["last_time"]["max_mph"], 10.2, places=6)
        self.assertAlmostEqual(x400_by_key["last_time"]["avg_mph"], 9.7, places=6)
        self.assertAlmostEqual(x400_by_key["taper"]["max_mph"], 10.0666666667, places=6)
        self.assertAlmostEqual(x400_by_key["taper"]["avg_mph"], 9.6333333333, places=6)

        d1_x800 = 0.5
        d2_x400 = 0.25
        t1_x800 = d1_x800 / 9.5
        expected_x400 = d2_x400 / (t1_x800 * ((d2_x400 / d1_x800) ** 1.06))
        self.assertAlmostEqual(
            x400_by_key["last_6_months"]["riegel"]["predicted_mph"],
            expected_x400,
            places=6,
        )
        self.assertAlmostEqual(
            x400_by_key["last_6_months"]["max_or_predicted_mph"],
            max(10.6, expected_x400),
            places=6,
        )
        self.assertAlmostEqual(
            x400_by_key["taper"]["max_or_predicted_mph"],
            max(
                x400_by_key["taper"]["max_mph"],
                x400_by_key["taper"]["riegel"]["predicted_mph"],
            ),
            places=6,
        )

        x200_by_key = {item["key"]: item for item in sprint_workouts["x200"]["periods"]}
        self.assertAlmostEqual(x200_by_key["last_time"]["max_mph"], 10.9, places=6)
        self.assertAlmostEqual(x200_by_key["last_time"]["avg_mph"], 10.3, places=6)
        self.assertAlmostEqual(x200_by_key["taper"]["max_mph"], 10.7666666667, places=6)
        self.assertAlmostEqual(x200_by_key["taper"]["avg_mph"], 10.2, places=6)
        d2_x200 = 0.125
        t1_x800_last = d1_x800 / 9.0
        expected_x200_last = d2_x200 / (t1_x800_last * ((d2_x200 / d1_x800) ** 1.06))
        self.assertAlmostEqual(
            x200_by_key["last_time"]["riegel"]["predicted_mph"],
            expected_x200_last,
            places=6,
        )
        self.assertAlmostEqual(
            x200_by_key["last_time"]["max_or_predicted_mph"],
            max(10.9, expected_x200_last),
            places=6,
        )
        self.assertAlmostEqual(
            x200_by_key["taper"]["max_or_predicted_mph"],
            max(
                x200_by_key["taper"]["max_mph"],
                x200_by_key["taper"]["riegel"]["predicted_mph"],
            ),
            places=6,
        )

    def test_fast_and_x800_use_avg_from_max_day_when_below_threshold(self):
        now = timezone.now()
        CardioDailyLog.objects.create(
            datetime_started=now - timedelta(days=4),
            workout=self.fast_workout,
            goal=6.0,
            total_completed=6.0,
            max_mph=5.5,
            avg_mph=9.9,
        )
        CardioDailyLog.objects.create(
            datetime_started=now - timedelta(days=4),
            workout=self.x800_workout,
            goal=5.0,
            total_completed=5.0,
            max_mph=8.2,
            avg_mph=10.7,
        )

        response = self.client.get("/api/metrics/cardio/")
        self.assertEqual(response.status_code, 200)
        payload = response.json()

        fast_by_key = {item["key"]: item for item in payload["fast"]["periods"]}
        self.assertAlmostEqual(fast_by_key["last_8_weeks"]["max_mph"], 6.5, places=6)
        self.assertAlmostEqual(fast_by_key["last_8_weeks"]["avg_mph"], 6.2, places=6)
        self.assertTrue(fast_by_key["last_8_weeks"]["avg_locked_to_max_day"])
        self.assertEqual(
            fast_by_key["last_8_weeks"]["max_activity_date"],
            fast_by_key["last_8_weeks"]["avg_activity_date"],
        )

        sprint_workouts = {item["workout_name"]: item for item in payload["sprints"]["workouts"]}
        x800_by_key = {item["key"]: item for item in sprint_workouts["x800"]["periods"]}
        self.assertAlmostEqual(x800_by_key["last_8_weeks"]["max_mph"], 9.5, places=6)
        self.assertAlmostEqual(x800_by_key["last_8_weeks"]["avg_mph"], 8.9, places=6)
        self.assertTrue(x800_by_key["last_8_weeks"]["avg_locked_to_max_day"])
        self.assertEqual(
            x800_by_key["last_8_weeks"]["max_activity_date"],
            x800_by_key["last_8_weeks"]["avg_activity_date"],
        )

    def test_metrics_exclude_incomplete_logs_even_if_current_progression_matches(self):
        now = timezone.now()
        CardioDailyLog.objects.create(
            datetime_started=now - timedelta(hours=4),
            workout=self.fast_workout,
            goal=6.0,
            total_completed=5.0,
            max_mph=12.2,
            avg_mph=11.4,
            ignore=False,
        )
        CardioDailyLog.objects.create(
            datetime_started=now - timedelta(hours=3),
            workout=self.fast_workout,
            goal=6.0,
            total_completed=6.0,
            max_mph=12.5,
            avg_mph=11.8,
            ignore=True,
        )

        response = self.client.get("/api/metrics/cardio/")
        self.assertEqual(response.status_code, 200)
        payload = response.json()

        fast_by_key = {item["key"]: item for item in payload["fast"]["periods"]}
        self.assertAlmostEqual(fast_by_key["last_8_weeks"]["max_mph"], 6.5, places=6)
        self.assertAlmostEqual(fast_by_key["last_8_weeks"]["avg_mph"], 6.2, places=6)
        self.assertAlmostEqual(fast_by_key["last_time"]["max_mph"], 6.0, places=6)
        self.assertAlmostEqual(fast_by_key["last_time"]["avg_mph"], 5.8, places=6)

    def test_metrics_include_current_progression_logs_after_exact_sprint_recompute(self):
        sync_interval_units_from_settings(get_distance_conversion_settings())
        self.x400_workout.unit.refresh_from_db()
        interval_miles = float(self.x400_workout.unit.mile_equiv_numerator) / float(self.x400_workout.unit.mile_equiv_denominator)
        sprint_exercise = CardioExercise.objects.create(
            name="x400 Metrics Exact",
            unit=self.x400_workout.unit,
            three_mile_equivalent=3.0,
        )
        sprint_log = CardioDailyLog.objects.create(
            datetime_started=timezone.now() - timedelta(hours=2),
            workout=self.x400_workout,
            goal=8.0,
            max_mph=11.0,
        )

        reps = [
            (1, 21.343, 11.0),
            (1, 22.074, 10.6),
            (1, 22.849, 10.8),
            (1, 23.624, 10.7),
            (1, 24.413, 10.6),
            (1, 25.217, 10.5),
            (1, 26.042, 10.3),
            (1, 28.592, 10.1),
        ]
        for index, (minutes, seconds, mph) in enumerate(reps):
            CardioDailyLogDetail.objects.create(
                log=sprint_log,
                datetime=sprint_log.datetime_started + timedelta(minutes=index),
                exercise=sprint_exercise,
                running_minutes=minutes,
                running_seconds=seconds,
                running_miles=interval_miles,
                running_mph=mph,
            )

        sprint_log.refresh_from_db()
        self.assertEqual(sprint_log.total_completed, 8.0)

        response = self.client.get("/api/metrics/cardio/")
        self.assertEqual(response.status_code, 200)
        payload = response.json()

        sprint_workouts = {item["workout_name"]: item for item in payload["sprints"]["workouts"]}
        x400_by_key = {item["key"]: item for item in sprint_workouts["x400"]["periods"]}
        self.assertAlmostEqual(x400_by_key["last_6_months"]["max_mph"], 11.0, places=6)
        self.assertAlmostEqual(x400_by_key["last_8_weeks"]["max_mph"], 11.0, places=6)
        self.assertAlmostEqual(x400_by_key["last_time"]["max_mph"], 11.0, places=6)
        self.assertEqual(x400_by_key["last_time"]["max_log_id"], sprint_log.id)

    def test_metrics_patch_persists_selected_period_key(self):
        response = self.client.patch(
            "/api/metrics/cardio/",
            {"workout_name": "x400", "period_key": "taper"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            CardioMetricPeriodSelection.objects.get(workout=self.x400_workout).period_key,
            "taper",
        )

        refreshed = self.client.get("/api/metrics/cardio/")
        self.assertEqual(refreshed.status_code, 200)
        payload = refreshed.json()
        sprint_workouts = {item["workout_name"]: item for item in payload["sprints"]["workouts"]}
        self.assertEqual(sprint_workouts["x400"]["selected_period_key"], "taper")

    def test_next_cardio_view_returns_selected_metric_plan(self):
        CardioMetricPeriodSelection.objects.create(workout=self.x800_workout, period_key="taper")

        response = self.client.get("/api/cardio/next/?routine_name=Sprints&include_skipped=true")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["next_workout"]["name"], "x800")
        self.assertEqual(payload["selected_metric_plan"]["period_key"], "taper")
        self.assertAlmostEqual(payload["selected_metric_plan"]["mph_goal"], 8.9, places=6)
        self.assertAlmostEqual(payload["selected_metric_plan"]["mph_goal_avg"], 8.4, places=6)
        plan_by_workout_id = {item["workout_id"]: item for item in payload["workout_metric_plans"]}
        self.assertEqual(plan_by_workout_id[self.x800_workout.id]["period_key"], "taper")

    def test_min_run_selected_metric_plan_easy_target_exceeds_raw_avg_by_point_one(self):
        CardioMetricPeriodSelection.objects.create(workout=self.min_run_workout, period_key="last_6_months")

        snapshot = get_cardio_metrics_snapshot()
        plan = get_selected_cardio_metric_plan(workout=self.min_run_workout, snapshot=snapshot)

        self.assertIsNotNone(plan)
        self.assertEqual(plan["period_key"], "last_6_months")
        self.assertGreaterEqual(plan["mph_goal"], 5.3)


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
        self.exercise = CardioExercise.objects.create(name="Run", unit=unit, three_mile_equivalent=3.0)
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


class CardioAggregateAvgMphTests(TestCase):
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
        routine = CardioRoutine.objects.create(name="R Avg")
        workout = CardioWorkout.objects.create(
            name="W Avg",
            routine=routine,
            unit=unit,
            priority_order=1,
            skip=False,
            difficulty=1,
        )
        self.exercise = CardioExercise.objects.create(
            name="Run Avg",
            unit=unit,
            three_mile_equivalent=3.0,
        )
        self.log = CardioDailyLog.objects.create(
            datetime_started=timezone.now(),
            workout=workout,
        )

    def test_avg_mph_uses_total_distance_over_total_time(self):
        CardioDailyLogDetail.objects.create(
            log=self.log,
            datetime=timezone.now(),
            exercise=self.exercise,
            running_minutes=25,
            running_seconds=40,
            running_miles=2.0,
        )
        CardioDailyLogDetail.objects.create(
            log=self.log,
            datetime=timezone.now() + timedelta(minutes=1),
            exercise=self.exercise,
            running_minutes=22,
            running_seconds=36,
            running_miles=3.0,
        )

        self.log.refresh_from_db()
        expected_avg = round(5.0 / ((48 + (16 / 60.0)) / 60.0), 3)
        self.assertAlmostEqual(self.log.avg_mph, expected_avg, places=3)
        self.assertAlmostEqual(self.log.avg_mph, 6.215, places=3)
        self.assertAlmostEqual(self.log.total_completed, 5.0, places=6)

    def test_avg_mph_handles_sprints_without_running_miles(self):
        first = CardioDailyLogDetail.objects.create(
            log=self.log,
            datetime=timezone.now(),
            exercise=self.exercise,
            running_minutes=1,
            running_seconds=0,
            running_miles=None,
            running_mph=10.0,
        )
        second = CardioDailyLogDetail.objects.create(
            log=self.log,
            datetime=timezone.now() + timedelta(minutes=1),
            exercise=self.exercise,
            running_minutes=2,
            running_seconds=30,
            running_miles=None,
            running_mph=8.0,
        )

        self.log.refresh_from_db()
        first.refresh_from_db()
        second.refresh_from_db()

        # Derived miles: 10 mph * 1/60 h = 0.1667, 8 mph * 2.5/60 h = 0.3333
        # Total miles = 0.5 over 3.5 minutes -> 8.571 mph.
        self.assertAlmostEqual(self.log.avg_mph, 8.571, places=3)
        self.assertAlmostEqual(self.log.total_completed, 0.5, places=6)
        self.assertAlmostEqual(first.running_mph, 10.0, places=3)
        self.assertAlmostEqual(second.running_mph, 8.0, places=3)

    def test_sprint_equal_distance_uses_interval_mph_average(self):
        dist_unit = CardioUnit.objects.create(
            name="200m Avg",
            unit_type=UnitType.objects.get(name="Distance"),
            mround_numerator=1,
            mround_denominator=1,
            speed_name=SpeedName.objects.get(name="mph"),
            mile_equiv_numerator=200,
            mile_equiv_denominator=1609.344,
        )
        sprint_routine = CardioRoutine.objects.create(name="Sprints Avg")
        sprint_workout = CardioWorkout.objects.create(
            name="x200",
            routine=sprint_routine,
            unit=dist_unit,
            priority_order=1,
            skip=False,
            difficulty=1,
        )
        sprint_exercise = CardioExercise.objects.create(
            name="Run Sprint Avg",
            unit=dist_unit,
            three_mile_equivalent=3.0,
        )
        sprint_log = CardioDailyLog.objects.create(
            datetime_started=timezone.now(),
            workout=sprint_workout,
        )

        rep_miles = 200.0 / 1609.344
        reps = [
            (0, 41.425, 10.8),
            (0, 41.425, 10.8),
            (0, 39.244, 11.4),
            (0, 40.672, 11.0),
        ]
        for minutes, seconds, mph in reps:
            CardioDailyLogDetail.objects.create(
                log=sprint_log,
                datetime=timezone.now(),
                exercise=sprint_exercise,
                running_minutes=minutes,
                running_seconds=seconds,
                running_miles=rep_miles,
                running_mph=mph,
            )

        sprint_log.refresh_from_db()
        self.assertAlmostEqual(sprint_log.avg_mph, 11.0, places=3)

    def test_sprint_with_mixed_distances_falls_back_to_total_formula(self):
        dist_unit = CardioUnit.objects.create(
            name="400m Avg",
            unit_type=UnitType.objects.get(name="Distance"),
            mround_numerator=1,
            mround_denominator=1,
            speed_name=SpeedName.objects.get(name="mph"),
            mile_equiv_numerator=400,
            mile_equiv_denominator=1609.344,
        )
        sprint_routine = CardioRoutine.objects.create(name="Sprints Mixed")
        sprint_workout = CardioWorkout.objects.create(
            name="x400",
            routine=sprint_routine,
            unit=dist_unit,
            priority_order=1,
            skip=False,
            difficulty=1,
        )
        sprint_exercise = CardioExercise.objects.create(
            name="Run Sprint Mixed",
            unit=dist_unit,
            three_mile_equivalent=3.0,
        )
        sprint_log = CardioDailyLog.objects.create(
            datetime_started=timezone.now(),
            workout=sprint_workout,
        )

        rep_200 = 200.0 / 1609.344
        rep_400 = 400.0 / 1609.344
        CardioDailyLogDetail.objects.create(
            log=sprint_log,
            datetime=timezone.now(),
            exercise=sprint_exercise,
            running_minutes=0,
            running_seconds=40,
            running_miles=rep_200,
            running_mph=11.2,
        )
        CardioDailyLogDetail.objects.create(
            log=sprint_log,
            datetime=timezone.now() + timedelta(minutes=1),
            exercise=sprint_exercise,
            running_minutes=1,
            running_seconds=40,
            running_miles=rep_400,
            running_mph=8.9,
        )

        sprint_log.refresh_from_db()
        total_miles = rep_200 + rep_400
        total_minutes = (40.0 / 60.0) + (100.0 / 60.0)
        expected = round(total_miles / (total_minutes / 60.0), 3)
        self.assertAlmostEqual(sprint_log.avg_mph, expected, places=3)


class SprintDistanceConversionRuleRegressionTests(TestCase):
    def setUp(self):
        distance_type = UnitType.objects.create(name="Distance")
        speed_name = SpeedName.objects.create(name="mph", speed_type="distance/time")
        self.units = {
            "x800": CardioUnit.objects.create(
                name="800m Intervals",
                unit_type=distance_type,
                mround_numerator=1,
                mround_denominator=1,
                speed_name=speed_name,
                mile_equiv_numerator=800,
                mile_equiv_denominator=1609.344,
            ),
            "x400": CardioUnit.objects.create(
                name="400m Intervals",
                unit_type=distance_type,
                mround_numerator=1,
                mround_denominator=1,
                speed_name=speed_name,
                mile_equiv_numerator=400,
                mile_equiv_denominator=1609.344,
            ),
            "x200": CardioUnit.objects.create(
                name="200m Intervals",
                unit_type=distance_type,
                mround_numerator=1,
                mround_denominator=1,
                speed_name=speed_name,
                mile_equiv_numerator=200,
                mile_equiv_denominator=1609.344,
            ),
        }
        self.routine = CardioRoutine.objects.create(name="Sprints")
        self.exercises = {
            workout_name: CardioExercise.objects.create(
                name=f"{workout_name} Exercise",
                unit=unit,
                three_mile_equivalent=3.0,
            )
            for workout_name, unit in self.units.items()
        }
        sync_interval_units_from_settings(get_distance_conversion_settings())

    def _assert_exact_total_completed(self, workout_name: str, rep_count: int, expected_miles: float) -> None:
        unit = self.units[workout_name]
        unit.refresh_from_db()
        self.assertEqual(float(unit.mile_equiv_numerator), expected_miles)
        self.assertEqual(float(unit.mile_equiv_denominator), 1.0)

        workout = CardioWorkout.objects.create(
            name=workout_name,
            routine=self.routine,
            unit=unit,
            priority_order=1,
            skip=False,
            difficulty=1,
        )
        log = CardioDailyLog.objects.create(
            datetime_started=timezone.now(),
            workout=workout,
        )
        for index in range(rep_count):
            CardioDailyLogDetail.objects.create(
                log=log,
                datetime=timezone.now() + timedelta(minutes=index),
                exercise=self.exercises[workout_name],
                running_minutes=1,
                running_seconds=0,
                running_miles=expected_miles,
                running_mph=10.0,
            )

        log.refresh_from_db()
        self.assertEqual(log.total_completed, float(rep_count))

    def test_synced_x800_distance_rules_keep_total_completed_exact(self):
        self._assert_exact_total_completed("x800", rep_count=5, expected_miles=0.5)

    def test_synced_x400_distance_rules_keep_total_completed_exact(self):
        self._assert_exact_total_completed("x400", rep_count=6, expected_miles=0.25)

    def test_synced_x200_distance_rules_keep_total_completed_exact(self):
        self._assert_exact_total_completed("x200", rep_count=10, expected_miles=0.125)


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
        self.exercise = CardioExercise.objects.create(name="Run", unit=unit, three_mile_equivalent=3.0)
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
        StrengthVolumeBucket.objects.all().delete()
        StrengthVolumeBucket.objects.create(
            min_max_reps=1,
            max_max_reps=1,
            training_set_reps=1,
            daily_volume_min=60,
            daily_volume_max=60,
            weekly_volume_min=120,
            weekly_volume_max=120,
        )
        self.r1 = StrengthRoutine.objects.create(name="R1", hundred_points_reps=100, hundred_points_weight=100)
        self.r2 = StrengthRoutine.objects.create(name="R2", hundred_points_reps=100, hundred_points_weight=100)
        StrengthDailyLog.objects.create(
            datetime_started=timezone.now(),
            routine=self.r1,
            rep_goal=50,
            total_reps_completed=50,
        )
        self.client = APIClient()

    def test_returns_least_recent_routine(self):
        resp = self.client.get("/api/strength/next/")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["next_routine"]["name"], "R2")
        self.assertEqual(data["routine_list"][-1]["name"], "R2")
        self.assertEqual(data["next_goal"]["daily_volume"], 60)


class StrengthBucketGoalTests(TestCase):
    def setUp(self):
        StrengthVolumeBucket.objects.all().delete()
        StrengthVolumeBucket.objects.bulk_create(
            [
                StrengthVolumeBucket(
                    min_max_reps=17,
                    max_max_reps=20,
                    training_set_reps=5,
                    daily_volume_min=75,
                    daily_volume_max=120,
                    weekly_volume_min=225,
                    weekly_volume_max=360,
                ),
                StrengthVolumeBucket(
                    min_max_reps=21,
                    max_max_reps=24,
                    training_set_reps=6,
                    daily_volume_min=100,
                    daily_volume_max=175,
                    weekly_volume_min=300,
                    weekly_volume_max=525,
                ),
            ]
        )
        self.routine = StrengthRoutine.objects.create(
            name="Strength Bucket",
            hundred_points_reps=23,
            hundred_points_weight=186,
        )
        self.exercise = StrengthExercise.objects.create(
            name="Pull Ups Strength Bucket",
            routine=self.routine,
            bodyweight_percentage=100,
        )

    def _create_log(self, days_ago, max_set, total_reps):
        started = timezone.now() - timedelta(days=days_ago)
        log = StrengthDailyLog.objects.create(
            datetime_started=started,
            activity_date=started.date(),
            routine=self.routine,
            rep_goal=total_reps,
            total_reps_completed=total_reps,
        )

        remaining = int(total_reps)
        idx = 0
        while remaining > 0:
            reps = min(int(max_set), remaining)
            StrengthDailyLogDetail.objects.create(
                log=log,
                datetime=started + timedelta(minutes=idx),
                exercise=self.exercise,
                reps=reps,
                weight=186.0,
            )
            remaining -= reps
            idx += 1
        return log

    def test_volume_advances_after_three_successful_sessions_in_bucket(self):
        self._create_log(days_ago=5, max_set=20, total_reps=120)
        self._create_log(days_ago=4, max_set=20, total_reps=75)
        self._create_log(days_ago=3, max_set=19, total_reps=75)
        self._create_log(days_ago=2, max_set=18, total_reps=75)

        goal = get_next_strength_goal(self.routine.id, print_debug=False)

        self.assertIsNotNone(goal)
        self.assertEqual(goal["bucket_label"], "17-20")
        self.assertEqual(goal["daily_volume"], 90.0)
        self.assertEqual(goal["successful_sessions_at_current_volume"], 0)
        self.assertEqual(goal["next_max_reps_goal"], 21.0)

    def test_breaking_into_next_bucket_resets_to_next_floor(self):
        self._create_log(days_ago=5, max_set=20, total_reps=120)
        self._create_log(days_ago=4, max_set=20, total_reps=75)
        self._create_log(days_ago=3, max_set=19, total_reps=75)
        self._create_log(days_ago=2, max_set=18, total_reps=75)
        self._create_log(days_ago=1, max_set=21, total_reps=175)

        goal = get_next_strength_goal(self.routine.id, print_debug=False)

        self.assertIsNotNone(goal)
        self.assertEqual(goal["bucket_label"], "21-24")
        self.assertEqual(goal["daily_volume"], 100.0)
        self.assertEqual(goal["successful_sessions_at_current_volume"], 0)
        self.assertEqual(goal["next_max_reps_goal"], 22.0)


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
    def test_max_reps_goal_uses_pull_up_bucket_not_unrelated_strength_peak(self):
        StrengthVolumeBucket.objects.all().delete()
        StrengthVolumeBucket.objects.bulk_create(
            [
                StrengthVolumeBucket(
                    min_max_reps=17,
                    max_max_reps=20,
                    training_set_reps=5,
                    daily_volume_min=75,
                    daily_volume_max=120,
                    weekly_volume_min=225,
                    weekly_volume_max=360,
                ),
                StrengthVolumeBucket(
                    min_max_reps=21,
                    max_max_reps=24,
                    training_set_reps=6,
                    daily_volume_min=100,
                    daily_volume_max=175,
                    weekly_volume_min=300,
                    weekly_volume_max=525,
                ),
            ]
        )

        routine = StrengthRoutine.objects.create(
            name="RLatest", hundred_points_reps=100, hundred_points_weight=128
        )
        pull_ups = StrengthExercise.objects.create(
            name="Pull Ups Bucket",
            routine=routine,
            bodyweight_percentage=100,
        )
        ammo = StrengthExercise.objects.create(
            name="Ammo Can Lift Bucket",
            routine=routine,
            bodyweight_percentage=0,
        )

        unrelated_log = StrengthDailyLog.objects.create(
            datetime_started=timezone.now() - timedelta(days=2),
            routine=routine,
            max_weight_goal=90.0,
            max_weight=90.0,
        )
        StrengthDailyLogDetail.objects.create(
            log=unrelated_log,
            datetime=unrelated_log.datetime_started,
            exercise=ammo,
            reps=105,
            weight=35.0,
        )

        pull_log = StrengthDailyLog.objects.create(
            datetime_started=timezone.now() - timedelta(days=1),
            routine=routine,
            max_weight_goal=128.0,
            max_weight=128.0,
        )
        StrengthDailyLogDetail.objects.create(
            log=pull_log,
            datetime=pull_log.datetime_started,
            exercise=pull_ups,
            reps=20,
            weight=128.0,
        )

        reps_goal = get_max_reps_goal_for_routine(routine.id, 110)
        weight_goal = get_max_weight_goal_for_routine(routine.id, 110)

        self.assertEqual(reps_goal, 21.0)
        self.assertAlmostEqual(weight_goal, 128.0)



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
        self.other_workout = CardioWorkout.objects.create(
            name="Workout Best Log 2",
            routine=routine,
            unit=unit,
            priority_order=2,
            skip=False,
            difficulty=1,
        )

    def _create_log(
        self,
        *,
        days_ago,
        max_mph,
        avg_mph=None,
        goal=3.0,
        total_completed=3.0,
        ignore=False,
        workout=None,
    ):
        if avg_mph is None:
            avg_mph = max_mph
        return CardioDailyLog.objects.create(
            datetime_started=timezone.now() - timedelta(days=days_ago),
            workout=workout or self.workout,
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

    def test_selects_most_recent_best_log_across_all_workouts(self):
        self._create_log(days_ago=5, max_mph=8.8, workout=self.workout)
        other_best = self._create_log(days_ago=1, max_mph=7.4, workout=self.other_workout)

        resp = self.client.get(
            "/api/cardio/best-completed-log/",
            {"workout_id": self.workout.id},
        )

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["id"], other_best.id)
        self.assertEqual(resp.data["workout"]["id"], self.other_workout.id)

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
        self.other_workout = CardioWorkout.objects.create(
            name="Workout Best Avg Log 2",
            routine=routine,
            unit=unit,
            priority_order=2,
            skip=False,
            difficulty=1,
        )

    def _create_log(
        self,
        *,
        days_ago,
        max_mph,
        avg_mph,
        goal=3.0,
        total_completed=3.0,
        ignore=False,
        workout=None,
    ):
        return CardioDailyLog.objects.create(
            datetime_started=timezone.now() - timedelta(days=days_ago),
            workout=workout or self.workout,
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

    def test_selects_most_recent_best_avg_log_across_all_workouts(self):
        self._create_log(days_ago=4, max_mph=8.0, avg_mph=7.7, workout=self.workout)
        other_best = self._create_log(days_ago=1, max_mph=7.9, avg_mph=7.2, workout=self.other_workout)

        resp = self.client.get(
            "/api/cardio/best-completed-avg-log/",
            {"workout_id": self.workout.id},
        )

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["id"], other_best.id)
        self.assertEqual(resp.data["workout"]["id"], self.other_workout.id)

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
    def test_goal_targets_include_total_goal_sum_of_three_sets(self):
        routine = SupplementalRoutine.objects.create(
            name="Total Goal Check",
            unit="Reps",
            step_value=2,
            max_set=60,
            step_weight=5,
        )

        plan = get_supplemental_goal_targets(routine.id)
        set_units = []
        for item in plan.get("sets", []):
            try:
                val = float(item.get("goal_unit"))
            except (TypeError, ValueError):
                continue
            if val > 0:
                set_units.append(val)

        self.assertEqual(plan.get("base_set_count"), 3)
        self.assertAlmostEqual(plan.get("total_goal"), sum(set_units), places=6)

    def test_time_goal_targets_spill_overflow_instead_of_using_weight(self):
        routine = SupplementalRoutine.objects.create(
            name="Plank",
            unit="Time",
            step_value=5,
            max_set=225,
            step_weight=10,
            rest_yellow_start_seconds=60,
            rest_red_start_seconds=90,
        )
        log = SupplementalDailyLog.objects.create(datetime_started=timezone.now(), routine=routine)
        now = timezone.now()
        SupplementalDailyLogDetail.objects.create(
            log=log,
            datetime=now - timedelta(seconds=90),
            unit_count=233,
            set_number=1,
        )
        SupplementalDailyLogDetail.objects.create(
            log=log,
            datetime=now - timedelta(seconds=60),
            unit_count=129,
            weight=5,
            set_number=2,
        )
        SupplementalDailyLogDetail.objects.create(
            log=log,
            datetime=now - timedelta(seconds=30),
            unit_count=135,
            set_number=3,
        )

        plan = get_supplemental_goal_targets(routine.id)
        sets = {item["set_number"]: item for item in plan.get("sets", [])}

        self.assertEqual(sets[1]["goal_unit"], 225)
        self.assertFalse(sets[1]["using_weight"])
        self.assertIsNone(sets[1]["goal_weight"])
        self.assertEqual(sets[2]["goal_unit"], 147)
        self.assertIsNone(sets[2]["goal_weight"])
        self.assertFalse(sets[2]["using_weight"])
        self.assertEqual(sets[3]["goal_unit"], 140)
        self.assertIsNone(sets[3]["goal_weight"])
        self.assertFalse(sets[3]["using_weight"])
        self.assertAlmostEqual(plan["total_goal"], 512.0, places=6)
        self.assertEqual(plan["rest_yellow_start_seconds"], 60)
        self.assertEqual(plan["rest_red_start_seconds"], 90)

    def test_time_goal_targets_cap_all_three_sets_at_three_forty_five(self):
        routine = SupplementalRoutine.objects.create(
            name="Plank Capped",
            unit="Time",
            step_value=5,
            max_set=225,
            step_weight=10,
        )
        log = SupplementalDailyLog.objects.create(datetime_started=timezone.now(), routine=routine)
        now = timezone.now()
        SupplementalDailyLogDetail.objects.create(
            log=log,
            datetime=now - timedelta(seconds=90),
            unit_count=240,
            set_number=1,
        )
        SupplementalDailyLogDetail.objects.create(
            log=log,
            datetime=now - timedelta(seconds=60),
            unit_count=224,
            set_number=2,
        )
        SupplementalDailyLogDetail.objects.create(
            log=log,
            datetime=now - timedelta(seconds=30),
            unit_count=224,
            set_number=3,
        )

        plan = get_supplemental_goal_targets(routine.id)
        sets = {item["set_number"]: item for item in plan.get("sets", [])}

        self.assertEqual(sets[1]["goal_unit"], 225)
        self.assertEqual(sets[2]["goal_unit"], 225)
        self.assertEqual(sets[3]["goal_unit"], 225)
        self.assertAlmostEqual(plan["total_goal"], 675.0, places=6)

    def test_rep_goal_targets_still_use_weight_progression(self):
        routine = SupplementalRoutine.objects.create(
            name="Weighted Reps",
            unit="Reps",
            step_value=2,
            max_set=60,
            step_weight=10,
        )
        log = SupplementalDailyLog.objects.create(datetime_started=timezone.now(), routine=routine)
        now = timezone.now()
        SupplementalDailyLogDetail.objects.create(
            log=log,
            datetime=now - timedelta(seconds=30),
            unit_count=60,
            weight=5,
            set_number=2,
        )

        plan = get_supplemental_goal_targets(routine.id)
        sets = {item["set_number"]: item for item in plan.get("sets", [])}

        self.assertEqual(sets[2]["goal_unit"], 60)
        self.assertEqual(sets[2]["goal_weight"], 15)
        self.assertTrue(sets[2]["using_weight"])

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


class SupplementalSessionProgressApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.routine = SupplementalRoutine.objects.create(
            name="Progress API Routine",
            unit="Reps",
            step_value=5,
            max_set=60,
            step_weight=5,
            rest_yellow_start_seconds=60,
            rest_red_start_seconds=90,
        )
        self.log = SupplementalDailyLog.objects.create(
            datetime_started=timezone.now() - timedelta(minutes=10),
            routine=self.routine,
            goal_set_1=10,
            goal_set_2=10,
            goal_set_3=10,
        )

    def _add_set(self, set_number: int, units: float, log_id: int = None):
        target_log_id = log_id or self.log.id
        return self.client.post(
            f"/api/supplemental/log/{target_log_id}/details/",
            {
                "details": [
                    {
                        "datetime": timezone.now().isoformat(),
                        "unit_count": units,
                        "set_number": set_number,
                    }
                ]
            },
            format="json",
        )

    def test_total_progress_and_next_set_repeat_set_three_goal(self):
        resp_1 = self._add_set(1, 8)
        self.assertEqual(resp_1.status_code, 201)
        resp_2 = self._add_set(2, 7)
        self.assertEqual(resp_2.status_code, 201)
        resp_3 = self._add_set(3, 6)
        self.assertEqual(resp_3.status_code, 201)

        data = resp_3.data
        self.assertAlmostEqual(float(data.get("total_goal")), 30.0, places=6)
        self.assertAlmostEqual(float(data.get("total_completed")), 21.0, places=6)
        self.assertAlmostEqual(float(data.get("remaining")), 9.0, places=6)
        self.assertTrue(data.get("has_next_set"))
        self.assertEqual(data.get("next_set_number"), 4)
        self.assertEqual((data.get("next_set_target") or {}).get("set_number"), 4)
        self.assertAlmostEqual(float((data.get("next_set_target") or {}).get("goal_unit")), 10.0, places=6)

        resp_4 = self._add_set(4, 9)
        self.assertEqual(resp_4.status_code, 201)
        data_4 = resp_4.data
        self.assertAlmostEqual(float(data_4.get("total_completed")), 30.0, places=6)
        self.assertAlmostEqual(float(data_4.get("remaining")), 0.0, places=6)
        self.assertFalse(data_4.get("has_next_set"))
        self.assertIsNone(data_4.get("next_set_number"))

    def test_time_routine_set_four_plus_uses_remaining_when_below_two_twenty(self):
        time_routine = SupplementalRoutine.objects.create(
            name="Progress API Time Routine",
            unit="Time",
            step_value=5,
            max_set=600,
            step_weight=0,
            rest_yellow_start_seconds=60,
            rest_red_start_seconds=90,
        )
        time_log = SupplementalDailyLog.objects.create(
            datetime_started=timezone.now() - timedelta(minutes=10),
            routine=time_routine,
            goal_set_1=100,
            goal_set_2=100,
            goal_set_3=100,
        )

        resp_1 = self._add_set(1, 70, log_id=time_log.id)
        self.assertEqual(resp_1.status_code, 201)
        resp_2 = self._add_set(2, 60, log_id=time_log.id)
        self.assertEqual(resp_2.status_code, 201)
        resp_3 = self._add_set(3, 40, log_id=time_log.id)
        self.assertEqual(resp_3.status_code, 201)

        data = resp_3.data
        self.assertAlmostEqual(float(data.get("remaining")), 130.0, places=6)
        self.assertEqual(data.get("next_set_number"), 4)
        self.assertAlmostEqual(float((data.get("next_set_target") or {}).get("goal_unit")), 130.0, places=6)

        resp_4 = self._add_set(4, 80, log_id=time_log.id)
        self.assertEqual(resp_4.status_code, 201)
        data_4 = resp_4.data
        self.assertAlmostEqual(float(data_4.get("remaining")), 50.0, places=6)
        self.assertEqual(data_4.get("next_set_number"), 5)
        self.assertAlmostEqual(float((data_4.get("next_set_target") or {}).get("goal_unit")), 50.0, places=6)

    def test_time_routine_set_four_reuses_set_three_goal_when_remaining_above_two_twenty(self):
        time_routine = SupplementalRoutine.objects.create(
            name="Progress API Time Routine Large Remaining",
            unit="Time",
            step_value=5,
            max_set=600,
            step_weight=0,
            rest_yellow_start_seconds=60,
            rest_red_start_seconds=90,
        )
        time_log = SupplementalDailyLog.objects.create(
            datetime_started=timezone.now() - timedelta(minutes=10),
            routine=time_routine,
            goal_set_1=200,
            goal_set_2=200,
            goal_set_3=200,
        )

        self.assertEqual(self._add_set(1, 120, log_id=time_log.id).status_code, 201)
        self.assertEqual(self._add_set(2, 100, log_id=time_log.id).status_code, 201)
        resp_3 = self._add_set(3, 80, log_id=time_log.id)
        self.assertEqual(resp_3.status_code, 201)

        data = resp_3.data
        self.assertAlmostEqual(float(data.get("remaining")), 300.0, places=6)
        self.assertEqual(data.get("next_set_number"), 4)
        self.assertAlmostEqual(float((data.get("next_set_target") or {}).get("goal_unit")), 200.0, places=6)

    def test_time_routine_serializer_hides_legacy_weight_fields(self):
        time_routine = SupplementalRoutine.objects.create(
            name="Legacy Time Routine",
            unit="Time",
            step_value=5,
            max_set=225,
            step_weight=10,
        )
        now = timezone.now()
        prior_log = SupplementalDailyLog.objects.create(
            datetime_started=now - timedelta(days=1),
            routine=time_routine,
        )
        SupplementalDailyLogDetail.objects.create(
            log=prior_log,
            datetime=now - timedelta(days=1, minutes=3),
            unit_count=225,
            set_number=1,
        )
        SupplementalDailyLogDetail.objects.create(
            log=prior_log,
            datetime=now - timedelta(days=1, minutes=2),
            unit_count=120,
            weight=15,
            set_number=2,
        )
        SupplementalDailyLogDetail.objects.create(
            log=prior_log,
            datetime=now - timedelta(days=1, minutes=1),
            unit_count=110,
            weight=5,
            set_number=3,
        )

        legacy_log = SupplementalDailyLog.objects.create(
            datetime_started=now,
            routine=time_routine,
            goal_set_1=225,
            goal_set_2=147,
            goal_set_3=140,
            goal_weight_set_1=5,
            goal_weight_set_2=10,
            goal_weight_set_3=15,
        )
        SupplementalDailyLogDetail.objects.create(
            log=legacy_log,
            datetime=now,
            unit_count=200,
            set_number=1,
        )

        data = SupplementalDailyLogSerializer(legacy_log).data
        set_targets = {item["set_number"]: item for item in data["set_targets"]}
        next_set_target = data["next_set_target"] or {}

        self.assertIsNone(set_targets[1]["goal_weight"])
        self.assertFalse(set_targets[1]["using_weight"])
        self.assertIsNone(set_targets[2]["goal_weight"])
        self.assertFalse(set_targets[2]["using_weight"])
        self.assertIsNone(set_targets[2]["min_goal_weight"])
        self.assertIsNone(set_targets[3]["goal_weight"])
        self.assertFalse(set_targets[3]["using_weight"])
        self.assertIsNone(set_targets[3]["min_goal_weight"])
        self.assertIsNone(next_set_target.get("goal_weight"))
        self.assertFalse(next_set_target.get("using_weight"))
        self.assertIsNone(next_set_target.get("min_goal_weight"))

    def test_time_routine_create_serializer_formats_saved_goal_notes_as_clock(self):
        time_routine = SupplementalRoutine.objects.create(
            name="Clock Goal Time Routine",
            unit="Time",
            step_value=5,
            max_set=225,
            step_weight=10,
        )
        now = timezone.now()
        prior_log = SupplementalDailyLog.objects.create(
            datetime_started=now - timedelta(days=1),
            routine=time_routine,
        )
        SupplementalDailyLogDetail.objects.create(
            log=prior_log,
            datetime=now - timedelta(days=1, minutes=3),
            unit_count=220,
            set_number=1,
        )
        SupplementalDailyLogDetail.objects.create(
            log=prior_log,
            datetime=now - timedelta(days=1, minutes=2),
            unit_count=139,
            set_number=2,
        )
        SupplementalDailyLogDetail.objects.create(
            log=prior_log,
            datetime=now - timedelta(days=1, minutes=1),
            unit_count=133,
            set_number=3,
        )

        serializer = SupplementalDailyLogCreateSerializer(
            data={"datetime_started": now.isoformat(), "routine_id": time_routine.id}
        )

        self.assertTrue(serializer.is_valid(), serializer.errors)
        log = serializer.save()

        self.assertEqual(log.goal, "Set 1: 03:45; Set 2: 02:24; Set 3: 02:18")

    def test_patch_allows_set_numbers_greater_than_three(self):
        detail = SupplementalDailyLogDetail.objects.create(
            log=self.log,
            datetime=timezone.now(),
            unit_count=8,
            set_number=1,
        )
        resp = self.client.patch(
            f"/api/supplemental/log/{self.log.id}/details/{detail.id}/",
            {"set_number": 5},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        detail.refresh_from_db()
        self.assertEqual(detail.set_number, 5)


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


class StrengthGoalsSignalTests(TestCase):
    def setUp(self):
        self.routine = StrengthRoutine.objects.create(
            name="Goal Sync Strength",
            hundred_points_reps=100,
            hundred_points_weight=100,
        )

    def test_creates_goal_rows_and_updates_values(self):
        self.assertEqual(
            StrengthGoals.objects.filter(routine=self.routine).count(),
            len(StrengthGoals.GOAL_TYPES),
        )

        now = timezone.now()
        StrengthDailyLog.objects.create(
            datetime_started=now - timedelta(days=7),
            routine=self.routine,
            max_reps=20.0,
            total_reps_completed=80.0,
            minutes_elapsed=30.0,
        )
        StrengthDailyLog.objects.create(
            datetime_started=now - timedelta(days=1),
            routine=self.routine,
            max_reps=25.0,
            total_reps_completed=90.0,
            minutes_elapsed=25.0,
        )

        rows = list(StrengthGoals.objects.filter(routine=self.routine))
        by_type = {row.goal_type: row for row in rows}
        self.assertEqual(len(by_type), len(StrengthGoals.GOAL_TYPES))

        highest_max = by_type["highest_max_rph_6months"]
        highest_avg = by_type["highest_avg_rph_6months"]
        last_max = by_type["last_max_rph"]
        last_avg = by_type["last_avg_rph"]

        self.assertEqual(highest_max.max_avg_type, "max")
        self.assertEqual(highest_avg.max_avg_type, "avg")
        self.assertAlmostEqual(highest_max.rph_raw, 25.0, places=6)
        self.assertAlmostEqual(highest_avg.rph_raw, 216.0, places=6)
        self.assertAlmostEqual(last_max.rph_raw, 25.0, places=6)
        self.assertAlmostEqual(last_avg.rph_raw, 216.0, places=6)
        self.assertIsNotNone(highest_max.last_updated)
        self.assertIsNotNone(highest_avg.last_updated)

        rounded_values = [row.rph_rounded for row in rows if row.rph_rounded is not None]
        self.assertEqual(len(rounded_values), len(set(rounded_values)))
        self.assertTrue(
            all(
                (row.inter_rank is None) == (row.rph_raw is None or row.rph_rounded is None)
                for row in rows
            )
        )

    def test_goal_rows_update_after_log_delete(self):
        log = StrengthDailyLog.objects.create(
            datetime_started=timezone.now(),
            routine=self.routine,
            max_reps=10.0,
            total_reps_completed=40.0,
            minutes_elapsed=20.0,
        )

        before = StrengthGoals.objects.get(routine=self.routine, goal_type="last_max_rph")
        self.assertIsNotNone(before.rph_raw)

        log.delete()

        after = StrengthGoals.objects.get(routine=self.routine, goal_type="last_max_rph")
        self.assertIsNone(after.rph_raw)
        self.assertIsNone(after.rph_rounded)


class SupplementalGoalsSignalTests(TestCase):
    def setUp(self):
        self.routine = SupplementalRoutine.objects.create(
            name="Goal Sync Supplemental",
            unit="Reps",
            step_value=1.0,
            max_set=60.0,
            step_weight=5.0,
        )

    def test_creates_goal_rows_and_updates_values(self):
        self.assertEqual(
            SupplementalGoals.objects.filter(routine=self.routine).count(),
            len(SupplementalGoals.GOAL_TYPES),
        )

        now = timezone.now()
        log_1 = SupplementalDailyLog.objects.create(
            datetime_started=now - timedelta(days=5),
            routine=self.routine,
        )
        SupplementalDailyLogDetail.objects.create(
            log=log_1,
            datetime=now - timedelta(days=5, minutes=3),
            unit_count=9.0,
            set_number=1,
        )
        SupplementalDailyLogDetail.objects.create(
            log=log_1,
            datetime=now - timedelta(days=5, minutes=2),
            unit_count=10.0,
            set_number=2,
        )
        SupplementalDailyLogDetail.objects.create(
            log=log_1,
            datetime=now - timedelta(days=5, minutes=1),
            unit_count=11.0,
            set_number=3,
        )

        log_2 = SupplementalDailyLog.objects.create(
            datetime_started=now - timedelta(days=1),
            routine=self.routine,
        )
        SupplementalDailyLogDetail.objects.create(
            log=log_2,
            datetime=now - timedelta(days=1, minutes=3),
            unit_count=15.0,
            set_number=1,
        )
        SupplementalDailyLogDetail.objects.create(
            log=log_2,
            datetime=now - timedelta(days=1, minutes=2),
            unit_count=12.0,
            set_number=2,
        )
        SupplementalDailyLogDetail.objects.create(
            log=log_2,
            datetime=now - timedelta(days=1, minutes=1),
            unit_count=12.0,
            set_number=3,
        )

        rows = list(SupplementalGoals.objects.filter(routine=self.routine))
        by_type = {row.goal_type: row for row in rows}
        self.assertEqual(len(by_type), len(SupplementalGoals.GOAL_TYPES))

        highest_max = by_type["highest_max_unit_6months"]
        highest_avg = by_type["highest_avg_unit_6months"]
        last_max = by_type["last_max_unit"]
        last_avg = by_type["last_avg_unit"]

        self.assertEqual(highest_max.max_avg_type, "max")
        self.assertEqual(highest_avg.max_avg_type, "avg")
        self.assertAlmostEqual(highest_max.unit_raw, 15.0, places=6)
        self.assertAlmostEqual(highest_avg.unit_raw, 13.0, places=6)
        self.assertAlmostEqual(last_max.unit_raw, 15.0, places=6)
        self.assertAlmostEqual(last_avg.unit_raw, 13.0, places=6)
        self.assertIsNotNone(highest_max.last_updated)
        self.assertIsNotNone(highest_avg.last_updated)

        rounded_values = [row.unit_rounded for row in rows if row.unit_rounded is not None]
        self.assertEqual(len(rounded_values), len(set(rounded_values)))
        self.assertTrue(
            all(
                (row.inter_rank is None) == (row.unit_raw is None or row.unit_rounded is None)
                for row in rows
            )
        )

    def test_goal_rows_update_after_log_delete(self):
        log = SupplementalDailyLog.objects.create(
            datetime_started=timezone.now(),
            routine=self.routine,
        )
        SupplementalDailyLogDetail.objects.create(
            log=log,
            datetime=timezone.now(),
            unit_count=8.0,
            set_number=1,
        )

        before = SupplementalGoals.objects.get(routine=self.routine, goal_type="last_max_unit")
        self.assertIsNotNone(before.unit_raw)

        log.delete()

        after = SupplementalGoals.objects.get(routine=self.routine, goal_type="last_max_unit")
        self.assertIsNone(after.unit_raw)
        self.assertIsNone(after.unit_rounded)


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
        self.assertIsInstance(payload.get("r2"), (int, float))
        self.assertEqual(payload.get("r2"), payload.get("trendline_r2"))
        self.assertEqual(payload.get("highest_goal_type"), "highest_max_mph_6months")
        self.assertIsNotNone(payload.get("highest_goal_mph_raw"))
        pct = payload.get("highest_goal_inter_rank_percentage")
        self.assertIsNotNone(pct)
        self.assertGreaterEqual(float(pct), 1.0)
        self.assertLessEqual(float(pct), 100.0)
        indicators = payload.get("goal_type_indicators")
        self.assertIsInstance(indicators, list)
        self.assertGreaterEqual(len(indicators), 2)
        self.assertTrue(all(isinstance(item.get("goal_type"), str) and item.get("goal_type") for item in indicators))
        self.assertTrue(all(isinstance(item.get("display_name"), str) and item.get("display_name") for item in indicators))
        self.assertTrue(all(item.get("inter_rank_percentage") is not None for item in indicators))
        self.assertTrue(all(1.0 <= float(item.get("inter_rank_percentage")) <= 100.0 for item in indicators))

    def test_trendline_fit_endpoint_returns_avg_payload(self):
        resp = self.client.get(
            f"/api/cardio/goals/trendline-fit/?workout_id={self.target_workout.id}&max_avg_type=avg"
        )
        self.assertEqual(resp.status_code, 200)
        payload = resp.json()
        self.assertIn(payload.get("best_fit_type"), {"linear", "exponential", "logarithmic", "power"})
        self.assertTrue(payload.get("formula"))
        self.assertIsInstance(payload.get("model_params"), dict)
        self.assertIsInstance(payload.get("r2"), (int, float))
        self.assertEqual(payload.get("r2"), payload.get("trendline_r2"))
        self.assertEqual(payload.get("highest_goal_type"), "highest_avg_mph_6months")
        self.assertIsNotNone(payload.get("highest_goal_mph_raw"))
        pct = payload.get("highest_goal_inter_rank_percentage")
        self.assertIsNotNone(pct)
        self.assertGreaterEqual(float(pct), 1.0)
        self.assertLessEqual(float(pct), 100.0)
        indicators = payload.get("goal_type_indicators")
        self.assertIsInstance(indicators, list)
        self.assertGreaterEqual(len(indicators), 2)
        self.assertTrue(all(isinstance(item.get("goal_type"), str) and item.get("goal_type") for item in indicators))
        self.assertTrue(all(isinstance(item.get("display_name"), str) and item.get("display_name") for item in indicators))
        self.assertTrue(all(item.get("inter_rank_percentage") is not None for item in indicators))
        self.assertTrue(all(1.0 <= float(item.get("inter_rank_percentage")) <= 100.0 for item in indicators))
