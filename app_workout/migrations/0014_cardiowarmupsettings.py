from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("app_workout", "0013_cardiodailylog_mph_goals"),
    ]

    operations = [
        migrations.CreateModel(
            name="CardioWarmupSettings",
            fields=[
                ("id", models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("warmup_minutes_5k_prep", models.FloatField(default=5.0)),
                ("warmup_mph_5k_prep", models.FloatField(default=5.0)),
                ("warmup_minutes_sprints", models.FloatField(default=5.0)),
                ("warmup_mph_sprints", models.FloatField(default=6.0)),
            ],
            options={
                "verbose_name": "Cardio Warmup Settings",
                "verbose_name_plural": "Cardio Warmup Settings",
            },
        ),
    ]

