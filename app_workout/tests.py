from django.test import TestCase
from unittest.mock import patch
from rest_framework.test import APIRequestFactory

from .views import CardioLogsRecentView


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
