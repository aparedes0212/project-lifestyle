from django.db import migrations, models


BUCKET_ROWS = [
    {
        "min_max_reps": 1,
        "max_max_reps": 5,
        "training_set_reps": 1.0,
        "daily_volume_min": 30.0,
        "daily_volume_max": 60.0,
        "weekly_volume_min": 90.0,
        "weekly_volume_max": 180.0,
    },
    {
        "min_max_reps": 6,
        "max_max_reps": 8,
        "training_set_reps": 2.0,
        "daily_volume_min": 40.0,
        "daily_volume_max": 70.0,
        "weekly_volume_min": 120.0,
        "weekly_volume_max": 210.0,
    },
    {
        "min_max_reps": 9,
        "max_max_reps": 12,
        "training_set_reps": 3.0,
        "daily_volume_min": 50.0,
        "daily_volume_max": 80.0,
        "weekly_volume_min": 150.0,
        "weekly_volume_max": 240.0,
    },
    {
        "min_max_reps": 13,
        "max_max_reps": 16,
        "training_set_reps": 4.0,
        "daily_volume_min": 60.0,
        "daily_volume_max": 90.0,
        "weekly_volume_min": 180.0,
        "weekly_volume_max": 270.0,
    },
    {
        "min_max_reps": 17,
        "max_max_reps": 20,
        "training_set_reps": 5.0,
        "daily_volume_min": 75.0,
        "daily_volume_max": 120.0,
        "weekly_volume_min": 225.0,
        "weekly_volume_max": 360.0,
    },
    {
        "min_max_reps": 21,
        "max_max_reps": 24,
        "training_set_reps": 6.0,
        "daily_volume_min": 100.0,
        "daily_volume_max": 175.0,
        "weekly_volume_min": 300.0,
        "weekly_volume_max": 525.0,
    },
]


def seed_strength_volume_buckets(apps, schema_editor):
    StrengthVolumeBucket = apps.get_model("app_workout", "StrengthVolumeBucket")
    if StrengthVolumeBucket.objects.exists():
        return
    StrengthVolumeBucket.objects.bulk_create(
        [StrengthVolumeBucket(**row) for row in BUCKET_ROWS]
    )


def unseed_strength_volume_buckets(apps, schema_editor):
    StrengthVolumeBucket = apps.get_model("app_workout", "StrengthVolumeBucket")
    StrengthVolumeBucket.objects.all().delete()


def drop_strength_progression_artifact(apps, schema_editor):
    del apps
    connection = schema_editor.connection
    with connection.cursor() as cursor:
        object_map = {
            info.name: getattr(info, "type", None)
            for info in connection.introspection.get_table_list(cursor)
        }
    object_type = object_map.get("Vw_Strength_Progression")
    if not object_type:
        return

    quoted_name = schema_editor.quote_name("Vw_Strength_Progression")
    if object_type == "v":
        schema_editor.execute(f"DROP VIEW {quoted_name}")
    else:
        schema_editor.execute(f"DROP TABLE {quoted_name}")


class Migration(migrations.Migration):

    dependencies = [
        ("app_workout", "0050_delete_dailyactivityselection"),
    ]

    operations = [
        migrations.CreateModel(
            name="StrengthVolumeBucket",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("min_max_reps", models.PositiveIntegerField()),
                ("max_max_reps", models.PositiveIntegerField()),
                ("training_set_reps", models.FloatField()),
                ("daily_volume_min", models.FloatField()),
                ("daily_volume_max", models.FloatField()),
                ("weekly_volume_min", models.FloatField()),
                ("weekly_volume_max", models.FloatField()),
            ],
            options={
                "verbose_name": "Strength Volume Bucket",
                "verbose_name_plural": "Strength Volume Buckets",
                "ordering": ["min_max_reps", "max_max_reps"],
                "constraints": [
                    models.UniqueConstraint(
                        fields=("min_max_reps", "max_max_reps"),
                        name="uniq_strengthvolumebucket_range",
                    ),
                ],
            },
        ),
        migrations.RunPython(seed_strength_volume_buckets, unseed_strength_volume_buckets),
        migrations.DeleteModel(
            name="PullProgression",
        ),
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunPython(drop_strength_progression_artifact, migrations.RunPython.noop),
            ],
            state_operations=[
                migrations.DeleteModel(
                    name="VwStrengthProgression",
                ),
            ],
        ),
    ]
