from django.utils import timezone

from .timezones import get_request_calendar_zone


class UserTimezoneMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        zone = get_request_calendar_zone(request)
        request.user_timezone = zone
        timezone.activate(zone)
        try:
            return self.get_response(request)
        finally:
            timezone.deactivate()
