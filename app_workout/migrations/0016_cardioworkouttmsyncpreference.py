from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("app_workout", "0015_alter_cardiowarmupsettings_id"),
    ]

    operations = [
        migrations.CreateModel(
            name="CardioWorkoutTMSyncPreference",
            fields=[
                ("id", models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                (
                    "default_tm_sync",
                    models.CharField(
                        choices=[
                            ("run_to_tm", "Run time → TM"),
                            ("tm_to_run", "TM → Run time"),
                            ("run_equals_tm", "Run time = TM"),
                            ("none", "No sync"),
                        ],
                        default="run_to_tm",
                        max_length=32,
                    ),
                ),
                (
                    "workout",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="tm_sync_pref",
                        to="app_workout.cardioworkout",
                    ),
                ),
            ],
            options={
                "verbose_name": "Cardio Workout TM Sync Preference",
                "verbose_name_plural": "Cardio Workout TM Sync Preferences",
                "ordering": ["workout__routine__name", "workout__name"],
            },
        ),
    ]

