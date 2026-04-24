from django.db import migrations, models


DEFAULT_SCHEDULE_CODES_BY_DAY = {
    1: ["5k_prep"],
    2: ["sprints", "strength"],
    3: ["5k_prep"],
    4: ["strength"],
    5: ["5k_prep"],
    6: ["sprints"],
    7: ["strength"],
}


def seed_supplemental_recommendation_settings(apps, schema_editor):
    SupplementalRecommendationSettings = apps.get_model("app_workout", "SupplementalRecommendationSettings")
    SupplementalRecommendationSettings.objects.get_or_create(defaults={"per_week": 5})


def remove_supplemental_from_schedule_days(apps, schema_editor):
    RoutineScheduleDay = apps.get_model("app_workout", "RoutineScheduleDay")

    for day in RoutineScheduleDay.objects.order_by("day_number"):
        source_codes = list(day.routine_codes or [])
        next_codes = []
        seen = set()
        for raw_code in source_codes:
            code = str(raw_code or "").strip().lower()
            if code == "supplemental" or code in seen:
                continue
            next_codes.append(code)
            seen.add(code)

        if not next_codes:
            next_codes = list(DEFAULT_SCHEDULE_CODES_BY_DAY.get(day.day_number, ["strength"]))

        if next_codes != source_codes:
            day.routine_codes = next_codes[:2]
            day.save(update_fields=["routine_codes"])


class Migration(migrations.Migration):

    dependencies = [
        ("app_workout", "0053_cardiometricperiodselection"),
    ]

    operations = [
        migrations.CreateModel(
            name="SupplementalRecommendationSettings",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("per_week", models.PositiveSmallIntegerField(default=5)),
            ],
            options={
                "verbose_name": "Supplemental Recommendation Settings",
                "verbose_name_plural": "Supplemental Recommendation Settings",
            },
        ),
        migrations.RunPython(seed_supplemental_recommendation_settings, migrations.RunPython.noop),
        migrations.RunPython(remove_supplemental_from_schedule_days, migrations.RunPython.noop),
    ]
